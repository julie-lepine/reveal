-- =============================================================================
-- FEATURE-TIERNIGHT-04E — SMOKE A1 (bootstrap) start_tiernight_live_series
-- =============================================================================
--
-- EXÉCUTER A1 SEUL D'ABORD. Attendre SUCCESS avant A2.
-- Migration A déjà appliquée — NE PAS re-exécuter A.
--
--   A) MIGRATION (déjà appliquée) :
--        supabase/feature-tiernight-04e-start-live-series.sql
--
--   A1) BOOTSTRAP (ce fichier) :
--        supabase/feature-tiernight-04e-start-live-series-smoke-bootstrap.sql
--      Drop helpers tn04ea_* + legacy tn04e_* + table ctx → recreate fresh →
--      spawn fixture (inline, linéaire) → R0 (ACL/signature/namespaces) →
--      preuve fixture. Laisse helpers + ctx + fixture en place pour A2.
--      Ne run PAS R2–R18.
--
--   A2) TESTS (après SUCCESS A1) :
--        supabase/feature-tiernight-04e-start-live-series-smoke-tests.sql
--
--   Cleanup d'urgence (si A1/A2 mid-fail) :
--        supabase/feature-tiernight-04e-start-live-series-smoke-cleanup.sql
--
-- Prérequis :
--   1. Migration A appliquée sur staging
--   2. ≥ 2 auth.users SANS membership vivant (tn04ea_user_has_living_membership)
--      (un 3ᵉ optionnel active les preuves "outsider" ; sinon notice + ignoré)
--   3. SQL Editor Supabase, connecté en tant que postgres / supabase_admin
--
-- Garde-fous (leçons FEATURE-TIERNIGHT-04C) :
--   - Fixtures UNIQUEMENT lobbies.code LIKE 'TN04EA%' (+ legacy nommé
--     TN04EG% pour purge d'anciens brouillons) — jamais de lobby réel.
--   - Aucun `DROP … CASCADE`.
--   - Aucun `%ROWTYPE` sur des artefacts du harness (tn04ea_smoke_ctx) :
--     lecture via `record` + `select into strict`.
--   - Aucun `CREATE OR REPLACE` de RPC produit (start_tiernight_live_series,
--     etc.) — ce script les APPELLE, ne les redéfinit jamais.
--   - `tn04ea_cleanup_fixtures` ne DROP jamais la table ctx : uniquement des
--     DELETE de lignes, et seulement si la table existe déjà.
-- =============================================================================

-- ############################################################################
-- A1.0 — Drop old harness helpers (safe order, NO CASCADE) puis table ctx
-- ############################################################################

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

-- Legacy draft names (tn04e_* / TN04E% era) — safe leftover cleanup, no CASCADE
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

-- ############################################################################
-- A1.1 — CREATE TABLE ctx (shape figée — pas d'ALTER incrémental)
-- ############################################################################

create table public.tn04ea_smoke_ctx (
  id int primary key default 1 check (id = 1),
  lobby_id uuid,
  host_id uuid,
  guest_id uuid,
  outsider_id uuid,
  code text,
  session_id uuid,
  updated_at timestamptz not null default now()
);

do $$
begin
  if to_regclass('public.tn04ea_smoke_ctx') is null then
    raise exception 'TN04EA_BOOTSTRAP_CONTEXT_TABLE_MISSING';
  end if;
  raise notice 'TN04EA A1 — public.tn04ea_smoke_ctx créé';
end $$;

-- ############################################################################
-- A1.2 — Recreate ALL harness helpers
-- ############################################################################

create or replace function public.tn04ea_set_jwt(p_uid uuid)
returns uuid
language plpgsql
as $$
begin
  if p_uid is null then
    raise exception 'TN04EA_NO_UID';
  end if;
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_uid::text, 'role', 'authenticated')::text,
    true
  );
  if auth.uid() is distinct from p_uid then
    raise exception 'TN04EA_JWT_FAILED want=% auth.uid()=%', p_uid, auth.uid();
  end if;
  return auth.uid();
