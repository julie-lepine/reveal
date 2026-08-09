-- =============================================================================
-- FEATURE-TIERNIGHT-04E (migration B) — SMOKE CLEANUP d'urgence (manuel)
-- =============================================================================
-- Récupération si B1/B2 a échoué mid-script (helpers/ctx/fixtures laissés).
-- Aucun CASCADE. Fixtures TN04EB% + legacy nommé TN04EG% uniquement.
-- INTERDIT : purge générique TN04E% (hors cible, collision TN04EA). Pas de
-- DELETE auth.users.
-- =============================================================================

do $$
declare
  v_clean jsonb := jsonb_build_object('skipped', true);
  v_left int;
begin
  if to_regprocedure('public.tn04eb_cleanup_fixtures()') is not null then
    v_clean := public.tn04eb_cleanup_fixtures();
  else
    -- Fallback si helper absent : purge fixtures TN04EB% + legacy TN04EG% à la main.
    delete from public.game_sessions gs
    using public.lobbies l where gs.lobby_id = l.id and l.code like 'TN04EB%';
    delete from public.lobby_members lm
    using public.lobbies l where lm.lobby_id = l.id and l.code like 'TN04EB%';
    delete from public.lobbies where code like 'TN04EB%';

    delete from public.game_sessions gs
    using public.lobbies l where gs.lobby_id = l.id and l.code like 'TN04EG%';
    delete from public.lobby_members lm
    using public.lobbies l where lm.lobby_id = l.id and l.code like 'TN04EG%';
    delete from public.lobbies where code like 'TN04EG%';
  end if;

  select count(*)::int into v_left
  from public.lobbies where code like 'TN04EB%' or code like 'TN04EG%';
  if v_left <> 0 then
    raise exception 'TN04EB emergency cleanup left % lobbies', v_left;
  end if;

  drop function if exists public.tn04eb_spawn_fixture(text, int, int);
  drop function if exists public.tn04eb_cleanup_fixtures();
  drop function if exists public.tn04eb_build_state(uuid, uuid, text, text, int, int);
  drop function if exists public.tn04eb_session_state(uuid);
  drop function if exists public.tn04eb_resolve_actors();
  drop function if exists public.tn04eb_user_has_living_membership(uuid);
  drop function if exists public.tn04eb_set_jwt(uuid);
  drop table if exists public.tn04eb_smoke_ctx;

  -- Legacy brouillon (tn04eg_* / TN04EG%) — safe leftover cleanup, no CASCADE.
  drop function if exists public.tn04eg_spawn_fixture(text, int, int);
  drop function if exists public.tn04eg_cleanup_fixtures();
  drop function if exists public.tn04eg_build_state(uuid, uuid, text, text, int, int);
  drop function if exists public.tn04eg_session_state(uuid);
  drop function if exists public.tn04eg_resolve_actors();
  drop function if exists public.tn04eg_set_jwt(uuid);
  drop table if exists public.tn04eg_smoke_ctx;

  raise notice 'TN04EB EMERGENCY CLEANUP OK %', v_clean;
end $$;
