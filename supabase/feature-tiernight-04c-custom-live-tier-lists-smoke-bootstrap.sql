-- =============================================================================
-- FEATURE-TIERNIGHT-04C — SMOKE B1 (bootstrap) customLiveTierLists
-- =============================================================================
--
-- EXÉCUTER B1 SEUL D'ABORD. Attendre SUCCESS avant B2.
-- Migration A déjà validée — NE PAS re-exécuter A.
--
--   A) MIGRATION (déjà appliquée) :
--        supabase/feature-tiernight-04c-custom-live-tier-lists.sql
--
--   B1) BOOTSTRAP (ce fichier) :
--        supabase/feature-tiernight-04c-custom-live-tier-lists-smoke-bootstrap.sql
--      Drop helpers tn04c_* + table ctx → recreate fresh → R0/R1 → spawn fixture.
--      Laisse helpers + ctx en place pour B2. Ne run PAS C1–C25.
--
--   B2) TESTS (après SUCCESS B1) :
--        supabase/feature-tiernight-04c-custom-live-tier-lists-smoke-tests.sql
--
--   Cleanup d'urgence (si B2 mid-fail) :
--        supabase/feature-tiernight-04c-custom-live-tier-lists-smoke-cleanup.sql
--
-- Prérequis :
--   1. Migration A appliquée sur staging
--   2. ≥ 2 auth.users SANS membership vivant (tn04c_user_has_living_membership)
--   3. SQL Editor : postgres / supabase_admin
--
-- Fixtures : lobbies.code LIKE 'TN04C%' uniquement — aucun DELETE de lobby réel.
-- Aucun CREATE OR REPLACE de RPC produit. Aucun CASCADE. Aucun DELETE auth.users.
-- =============================================================================

-- ############################################################################
-- B1.0 — Drop old harness helpers (safe order, NO CASCADE) puis table ctx
-- ############################################################################

drop function if exists public.tn04c_assert_err(text, text, text);
drop function if exists public.tn04c_find_entry(jsonb, text);
drop function if exists public.tn04c_list_ids(jsonb);
drop function if exists public.tn04c_assert_helper_owner_only(text);
drop function if exists public.tn04c_assert_rpc_acl(text, text);
drop function if exists public.tn04c_spawn_fixture();
drop function if exists public.tn04c_cleanup_fixtures();
drop function if exists public.tn04c_build_state(uuid, uuid, jsonb, int, jsonb);
drop function if exists public.tn04c_valid_entry(text, text, text, jsonb, text, text);
drop function if exists public.tn04c_new_id();
drop function if exists public.tn04c_resolve_actors();
drop function if exists public.tn04c_user_has_living_membership(uuid);
drop function if exists public.tn04c_set_jwt(uuid);

drop table if exists public.tn04c_smoke_ctx;

-- ############################################################################
-- B1.1 — CREATE TABLE ctx (fresh shape, pas IF NOT EXISTS + ALTER)
-- ############################################################################

create table public.tn04c_smoke_ctx (
  id int primary key default 1 check (id = 1),
  lobby_id uuid,
  host_id uuid,
  guest_id uuid,
  code text,
  session_id uuid,
  id_a text,
  id_b text,
  epoch_after_clear int,
  updated_at timestamptz not null default now()
);

do $$
begin
  if to_regclass('public.tn04c_smoke_ctx') is null then
    raise exception 'TN04C_BOOTSTRAP_CONTEXT_TABLE_MISSING';
  end if;
  raise notice 'TN04C B1 — public.tn04c_smoke_ctx créé';
end $$;

-- ############################################################################
-- B1.2 — Recreate ALL harness helpers
-- ############################################################################

create or replace function public.tn04c_set_jwt(p_uid uuid)
returns uuid
language plpgsql
as $$
begin
  if p_uid is null then
    raise exception 'TN04C_NO_UID';
  end if;
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_uid::text, 'role', 'authenticated')::text,
    true
  );
  if auth.uid() is distinct from p_uid then
    raise exception 'TN04C_JWT_FAILED want=% auth.uid()=%', p_uid, auth.uid();
  end if;
  return auth.uid();
