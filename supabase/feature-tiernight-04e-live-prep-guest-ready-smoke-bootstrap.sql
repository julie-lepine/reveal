-- =============================================================================
-- FEATURE-TIERNIGHT-04E (migration B) — SMOKE B1 (bootstrap) guest ready
-- =============================================================================
--
-- EXÉCUTER B1 SEUL D'ABORD. Attendre SUCCESS avant B2.
-- Migration B déjà appliquée — NE PAS re-exécuter B.
--
--   B) MIGRATION (déjà appliquée) :
--        supabase/feature-tiernight-04e-live-prep-guest-ready.sql
--
--   B1) BOOTSTRAP (ce fichier) :
--        supabase/feature-tiernight-04e-live-prep-guest-ready-smoke-bootstrap.sql
--      Garde namespace 0.a → drop helpers tn04eb_* + legacy tn04eg_* + ctx →
--      recreate helpers → J (ACL) → spawn fixture canonique (inline) →
--      preuve fixture. Laisse helpers + ctx + fixture en place pour B2.
--      Ne run PAS A–O (sauf J structurel).
--
--   B2) TESTS (après SUCCESS B1) :
--        supabase/feature-tiernight-04e-live-prep-guest-ready-smoke-tests.sql
--
--   Cleanup d'urgence (si B1/B2 mid-fail) :
--        supabase/feature-tiernight-04e-live-prep-guest-ready-smoke-cleanup.sql
--
-- Cible produit : contribute_game_session_player étendu
--   (screen='tiernight-prep' / 'tiernight-live-prep').
-- Ce fichier N'appelle QUE public.contribute_game_session_player pour J
-- (signature/ACL) — il ne le redéfinit JAMAIS.
--
-- Namespace (CRITIQUE) :
--   Fixtures : lobbies.code LIKE 'TN04EB%' UNIQUEMENT (+ purge legacy TN04EG%).
--   Ne JAMAIS utiliser 'TN04E%' générique (collision connue avec TN04EA/TN04EG).
--   Helpers  : préfixe tn04eb_ (table de contexte tn04eb_smoke_ctx).
--
-- Prérequis :
--   1. Migration B appliquée : feature-tiernight-04e-live-prep-guest-ready.sql
--   2. ≥ 2 lignes dans auth.users SANS adhésion vivante (lobby_members ⋈
--      lobbies) — jamais de suppression de vraies adhésions/auth.users ici.
--   3. Rôle SQL Editor : postgres (INSERT fixtures, DDL helpers).
--
-- Garde-fous :
--   - Aucun %ROWTYPE (variables `record` via `select into strict`).
--   - Aucun `DROP … CASCADE`.
--   - Aucun `CREATE OR REPLACE` de RPC produit.
--   - `tn04eb_cleanup_fixtures` ne DROP jamais la table ctx : DELETE rows only.
--   - JWT via set_config(..., true).
--   - Shape ctx : + session_id uuid (amélioration harness-only vs monolith).
-- =============================================================================

-- ############################################################################
-- 0.a) Garde structurelle namespace — AVANT toute autre opération
-- ############################################################################

