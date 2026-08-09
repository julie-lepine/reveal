-- =============================================================================
-- FEATURE-TIERNIGHT-04E — SMOKE CLEANUP d'urgence (manuel)
-- =============================================================================
-- Récupération si A1/A2 a échoué mid-script (helpers/ctx/fixtures laissés).
-- Aucun CASCADE. Fixtures TN04EA% + legacy nommé TN04EG% uniquement.
-- INTERDIT : purge générique TN04E% (hors cible, cf. leçon 04C). Pas de
-- DELETE auth.users.
-- =============================================================================

do $$
declare
  v_clean jsonb := jsonb_build_object('skipped', true);
  v_left int;
begin
  if to_regprocedure('public.tn04ea_cleanup_fixtures()') is not null then
    v_clean := public.tn04ea_cleanup_fixtures();
  else
    -- Fallback si helper absent : purge fixtures TN04EA% + legacy TN04EG% à la main.
    delete from public.game_sessions gs
    using public.lobbies l where gs.lobby_id = l.id and l.code like 'TN04EA%';
    delete from public.lobby_members lm
    using public.lobbies l where lm.lobby_id = l.id and l.code like 'TN04EA%';
    delete from public.lobbies where code like 'TN04EA%';

    delete from public.game_sessions gs
    using public.lobbies l where gs.lobby_id = l.id and l.code like 'TN04EG%';
    delete from public.lobby_members lm
    using public.lobbies l where lm.lobby_id = l.id and l.code like 'TN04EG%';
    delete from public.lobbies where code like 'TN04EG%';
  end if;

  select count(*)::int into v_left
  from public.lobbies where code like 'TN04EA%' or code like 'TN04EG%';
  if v_left <> 0 then
    raise exception 'TN04EA emergency cleanup left % lobbies', v_left;
  end if;

  drop function if exists public.tn04ea_set_jwt(uuid);
  drop function if exists public.tn04ea_user_has_living_membership(uuid);
  drop function if exists public.tn04ea_resolve_actors();
  drop function if exists public.tn04ea_new_custom_id();
  drop function if exists public.tn04ea_official_snap(text, text);
  drop function if exists public.tn04ea_custom_entry(text, uuid);
  drop function if exists public.tn04ea_queue_entry(int, text, jsonb);
  drop function if exists public.tn04ea_series(text, int, jsonb);
  drop function if exists public.tn04ea_cleanup_fixtures();
  drop function if exists public.tn04ea_spawn_prep(jsonb, int, int);
  drop function if exists public.tn04ea_assert_err(text, text, text);
  drop function if exists public.tn04ea_assert_rpc_acl(text, text);
  drop function if exists public.tn04ea_assert_helper_owner_only(text);
  drop table if exists public.tn04ea_smoke_ctx;

  -- Legacy draft names (tn04e_* / TN04E% era) — safe leftover cleanup, no CASCADE.
  drop function if exists public.tn04e_set_jwt(uuid);
  drop function if exists public.tn04e_user_has_living_membership(uuid);
  drop function if exists public.tn04e_resolve_actors();
  drop function if exists public.tn04e_new_custom_id();
  drop function if exists public.tn04e_official_snap(text, text);
  drop function if exists public.tn04e_custom_entry(text, uuid);
  drop function if exists public.tn04e_queue_entry(int, text, jsonb);
  drop function if exists public.tn04e_series(text, int, jsonb);
  drop function if exists public.tn04e_cleanup_fixtures();
  drop function if exists public.tn04e_spawn_prep(jsonb, int, int);
  drop function if exists public.tn04e_assert_err(text, text, text);
  drop function if exists public.tn04e_assert_rpc_acl(text, text);
  drop function if exists public.tn04e_assert_helper_owner_only(text);
  drop table if exists public.tn04e_smoke_ctx;

  raise notice 'TN04EA EMERGENCY CLEANUP OK %', v_clean;
end $$;