end;
$$;

create or replace function public.tn04ea_user_has_living_membership(p_uid uuid)
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

create or replace function public.tn04ea_resolve_actors()
returns table (host_id uuid, guest_id uuid, outsider_id uuid)
language plpgsql
as $$
declare
  v_host uuid;
  v_guest uuid;
  v_outsider uuid;
begin
  select u.id into v_host
  from auth.users u
  where not public.tn04ea_user_has_living_membership(u.id)
  order by u.created_at asc nulls last, u.id asc
  limit 1;

  select u.id into v_guest
  from auth.users u
  where u.id is distinct from v_host
    and not public.tn04ea_user_has_living_membership(u.id)
  order by u.created_at asc nulls last, u.id asc
  limit 1;

  if v_host is null or v_guest is null then
    raise exception
      'TN04EA_NEED_2_FREE_AUTH_USERS host=% guest=% (living = lobby_members⋈lobbies)',
      v_host, v_guest;
  end if;

  select u.id into v_outsider
  from auth.users u
  where u.id is distinct from v_host
    and u.id is distinct from v_guest
    and not public.tn04ea_user_has_living_membership(u.id)
  order by u.created_at asc nulls last, u.id asc
  limit 1;

  if v_outsider is null then
    raise notice 'TN04EA_NO_OUTSIDER — 3e auth.user libre indisponible ; tests outsider ignorés';
  end if;

  host_id := v_host;
  guest_id := v_guest;
  outsider_id := v_outsider;
  return next;
end;
$$;

create or replace function public.tn04ea_new_custom_id()
returns text
language sql
volatile
as $$
  select 'custom-live-' || replace(gen_random_uuid()::text, '-', '');
$$;

-- Snapshot "officiel" inventé (custom:false) — indépendant de TIER_LISTS.
create or replace function public.tn04ea_official_snap(p_id text, p_name text)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'id', p_id,
    'name', p_name,
    'emoji', '⭐',
    'items', jsonb_build_array('i1', 'i2', 'i3', 'i4'),
    'custom', false
  );
$$;

-- Entrée custom canon (state.customLiveTierLists) — id DOIT commencer par
-- 'custom-live-' (invariant serveur vérifié par tiernight_live_validate_series_shape).
create or replace function public.tn04ea_custom_entry(p_id text, p_author_uid uuid)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'id', p_id,
    'name', 'Custom ' || right(p_id, 6),
    'emoji', '🎯',
    'items', jsonb_build_array('c1', 'c2', 'c3', 'c4'),
    'author', 'TN04EA Author',
    'authorUid', p_author_uid::text,
    'custom', true
  );
$$;

-- Entrée de queue proposée par le client — roundId = runId || ':' || idx.
create or replace function public.tn04ea_queue_entry(p_idx int, p_run_id text, p_snap jsonb)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'roundIndex', p_idx,
    'roundId', p_run_id || ':' || p_idx::text,
    'listId', p_snap ->> 'id',
    'listSnapshot', p_snap
  );
$$;