do $$
begin
  if 'TN04EAABC' like 'TN04EB%' then
    raise exception 'BOOTSTRAP namespace collision : TN04EA* matche TN04EB%%';
  end if;
  if 'TN04EBABC' like 'TN04EA%' then
    raise exception 'BOOTSTRAP namespace collision : TN04EB* matche TN04EA%%';
  end if;

  -- Rappel historique (bug corrigé, documenté sans être réintroduit) :
  -- l'ancien préfixe legacy 'TN04EG%' matche bien le générique 'TN04E%'
  -- (c'est précisément la collision qui a motivé la migration vers TN04EB%).
  if 'TN04EGABC' not like 'TN04E%' then
    raise exception
      'BOOTSTRAP hypothèse historique invalide : TN04EG* devrait matcher TN04E%% (bug documenté non reproduit)';
  end if;
  -- Mais TN04EG% ne doit JAMAIS matcher TN04EB% (namespace strict de ce fichier).
  if 'TN04EGABC' like 'TN04EB%' then
    raise exception 'BOOTSTRAP namespace collision : TN04EG* (legacy) ne doit PAS matcher TN04EB%%';
  end if;
  if 'TN04EBABC' like 'TN04EG%' then
    raise exception 'BOOTSTRAP namespace collision : TN04EB* ne doit PAS matcher TN04EG%% (legacy)';
  end if;

  raise notice 'BOOTSTRAP OK — namespaces isolés (TN04EB strict ⊥ TN04EA ⊥ TN04E%% générique ; legacy TN04EG%% documenté puis purgé)';
end $$;

-- ############################################################################
-- 0.b) DROP helpers connus (ordre sûr, sans CASCADE) — migration TN04EG → TN04EB
-- ############################################################################

drop function if exists public.tn04eb_spawn_fixture(text, int, int);
drop function if exists public.tn04eb_cleanup_fixtures();
drop function if exists public.tn04eb_build_state(uuid, uuid, text, text, int, int);
drop function if exists public.tn04eb_session_state(uuid);
drop function if exists public.tn04eb_resolve_actors();
drop function if exists public.tn04eb_user_has_living_membership(uuid);
drop function if exists public.tn04eb_set_jwt(uuid);

drop table if exists public.tn04eb_smoke_ctx;

-- Legacy brouillon cassé (namespace TN04EG / tn04eg_*) — nettoyage
-- inconditionnel à chaque exécution (idempotent, migration one-shot).
drop function if exists public.tn04eg_spawn_fixture(text, int, int);
drop function if exists public.tn04eg_cleanup_fixtures();
drop function if exists public.tn04eg_build_state(uuid, uuid, text, text, int, int);
drop function if exists public.tn04eg_session_state(uuid);
drop function if exists public.tn04eg_resolve_actors();
drop function if exists public.tn04eg_set_jwt(uuid);

drop table if exists public.tn04eg_smoke_ctx;

-- ############################################################################
-- 1) CREATE TABLE ctx (shape figée — + session_id harness-only) + assert
-- ############################################################################

create table public.tn04eb_smoke_ctx (
  id int primary key default 1 check (id = 1),
  lobby_id uuid,
  session_id uuid,
  host_id uuid,
  guest_id uuid,
  code text,
  guest_custom_id text,
  host_custom_id text,
  roster_epoch int,
  live_epoch int,
  scenario text,
  notes text,
  updated_at timestamptz not null default now()
);

do $$
begin
  if to_regclass('public.tn04eb_smoke_ctx') is null then
    raise exception 'TN04EB_CONTEXT_TABLE_MISSING';
  end if;
  raise notice 'TN04EB B1 — public.tn04eb_smoke_ctx créé';
end $$;

-- ############################################################################
-- 2) Helpers (préfixe tn04eb_) — acteurs libres, jamais de vraie donnée touchée
-- ############################################################################

create or replace function public.tn04eb_set_jwt(p_uid uuid)
returns uuid
language plpgsql
as $$
begin
  if p_uid is null then
    raise exception 'TN04EB_NO_UID';
  end if;
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_uid::text, 'role', 'authenticated')::text,
    true
  );
  if auth.uid() is distinct from p_uid then
    raise exception 'TN04EB_JWT_FAILED want=% auth.uid()=%', p_uid, auth.uid();
  end if;
  return auth.uid();
end;
$$;

-- "Vivant" = a une adhésion (lobby_members) rattachée à une lobby existante.
-- Utilisé pour ne JAMAIS réquisitionner un auth.user réellement en jeu.
create or replace function public.tn04eb_user_has_living_membership(p_uid uuid)
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

create or replace function public.tn04eb_resolve_actors()
returns table (host_id uuid, guest_id uuid)
language plpgsql
as $$
declare
  v_host uuid;
  v_guest uuid;
