-- FEATURE-HOST-04 — H-RACE : cap de sièges concurrent-safe sur INSERT lobby_members
--
-- Ticket : join par code (et tout INSERT) faisait count client puis INSERT.
-- Deux clients lisaient le même count et dépassaient 8/14.
--
-- Un BEFORE INSERT qui compte SANS lock resterait racy :
--   T1 count=7 ; T2 count=7 ; T1 insert ; T2 insert → 9.
-- Correctif : FOR UPDATE sur la ligne public.lobbies du salon, PUIS
-- cap (lobby_max_players) + count (get_lobby_member_count), PUIS RAISE ou INSERT.
--
-- Prérequis : FEATURE-HOST-02 (`lobby_max_players` + get_lobby_member_count).
-- Ne PAS réexécuter feature-friends-02.sql, HOST-02, HOST-03.
-- Ne remplace PAS accept_lobby_invite / send_lobby_invite / transfer_lobby_host.
-- Ne supprime JAMAIS de membres (H-TRANSFER : cap 14→8, les 10 restent).
--
-- À coller dans SQL Editor (staging puis prod). Idempotent.
-- Consigner dans docs/DEPLOYMENTS_SQL.md.

create or replace function public.lobby_members_enforce_seat_cap()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_lock uuid;
  v_cap integer;
  v_count integer;
begin
  -- h-race-v1
  if new.lobby_id is null then
    raise exception 'lobby_full';
  end if;

  select l.id
    into v_lock
    from public.lobbies l
   where l.id = new.lobby_id
   for update;

  if v_lock is null then
    raise exception 'lobby_full';
  end if;

  v_cap := public.lobby_max_players(new.lobby_id);
  v_count := public.get_lobby_member_count(new.lobby_id);

  if v_count >= v_cap then
    raise exception 'lobby_full';
  end if;

  return new;
end;
$$;

revoke all on function public.lobby_members_enforce_seat_cap() from public;
revoke all on function public.lobby_members_enforce_seat_cap() from anon;
revoke all on function public.lobby_members_enforce_seat_cap() from authenticated;

comment on function public.lobby_members_enforce_seat_cap() is
  'H-RACE / HOST-04 : BEFORE INSERT lobby_members. FOR UPDATE lobbies puis cap. Pas de DELETE membres.';

drop trigger if exists lobby_members_enforce_seat_cap on public.lobby_members;
create trigger lobby_members_enforce_seat_cap
before insert on public.lobby_members
for each row execute function public.lobby_members_enforce_seat_cap();