-- Série proposée complète (shape §04E) — p_snaps = jsonb array de snapshots,
-- longueur = p_round (responsabilité de l'appelant).
create or replace function public.tn04ea_series(p_run_id text, p_round int, p_snaps jsonb)
returns jsonb
language plpgsql
immutable
as $$
declare
  v_queue jsonb := '[]'::jsonb;
  v_i int;
begin
  for v_i in 0 .. jsonb_array_length(p_snaps) - 1 loop
    v_queue := v_queue || jsonb_build_array(
      public.tn04ea_queue_entry(v_i, p_run_id, p_snaps -> v_i)
    );
  end loop;

  return jsonb_build_object(
    'version', 1,
    'kind', 'live',
    'categoryIds', jsonb_build_array('*'),
    'roundCount', p_round,
    'runId', p_run_id,
    'roundIndex', 0,
    'phase', 'playing_list',
    'queue', v_queue,
    'completedRoundIds', '[]'::jsonb,
    'scoredRoundIds', '[]'::jsonb
  );
end;
$$;

-- CRITIQUE : ne DROP jamais public.tn04ea_smoke_ctx — DELETE de lignes
-- uniquement, et seulement si la table existe déjà. Predicates limités à
-- TN04EA% (courant) + TN04EG% (legacy nommé) — jamais TN04E% générique.
create or replace function public.tn04ea_cleanup_fixtures()
returns jsonb
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_lobbies int := 0;
  v_members int := 0;
  v_sessions int := 0;
  v_legacy int := 0;
begin
  -- CURRENT harness A uniquement.
  delete from public.game_sessions gs
  using public.lobbies l where gs.lobby_id = l.id and l.code LIKE 'TN04EA%';
  get diagnostics v_sessions = row_count;
  delete from public.lobby_members lm
  using public.lobbies l where lm.lobby_id = l.id and l.code LIKE 'TN04EA%';
  get diagnostics v_members = row_count;
  delete from public.lobbies where code LIKE 'TN04EA%';
  get diagnostics v_lobbies = row_count;

  -- LEGACY nommé explicitement (ancien brouillon TN04EG uniquement).
  -- INTERDIT : wildcard générique préfixe TN04E (ex. code TN04EX… hors cible).
  delete from public.game_sessions gs
  using public.lobbies l
  where gs.lobby_id = l.id and l.code LIKE 'TN04EG%';
  delete from public.lobby_members lm
  using public.lobbies l
  where lm.lobby_id = l.id and l.code LIKE 'TN04EG%';
  delete from public.lobbies where code LIKE 'TN04EG%';
  get diagnostics v_legacy = row_count;

  if to_regclass('public.tn04ea_smoke_ctx') is not null then
    delete from public.tn04ea_smoke_ctx;
  end if;

  return jsonb_build_object(
    'lobbies', v_lobbies,
    'members', v_members,
    'sessions', v_sessions,
    'legacy_tn04eg_purged', v_legacy
  );
end;
$$;

-- Spawn / respawn d'une prep Rank Live ouverte (screen=tiernight-live-prep,
-- writable=true, pas de série live). Nettoie les fixtures précédentes d'abord
-- (respawn = nouvelle lobby + nouvelle session, mêmes acteurs si libres).
create or replace function public.tn04ea_spawn_prep(
  p_customs jsonb default '[]'::jsonb,
  p_round int default 3,
  p_epoch int default 0
)
returns jsonb
language plpgsql
as $$
declare
  v_host uuid;
  v_guest uuid;
  v_outsider uuid;
  v_lobby uuid := gen_random_uuid();
  v_code text := 'TN04EA' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 7);
  v_state jsonb;
  v_session uuid;
  v_lobby_count int;
  v_member_count int;
  v_session_count int;
