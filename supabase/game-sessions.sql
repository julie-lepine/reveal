-- REVEAL — sessions de jeu multijoueur (SQL Editor → Run après schema.sql + fix-rls)

create table if not exists public.game_sessions (
  id uuid primary key default gen_random_uuid(),
  lobby_id uuid not null unique references public.lobbies(id) on delete cascade,
  game_id text not null,
  screen text not null,
  host_id uuid not null references auth.users(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists game_sessions_lobby_idx on public.game_sessions (lobby_id);

drop trigger if exists game_sessions_updated_at on public.game_sessions;
create trigger game_sessions_updated_at
before update on public.game_sessions
for each row execute function public.set_updated_at();

alter table public.game_sessions enable row level security;

drop policy if exists "game_sessions_select" on public.game_sessions;
create policy "game_sessions_select" on public.game_sessions
for select using (public.is_lobby_member(lobby_id));

drop policy if exists "game_sessions_insert" on public.game_sessions;
create policy "game_sessions_insert" on public.game_sessions
for insert with check (
  public.is_lobby_member(lobby_id) and auth.uid() = host_id
);

drop policy if exists "game_sessions_update" on public.game_sessions;
create policy "game_sessions_update" on public.game_sessions
for update
using (public.is_lobby_member(lobby_id))
with check (public.is_lobby_member(lobby_id));

drop policy if exists "game_sessions_delete" on public.game_sessions;
create policy "game_sessions_delete" on public.game_sessions
for delete using (auth.uid() = host_id);

-- Realtime : Database → Replication → activer aussi la table game_sessions
