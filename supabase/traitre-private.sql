-- REVEAL — Spot the fake (Traitre) : rôle imposteur privé par joueur
-- Run after schema.sql + game-sessions.sql (+ fil-rouge-private.sql for is_lobby_host)

create table if not exists public.traitre_private (
  id uuid primary key default gen_random_uuid(),
  lobby_id uuid not null references public.lobbies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  pair_id text not null,
  is_impostor boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lobby_id, user_id)
);

create index if not exists traitre_private_lobby_idx on public.traitre_private (lobby_id);
create index if not exists traitre_private_pair_idx on public.traitre_private (lobby_id, pair_id);

drop trigger if exists traitre_private_updated_at on public.traitre_private;
create trigger traitre_private_updated_at
before update on public.traitre_private
for each row execute function public.set_updated_at();

alter table public.traitre_private enable row level security;

drop policy if exists "traitre_private_select_own" on public.traitre_private;
create policy "traitre_private_select_own" on public.traitre_private
for select using (
  user_id = auth.uid()
  or public.is_lobby_host(lobby_id)
);

drop policy if exists "traitre_private_insert_host" on public.traitre_private;
create policy "traitre_private_insert_host" on public.traitre_private
for insert with check (public.is_lobby_host(lobby_id));

drop policy if exists "traitre_private_update_host" on public.traitre_private;
create policy "traitre_private_update_host" on public.traitre_private
for update using (public.is_lobby_host(lobby_id));

drop policy if exists "traitre_private_delete_host" on public.traitre_private;
create policy "traitre_private_delete_host" on public.traitre_private
for delete using (public.is_lobby_host(lobby_id));