begin
  perform public.tn04ea_cleanup_fixtures();

  select a.host_id, a.guest_id, a.outsider_id
  into v_host, v_guest, v_outsider
  from public.tn04ea_resolve_actors() a;

  if public.tn04ea_user_has_living_membership(v_host)
     or public.tn04ea_user_has_living_membership(v_guest) then
    raise exception
      'TN04EA_ACTORS_BUSY_AFTER_RESOLVE host=% guest=% — relancer spawn',
      v_host, v_guest;
  end if;

  begin
    insert into public.lobbies (id, code, host_id, status, game_id)
    values (v_lobby, v_code, v_host, 'playing', 'tiernight');

    insert into public.lobby_members (lobby_id, user_id, display_name, emoji, color, is_host, ready)
    values
      (v_lobby, v_host, 'TN04EA Host', '👑', '#F59E0B', true, true),
      (v_lobby, v_guest, 'TN04EA Guest', '🙂', '#60A5FA', false, true);
  exception
    when unique_violation then
      perform public.tn04ea_cleanup_fixtures();
      raise exception
        'TN04EA_ACTOR_BECAME_BUSY unique_violation (lobby_members_one_living_per_user) — relancer ; aucun fallback vers user occupé'
        using errcode = 'P0001';
  end;

  v_state := jsonb_build_object(
    'tierNightLivePrep', jsonb_build_object(
      'roundCount', p_round,
      'setupEpoch', coalesce(p_epoch, 0),
      'ready', '{}'::jsonb,
      'poolInvalidateRequestId', null
    ),
    'customLiveTierLists', coalesce(p_customs, '[]'::jsonb),
    'customLiveTierListsWritable', true
  );

  insert into public.game_sessions (lobby_id, game_id, screen, host_id, state)
  values (v_lobby, 'tiernight', 'tiernight-live-prep', v_host, v_state)
  returning id into v_session;

  select count(*)::int into v_lobby_count
  from public.lobbies where code LIKE 'TN04EA%';
  select count(*)::int into v_member_count
  from public.lobby_members lm
  join public.lobbies l on l.id = lm.lobby_id
  where l.code LIKE 'TN04EA%';
  select count(*)::int into v_session_count
  from public.game_sessions gs
  join public.lobbies l on l.id = gs.lobby_id
  where l.code LIKE 'TN04EA%';

  if v_lobby_count is distinct from 1
     or v_member_count is distinct from 2
     or v_session_count is distinct from 1 then
    perform public.tn04ea_cleanup_fixtures();
    raise exception
      'TN04EA_SPAWN_SHAPE lobbies=% members=% sessions=% (attendu 1/2/1)',
      v_lobby_count, v_member_count, v_session_count;
  end if;

  insert into public.tn04ea_smoke_ctx as c (
    id, lobby_id, host_id, guest_id, outsider_id, code, session_id, updated_at
  ) values (
    1, v_lobby, v_host, v_guest, v_outsider, v_code, v_session, now()
  )
  on conflict (id) do update set
    lobby_id = excluded.lobby_id,
    host_id = excluded.host_id,
    guest_id = excluded.guest_id,
    outsider_id = excluded.outsider_id,
    code = excluded.code,
    session_id = excluded.session_id,
    updated_at = now();

  return jsonb_build_object(
    'ok', true,
    'lobby_id', v_lobby,
    'session_id', v_session,
    'host_id', v_host,
    'guest_id', v_guest,
    'outsider_id', v_outsider,
    'code', v_code
  );
end;
$$;

create or replace function public.tn04ea_assert_err(p_err text, p_needle text, p_label text)
returns void
language plpgsql
as $$
begin
  if position(p_needle in coalesce(p_err, '')) = 0 then
    raise exception '% attendu needle=% got %', p_label, p_needle, p_err;
  end if;
end;
$$;

create or replace function public.tn04ea_assert_rpc_acl(p_name text, p_label text)
returns void
language plpgsql
as $$
declare
  v_definer boolean; v_config text[]; v_auth boolean; v_anon boolean; v_public boolean;
  v_oid oid;
begin
  select p.oid, p.prosecdef, p.proconfig
  into v_oid, v_definer, v_config
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

create or replace function public.tn04ea_assert_helper_owner_only(p_name text)
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

-- ############################################################################
-- A1.3 — Spawn fixture (linéaire, inline — pas seulement via l'helper opaque)
-- ############################################################################
-- Explicite volontairement (mêmes étapes que tn04ea_spawn_prep) pour que la
-- preuve A1 soit lisible de bout en bout sans sauter dans une fonction.
-- tn04ea_spawn_prep reste disponible pour les respawns mid-tests en A2.
-- ############################################################################

do $$
declare
  v_host uuid;
  v_guest uuid;
  v_outsider uuid;
  v_lobby uuid := gen_random_uuid();
  v_code text := 'TN04EA' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 7);
  v_state jsonb;
  v_session uuid;
  v_lobby_count int;
  v_member_count int;
  v_session_count int;
