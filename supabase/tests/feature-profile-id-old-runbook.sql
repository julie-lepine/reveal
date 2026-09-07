-- =============================================================================
-- ID-OLD — Runbook (SQL Editor) — preuve des fonctions, pas de mutation
-- Prérequis : coller supabase/feature-profile-id-old.sql (SUCCESS).
-- QA données Anrobensy : voir docs/DEPLOYMENTS_SQL.md §30 (pas ce fichier).
-- =============================================================================

do $$
declare
  v_cos text;
  v_ava text;
begin
  select pg_get_functiondef('public.profiles_signature_cosmetics()'::regprocedure)
    into v_cos;
  if position('03c-persist-v4' in v_cos) = 0 then
    raise exception 'IDOLD_COSMETICS_NOT_V4';
  end if;
  if position('coalesce(old.profile_pack, false) or coalesce(new.profile_pack, false)' in v_cos) = 0 then
    raise exception 'IDOLD_COSMETICS_NO_OR_PACK';
  end if;
  if position('coalesce(old.profile_pack, new.profile_pack, false)' in v_cos) > 0 then
    raise exception 'IDOLD_COSMETICS_OLD_COALESCE';
  end if;
  if position('select p.profile_pack into v_existing' in v_cos) = 0 then
    raise exception 'IDOLD_COSMETICS_INSERT_BRANCH_MISSING';
  end if;

  select pg_get_functiondef('public.profiles_signature_avatar()'::regprocedure)
    into v_ava;
  if position('id-old-v1' in v_ava) = 0 then
    raise exception 'IDOLD_AVATAR_NOT_V1';
  end if;
  if position('coalesce(old.profile_pack, false) or coalesce(new.profile_pack, false)' in v_ava) = 0 then
    raise exception 'IDOLD_AVATAR_NO_OR_PACK';
  end if;
  if position('coalesce(old.profile_pack, new.profile_pack, false)' in v_ava) > 0 then
    raise exception 'IDOLD_AVATAR_OLD_COALESCE';
  end if;

  raise notice 'IDOLD_FUNCTIONS_OK';
end $$;
