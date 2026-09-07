-- =============================================================================
-- AV-STORAGE — Runbook (SQL Editor) — preuve des policies, pas de mutation data
-- Prérequis : coller supabase/feature-profile-av-storage.sql (SUCCESS).
-- QA upload réel : docs/DEPLOYMENTS_SQL.md §32 (compte sans pack vs Signature).
-- =============================================================================

do $$
declare
  v_fn text;
  v_ins text;
  v_upd_using text;
  v_upd_check text;
  v_del text;
  v_sel text;
  v_write_bad int;
  v_n int;
begin
  select pg_get_functiondef('public.can_write_own_avatar()'::regprocedure)
    into v_fn;
  if v_fn is null then
    raise exception 'AVSTORAGE_FN_MISSING';
  end if;
  if position('av-storage-v1' in v_fn) = 0 then
    raise exception 'AVSTORAGE_FN_NOT_V1';
  end if;
  if position('p.profile_pack' in v_fn) = 0 or position('p.host_pack' in v_fn) = 0 then
    raise exception 'AVSTORAGE_FN_PACKS_MISSING';
  end if;
  if position('auth.uid()' in v_fn) = 0 then
    raise exception 'AVSTORAGE_FN_NO_AUTH_UID';
  end if;

  select count(*)::int into v_n
  from pg_policies
  where schemaname = 'storage'
    and tablename = 'objects'
    and policyname like 'avatars%';
  if v_n <> 4 then
    raise exception 'AVSTORAGE_POLICY_COUNT_%', v_n;
  end if;

  select with_check into v_ins
  from pg_policies
  where schemaname = 'storage' and tablename = 'objects'
    and policyname = 'avatars owner insert';
  if v_ins is null or position('can_write_own_avatar' in v_ins) = 0 then
    raise exception 'AVSTORAGE_INSERT_NO_PACK';
  end if;
  if position('avatar.jpg' in v_ins) = 0 then
    raise exception 'AVSTORAGE_INSERT_NO_OWNER';
  end if;

  select qual, with_check into v_upd_using, v_upd_check
  from pg_policies
  where schemaname = 'storage' and tablename = 'objects'
    and policyname = 'avatars owner update';
  if position('can_write_own_avatar' in coalesce(v_upd_using, '')) = 0
     or position('can_write_own_avatar' in coalesce(v_upd_check, '')) = 0 then
    raise exception 'AVSTORAGE_UPDATE_NO_PACK';
  end if;

  select qual into v_del
  from pg_policies
  where schemaname = 'storage' and tablename = 'objects'
    and policyname = 'avatars owner delete';
  if v_del is null or position('can_write_own_avatar' in v_del) = 0 then
    raise exception 'AVSTORAGE_DELETE_NO_PACK';
  end if;

  select coalesce(qual, '') into v_sel
  from pg_policies
  where schemaname = 'storage' and tablename = 'objects'
    and policyname = 'avatars public read';
  if v_sel is null then
    raise exception 'AVSTORAGE_SELECT_MISSING';
  end if;
  if position('can_write_own_avatar' in v_sel) > 0 then
    raise exception 'AVSTORAGE_SELECT_GATED';
  end if;
  if position('avatars' in v_sel) = 0 then
    raise exception 'AVSTORAGE_SELECT_NOT_AVATARS';
  end if;

  select count(*)::int into v_write_bad
  from pg_policies
  where schemaname = 'storage'
    and tablename = 'objects'
    and policyname like 'avatars%'
    and cmd in ('INSERT', 'UPDATE', 'DELETE')
    and position('can_write_own_avatar' in coalesce(qual, '') || coalesce(with_check, '')) = 0;
  if v_write_bad > 0 then
    raise exception 'AVSTORAGE_PERMISSIVE_WRITE';
  end if;

  raise notice 'AVSTORAGE_POLICIES_OK';
end $$;