begin
  -- 1) cleanup fixtures précédentes.
  perform public.tn04ea_cleanup_fixtures();

  -- 2) resolve actors (raise TN04EA_NEED_2_FREE_AUTH_USERS si indisponibles).
  select a.host_id, a.guest_id, a.outsider_id
  into v_host, v_guest, v_outsider
  from public.tn04ea_resolve_actors() a;

  if public.tn04ea_user_has_living_membership(v_host)
     or public.tn04ea_user_has_living_membership(v_guest) then
    raise exception
      'TN04EA_ACTORS_BUSY_AFTER_RESOLVE host=% guest=% — relancer A1',
      v_host, v_guest;
  end if;

  begin
    -- 3) insert lobby code = 'TN04EA' || ...
    insert into public.lobbies (id, code, host_id, status, game_id)
    values (v_lobby, v_code, v_host, 'playing', 'tiernight');

    -- 4) insert 2 members.
    insert into public.lobby_members (lobby_id, user_id, display_name, emoji, color, is_host, ready)
    values
      (v_lobby, v_host, 'TN04EA Host', '👑', '#F59E0B', true, true),
      (v_lobby, v_guest, 'TN04EA Guest', '🙂', '#60A5FA', false, true);
  exception
    when unique_violation then
      perform public.tn04ea_cleanup_fixtures();
      raise exception
        'TN04EA_ACTOR_BECAME_BUSY unique_violation (lobby_members_one_living_per_user) — relancer A1 ; aucun fallback vers user occupé'
        using errcode = 'P0001';
  end;

  -- 5) insert game_sessions — prep ouverte C=0 N=3, writable=true.
  v_state := jsonb_build_object(
    'tierNightLivePrep', jsonb_build_object(
      'roundCount', 3,
      'setupEpoch', 0,
      'ready', '{}'::jsonb,
      'poolInvalidateRequestId', null
    ),
    'customLiveTierLists', '[]'::jsonb,
    'customLiveTierListsWritable', true
  );

  insert into public.game_sessions (lobby_id, game_id, screen, host_id, state)
  values (v_lobby, 'tiernight', 'tiernight-live-prep', v_host, v_state)
  returning id into v_session;

  select count(*)::int into v_lobby_count
  from public.lobbies where code LIKE 'TN04EA%';
  select count(*)::int into v_member_count
  from public.lobby_members lm
  join public.lobbies l on l.id = lm.lobby_id
  where l.code LIKE 'TN04EA%';
  select count(*)::int into v_session_count
  from public.game_sessions gs
  join public.lobbies l on l.id = gs.lobby_id
  where l.code LIKE 'TN04EA%';

  if v_lobby_count is distinct from 1
     or v_member_count is distinct from 2
     or v_session_count is distinct from 1 then
    perform public.tn04ea_cleanup_fixtures();
    raise exception
      'TN04EA_SPAWN_SHAPE lobbies=% members=% sessions=% (attendu 1/2/1)',
      v_lobby_count, v_member_count, v_session_count;
  end if;

  -- 6) upsert ctx id=1.
  insert into public.tn04ea_smoke_ctx as c (
    id, lobby_id, host_id, guest_id, outsider_id, code, session_id, updated_at
  ) values (
    1, v_lobby, v_host, v_guest, v_outsider, v_code, v_session, now()
  )
  on conflict (id) do update set
    lobby_id = excluded.lobby_id,
    host_id = excluded.host_id,
    guest_id = excluded.guest_id,
    outsider_id = excluded.outsider_id,
    code = excluded.code,
    session_id = excluded.session_id,
    updated_at = now();

  raise notice 'TN04EA A1 — fixture spawn OK (lobby=%, session=%)', v_lobby, v_session;
end $$;

-- ############################################################################
-- R0) Signature + ACL du RPC produit + helpers owner-only
-- ############################################################################

do $$
declare
  v_args text;
  v_n int;