begin
  select u.id into v_host
  from auth.users u
  where not public.tn04eb_user_has_living_membership(u.id)
  order by u.created_at asc nulls last, u.id asc
  limit 1;

  select u.id into v_guest
  from auth.users u
  where u.id is distinct from v_host
    and not public.tn04eb_user_has_living_membership(u.id)
  order by u.created_at asc nulls last, u.id asc
  limit 1;

  if v_host is null or v_guest is null then
    raise exception
      'TN04EB_NEED_2_FREE_AUTH_USERS host=% guest=% (living = lobby_members⋈lobbies)',
      v_host, v_guest;
  end if;

  host_id := v_host;
  guest_id := v_guest;
  return next;
end;
$$;

-- État de session avec les DEUX préparations en même temps (tierNightPrep
-- epoch=4 par défaut, tierNightLivePrep epoch=7 par défaut) afin que les
-- tests d'isolation (E/F) portent réellement sur un state qui contient les
-- deux branches simultanément, quel que soit l'écran actif.
create or replace function public.tn04eb_build_state(
  p_host uuid,
  p_guest uuid,
  p_guest_custom text,
  p_host_custom text,
  p_roster_epoch int default 4,
  p_live_epoch int default 7
)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'tierNightPrep', jsonb_build_object(
      'setupEpoch', p_roster_epoch,
      'ready', '{}'::jsonb,
      'categoryIds', jsonb_build_array('*'),
      'roundCount', 5,
      'poolInvalidateRequestId', null
    ),
    'tierNightLivePrep', jsonb_build_object(
      'setupEpoch', p_live_epoch,
      'ready', '{}'::jsonb,
      'seriesLength', 3
    ),
    'customRosterTopics', jsonb_build_array(
      jsonb_build_object(
        'id', p_guest_custom,
        'name', 'TN04EB Guest Theme',
        'custom', true,
        'authorUid', p_guest::text,
        'author', 'TN04EB Guest'
      ),
      jsonb_build_object(
        'id', p_host_custom,
        'name', 'TN04EB Host Theme',
        'custom', true,
        'authorUid', p_host::text,
        'author', 'TN04EB Host'
      )
    )
  );
$$;

create or replace function public.tn04eb_cleanup_fixtures()
returns jsonb
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_lobbies int := 0;
  v_members int := 0;
  v_sessions int := 0;
  v_legacy_lobbies int := 0;
begin
  -- Uniquement fixtures TN04EB% — jamais de lobby réelle.
  delete from public.game_sessions gs
  using public.lobbies l
  where gs.lobby_id = l.id and l.code like 'TN04EB%';
  get diagnostics v_sessions = row_count;

  delete from public.lobby_members lm
  using public.lobbies l
  where lm.lobby_id = l.id and l.code like 'TN04EB%';
  get diagnostics v_members = row_count;

  delete from public.lobbies where code like 'TN04EB%';
  get diagnostics v_lobbies = row_count;

  -- CRITICAL : DELETE rows only — NEVER DROP the ctx table.
  if to_regclass('public.tn04eb_smoke_ctx') is not null then
    delete from public.tn04eb_smoke_ctx;
  end if;

  -- Migration one-shot : purge tout résidu du namespace legacy cassé
  -- TN04EG% (ancien brouillon tn04eg_*), au cas où un run antérieur au
  -- renommage aurait laissé des fixtures. Sans effet si déjà propre.
  delete from public.game_sessions gs
  using public.lobbies l
  where gs.lobby_id = l.id and l.code like 'TN04EG%';

  delete from public.lobby_members lm
  using public.lobbies l
  where lm.lobby_id = l.id and l.code like 'TN04EG%';

  delete from public.lobbies where code like 'TN04EG%';
  get diagnostics v_legacy_lobbies = row_count;

  return jsonb_build_object(
    'lobbies', v_lobbies,
    'members', v_members,
    'sessions', v_sessions,
    'legacy_tn04eg_lobbies_purged', v_legacy_lobbies
  );
