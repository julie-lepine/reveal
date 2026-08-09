-- =============================================================================
-- FEATURE-TIERNIGHT-04C — SMOKE CLEANUP d'urgence (manuel)
-- =============================================================================
-- Récupération si B2 a échoué mid-script (helpers/ctx/fixtures laissés).
-- Aucun CASCADE. Fixtures TN04C% uniquement. Pas de DELETE auth.users.
-- =============================================================================

do $$
declare
  v_clean jsonb := jsonb_build_object('skipped', true);
  v_left int;
begin
  if to_regprocedure('public.tn04c_cleanup_fixtures()') is not null then
    v_clean := public.tn04c_cleanup_fixtures();
  else
    -- Fallback si helper absent : purge fixtures TN04C% à la main
    delete from public.game_sessions gs
    using public.lobbies l where gs.lobby_id = l.id and l.code like 'TN04C%';
    delete from public.lobby_members lm
    using public.lobbies l where lm.lobby_id = l.id and l.code like 'TN04C%';
    delete from public.lobbies where code like 'TN04C%';
  end if;

  select count(*)::int into v_left from public.lobbies where code like 'TN04C%';
  if v_left <> 0 then
    raise exception 'TN04C emergency cleanup left % lobbies', v_left;
  end if;

  drop function if exists public.tn04c_set_jwt(uuid);
  drop function if exists public.tn04c_user_has_living_membership(uuid);
  drop function if exists public.tn04c_resolve_actors();
  drop function if exists public.tn04c_new_id();
  drop function if exists public.tn04c_valid_entry(text, text, text, jsonb, text, text);
  drop function if exists public.tn04c_build_state(uuid, uuid, jsonb, int, jsonb);
  drop function if exists public.tn04c_cleanup_fixtures();
  drop function if exists public.tn04c_spawn_fixture();
  drop function if exists public.tn04c_assert_rpc_acl(text, text);
  drop function if exists public.tn04c_assert_helper_owner_only(text);
  drop function if exists public.tn04c_list_ids(jsonb);
  drop function if exists public.tn04c_find_entry(jsonb, text);
  drop function if exists public.tn04c_assert_err(text, text, text);
  drop table if exists public.tn04c_smoke_ctx;

  raise notice 'TN04C EMERGENCY CLEANUP OK %', v_clean;
end $$;
