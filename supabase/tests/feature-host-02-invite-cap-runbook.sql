-- =============================================================================
-- FEATURE-HOST-02 — Runbook STAGING (SQL Editor) — lecture catalogue
-- Prérequis : coller supabase/feature-host-02-invite-cap.sql (SUCCESS) AVANT.
-- INTERDIT EN PRODUCTION (sauf le fichier de migration lui-même).
--
-- Ne crée / ne dissout AUCUN lobby. Ne touche PAS aux flags IAP.
-- Un RAISE EXCEPTION = échec.
-- =============================================================================

do $$
declare
  v_src text;
begin
  if to_regprocedure('public.lobby_max_players(uuid)') is null then
    raise exception 'HOST02_MISSING_HELPER';
  end if;

  if to_regprocedure('public.accept_lobby_invite(uuid)') is null then
    raise exception 'HOST02_MISSING_ACCEPT';
  end if;

  select pg_get_functiondef('public.lobby_max_players(uuid)'::regprocedure)
    into v_src;
  if position('host_pack' in v_src) = 0 then
    raise exception 'HOST02_HELPER_NO_HOST_PACK';
  end if;
  if position('return 14' in lower(v_src)) = 0 then
    raise exception 'HOST02_HELPER_NO_14';
  end if;

  select pg_get_functiondef('public.accept_lobby_invite(uuid)'::regprocedure)
    into v_src;
  if position('lobby_max_players' in v_src) = 0 then
    raise exception 'HOST02_ACCEPT_STILL_HARD_8';
  end if;
  if v_src ~ 'get_lobby_member_count\(v_lobby_id\) >= 8' then
    raise exception 'HOST02_ACCEPT_HARDCODED_8';
  end if;

  raise notice 'HOST02_INVITE_CAP_OK';
end $$;