end;
$$;

-- Spawn / respawn de la fixture canonique (screen paramétrable). Nettoie
-- d'abord les fixtures TN04EB% (et legacy TN04EG%) précédentes ; gère
-- explicitement unique_violation (contrainte "un seul lobby vivant par
-- user") sans jamais retomber sur un user déjà occupé.
-- Disponible pour respawns mid-tests en B2 ; B1 utilise aussi un spawn inline.
create or replace function public.tn04eb_spawn_fixture(
  p_screen text default 'tiernight-prep',
  p_roster_epoch int default 4,
  p_live_epoch int default 7
)
returns jsonb
language plpgsql
as $$
declare
  v_host uuid;
  v_guest uuid;
  v_lobby uuid := gen_random_uuid();
  v_session uuid;
  v_code text := 'TN04EB' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 7);
  v_guest_custom text := 'custom-roster-tn04eb-guest';
  v_host_custom text := 'custom-roster-tn04eb-host';
  v_state jsonb;
  v_lobby_count int;
  v_member_count int;
  v_session_count int;
begin
  perform public.tn04eb_cleanup_fixtures();

  select a.host_id, a.guest_id into v_host, v_guest
  from public.tn04eb_resolve_actors() a;

  if public.tn04eb_user_has_living_membership(v_host)
     or public.tn04eb_user_has_living_membership(v_guest) then
    raise exception
      'TN04EB_ACTORS_BUSY_AFTER_RESOLVE host=% guest=% — relancer spawn',
      v_host, v_guest;
  end if;

  begin
    insert into public.lobbies (id, code, host_id, status, game_id)
    values (v_lobby, v_code, v_host, 'playing', 'tiernight');

    insert into public.lobby_members (lobby_id, user_id, display_name, emoji, color, is_host, ready)
    values
      (v_lobby, v_host, 'TN04EB Host', '👑', '#F59E0B', true, true),
      (v_lobby, v_guest, 'TN04EB Guest', '🙂', '#60A5FA', false, true);
  exception
    when unique_violation then
      perform public.tn04eb_cleanup_fixtures();
      raise exception
        'TN04EB_ACTOR_BECAME_BUSY unique_violation (lobby_members_one_living_per_user) — relancer ; aucun fallback vers user occupé'
        using errcode = 'P0001';
  end;

  v_state := public.tn04eb_build_state(
    v_host, v_guest, v_guest_custom, v_host_custom, p_roster_epoch, p_live_epoch
  );

  insert into public.game_sessions (lobby_id, game_id, screen, host_id, state)
  values (v_lobby, 'tiernight', p_screen, v_host, v_state)
  returning id into v_session;

  select count(*)::int into v_lobby_count from public.lobbies where code like 'TN04EB%';
  select count(*)::int into v_member_count
  from public.lobby_members lm join public.lobbies l on l.id = lm.lobby_id
  where l.code like 'TN04EB%';
  select count(*)::int into v_session_count
  from public.game_sessions gs join public.lobbies l on l.id = gs.lobby_id
  where l.code like 'TN04EB%';

  if v_lobby_count is distinct from 1
     or v_member_count is distinct from 2
     or v_session_count is distinct from 1 then
    perform public.tn04eb_cleanup_fixtures();
    raise exception
      'TN04EB_SPAWN_SHAPE lobbies=% members=% sessions=% (attendu 1/2/1)',
      v_lobby_count, v_member_count, v_session_count;
  end if;

  insert into public.tn04eb_smoke_ctx as c (
    id, lobby_id, session_id, host_id, guest_id, code,
    guest_custom_id, host_custom_id, roster_epoch, live_epoch,
    scenario, notes, updated_at
  ) values (
    1, v_lobby, v_session, v_host, v_guest, v_code,
    v_guest_custom, v_host_custom, p_roster_epoch, p_live_epoch,
    'canonical', 'screen=' || p_screen, now()
  )
  on conflict (id) do update set
    lobby_id = excluded.lobby_id,
    session_id = excluded.session_id,
    host_id = excluded.host_id,
    guest_id = excluded.guest_id,
    code = excluded.code,
    guest_custom_id = excluded.guest_custom_id,
    host_custom_id = excluded.host_custom_id,
    roster_epoch = excluded.roster_epoch,
    live_epoch = excluded.live_epoch,
    scenario = excluded.scenario,
    notes = excluded.notes,
    updated_at = now();

  return jsonb_build_object(
    'ok', true,
    'lobby_id', v_lobby,
    'session_id', v_session,
    'code', v_code,
    'host_id', v_host,
    'guest_id', v_guest,
    'guest_custom_id', v_guest_custom,
    'host_custom_id', v_host_custom
  );