end;
$$;

create or replace function public.tn04c_user_has_living_membership(p_uid uuid)
returns boolean
language sql
stable
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.lobby_members m
    inner join public.lobbies l on l.id = m.lobby_id
    where m.user_id = p_uid
  );
$$;

create or replace function public.tn04c_resolve_actors()
returns table (host_id uuid, guest_id uuid)
language plpgsql
as $$
declare
  v_host uuid;
  v_guest uuid;
begin
  select u.id into v_host
  from auth.users u
  where not public.tn04c_user_has_living_membership(u.id)
  order by u.created_at asc nulls last, u.id asc
  limit 1;

  select u.id into v_guest
  from auth.users u
  where u.id is distinct from v_host
    and not public.tn04c_user_has_living_membership(u.id)
  order by u.created_at asc nulls last, u.id asc
  limit 1;

  if v_host is null or v_guest is null then
    raise exception
      'TN04C_NEED_2_FREE_AUTH_USERS host=% guest=% (living = lobby_members⋈lobbies)',
      v_host, v_guest;
  end if;

  host_id := v_host;
  guest_id := v_guest;
  return next;
end;
$$;

create or replace function public.tn04c_new_id()
returns text
language sql
volatile
as $$
  select 'custom-live-' || gen_random_uuid()::text;
$$;

create or replace function public.tn04c_valid_entry(
  p_id text,
  p_name text default 'TN04C List',
  p_emoji text default '🎯',
  p_items jsonb default '["alpha","bravo","charlie","delta"]'::jsonb,
  p_author text default 'forged',
  p_author_uid text default 'forged-uid'
)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'id', p_id,
    'name', p_name,
    'emoji', p_emoji,
    'items', p_items,
    'author', p_author,
    'authorUid', p_author_uid,
    'custom', true
  );
$$;

create or replace function public.tn04c_build_state(
  p_host uuid,
  p_guest uuid,
  p_lists jsonb default '[]'::jsonb,
  p_epoch int default null,
  p_writable jsonb default 'true'::jsonb
)
returns jsonb
language sql
immutable
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'customLiveTierLists', coalesce(p_lists, '[]'::jsonb),
    'customLiveTierListsEpoch', to_jsonb(p_epoch),
    'customLiveTierListsWritable', p_writable,
    'customRosterTopics', jsonb_build_array(
      jsonb_build_object(
        'id', 'custom-roster-tn04c-keep',
        'name', 'TN04C Roster Keep',
        'custom', true,
        'authorUid', p_host::text,
        'author', 'TN04C Host'
      )
    ),
    'customRosterTopicsEpoch', 3,
    'customRosterTopicsWritable', true,
    'customTierLists', jsonb_build_array(
      jsonb_build_object('id', 'live-catalog-keep', 'name', 'Catalog Keep', 'items', jsonb_build_array('a'))
    ),
    'tierNight', jsonb_build_object(
      'series', jsonb_build_object(
        'phase', 'between_rounds',
        'queue', jsonb_build_array(jsonb_build_object('topicId', 'q1')),
        'roundHistory', jsonb_build_array(
          jsonb_build_object(
            'topicSnapshot', jsonb_build_object('id', 'snap-tn04c', 'name', 'Snap Keep')
          )
        ),
        'scores', jsonb_build_object(p_host::text, 7, p_guest::text, 3)
      )
    ),
    'hotTake', jsonb_build_object('customTakes', '[]'::jsonb),
    'dilemma', jsonb_build_object('customDilemmas', '[]'::jsonb)
  ));
$$;

create or replace function public.tn04c_cleanup_fixtures()
returns jsonb
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_lobbies int := 0;
  v_members int := 0;
  v_sessions int := 0;