begin
  select pg_get_function_identity_arguments(p.oid) into v_args
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'start_tiernight_live_series'
  order by p.oid desc limit 1;

  if v_args is null then
    raise exception 'R0 start_tiernight_live_series manquant — appliquer migration A d''abord';
  end if;
  if v_args is distinct from 'p_lobby_id uuid, p_expected_setup_epoch integer, p_series jsonb'
     and v_args is distinct from 'uuid, integer, jsonb' then
    if position('uuid' in coalesce(v_args, '')) = 0
       or position('integer' in coalesce(v_args, '')) = 0
       or position('jsonb' in coalesce(v_args, '')) = 0 then
      raise exception 'R0 signature start attendue (uuid,integer,jsonb) got %', v_args;
    end if;
  end if;

  select count(*)::int into v_n
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'start_tiernight_live_series';
  if v_n is distinct from 1 then
    raise exception 'R0 nombre de signatures start ≠ 1 got %', v_n;
  end if;

  perform public.tn04ea_assert_rpc_acl('start_tiernight_live_series', 'R0 start');

  -- Dépendances host / membership canoniques.
  if to_regprocedure('public.is_lobby_host(uuid)') is null then
    raise exception 'R0 is_lobby_host(uuid) missing';
  end if;
  if to_regprocedure('public.is_acting_host(uuid)') is null then
    raise exception 'R0 is_acting_host(uuid) missing';
  end if;
  if to_regprocedure('public.assert_lobby_member(uuid)') is null then
    raise exception 'R0 assert_lobby_member(uuid) missing';
  end if;

  -- Helpers 04E : owner-only (aucun grant authenticated/anon/public).
  perform public.tn04ea_assert_helper_owner_only('tiernight_live_jsonb_shuffle');
  perform public.tn04ea_assert_helper_owner_only('tiernight_live_norm_emoji');
  perform public.tn04ea_assert_helper_owner_only('tiernight_live_jsonb_int');
  perform public.tn04ea_assert_helper_owner_only('tiernight_live_validate_series_shape');
  perform public.tn04ea_assert_helper_owner_only('tiernight_live_custom_snapshot_matches_canon');
  perform public.tn04ea_assert_helper_owner_only('tiernight_live_validate_custom_queue_policy');

  -- Non-régression : aucun catalogue SQL officiel introduit par 04E.
  if to_regprocedure('public.tiernight_live_official_catalog()') is not null then
    raise exception 'R0 tiernight_live_official_catalog ne doit PAS exister (pas de catalogue SQL)';
  end if;
  if to_regprocedure('public.tiernight_live_build_list_subset(jsonb,int)') is not null then
    raise exception 'R0 tiernight_live_build_list_subset ne doit PAS exister';
  end if;

  -- Isolation namespaces : TN04EA% ne matche PAS le cleanup B (TN04EB%).
  if 'TN04EAABC123' like 'TN04EB%' then
    raise exception 'R0 namespace collision : TN04EA* matche TN04EB%%';
  end if;
  if 'TN04EBABC123' like 'TN04EA%' then
    raise exception 'R0 namespace collision : TN04EB* matche TN04EA%%';
  end if;

  -- Cleanup A : predicates autorisés UNIQUEMENT TN04EA% + legacy nommé TN04EG%.
  -- Preuve source (après masquage des patterns autorisés) : aucun LIKE TN04E% générique.
  -- IMPORTANT : littéraux en quotes simples — pas de dollar-quote imbriqué dans le DO parent.
  declare
    v_cleanup_src text;
    v_probe text;
  begin
    v_cleanup_src := pg_get_functiondef('public.tn04ea_cleanup_fixtures()'::regprocedure);
    v_probe := v_cleanup_src;
    v_probe := replace(v_probe, 'LIKE ''TN04EA%''', '<<OK_EA>>');
    v_probe := replace(v_probe, 'like ''TN04EA%''', '<<OK_EA>>');
    v_probe := replace(v_probe, 'LIKE ''TN04EG%''', '<<OK_EG>>');
    v_probe := replace(v_probe, 'like ''TN04EG%''', '<<OK_EG>>');
    if v_probe ~* 'LIKE[[:space:]]*''TN04E%''' then
      raise exception
        'R0 cleanup A contient encore LIKE ''TN04E%%'' générique (interdit) — source après masquage: %',
        left(v_probe, 400);
    end if;
    -- Contrat codes : A/G autorisés ; B/X hors cleanup A.
    if 'TN04EAabc' not like 'TN04EA%' then
      raise exception 'R0 TN04EAabc doit matcher TN04EA%%';
    end if;
    if 'TN04EBabc' like 'TN04EA%' or 'TN04EBabc' like 'TN04EG%' then
      raise exception 'R0 TN04EBabc ne doit pas être cible cleanup A';
    end if;
    if 'TN04EGabc' not like 'TN04EG%' then
      raise exception 'R0 TN04EGabc doit matcher legacy TN04EG%%';
    end if;
    if 'TN04EXabc' like 'TN04EA%' or 'TN04EXabc' like 'TN04EG%' then
      raise exception 'R0 TN04EXabc ne doit JAMAIS être supprimable par A';
    end if;
  end;

  raise notice 'R0 OK — ACL + helpers + namespaces + cleanup A limité TN04EA|TN04EG (pas TN04EX/TN04EB/TN04E%%)';
