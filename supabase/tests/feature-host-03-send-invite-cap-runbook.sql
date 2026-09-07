-- =============================================================================
-- FEATURE-HOST-03 — Runbook STAGING (SQL Editor) — lecture catalogue
-- Prérequis : coller supabase/feature-host-03-send-invite-cap.sql (SUCCESS) AVANT.
-- INTERDIT EN PRODUCTION (sauf le fichier de migration lui-même).
--
-- Ne crée / ne dissout AUCUN lobby. Ne touche PAS aux flags IAP.
-- Un RAISE EXCEPTION = échec.
-- =============================================================================

do $$
declare
  v_src text;
begin
  if to_regprocedure('public.send_lobby_invite(uuid)') is null then
    raise exception 'HOST03_MISSING_SEND';
  end if;

  if to_regprocedure('public.lobby_max_players(uuid)') is null then
    raise exception 'HOST03_MISSING_HELPER';
  end if;

  select pg_get_functiondef('public.send_lobby_invite(uuid)'::regprocedure)
    into v_src;
  if position('lobby_max_players' in v_src) = 0 then
    raise exception 'HOST03_SEND_NO_CAP';
  end if;
  if position('lobby_invite_full' in v_src) = 0 then
    raise exception 'HOST03_SEND_NO_FULL';
  end if;

  raise notice 'HOST03_SEND_INVITE_CAP_OK';
end $$;