begin
  -- Uniquement fixtures TN04C% — jamais de lobbies réels.
  delete from public.game_sessions gs
  using public.lobbies l where gs.lobby_id = l.id and l.code like 'TN04C%';
  get diagnostics v_sessions = row_count;
  delete from public.lobby_members lm
  using public.lobbies l where lm.lobby_id = l.id and l.code like 'TN04C%';
  get diagnostics v_members = row_count;
  delete from public.lobbies where code like 'TN04C%';
  get diagnostics v_lobbies = row_count;

  -- Tolérant : table ctx absente après rollback / cleanup partiel / helpers orphelins.
  if to_regclass('public.tn04c_smoke_ctx') is not null then
    delete from public.tn04c_smoke_ctx;
  end if;

  return jsonb_build_object(
    'lobbies', v_lobbies,
    'members', v_members,
    'sessions', v_sessions
  );
end;
$$;

create or replace function public.tn04c_spawn_fixture()
returns jsonb
language plpgsql
as $$
declare
  v_host uuid;
  v_guest uuid;
  v_lobby uuid := gen_random_uuid();
  v_code text := 'TN04C' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 7);
  v_id_a text := public.tn04c_new_id();
  v_id_b text := public.tn04c_new_id();
  v_state jsonb;
  v_session uuid;
  v_member_count int;
  v_lobby_count int;
  v_session_count int;
begin
  perform public.tn04c_cleanup_fixtures();

  select a.host_id, a.guest_id
  into v_host, v_guest
  from public.tn04c_resolve_actors() a;

  if public.tn04c_user_has_living_membership(v_host)
     or public.tn04c_user_has_living_membership(v_guest) then
    raise exception
      'TN04C_ACTORS_BUSY_AFTER_RESOLVE host=% guest=% — relancer spawn',
      v_host, v_guest;
  end if;

  begin
    insert into public.lobbies (id, code, host_id, status, game_id)
    values (v_lobby, v_code, v_host, 'playing', 'tiernight');

    insert into public.lobby_members (lobby_id, user_id, display_name, emoji, color, is_host, ready)
    values
      (v_lobby, v_host, 'TN04C Host', '👑', '#F59E0B', true, true),
      (v_lobby, v_guest, 'TN04C Guest', '🙂', '#60A5FA', false, true);
  exception
    when unique_violation then
      perform public.tn04c_cleanup_fixtures();
      raise exception
        'TN04C_ACTOR_BECAME_BUSY unique_violation (lobby_members_one_living_per_user) — relancer ; aucun fallback vers user occupé'
        using errcode = 'P0001';
  end;

  -- Prep ouverte : writable true, pas de série live, pas de lobbyStarted.
  v_state := public.tn04c_build_state(v_host, v_guest, '[]'::jsonb, null, 'true'::jsonb);

  insert into public.game_sessions (lobby_id, game_id, screen, host_id, state)
  values (v_lobby, 'tiernight', 'tiernight-live-prep', v_host, v_state)
  returning id into v_session;

  select count(*)::int into v_lobby_count
  from public.lobbies where code like 'TN04C%';
  select count(*)::int into v_member_count
  from public.lobby_members lm
  join public.lobbies l on l.id = lm.lobby_id
  where l.code like 'TN04C%';
  select count(*)::int into v_session_count
  from public.game_sessions gs
  join public.lobbies l on l.id = gs.lobby_id
  where l.code like 'TN04C%';

  if v_lobby_count is distinct from 1
     or v_member_count is distinct from 2
     or v_session_count is distinct from 1 then
    perform public.tn04c_cleanup_fixtures();
    raise exception
      'TN04C_SPAWN_SHAPE lobbies=% members=% sessions=% (attendu 1/2/1)',
      v_lobby_count, v_member_count, v_session_count;
  end if;

  insert into public.tn04c_smoke_ctx as c (
    id, lobby_id, host_id, guest_id, code, session_id, id_a, id_b,
    epoch_after_clear, updated_at
  ) values (
    1, v_lobby, v_host, v_guest, v_code, v_session, v_id_a, v_id_b,
    null, now()
  )
  on conflict (id) do update set
    lobby_id = excluded.lobby_id,
    host_id = excluded.host_id,
    guest_id = excluded.guest_id,
    code = excluded.code,
    session_id = excluded.session_id,
    id_a = excluded.id_a,
    id_b = excluded.id_b,
    epoch_after_clear = null,
    updated_at = now();

  return jsonb_build_object(
    'ok', true,
    'lobby_id', v_lobby,
    'session_id', v_session,
    'host_id', v_host,
    'guest_id', v_guest,
    'code', v_code,
    'id_a', v_id_a,
    'id_b', v_id_b
  );
