-- REVEAL — cycle de vie des lobbies (expiration, heartbeat, purge)
-- SQL Editor → Run après schema.sql, game-sessions.sql, lobby-nudge.sql
--
-- Durées (alignées js/config/lobbyLifecycle.js) :
--   join refusé si inactif > 24 h
--   purge waiting : inactif > 2 h OU personne vu en ligne > 45 min
--   purge playing : inactif > 12 h
--   purge immédiate si 0 membre

-- ── Colonnes ────────────────────────────────────────────────────────────────

alter table public.lobbies
  add column if not exists last_activity_at timestamptz not null default now();

alter table public.lobby_members
  add column if not exists last_seen_at timestamptz not null default now();

update public.lobbies
set last_activity_at = coalesce(last_activity_at, updated_at, created_at)
where last_activity_at is null;

update public.lobby_members
set last_seen_at = coalesce(last_seen_at, joined_at, now())
where last_seen_at is null;

comment on column public.lobbies.last_activity_at is
  'Dernière activité lobby (jeu, membre, message, statut). Utilisé pour expiration / purge.';

comment on column public.lobby_members.last_seen_at is
  'Dernier heartbeat client (présence). Mis à jour par l''app toutes les ~60–120 s.';

-- ── Touch activité lobby ────────────────────────────────────────────────────

create or replace function public.touch_lobby_activity(p_lobby_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.lobbies
  set last_activity_at = now()
  where id = p_lobby_id;
$$;

grant execute on function public.touch_lobby_activity(uuid) to authenticated;

create or replace function public.set_lobbies_timestamps()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  new.last_activity_at = now();
  return new;
end;
$$;

drop trigger if exists lobbies_updated_at on public.lobbies;
create trigger lobbies_updated_at
before update on public.lobbies
for each row execute function public.set_lobbies_timestamps();

create or replace function public.touch_lobby_on_member_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.touch_lobby_activity(new.lobby_id);
  return new;
end;
$$;

drop trigger if exists lobby_members_touch_lobby on public.lobby_members;
create trigger lobby_members_touch_lobby
after insert on public.lobby_members
for each row execute function public.touch_lobby_on_member_insert();

create or replace function public.touch_lobby_on_member_seen()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.last_seen_at is distinct from old.last_seen_at then
    perform public.touch_lobby_activity(new.lobby_id);
  end if;
  return new;
end;
$$;

drop trigger if exists lobby_members_seen_touch_lobby on public.lobby_members;
create trigger lobby_members_seen_touch_lobby
after update of last_seen_at on public.lobby_members
for each row execute function public.touch_lobby_on_member_seen();

create or replace function public.touch_lobby_on_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.touch_lobby_activity(new.lobby_id);
  return new;
end;
$$;

drop trigger if exists lobby_messages_touch_lobby on public.lobby_messages;
create trigger lobby_messages_touch_lobby
after insert on public.lobby_messages
for each row execute function public.touch_lobby_on_message();

create or replace function public.touch_lobby_on_game_session()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.touch_lobby_activity(new.lobby_id);
  return new;
end;
$$;

drop trigger if exists game_sessions_touch_lobby on public.game_sessions;
create trigger game_sessions_touch_lobby
after insert or update on public.game_sessions
for each row execute function public.touch_lobby_on_game_session();

-- ── Recherche par code (refuse les lobbies expirés au join) ─────────────────

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

-- ── Purge des lobbies stale ─────────────────────────────────────────────────

create or replace function public.purge_stale_lobbies()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count integer;
begin
  with doomed as (
    select l.id
    from public.lobbies l
    where
      not exists (
        select 1 from public.lobby_members m where m.lobby_id = l.id
      )
      or (
        l.status = 'waiting'
        and coalesce(l.last_activity_at, l.updated_at, l.created_at)
          < now() - interval '2 hours'
      )
      or (
        l.status = 'playing'
        and coalesce(l.last_activity_at, l.updated_at, l.created_at)
          < now() - interval '12 hours'
      )
      or (
        l.status = 'waiting'
        and exists (select 1 from public.lobby_members m where m.lobby_id = l.id)
        and not exists (
          select 1 from public.lobby_members m
          where m.lobby_id = l.id
            and coalesce(m.last_seen_at, m.joined_at) > now() - interval '45 minutes'
        )
      )
  )
  delete from public.lobbies l
  using doomed d
  where l.id = d.id;

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function public.purge_stale_lobbies() from public;
-- Appel manuel (SQL Editor) ou pg_cron uniquement — pas exposé aux clients.

-- ── pg_cron (optionnel — Extensions → pg_cron) ─────────────────────────────
-- Décommente après activation de l'extension pg_cron sur ton projet Supabase :

-- select cron.unschedule('reveal-purge-stale-lobbies')
-- where exists (select 1 from cron.job where jobname = 'reveal-purge-stale-lobbies');

-- select cron.schedule(
--   'reveal-purge-stale-lobbies',
--   '*/15 * * * *',
--   $$ select public.purge_stale_lobbies(); $$
-- );

-- ── Monitoring (aperçu lobbies à risque) ───────────────────────────────────

create or replace view public.lobby_lifecycle_audit
with (security_invoker = on) as
select
  l.id,
  l.code,
  l.status,
  l.created_at,
  l.last_activity_at,
  (select count(*)::integer from public.lobby_members m where m.lobby_id = l.id) as member_count,
  (
    select max(coalesce(m.last_seen_at, m.joined_at))
    from public.lobby_members m
    where m.lobby_id = l.id
  ) as last_member_seen,
  pg_column_size(gs.state) as session_state_bytes
from public.lobbies l
left join public.game_sessions gs on gs.lobby_id = l.id
order by l.last_activity_at asc nulls first;

comment on view public.lobby_lifecycle_audit is
  'Lobbies triés par ancienneté d''activité — monitoring / nettoyage manuel.';

-- Outil d'admin uniquement : pas d'accès depuis les clients anon/authenticated.
revoke all on public.lobby_lifecycle_audit from anon, authenticated;
