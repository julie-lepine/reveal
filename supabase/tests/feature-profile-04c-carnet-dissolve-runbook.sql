-- =============================================================================
-- FEATURE-PROFILE-04c — Runbook STAGING (SQL Editor) — lecture catalogue
-- Prérequis : coller supabase/feature-profile-04c-carnet-dissolve.sql (SUCCESS).
-- INTERDIT EN PRODUCTION (sauf le fichier de migration lui-même).
-- =============================================================================

do $$
declare
  v_fn text;
begin
  if to_regclass('public.signature_carnet_kick_allow') is null then
    raise exception 'CARNET04C_MISSING_ALLOW';
  end if;

  select pg_get_functiondef(
    'public.dissolve_lobby_atomically(uuid)'::regprocedure
  ) into v_fn;
  if position('signature_carnet_kick_allow' in v_fn) = 0 then
    raise exception 'CARNET04C_DISSOLVE_NO_ALLOW';
  end if;
  if position('profile_pack' in v_fn) = 0 then
    raise exception 'CARNET04C_DISSOLVE_NO_PACK_GATE';
  end if;
  if position('delete from public.lobbies' in lower(v_fn)) = 0 then
    raise exception 'CARNET04C_DISSOLVE_NO_DELETE';
  end if;
  if position('signature_carnet_kick_allow' in v_fn)
     > position('delete from public.lobbies' in lower(v_fn)) then
    raise exception 'CARNET04C_ALLOW_AFTER_DELETE';
  end if;

  raise notice 'CARNET04C_DISSOLVE_OK';
end $$;