end;
$$;

create or replace function public.tn04c_assert_rpc_acl(p_name text, p_label text)
returns void
language plpgsql
as $$
declare
  v_definer boolean; v_config text[]; v_auth boolean; v_anon boolean; v_public boolean;
  v_oid oid; v_args text;
begin
  select p.oid, p.prosecdef, p.proconfig, pg_get_function_identity_arguments(p.oid)
  into v_oid, v_definer, v_config, v_args
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = p_name
  order by p.oid desc limit 1;

  if v_oid is null then raise exception '% missing %', p_label, p_name; end if;
  if v_definer is not true then raise exception '% DEFINER attendu', p_label; end if;
  if v_config is null or not exists (
    select 1 from unnest(coalesce(v_config, array[]::text[])) c
    where c ilike '%pg_catalog%' and c ilike '%public%'
  ) then
    raise exception '% search_path attendu ; got %', p_label, v_config;
  end if;

  v_auth := has_function_privilege('authenticated', v_oid, 'EXECUTE');
  v_anon := has_function_privilege('anon', v_oid, 'EXECUTE');
  v_public := has_function_privilege('public', v_oid, 'EXECUTE');
  if v_auth is not true then raise exception '% authenticated EXECUTE', p_label; end if;
  if v_anon is not false then raise exception '% anon EXECUTE interdit', p_label; end if;
  if v_public is not false then raise exception '% public EXECUTE interdit', p_label; end if;
end;
$$;

create or replace function public.tn04c_assert_helper_owner_only(p_name text)
returns void
language plpgsql
as $$
declare
  v_oid oid;
begin
  select p.oid into v_oid
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = p_name
  order by p.oid desc limit 1;
  if v_oid is null then raise exception 'helper missing %', p_name; end if;
  if has_function_privilege('authenticated', v_oid, 'EXECUTE') then
    raise exception 'helper % ne doit PAS grant authenticated', p_name;
  end if;
  if has_function_privilege('anon', v_oid, 'EXECUTE') then
    raise exception 'helper % ne doit PAS grant anon', p_name;
  end if;
  if has_function_privilege('public', v_oid, 'EXECUTE') then
    raise exception 'helper % ne doit PAS grant public', p_name;
  end if;
end;
$$;

create or replace function public.tn04c_list_ids(p_state jsonb)
returns text[]
language sql
stable
as $$
  select coalesce(
    array_agg(e ->> 'id' order by ordinality),
    array[]::text[]
  )
  from jsonb_array_elements(coalesce(p_state -> 'customLiveTierLists', '[]'::jsonb))
    with ordinality as t(e, ordinality);
$$;

create or replace function public.tn04c_find_entry(p_state jsonb, p_id text)
returns jsonb
language sql
stable
as $$
  select e
  from jsonb_array_elements(coalesce(p_state -> 'customLiveTierLists', '[]'::jsonb)) e
  where e ->> 'id' = p_id
  limit 1;
$$;

create or replace function public.tn04c_assert_err(p_err text, p_needle text, p_label text)
returns void
language plpgsql
as $$
begin
  if position(p_needle in coalesce(p_err, '')) = 0 then
    raise exception '% attendu needle=% got %', p_label, p_needle, p_err;
  end if;
end;
$$;

-- ############################################################################
-- R0) Signatures RPC + ACL + helpers owner-only
-- ############################################################################

do $$
declare
  v_args text;
  v_n int;