end;
$$;

create or replace function public.tn04eb_session_state(p_lobby uuid)
returns jsonb
language sql
stable
as $$
  select state from public.game_sessions where lobby_id = p_lobby;
$$;

comment on function public.tn04eb_spawn_fixture(text, int, int) is
  'SMOKE ONLY FEATURE-TIERNIGHT-04E migration B (guest ready) — drop via B2 teardown K';

-- ############################################################################
-- J) ACL — EXECUTE authenticated uniquement (ne nécessite pas de fixture)
-- ############################################################################

do $$
declare
  v_definer boolean;
  v_config text[];
  v_auth boolean;
  v_anon boolean;
  v_public boolean;
  v_args text;
begin
  select p.prosecdef, p.proconfig,
         pg_get_function_identity_arguments(p.oid)
  into v_definer, v_config, v_args
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'contribute_game_session_player'
  limit 1;

  if v_args is distinct from 'p_lobby_id uuid, p_game text, p_kind text, p_value jsonb' then
    raise exception 'J signature diverge: %', v_args;
  end if;
  if v_definer is not true then
    raise exception 'J SECURITY DEFINER attendu';
  end if;

  v_auth := has_function_privilege(
    'authenticated',
    'public.contribute_game_session_player(uuid,text,text,jsonb)',
    'EXECUTE'
  );
  v_anon := has_function_privilege(
    'anon',
    'public.contribute_game_session_player(uuid,text,text,jsonb)',
    'EXECUTE'
  );
  v_public := has_function_privilege(
    'public',
    'public.contribute_game_session_player(uuid,text,text,jsonb)',
    'EXECUTE'
  );

  if v_auth is not true then
    raise exception 'J authenticated EXECUTE attendu';
  end if;
  if v_anon is not false then
    raise exception 'J anon ne doit PAS avoir EXECUTE';
  end if;
  if v_public is not false then
    raise exception 'J public ne doit PAS avoir EXECUTE';
  end if;

  raise notice 'J OK — signature, DEFINER, ACL (authenticated only)';
end $$;

-- ############################################################################
-- B1.3 — Spawn fixture canonique (inline, linéaire — écran tiernight-prep,
-- roster setupEpoch=4, live setupEpoch=7 ; les DEUX préparations coexistent).
-- tn04eb_spawn_fixture reste disponible pour respawns mid-tests en B2.
-- ############################################################################

do $$
declare
  v_host uuid;
  v_guest uuid;
  v_lobby uuid := gen_random_uuid();
  v_session uuid;
  v_code text := 'TN04EB' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 7);
  v_guest_custom text := 'custom-roster-tn04eb-guest';
  v_host_custom text := 'custom-roster-tn04eb-host';
  v_roster_epoch int := 4;
  v_live_epoch int := 7;
  v_state jsonb;
  v_lobby_count int;
  v_member_count int;
  v_session_count int;
