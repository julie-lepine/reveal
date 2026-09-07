-- =============================================================================
-- FEATURE-PROFILE-04b — Runbook STAGING (SQL Editor) — lecture catalogue
-- Prérequis : coller supabase/feature-profile-04b-carnet-kick.sql (SUCCESS).
-- INTERDIT EN PRODUCTION (sauf le fichier de migration lui-même).
-- =============================================================================

do $$
declare
  v_kick text;
  v_arch text;
begin
  if to_regclass('public.signature_carnet_kick_allow') is null then
    raise exception 'CARNET04B_MISSING_ALLOW';
  end if;

  select pg_get_functiondef('public.kick_lobby_member(uuid, uuid)'::regprocedure)
    into v_kick;
  if position('signature_carnet_kick_allow' in v_kick) = 0 then
    raise exception 'CARNET04B_KICK_NO_ALLOW';
  end if;
  if position('profile_pack' in v_kick) = 0 then
    raise exception 'CARNET04B_KICK_NO_PACK_GATE';
  end if;

  select pg_get_functiondef(
    'public.archive_signature_evening(uuid, integer, integer, text[], uuid[])'::regprocedure
  ) into v_arch;
  if position('signature_carnet_kick_allow' in v_arch) = 0 then
    raise exception 'CARNET04B_ARCHIVE_NO_ALLOW';
  end if;
  if position('is_lobby_member' in v_arch) = 0 then
    raise exception 'CARNET04B_ARCHIVE_DROPPED_MEMBER_GATE';
  end if;

  raise notice 'CARNET04B_KICK_OK';
end $$;