begin
  -- upsert
  select pg_get_function_identity_arguments(p.oid) into v_args
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'upsert_player_custom_live_tier_list'
  order by p.oid desc limit 1;
  if v_args is distinct from 'p_lobby_id uuid, p_entry jsonb'
     and v_args is distinct from 'uuid, jsonb' then
    if position('uuid' in coalesce(v_args, '')) = 0
       or position('jsonb' in coalesce(v_args, '')) = 0 then
      raise exception 'R0 upsert signature got %', v_args;
    end if;
  end if;
  perform public.tn04c_assert_rpc_acl('upsert_player_custom_live_tier_list', 'R0 upsert');

  -- delete
  select pg_get_function_identity_arguments(p.oid) into v_args
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'delete_player_custom_live_tier_list'
  order by p.oid desc limit 1;
  if v_args is distinct from 'p_lobby_id uuid, p_entry_id text'
     and v_args is distinct from 'uuid, text' then
    if position('uuid' in coalesce(v_args, '')) = 0
       or position('text' in coalesce(v_args, '')) = 0 then
      raise exception 'R0 delete signature got %', v_args;
    end if;
  end if;
  perform public.tn04c_assert_rpc_acl('delete_player_custom_live_tier_list', 'R0 delete');

  -- clear CAS
  select pg_get_function_identity_arguments(p.oid) into v_args
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'clear_tiernight_custom_live_tier_lists'
  order by p.oid desc limit 1;
  if v_args is distinct from 'p_lobby_id uuid, p_expected_session_id uuid, p_reopen boolean'
     and v_args is distinct from 'uuid, uuid, boolean' then
    if (select count(*) from regexp_matches(coalesce(v_args, ''), 'uuid', 'g')) < 2 then
      raise exception 'R0 clear signature CAS attendue got %', v_args;
    end if;
  end if;
  select count(*)::int into v_n
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'clear_tiernight_custom_live_tier_lists';
  if v_n is distinct from 1 then
    raise exception 'R0 nombre de signatures clear ≠ 1 got %', v_n;
  end if;
  perform public.tn04c_assert_rpc_acl('clear_tiernight_custom_live_tier_lists', 'R0 clear');

  -- Dépendance host canonique (1 arg) — pas is_lobby_host(uuid,uuid)
  if to_regprocedure('public.is_lobby_host(uuid)') is null then
    raise exception 'R0 is_lobby_host(uuid) missing';
  end if;
  if to_regprocedure('public.is_lobby_host(uuid,uuid)') is not null then
    raise exception 'R0 signature fantôme is_lobby_host(uuid,uuid) présente — inattendu';
  end if;
  if to_regprocedure('public.assert_lobby_member(uuid)') is null then
    raise exception 'R0 assert_lobby_member(uuid) missing';
  end if;

  -- preserve étendu (toujours présent ; sémantique live vérifiée en C25)
  if to_regprocedure('public.upsert_game_session_preserving_roster_topics(uuid,text,text,jsonb)') is null then
    raise exception 'R0 preserve missing';
  end if;
  perform public.tn04c_assert_rpc_acl(
    'upsert_game_session_preserving_roster_topics', 'R0 preserve'
  );

  -- helpers owner-only (prédicat + parse + build)
  perform public.tn04c_assert_helper_owner_only('tiernight_parse_custom_live_writable');
  perform public.tn04c_assert_helper_owner_only('tiernight_live_custom_pool_writable');
  perform public.tn04c_assert_helper_owner_only('tiernight_live_build_custom_entry');

  -- upsert_player_custom_entry NE DOIT PAS être redéfini par 04C (non-régression)
  if to_regprocedure('public.upsert_player_custom_entry(uuid,text,jsonb)') is null then
    raise exception 'R0 upsert_player_custom_entry absent (régression amont)';
  end if;

  raise notice 'R0 OK — signatures upsert/delete/clear/preserve + ACL + helpers owner-only';
end $$;

-- ############################################################################
-- R1) Predicate matrix tiernight_live_custom_pool_writable
-- ############################################################################