begin
  -- 1) cleanup fixtures précédentes (TN04EB% + legacy TN04EG%).
  perform public.tn04eb_cleanup_fixtures();

  -- 2) resolve actors.
  select a.host_id, a.guest_id into v_host, v_guest
  from public.tn04eb_resolve_actors() a;

  if public.tn04eb_user_has_living_membership(v_host)
     or public.tn04eb_user_has_living_membership(v_guest) then
    raise exception
      'TN04EB_ACTORS_BUSY_AFTER_RESOLVE host=% guest=% — relancer B1',
      v_host, v_guest;
  end if;

  begin
    -- 3) insert lobby code = 'TN04EB' || ...
    insert into public.lobbies (id, code, host_id, status, game_id)
    values (v_lobby, v_code, v_host, 'playing', 'tiernight');

    -- 4) insert 2 members.
    insert into public.lobby_members (lobby_id, user_id, display_name, emoji, color, is_host, ready)
    values
      (v_lobby, v_host, 'TN04EB Host', '👑', '#F59E0B', true, true),
      (v_lobby, v_guest, 'TN04EB Guest', '🙂', '#60A5FA', false, true);
  exception
    when unique_violation then
      perform public.tn04eb_cleanup_fixtures();
      raise exception
        'TN04EB_ACTOR_BECAME_BUSY unique_violation (lobby_members_one_living_per_user) — relancer B1 ; aucun fallback vers user occupé'
        using errcode = 'P0001';
  end;

  -- 5) insert game_sessions — screen=tiernight-prep, dual prep epochs 4/7.
  v_state := public.tn04eb_build_state(
    v_host, v_guest, v_guest_custom, v_host_custom, v_roster_epoch, v_live_epoch
  );

  insert into public.game_sessions (lobby_id, game_id, screen, host_id, state)
  values (v_lobby, 'tiernight', 'tiernight-prep', v_host, v_state)
  returning id into v_session;

  select count(*)::int into v_lobby_count
  from public.lobbies where code like 'TN04EB%';
  select count(*)::int into v_member_count
  from public.lobby_members lm
  join public.lobbies l on l.id = lm.lobby_id
  where l.code like 'TN04EB%';
  select count(*)::int into v_session_count
  from public.game_sessions gs
  join public.lobbies l on l.id = gs.lobby_id
  where l.code like 'TN04EB%';

  if v_lobby_count is distinct from 1
     or v_member_count is distinct from 2
     or v_session_count is distinct from 1 then
    perform public.tn04eb_cleanup_fixtures();
    raise exception
      'TN04EB_SPAWN_SHAPE lobbies=% members=% sessions=% (attendu 1/2/1)',
      v_lobby_count, v_member_count, v_session_count;
  end if;

  -- 6) upsert ctx id=1 (avec session_id).
  insert into public.tn04eb_smoke_ctx as c (
    id, lobby_id, session_id, host_id, guest_id, code,
    guest_custom_id, host_custom_id, roster_epoch, live_epoch,
    scenario, notes, updated_at
  ) values (
    1, v_lobby, v_session, v_host, v_guest, v_code,
    v_guest_custom, v_host_custom, v_roster_epoch, v_live_epoch,
    'canonical', 'screen=tiernight-prep', now()
  )
  on conflict (id) do update set
    lobby_id = excluded.lobby_id,
    session_id = excluded.session_id,
    host_id = excluded.host_id,
    guest_id = excluded.guest_id,
    code = excluded.code,
    guest_custom_id = excluded.guest_custom_id,
    host_custom_id = excluded.host_custom_id,
    roster_epoch = excluded.roster_epoch,
    live_epoch = excluded.live_epoch,
    scenario = excluded.scenario,
    notes = excluded.notes,
    updated_at = now();

  raise notice 'TN04EB B1 — fixture spawn OK (lobby=%, session=%)', v_lobby, v_session;
end $$;

-- ############################################################################
-- B1.4 — Preuve fixture (lobby + 2 membres + session + epochs + customs)
-- ############################################################################

do $$
declare
  c record;
  v_screen text;
  v_game_id text;
  v_state jsonb;
  v_customs jsonb;
