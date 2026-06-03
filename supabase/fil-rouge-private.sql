-- REVEAL — Fil Rouge / Mot interdit (missions privées par joueur)
-- JEU ABANDONNÉ dans l'app (FIL_ROUGE_ENABLED = false) — conserver ce script pour réactivation future.
-- Run after schema.sql + game-sessions.sql

create or replace function public.is_lobby_host(p_lobby_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.lobbies
    where id = p_lobby_id and host_id = auth.uid()
  );
$$;

grant execute on function public.is_lobby_host(uuid) to authenticated;

create table if not exists public.fil_rouge_private (
  id uuid primary key default gen_random_uuid(),
  lobby_id uuid not null references public.lobbies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  setup_word text,
  mission_word text,
  mission_target_uid uuid references auth.users(id) on delete set null,
  mission_ack_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lobby_id, user_id)
);

create index if not exists fil_rouge_private_lobby_idx on public.fil_rouge_private (lobby_id);

drop trigger if exists fil_rouge_private_updated_at on public.fil_rouge_private;
create trigger fil_rouge_private_updated_at
before update on public.fil_rouge_private
for each row execute function public.set_updated_at();

alter table public.fil_rouge_private enable row level security;

drop policy if exists "fil_rouge_select_own" on public.fil_rouge_private;
create policy "fil_rouge_select_own" on public.fil_rouge_private
for select using (
  user_id = auth.uid()
  or public.is_lobby_host(lobby_id)
);

drop policy if exists "fil_rouge_insert_own" on public.fil_rouge_private;
create policy "fil_rouge_insert_own" on public.fil_rouge_private
for insert with check (
  user_id = auth.uid()
  and public.is_lobby_member(lobby_id)
);

drop policy if exists "fil_rouge_update_own_setup" on public.fil_rouge_private;
create policy "fil_rouge_update_own_setup" on public.fil_rouge_private
for update using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "fil_rouge_update_host" on public.fil_rouge_private;
create policy "fil_rouge_update_host" on public.fil_rouge_private
for update using (public.is_lobby_host(lobby_id));

-- Realtime optionnel : Database → Replication → fil_rouge_private
