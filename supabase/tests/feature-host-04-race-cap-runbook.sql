-- =============================================================================
-- FEATURE-HOST-04 / H-RACE — Runbook catalogue (SQL Editor) — lecture seule
-- Prérequis : coller supabase/feature-host-04-race-cap.sql (SUCCESS).
-- INTERDIT EN PRODUCTION comme mutation data (ce bloc ne crée aucun lobby).
-- Un RAISE EXCEPTION = échec.
-- Concurrence réelle : supabase/tests/feature-host-04-race-cap-concurrent.sql
-- =============================================================================

do $$
declare
  v_fn text;
  v_lock int;
  v_cap int;
  v_count int;
  v_pol text;
begin
  if to_regprocedure('public.lobby_members_enforce_seat_cap()') is null then
    raise exception 'HRACE_FN_MISSING';
  end if;

  select pg_get_functiondef('public.lobby_members_enforce_seat_cap()'::regprocedure)
    into v_fn;

  if position('h-race-v1' in v_fn) = 0 then
    raise exception 'HRACE_FN_NOT_V1';
  end if;

  v_lock := position('for update' in lower(v_fn));
  v_cap := position('lobby_max_players' in v_fn);
  v_count := position('get_lobby_member_count' in v_fn);

  if v_lock = 0 then
    raise exception 'HRACE_NO_FOR_UPDATE';
  end if;
  if v_cap = 0 then
    raise exception 'HRACE_NO_CAP';
  end if;
  if v_count = 0 then
    raise exception 'HRACE_NO_COUNT';
  end if;
  if v_lock > v_cap or v_lock > v_count then
    raise exception 'HRACE_LOCK_AFTER_COUNT';
  end if;
  if v_cap > v_count then
    raise exception 'HRACE_CAP_AFTER_COUNT';
  end if;

  if position('delete from' in lower(v_fn)) > 0 then
    raise exception 'HRACE_DELETES_MEMBERS';
  end if;
  if position('raise exception ''lobby_full''' in v_fn) = 0 then
    raise exception 'HRACE_NO_LOBBY_FULL';
  end if;
  if position('lock table' in lower(v_fn)) > 0 then
    raise exception 'HRACE_LOCK_TABLE';
  end if;

  if not exists (
    select 1
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'lobby_members'
      and t.tgname = 'lobby_members_enforce_seat_cap'
      and not t.tgisinternal
  ) then
    raise exception 'HRACE_TRIGGER_MISSING';
  end if;

  select coalesce(with_check, qual, '')
    into v_pol
  from pg_policies
  where schemaname = 'public'
    and tablename = 'lobby_members'
    and policyname = 'members_insert_self';

  if v_pol is null or position('auth.uid()' in v_pol) = 0 then
    raise exception 'HRACE_RLS_INSERT_SELF_GONE';
  end if;

  raise notice 'HRACE_SEAT_CAP_OK';
end $$;