begin
  select * into strict c from public.tn04eb_smoke_ctx where id = 1;

  if c.lobby_id is null or c.session_id is null
     or c.host_id is null or c.guest_id is null then
    raise exception 'TN04EB_B1 ctx colonnes nulles';
  end if;
  if c.code is null or c.code not like 'TN04EB%' then
    raise exception 'TN04EB_B1 code invalide %', c.code;
  end if;
  if c.roster_epoch is distinct from 4 then
    raise exception 'TN04EB_B1 roster_epoch attendu 4 got %', c.roster_epoch;
  end if;
  if c.live_epoch is distinct from 7 then
    raise exception 'TN04EB_B1 live_epoch attendu 7 got %', c.live_epoch;
  end if;
  if c.guest_custom_id is distinct from 'custom-roster-tn04eb-guest' then
    raise exception 'TN04EB_B1 guest_custom_id invalide %', c.guest_custom_id;
  end if;
  if c.host_custom_id is distinct from 'custom-roster-tn04eb-host' then
    raise exception 'TN04EB_B1 host_custom_id invalide %', c.host_custom_id;
  end if;

  if not exists (select 1 from public.lobbies where id = c.lobby_id and code like 'TN04EB%') then
    raise exception 'TN04EB_B1 lobby absent';
  end if;

  if (select count(*)::int from public.lobby_members where lobby_id = c.lobby_id) is distinct from 2 then
    raise exception 'TN04EB_B1 membres attendu 2';
  end if;

  select screen, game_id, state into v_screen, v_game_id, v_state
  from public.game_sessions where id = c.session_id and lobby_id = c.lobby_id;

  if v_screen is null then
    raise exception 'TN04EB_B1 session absente';
  end if;
  if v_game_id is distinct from 'tiernight' then
    raise exception 'TN04EB_B1 game_id attendu tiernight got %', v_game_id;
  end if;
  if v_screen is distinct from 'tiernight-prep' then
    raise exception 'TN04EB_B1 screen attendu tiernight-prep got %', v_screen;
  end if;
  if (v_state -> 'tierNightPrep' ->> 'setupEpoch')::int is distinct from c.roster_epoch then
    raise exception 'TN04EB_B1 tierNightPrep.setupEpoch mismatch';
  end if;
  if (v_state -> 'tierNightLivePrep' ->> 'setupEpoch')::int is distinct from c.live_epoch then
    raise exception 'TN04EB_B1 tierNightLivePrep.setupEpoch mismatch';
  end if;

  v_customs := coalesce(v_state -> 'customRosterTopics', '[]'::jsonb);
  if jsonb_array_length(v_customs) is distinct from 2 then
    raise exception 'TN04EB_B1 customRosterTopics attendu 2 got %', v_customs;
  end if;
  if not exists (
    select 1 from jsonb_array_elements(v_customs) e
    where e->>'id' = c.guest_custom_id and e->>'authorUid' = c.guest_id::text
  ) then
    raise exception 'TN04EB_B1 custom guest absent';
  end if;
  if not exists (
    select 1 from jsonb_array_elements(v_customs) e
    where e->>'id' = c.host_custom_id and e->>'authorUid' = c.host_id::text
  ) then
    raise exception 'TN04EB_B1 custom host absent';
  end if;

  raise notice 'TN04EB B1 — preuve fixture OK (lobby=%, session=%)', c.lobby_id, c.session_id;
end $$;

-- Preuve visible (pas de secrets) — singleton id=1, pas d'agrégat UUID (max/min uuid invalides).
select
  to_regclass('public.tn04eb_smoke_ctx') as ctx_table,
  (select count(*) from public.tn04eb_smoke_ctx) as ctx_rows,
  c.lobby_id,
  c.session_id,
  c.host_id,
  c.guest_id,
  c.code,
  c.guest_custom_id,
  c.host_custom_id,
  c.roster_epoch,
  c.live_epoch
from public.tn04eb_smoke_ctx c
where c.id = 1;

do $$
begin
  raise notice 'TN04EB B1 READY';
end $$;
