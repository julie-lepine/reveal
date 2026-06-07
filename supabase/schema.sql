-- REVEAL — schéma Supabase (SQL Editor → Run)
-- Puis : Database → Replication → activer lobby_members, lobby_messages, lobbies

-- Profils
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) >= 2),
  emoji text default '👤',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Salons
create table if not exists public.lobbies (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (char_length(code) >= 4),
  host_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'waiting' check (status in ('waiting', 'playing')),
  game_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now()
);

create index if not exists lobbies_code_idx on public.lobbies (upper(code));

-- Membres
create table if not exists public.lobby_members (
  id uuid primary key default gen_random_uuid(),
  lobby_id uuid not null references public.lobbies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null,
  emoji text not null default '👤',
  color text not null default '#60A5FA',
  is_host boolean not null default false,
  ready boolean not null default false,
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (lobby_id, user_id)
);

create index if not exists lobby_members_lobby_idx on public.lobby_members (lobby_id);

-- Chat lobby
create table if not exists public.lobby_messages (
  id uuid primary key default gen_random_uuid(),
  lobby_id uuid not null references public.lobbies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null,
  body text not null check (char_length(body) between 1 and 200),
  created_at timestamptz not null default now()
);

create index if not exists lobby_messages_lobby_idx on public.lobby_messages (lobby_id, created_at);

-- updated_at
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists lobbies_updated_at on public.lobbies;
create trigger lobbies_updated_at
before update on public.lobbies
for each row execute function public.set_updated_at();

drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

-- Profil auto à l'inscription
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name, emoji)
  values (
    new.id,
    coalesce(
      nullif(trim(new.raw_user_meta_data->>'display_name'), ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'Joueur'
    ),
    coalesce(nullif(trim(new.raw_user_meta_data->>'emoji'), ''), '👤')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- Recherche lobby par code (pour rejoindre via QR / lien)
create or replace function public.find_lobby_by_code(p_code text)
returns table (id uuid, code text, status text, game_id text, host_id uuid, last_activity_at timestamptz)
language sql
security definer
set search_path = public
as $$
  select l.id, l.code, l.status, l.game_id, l.host_id, l.last_activity_at
  from public.lobbies l
  where upper(trim(l.code)) = upper(trim(p_code))
    and coalesce(l.last_activity_at, l.updated_at, l.created_at) > now() - interval '24 hours'
  limit 1;
$$;

grant execute on function public.find_lobby_by_code(text) to authenticated;

-- Helpers RLS (évite la récursion infinie sur lobby_members)
create or replace function public.is_lobby_member(p_lobby_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.lobby_members
    where lobby_id = p_lobby_id
      and user_id = auth.uid()
  );
$$;

create or replace function public.get_lobby_member_count(p_lobby_id uuid)
returns integer
language sql
security definer
set search_path = public
stable
as $$
  select count(*)::integer
  from public.lobby_members
  where lobby_id = p_lobby_id;
$$;

grant execute on function public.is_lobby_member(uuid) to authenticated;
grant execute on function public.get_lobby_member_count(uuid) to authenticated;

-- RLS
alter table public.profiles enable row level security;
alter table public.lobbies enable row level security;
alter table public.lobby_members enable row level security;
alter table public.lobby_messages enable row level security;

drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles for select using (true);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles for insert with check (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles for update using (auth.uid() = id);

drop policy if exists "lobbies_insert_host" on public.lobbies;
create policy "lobbies_insert_host" on public.lobbies for insert
with check (auth.uid() = host_id);

drop policy if exists "lobbies_update_host" on public.lobbies;
create policy "lobbies_update_host" on public.lobbies for update using (auth.uid() = host_id);

drop policy if exists "lobbies_select_host" on public.lobbies;
create policy "lobbies_select_host" on public.lobbies for select using (
  auth.uid() = host_id
);

drop policy if exists "lobbies_select_member" on public.lobbies;
create policy "lobbies_select_member" on public.lobbies for select using (
  public.is_lobby_member(id)
);

drop policy if exists "lobbies_delete_host" on public.lobbies;
create policy "lobbies_delete_host" on public.lobbies
  for delete using (auth.uid() = host_id);

drop policy if exists "members_select_same_lobby" on public.lobby_members;
create policy "members_select_same_lobby" on public.lobby_members for select using (
  public.is_lobby_member(lobby_id)
);

drop policy if exists "members_insert_self" on public.lobby_members;
create policy "members_insert_self" on public.lobby_members for insert
with check (auth.uid() = user_id);

drop policy if exists "members_update_self" on public.lobby_members;
create policy "members_update_self" on public.lobby_members for update using (auth.uid() = user_id);

drop policy if exists "members_delete_self" on public.lobby_members;
create policy "members_delete_self" on public.lobby_members for delete using (auth.uid() = user_id);

drop policy if exists "messages_select_same_lobby" on public.lobby_messages;
create policy "messages_select_same_lobby" on public.lobby_messages for select using (
  public.is_lobby_member(lobby_id)
);

drop policy if exists "messages_insert_member" on public.lobby_messages;
create policy "messages_insert_member" on public.lobby_messages for insert with check (
  auth.uid() = user_id
  and public.is_lobby_member(lobby_id)
);