end $$;

-- ############################################################################
-- A1.4 — Preuve fixture (lobby + 2 membres + session + shape prep C=0 N=3)
-- ############################################################################

do $$
declare
  c record;
  v_screen text;
  v_game_id text;
  v_state jsonb;
begin
  select * into strict c from public.tn04ea_smoke_ctx where id = 1;

  if c.lobby_id is null or c.host_id is null or c.guest_id is null or c.session_id is null then
    raise exception 'TN04EA_A1 ctx colonnes nulles';
  end if;
  if c.code is null or c.code not like 'TN04EA%' then
    raise exception 'TN04EA_A1 code invalide %', c.code;
  end if;

  if not exists (select 1 from public.lobbies where id = c.lobby_id and code like 'TN04EA%') then
    raise exception 'TN04EA_A1 lobby absent';
  end if;

  if (select count(*)::int from public.lobby_members where lobby_id = c.lobby_id) is distinct from 2 then
    raise exception 'TN04EA_A1 membres attendu 2';
  end if;

  select screen, game_id, state into v_screen, v_game_id, v_state
  from public.game_sessions where id = c.session_id and lobby_id = c.lobby_id;

  if v_screen is null then
    raise exception 'TN04EA_A1 session absente';
  end if;
  if v_game_id is distinct from 'tiernight' then
    raise exception 'TN04EA_A1 game_id attendu tiernight got %', v_game_id;
  end if;
  if v_screen is distinct from 'tiernight-live-prep' then
    raise exception 'TN04EA_A1 screen attendu tiernight-live-prep got %', v_screen;
  end if;
  if (v_state -> 'tierNightLivePrep' ->> 'roundCount')::int is distinct from 3 then
    raise exception 'TN04EA_A1 roundCount attendu 3';
  end if;
  if (v_state -> 'tierNightLivePrep' ->> 'setupEpoch')::int is distinct from 0 then
    raise exception 'TN04EA_A1 setupEpoch attendu 0';
  end if;
  if (v_state -> 'customLiveTierLists') is distinct from '[]'::jsonb then
    raise exception 'TN04EA_A1 customLiveTierLists attendu []';
  end if;
  if (v_state ->> 'customLiveTierListsWritable')::boolean is not true then
    raise exception 'TN04EA_A1 customLiveTierListsWritable attendu true';
  end if;

  raise notice 'TN04EA A1 — preuve fixture OK (lobby=%, session=%)', c.lobby_id, c.session_id;
end $$;

-- Preuve visible (pas de secrets) — singleton id=1, pas d'agrégat UUID (max/min uuid invalides).
select
  to_regclass('public.tn04ea_smoke_ctx') as ctx_table,
  (select count(*) from public.tn04ea_smoke_ctx) as ctx_rows,
  c.lobby_id,
  c.session_id,
  c.code
from public.tn04ea_smoke_ctx c
where c.id = 1;

do $$
begin
  raise notice 'TN04EA A1 READY';
end $$;