do $$
begin
  if public.tiernight_live_custom_pool_writable('{}'::jsonb) is not true then
    raise exception 'R1 open_default';
  end if;
  if public.tiernight_live_custom_pool_writable(null) is not true then
    raise exception 'R1 null_state';
  end if;
  if public.tiernight_live_custom_pool_writable(
       '{"customLiveTierListsWritable":true}'::jsonb
     ) is not true then
    raise exception 'R1 writable_true';
  end if;
  if public.tiernight_live_custom_pool_writable(
       '{"customLiveTierListsWritable":false}'::jsonb
     ) is not false then
    raise exception 'R1 writable_false';
  end if;
  -- invalid writable → parse défensif = closed
  if public.tiernight_live_custom_pool_writable(
       '{"customLiveTierListsWritable":"garbage"}'::jsonb
     ) is not false then
    raise exception 'R1 writable_invalid';
  end if;
  if public.tiernight_live_custom_pool_writable(
       '{"tierNightLive":{"series":{"kind":"live"}}}'::jsonb
     ) is not false then
    raise exception 'R1 series_live';
  end if;
  if public.tiernight_live_custom_pool_writable(
       '{"tierNightLive":{"series":{"kind":"classic"}}}'::jsonb
     ) is not true then
    raise exception 'R1 series_non_live';
  end if;
  if public.tiernight_live_custom_pool_writable(
       '{"tierNightLive":{"lobbyStarted":true,"finished":false}}'::jsonb
     ) is not false then
    raise exception 'R1 mono_started';
  end if;
  if public.tiernight_live_custom_pool_writable(
       '{"tierNightLive":{"lobbyStarted":true,"finished":true}}'::jsonb
     ) is not true then
    raise exception 'R1 mono_finished';
  end if;
  -- Ready maps ignorées (cas 19–20 documentés N/A SQL)
  if public.tiernight_live_custom_pool_writable(
       '{"tierNightLivePrep":{"ready":{"uid-1":true,"uid-2":true}},"customLiveTierListsWritable":true}'::jsonb
     ) is not true then
    raise exception 'R1 ready_ignored';
  end if;
  -- writable false gagne même si pas de série
  if public.tiernight_live_custom_pool_writable(
       '{"customLiveTierListsWritable":false,"tierNightLive":{"lobbyStarted":false}}'::jsonb
     ) is not false then
    raise exception 'R1 flag_wins';
  end if;

  raise notice 'R1 OK — predicate matrix (default/flag/series/mono/ready-ignored)';
end $$;

-- ############################################################################
-- B1.3 — Spawn fixture + preuves ctx
-- ############################################################################

select public.tn04c_spawn_fixture() as spawn;

do $$
declare
  v_rows int;
  v_lobby uuid;
  v_session uuid;
  v_code text;
  v_host uuid;
  v_guest uuid;
  v_id_a text;
  v_id_b text;
begin
  if to_regclass('public.tn04c_smoke_ctx') is null then
    raise exception 'TN04C_B1 ctx table missing after spawn';
  end if;

  select count(*)::int into v_rows from public.tn04c_smoke_ctx;
  if v_rows is distinct from 1 then
    raise exception 'TN04C_B1 ctx_rows=% (attendu 1)', v_rows;
  end if;

  select lobby_id, host_id, guest_id, session_id, code, id_a, id_b
  into v_lobby, v_host, v_guest, v_session, v_code, v_id_a, v_id_b
  from public.tn04c_smoke_ctx
  where id = 1;

  if v_lobby is null or v_host is null or v_guest is null
     or v_session is null or v_id_a is null or v_id_b is null then
    raise exception 'TN04C_B1 ctx colonnes nulles';
  end if;

  if v_code is null or v_code not like 'TN04C%' then
    raise exception 'TN04C_B1 code invalide %', v_code;
  end if;

  if not exists (select 1 from public.lobbies where id = v_lobby and code like 'TN04C%') then
    raise exception 'TN04C_B1 lobby absent';
  end if;

  if not exists (select 1 from public.game_sessions where id = v_session and lobby_id = v_lobby) then
    raise exception 'TN04C_B1 session absente';
  end if;

  raise notice 'TN04C B1 READY';
end $$;

-- Preuve visible (pas de secrets)
select
  to_regclass('public.tn04c_smoke_ctx')::text as ctx_table,
  (select count(*)::int from public.tn04c_smoke_ctx) as ctx_rows,
  c.lobby_id,
  c.session_id,
  c.code
from public.tn04c_smoke_ctx c
where c.id = 1;
