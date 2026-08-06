-- =============================================================================
-- FEATURE-TIERNIGHT-03-D1-bis — HARNESS SQL STAGING (exécutable)
-- =============================================================================
-- Remplace le pseudocode du runbook pour F/A/L/C/R.
-- Aucun code produit JS. Fixtures code LIKE 'TNSD1B%'. Cleanup garanti.
--
-- Prérequis : D1-bis shape + finalize 03A + advance 05 appliqués (P1–P8 verts).
-- Rôle SQL Editor : postgres / supabase_admin (bypass RLS pour INSERT).
--
-- ORDRE D’EXÉCUTION :
--   0. HELPERS (une fois)
--   A → B → C → D → E → F → G → H → I → J → K → L
--
-- TRANSACTION : chaque smoke mutationnel est prévu en BEGIN…ROLLBACK
-- (les UPDATE des RPC SECURITY DEFINER sont dans la même tx → rollback OK).
-- set_config(..., true) = local à la transaction.
--
-- ACTEURS : sélection auto de 2 lignes auth.users (pas d’UUID inventés).
-- Si < 2 users staging → exception explicite (créer un 2e compte test).
-- =============================================================================

-- ############################################################################
-- 0. HELPERS (exécuter une fois avant A–L)
-- ############################################################################

create table if not exists public.tnsd1b_smoke_ctx (
  id int primary key default 1 check (id = 1),
  lobby_id uuid,
  host_id uuid,
  guest_id uuid,
  run_id text,
  code text,
  scenario text,
  notes text,
  updated_at timestamptz not null default now()
);

create or replace function public.tnsd1b_set_host_jwt(p_host uuid)
returns uuid
language plpgsql
as $$
begin
  if p_host is null then
    raise exception 'TNSD1B_NO_HOST';
  end if;
  -- Compat auth.uid() Supabase (claim.sub ET claims JSON)
  perform set_config('request.jwt.claim.sub', p_host::text, true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_host::text, 'role', 'authenticated')::text,
    true
  );
  if auth.uid() is distinct from p_host then
    raise exception 'TNSD1B_JWT_FAILED host=% auth.uid()=%', p_host, auth.uid();
  end if;
  return auth.uid();
end;
$$;

create or replace function public.tnsd1b_resolve_actors()
returns table (host_id uuid, guest_id uuid)
language plpgsql
as $$
declare
  v_host uuid;
  v_guest uuid;
begin
  select u.id into v_host
  from auth.users u
  order by u.created_at asc nulls last, u.id asc
  limit 1;

  select u.id into v_guest
  from auth.users u
  where u.id is distinct from v_host
  order by u.created_at asc nulls last, u.id asc
  limit 1;

  if v_host is null or v_guest is null then
    raise exception
      'TNSD1B_NEED_TWO_AUTH_USERS: staging doit avoir ≥2 lignes dans auth.users (actuellement host=% guest=%)',
      v_host, v_guest;
  end if;

  host_id := v_host;
  guest_id := v_guest;
  return next;
end;
$$;

create or replace function public.tnsd1b_queue_entry(
  p_run text,
  p_index int,
  p_slug text,
  p_custom boolean default false
)
returns jsonb
language plpgsql
immutable
as $$
declare
  v_raw text := case
    when p_custom then 'custom-roster-' || p_slug
    else p_slug
  end;
  v_topic text := 'roster:' || v_raw;
begin
  return jsonb_build_object(
    'roundId', p_run || ':' || p_index::text,
    'roundIndex', p_index,
    'topicId', v_topic,
    'topicSnapshot', jsonb_build_object(
      'id', v_raw,
      'name', 'Smoke ' || p_slug,
      'emoji', '🏆',
      'categoryId', 'survival',
      'custom', to_jsonb(coalesce(p_custom, false))
    )
  );
end;
$$;

create or replace function public.tnsd1b_build_queue(
  p_run text,
  p_count int,
  p_with_custom boolean default false
)
returns jsonb
language plpgsql
immutable
as $$
declare
  v_q jsonb := '[]'::jsonb;
  v_i int;
  v_slug text;
  v_custom boolean;
begin
  for v_i in 0 .. p_count - 1 loop
    v_slug := 'tnsd1b-t' || v_i::text;
    v_custom := p_with_custom and v_i = 0;
    v_q := v_q || jsonb_build_array(
      public.tnsd1b_queue_entry(p_run, v_i, v_slug, v_custom)
    );
  end loop;
  return v_q;
end;
$$;

create or replace function public.tnsd1b_full_placement(p_items jsonb)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'S', jsonb_build_array(p_items ->> 0),
    'A', jsonb_build_array(p_items ->> 1),
    'B', jsonb_build_array(p_items ->> 2),
    'C', '[]'::jsonb,
    'D', '[]'::jsonb
  );
$$;

-- p_finished_mode: all | none | host_only
-- p_scored_before: nombre de manches déjà scorées (0..roundIndex) pour last-round
create or replace function public.tnsd1b_build_state(
  p_run text,
  p_host uuid,
  p_guest uuid,
  p_round_count int,
  p_round_index int,
  p_phase text,
  p_finished_mode text default 'all',
  p_with_custom boolean default false,
  p_scored_before int default 0
)
returns jsonb
language plpgsql
immutable
as $$
declare
  v_items jsonb := '["alpha","beta","gamma"]'::jsonb;
  v_queue jsonb := public.tnsd1b_build_queue(p_run, p_round_count, p_with_custom);
  v_entry jsonb := v_queue -> p_round_index;
  v_place jsonb := public.tnsd1b_full_placement(v_items);
  v_roster jsonb := jsonb_build_array(
    jsonb_build_object('userId', p_host::text, 'displayName', 'TNSD1B Host'),
    jsonb_build_object('userId', p_guest::text, 'displayName', 'TNSD1B Guest')
  );
  v_finished jsonb := '{}'::jsonb;
  v_placements jsonb := '{}'::jsonb;
  v_scored jsonb := '[]'::jsonb;
  v_completed jsonb := '[]'::jsonb;
  v_history jsonb := '[]'::jsonb;
  v_i int;
  v_rid text;
begin
  if p_finished_mode = 'all' then
    v_finished := jsonb_build_object(p_host::text, true, p_guest::text, true);
    v_placements := jsonb_build_object(p_host::text, v_place, p_guest::text, v_place);
  elsif p_finished_mode = 'host_only' then
    v_finished := jsonb_build_object(p_host::text, true, p_guest::text, false);
    v_placements := jsonb_build_object(p_host::text, v_place);
  elsif p_finished_mode = 'none' then
    v_finished := jsonb_build_object(p_host::text, false, p_guest::text, false);
    v_placements := '{}'::jsonb;
  else
    raise exception 'TNSD1B_BAD_FINISHED_MODE %', p_finished_mode;
  end if;

  for v_i in 0 .. greatest(p_scored_before - 1, -1) loop
    exit when p_scored_before <= 0;
    v_rid := p_run || ':' || v_i::text;
    v_scored := v_scored || to_jsonb(v_rid);
    v_completed := v_completed || to_jsonb(v_rid);
    v_history := v_history || jsonb_build_array(
      jsonb_build_object(
        'roundId', v_rid,
        'roundIndex', v_i,
        'topicId', v_queue -> v_i ->> 'topicId',
        'topicSnapshot', v_queue -> v_i -> 'topicSnapshot',
        'scoresApplied', true
      )
    );
  end loop;

  return jsonb_build_object(
    'scores', jsonb_build_object(p_host::text, 0, p_guest::text, 0),
    'playerStats', jsonb_build_object(
      p_host::text, jsonb_build_object('tierConsensusPoints', 0, 'tierNightsPlayed', 0),
      p_guest::text, jsonb_build_object('tierConsensusPoints', 0, 'tierNightsPlayed', 0)
    ),
    'gameScores', jsonb_build_object(
      'tiernight', jsonb_build_object(p_host::text, 0, p_guest::text, 0)
    ),
    'gameScoreOrder', jsonb_build_array('tiernight'),
    'stats', jsonb_build_object('tierNightsPlayed', 0),
    'eveningGamesRecorded', '{}'::jsonb,
    'tierNight', jsonb_build_object(
      'runId', p_run,
      'lobbyStarted', true,
      'topicId', v_entry ->> 'topicId',
      'listName', v_entry -> 'topicSnapshot' ->> 'name',
      'topicEmoji', coalesce(v_entry -> 'topicSnapshot' ->> 'emoji', '🏆'),
      'items', v_items,
      'modifier', 'normal',
      'playerRoster', v_roster,
      'placements', v_placements,
      'finished', v_finished,
      'series', jsonb_build_object(
        'version', 1,
        'phase', p_phase,
        'roundCount', p_round_count,
        'roundIndex', p_round_index,
        'categoryIds', jsonb_build_array('*'),
        'queue', v_queue,
        'scoredRoundIds', v_scored,
        'completedRoundIds', v_completed,
        'roundHistory', v_history
      )
    )
  );
end;
$$;

create or replace function public.tnsd1b_cleanup_fixtures()
returns jsonb
language plpgsql
as $$
declare
  v_lobbies int;
  v_members int;
  v_sessions int;
begin
  delete from public.game_sessions gs
  using public.lobbies l
  where gs.lobby_id = l.id and l.code like 'TNSD1B%';
  get diagnostics v_sessions = row_count;

  delete from public.lobby_members lm
  using public.lobbies l
  where lm.lobby_id = l.id and l.code like 'TNSD1B%';
  get diagnostics v_members = row_count;

  delete from public.lobbies where code like 'TNSD1B%';
  get diagnostics v_lobbies = row_count;

  delete from public.tnsd1b_smoke_ctx;

  return jsonb_build_object(
    'lobbies', v_lobbies,
    'members', v_members,
    'sessions', v_sessions
  );
end;
$$;

create or replace function public.tnsd1b_spawn_fixture(
  p_scenario text,
  p_round_count int default 3,
  p_round_index int default 0,
  p_phase text default 'ranking',
  p_finished_mode text default 'all',
  p_with_custom boolean default false,
  p_scored_before int default 0
)
returns jsonb
language plpgsql
as $$
declare
  v_host uuid;
  v_guest uuid;
  v_lobby uuid := gen_random_uuid();
  v_run text := 'tnsd1b-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
  v_code text := 'TNSD1B' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);
  v_state jsonb;
begin
  select a.host_id, a.guest_id into v_host, v_guest
  from public.tnsd1b_resolve_actors() a;

  -- Nettoie seulement les fixtures smoke (jamais un lobby réel)
  perform public.tnsd1b_cleanup_fixtures();

  insert into public.lobbies (id, code, host_id, status, game_id)
  values (v_lobby, v_code, v_host, 'playing', 'tiernight');

  insert into public.lobby_members (lobby_id, user_id, display_name, emoji, color, is_host, ready)
  values
    (v_lobby, v_host, 'TNSD1B Host', '👑', '#F59E0B', true, true),
    (v_lobby, v_guest, 'TNSD1B Guest', '🙂', '#60A5FA', false, true);

  v_state := public.tnsd1b_build_state(
    v_run, v_host, v_guest,
    p_round_count, p_round_index, p_phase,
    p_finished_mode, p_with_custom, p_scored_before
  );

  insert into public.game_sessions (lobby_id, game_id, screen, host_id, state)
  values (
    v_lobby,
    'tiernight',
    case when p_phase = 'series_end' then 'tiernight-end' else 'tiernight' end,
    v_host,
    v_state
  );

  insert into public.tnsd1b_smoke_ctx as c (
    id, lobby_id, host_id, guest_id, run_id, code, scenario, notes, updated_at
  ) values (
    1, v_lobby, v_host, v_guest, v_run, v_code, p_scenario,
    format('count=%s index=%s phase=%s finished=%s custom=%s scored_before=%s',
      p_round_count, p_round_index, p_phase, p_finished_mode, p_with_custom, p_scored_before),
    now()
  )
  on conflict (id) do update set
    lobby_id = excluded.lobby_id,
    host_id = excluded.host_id,
    guest_id = excluded.guest_id,
    run_id = excluded.run_id,
    code = excluded.code,
    scenario = excluded.scenario,
    notes = excluded.notes,
    updated_at = now();

  perform public.tnsd1b_set_host_jwt(v_host);

  return jsonb_build_object(
    'ok', true,
    'lobby_id', v_lobby,
    'code', v_code,
    'run_id', v_run,
    'host_id', v_host,
    'guest_id', v_guest,
    'scenario', p_scenario,
    'auth_uid', auth.uid()
  );
end;
$$;

comment on function public.tnsd1b_spawn_fixture is
  'SMOKE ONLY FEATURE-TIERNIGHT-03-D1-bis — drop via cleanup L';

-- ############################################################################
-- A. PRÉCHECK SCHÉMA RÉEL
-- ############################################################################

-- A1 Colonnes lobbies
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'lobbies'
  and column_name in ('id','code','host_id','status','game_id','created_at','updated_at','last_activity_at')
order by column_name;
-- Attendu : id, code, host_id, status, game_id présents. PAS de colonne name.

-- A2 Colonnes lobby_members
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'lobby_members'
  and column_name in ('id','lobby_id','user_id','display_name','emoji','color','is_host','ready','joined_at','last_seen_at')
order by column_name;

-- A3 Colonnes game_sessions
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'game_sessions'
  and column_name in ('id','lobby_id','game_id','screen','host_id','state','updated_at')
order by column_name;

-- A4 FK vers auth.users
select
  (select count(*) from auth.users) as auth_users_count;
-- Attendu : >= 2

-- A5 Acteurs auto
select * from public.tnsd1b_resolve_actors();
-- Attendu : 1 ligne host_id ≠ guest_id

-- ############################################################################
-- B. CLEANUP PRÉVENTIF
-- ############################################################################

select public.tnsd1b_cleanup_fixtures() as cleanup_preventif;
-- Attendu : jsonb counts (souvent 0)

select count(*) as remaining_tnsd1b_lobbies
from public.lobbies where code like 'TNSD1B%';
-- Attendu : 0

-- ############################################################################
-- C. FIXTURE F/A DE BASE (count 3, ranking, round 0, all finished)
-- ############################################################################

begin;

select public.tnsd1b_spawn_fixture(
  'base_fa',
  3,          -- round_count
  0,          -- round_index
  'ranking',
  'all',      -- finished
  false,      -- custom
  0           -- scored_before
) as fixture_c;

-- Laisser la transaction ouverte pour D–F5 dans la même session,
-- OU commit si vous exécutez les blocs dans des runs séparés.
-- Recommandé pour smoke isolé : enchaîner C→E→F dans UNE transaction puis ROLLBACK.

-- ############################################################################
-- D. VÉRIFICATION FIXTURE AVANT RPC
-- ############################################################################

select
  c.lobby_id,
  c.run_id,
  c.host_id,
  auth.uid() as auth_uid,
  auth.uid() = c.host_id as jwt_is_host,
  gs.game_id,
  gs.screen,
  gs.state -> 'tierNight' -> 'series' ->> 'phase' as phase,
  gs.state -> 'tierNight' -> 'series' ->> 'roundIndex' as round_index,
  jsonb_array_length(gs.state -> 'tierNight' -> 'series' -> 'queue') as queue_len,
  gs.state -> 'tierNight' -> 'finished' as finished,
  public.tiernight_series_validate_series_shape(
    gs.state -> 'tierNight' -> 'series',
    c.run_id
  ) as shape
from public.tnsd1b_smoke_ctx c
join public.game_sessions gs on gs.lobby_id = c.lobby_id;
-- Attendu :
--   jwt_is_host = true
--   game_id = tiernight
--   phase = ranking
--   queue_len = 3
--   shape = {"ok":true}
--   finished = {host:true, guest:true} (booléens JSON)

-- ############################################################################
-- E. F1 — FINALIZE NORMAL
-- ############################################################################

select public.finalize_tiernight_series_round(
  c.lobby_id,
  c.run_id,
  c.run_id || ':0',
  0,
  'ranking',
  false
) as f1
from public.tnsd1b_smoke_ctx c;
-- Attendu : ok=true, applied=true, phase=between_rounds, isLastRound=false

-- ############################################################################
-- F. INSPECTIONS F2–F4
-- ############################################################################

-- F2 phase
select
  gs.state -> 'tierNight' -> 'series' ->> 'phase' as phase
from public.tnsd1b_smoke_ctx c
join public.game_sessions gs on gs.lobby_id = c.lobby_id;
-- Attendu : between_rounds

-- F3 ledgers sans doublon
select
  gs.state -> 'tierNight' -> 'series' -> 'scoredRoundIds' as scored,
  gs.state -> 'tierNight' -> 'series' -> 'completedRoundIds' as completed,
  jsonb_array_length(gs.state -> 'tierNight' -> 'series' -> 'scoredRoundIds') as scored_n,
  jsonb_array_length(gs.state -> 'tierNight' -> 'series' -> 'completedRoundIds') as completed_n
from public.tnsd1b_smoke_ctx c
join public.game_sessions gs on gs.lobby_id = c.lobby_id;
-- Attendu : scored_n=1, completed_n=1, valeur = run:0

-- F4 history/recap
select
  jsonb_array_length(gs.state -> 'tierNight' -> 'series' -> 'roundHistory') as hist_n,
  gs.state -> 'tierNight' -> 'series' -> 'roundRecap' ->> 'roundId' as recap_round,
  gs.state -> 'tierNight' -> 'series' -> 'roundRecap' ->> 'scoresApplied' as scores_applied
from public.tnsd1b_smoke_ctx c
join public.game_sessions gs on gs.lobby_id = c.lobby_id;
-- Attendu : hist_n=1, recap_round=run:0, scores_applied=true

-- Snapshot scores pour F5
select
  gs.state -> 'scores' as scores_after_f1,
  gs.state -> 'stats' ->> 'tierNightsPlayed' as nights
from public.tnsd1b_smoke_ctx c
join public.game_sessions gs on gs.lobby_id = c.lobby_id;
-- Attendu : nights = 0 (pas dernière manche)

-- ############################################################################
-- G. F5–F11
-- ############################################################################

-- G-F5 idempotent (même fixture après F1)
select public.finalize_tiernight_series_round(
  c.lobby_id, c.run_id, c.run_id || ':0', 0, 'ranking', false
) as f5
from public.tnsd1b_smoke_ctx c;
-- Attendu : ok=true, applied=false, code=ALREADY_APPLIED
-- Re-vérifier scores/history inchangés (hist_n toujours 1)

-- --- Fin du parcours F1–F5 sur fixture base : rollback recommandé ---
-- rollback;
-- begin;  -- nouvelle tx pour F6+

-- G-F6 mauvais runId
select public.tnsd1b_spawn_fixture('f6_stale_run', 3, 0, 'ranking', 'all', false, 0);
select public.finalize_tiernight_series_round(
  c.lobby_id, 'wrong-run', c.run_id || ':0', 0, 'ranking', false
) as f6
from public.tnsd1b_smoke_ctx c;
-- Attendu : EXCEPTION TNS_STALE_RUN
-- (dans SQL Editor : encapsuler dans DO $$ BEGIN … EXCEPTION WHEN OTHERS THEN RAISE NOTICE '%', SQLERRM; END $$;)

do $$
declare
  c record;
  v_msg text;
begin
  select * into c from public.tnsd1b_smoke_ctx;
  perform public.tnsd1b_set_host_jwt(c.host_id);
  begin
    perform public.finalize_tiernight_series_round(
      c.lobby_id, 'wrong-run', c.run_id || ':0', 0, 'ranking', false
    );
    raise exception 'F6_EXPECTED_ERROR';
  exception when others then
    v_msg := SQLERRM;
    if position('TNS_STALE_RUN' in v_msg) = 0 then
      raise exception 'F6 unexpected: %', v_msg;
    end if;
    raise notice 'F6 OK: %', v_msg;
  end;
end $$;

-- G-F7 mauvais roundId
do $$
declare
  c record;
  v_msg text;
begin
  perform public.tnsd1b_spawn_fixture('f7_stale_round', 3, 0, 'ranking', 'all', false, 0);
  select * into c from public.tnsd1b_smoke_ctx;
  begin
    perform public.finalize_tiernight_series_round(
      c.lobby_id, c.run_id, c.run_id || ':9', 0, 'ranking', false
    );
    raise exception 'F7_EXPECTED_ERROR';
  exception when others then
    v_msg := SQLERRM;
    if position('TNS_ROUND_ID_MISMATCH' in v_msg) = 0
       and position('TNS_STALE_ROUND_ID' in v_msg) = 0 then
      raise exception 'F7 unexpected: %', v_msg;
    end if;
    raise notice 'F7 OK: %', v_msg;
  end;
end $$;

-- G-F8 mauvais index
do $$
declare
  c record;
  v_msg text;
begin
  perform public.tnsd1b_spawn_fixture('f8_stale_index', 3, 0, 'ranking', 'all', false, 0);
  select * into c from public.tnsd1b_smoke_ctx;
  begin
    perform public.finalize_tiernight_series_round(
      c.lobby_id, c.run_id, c.run_id || ':0', 1, 'ranking', false
    );
    raise exception 'F8_EXPECTED_ERROR';
  exception when others then
    v_msg := SQLERRM;
    if position('TNS_STALE_ROUND_INDEX' in v_msg) = 0
       and position('TNS_ROUND_ID_MISMATCH' in v_msg) = 0 then
      raise exception 'F8 unexpected: %', v_msg;
    end if;
    raise notice 'F8 OK: %', v_msg;
  end;
end $$;

-- G-F9 placements incomplets
do $$
declare
  c record;
  v_msg text;
begin
  perform public.tnsd1b_spawn_fixture('f9_incomplete', 3, 0, 'ranking', 'host_only', false, 0);
  select * into c from public.tnsd1b_smoke_ctx;
  begin
    perform public.finalize_tiernight_series_round(
      c.lobby_id, c.run_id, c.run_id || ':0', 0, 'ranking', false
    );
    raise exception 'F9_EXPECTED_ERROR';
  exception when others then
    v_msg := SQLERRM;
    if position('TNS_PLACEMENTS_INCOMPLETE' in v_msg) = 0 then
      raise exception 'F9 unexpected: %', v_msg;
    end if;
    raise notice 'F9 OK: %', v_msg;
  end;
end $$;

-- G-F10 force zéro finished
do $$
declare
  c record;
  v_msg text;
begin
  perform public.tnsd1b_spawn_fixture('f10_force_zero', 3, 0, 'ranking', 'none', false, 0);
  select * into c from public.tnsd1b_smoke_ctx;
  begin
    perform public.finalize_tiernight_series_round(
      c.lobby_id, c.run_id, c.run_id || ':0', 0, 'ranking', true
    );
    raise exception 'F10_EXPECTED_ERROR';
  exception when others then
    v_msg := SQLERRM;
    if position('TNS_FORCE_NO_FINISHED' in v_msg) = 0 then
      raise exception 'F10 unexpected: %', v_msg;
    end if;
    raise notice 'F10 OK: %', v_msg;
  end;
end $$;

-- G-F11 force sous-ensemble (host only finished=true)
do $$
declare
  c record;
  v_res jsonb;
begin
  perform public.tnsd1b_spawn_fixture('f11_force_subset', 3, 0, 'ranking', 'host_only', false, 0);
  select * into c from public.tnsd1b_smoke_ctx;
  v_res := public.finalize_tiernight_series_round(
    c.lobby_id, c.run_id, c.run_id || ':0', 0, 'ranking', true
  );
  if coalesce((v_res ->> 'ok')::boolean, false) is not true
     or coalesce((v_res ->> 'applied')::boolean, false) is not true
     or coalesce((v_res ->> 'forced')::boolean, false) is not true then
    raise exception 'F11 unexpected: %', v_res;
  end if;
  if v_res ->> 'phase' is distinct from 'between_rounds' then
    raise exception 'F11 phase: %', v_res;
  end if;
  raise notice 'F11 OK: %', v_res;
end $$;

-- ############################################################################
-- H. A1–A10 (advance)
-- ############################################################################

-- H-prep : fixture base + finalize → between_rounds, puis advance
do $$
declare
  c record;
  v_fin jsonb;
  v_adv jsonb;
  v_state jsonb;
  v_queue_before jsonb;
  v_scores_before jsonb;
  v_hist_before jsonb;
  v_scored_before jsonb;
begin
  perform public.tnsd1b_spawn_fixture('a_base', 3, 0, 'ranking', 'all', false, 0);
  select * into c from public.tnsd1b_smoke_ctx;
  select state into v_state from public.game_sessions where lobby_id = c.lobby_id;
  v_queue_before := v_state -> 'tierNight' -> 'series' -> 'queue';

  v_fin := public.finalize_tiernight_series_round(
    c.lobby_id, c.run_id, c.run_id || ':0', 0, 'ranking', false
  );
  if v_fin ->> 'phase' is distinct from 'between_rounds' then
    raise exception 'A prep finalize failed: %', v_fin;
  end if;

  select state into v_state from public.game_sessions where lobby_id = c.lobby_id;
  v_scores_before := v_state -> 'scores';
  v_hist_before := v_state -> 'tierNight' -> 'series' -> 'roundHistory';
  v_scored_before := v_state -> 'tierNight' -> 'series' -> 'scoredRoundIds';

  -- A1
  v_adv := public.advance_tiernight_series_round(
    c.lobby_id, c.run_id, c.run_id || ':0', 0, 'between_rounds'
  );
  if coalesce((v_adv ->> 'ok')::boolean, false) is not true
     or coalesce((v_adv ->> 'applied')::boolean, false) is not true then
    raise exception 'A1 failed: %', v_adv;
  end if;
  if v_adv ->> 'phase' is distinct from 'ranking' then
    raise exception 'A3 phase: %', v_adv;
  end if;
  if (v_adv ->> 'roundIndex')::int is distinct from 1 then
    raise exception 'A2 index: %', v_adv;
  end if;

  select state into v_state from public.game_sessions where lobby_id = c.lobby_id;
  -- A4 queue
  if (v_state -> 'tierNight' -> 'series' -> 'queue') is distinct from v_queue_before then
    raise exception 'A4 queue mutated';
  end if;
  -- A5 scores/history/ledgers
  if (v_state -> 'scores') is distinct from v_scores_before then
    raise exception 'A5 scores mutated';
  end if;
  if (v_state -> 'tierNight' -> 'series' -> 'roundHistory') is distinct from v_hist_before then
    raise exception 'A5 history mutated';
  end if;
  if (v_state -> 'tierNight' -> 'series' -> 'scoredRoundIds') is distinct from v_scored_before then
    raise exception 'A5 scored mutated';
  end if;
  -- A6 clear
  if coalesce(v_state -> 'tierNight' -> 'placements', '{}'::jsonb) <> '{}'::jsonb then
    raise exception 'A6 placements not cleared: %', v_state -> 'tierNight' -> 'placements';
  end if;
  if coalesce(v_state -> 'tierNight' -> 'finished', '{}'::jsonb) <> '{}'::jsonb then
    raise exception 'A6 finished not cleared';
  end if;
  -- advance pose roundRecap null → jsonb_build_object omet souvent la clé
  if (v_state -> 'tierNight' -> 'series' ? 'roundRecap')
     and jsonb_typeof(v_state -> 'tierNight' -> 'series' -> 'roundRecap') <> 'null' then
    raise exception 'A6 roundRecap still set: %', v_state -> 'tierNight' -> 'series' -> 'roundRecap';
  end if;

  -- A7 double advance
  v_adv := public.advance_tiernight_series_round(
    c.lobby_id, c.run_id, c.run_id || ':0', 0, 'between_rounds'
  );
  if not (
    coalesce((v_adv ->> 'ok')::boolean, false)
    and coalesce((v_adv ->> 'applied')::boolean, true) = false
    and v_adv ->> 'code' = 'ALREADY_ADVANCED'
  ) then
    raise exception 'A7 expected ALREADY_ADVANCED: %', v_adv;
  end if;

  raise notice 'A1–A7 OK';
end $$;

-- A8 ancien roundId
do $$
declare
  c record;
  v_msg text;
begin
  perform public.tnsd1b_spawn_fixture('a8', 3, 0, 'ranking', 'all', false, 0);
  select * into c from public.tnsd1b_smoke_ctx;
  perform public.finalize_tiernight_series_round(
    c.lobby_id, c.run_id, c.run_id || ':0', 0, 'ranking', false
  );
  begin
    perform public.advance_tiernight_series_round(
      c.lobby_id, c.run_id, 'not-a-round', 0, 'between_rounds'
    );
    raise exception 'A8_EXPECTED_ERROR';
  exception when others then
    v_msg := SQLERRM;
    if position('TNS_STALE_ROUND_ID' in v_msg) = 0
       and position('TNS_ROUND_ID_MISMATCH' in v_msg) = 0 then
      raise exception 'A8 unexpected: %', v_msg;
    end if;
    raise notice 'A8 OK: %', v_msg;
  end;
end $$;

-- A9 mauvaise phase (ranking sans between)
do $$
declare
  c record;
  v_msg text;
begin
  perform public.tnsd1b_spawn_fixture('a9', 3, 0, 'ranking', 'all', false, 0);
  select * into c from public.tnsd1b_smoke_ctx;
  begin
    perform public.advance_tiernight_series_round(
      c.lobby_id, c.run_id, c.run_id || ':0', 0, 'between_rounds'
    );
    raise exception 'A9_EXPECTED_ERROR';
  exception when others then
    v_msg := SQLERRM;
    if position('TNS_INVALID_PHASE' in v_msg) = 0 then
      raise exception 'A9 unexpected: %', v_msg;
    end if;
    raise notice 'A9 OK: %', v_msg;
  end;
end $$;

-- A10 après series_end
do $$
declare
  c record;
  v_msg text;
  v_fin jsonb;
begin
  -- dernière manche count 3 index 2
  perform public.tnsd1b_spawn_fixture('a10', 3, 2, 'ranking', 'all', false, 2);
  select * into c from public.tnsd1b_smoke_ctx;
  v_fin := public.finalize_tiernight_series_round(
    c.lobby_id, c.run_id, c.run_id || ':2', 2, 'ranking', false
  );
  if v_fin ->> 'phase' is distinct from 'series_end' then
    raise exception 'A10 prep not series_end: %', v_fin;
  end if;
  begin
    perform public.advance_tiernight_series_round(
      c.lobby_id, c.run_id, c.run_id || ':2', 2, 'between_rounds'
    );
    raise exception 'A10_EXPECTED_ERROR';
  exception when others then
    v_msg := SQLERRM;
    if position('TNS_SERIES_ENDED' in v_msg) = 0
       and position('TNS_INVALID_PHASE' in v_msg) = 0
       and position('TNS_NO_NEXT_ROUND' in v_msg) = 0 then
      raise exception 'A10 unexpected: %', v_msg;
    end if;
    raise notice 'A10 OK: %', v_msg;
  end;
end $$;

-- ############################################################################
-- I. L1–L6 dernières manches
-- ############################################################################

do $$
declare
  v_cases int[][] := array[[3,2],[5,4],[8,7],[7,6]];
  v_pair int[];
  v_count int;
  v_idx int;
  c record;
  v_fin jsonb;
  v_fin2 jsonb;
  v_nights_before numeric;
  v_nights_after numeric;
  v_nights_retry numeric;
  v_label text;
begin
  foreach v_pair slice 1 in array v_cases
  loop
    v_count := v_pair[1];
    v_idx := v_pair[2];
    v_label := format('L count=%s idx=%s', v_count, v_idx);

    perform public.tnsd1b_spawn_fixture(
      'last_' || v_count::text,
      v_count, v_idx, 'ranking', 'all', false, v_idx
    );
    select * into c from public.tnsd1b_smoke_ctx;
    select coalesce((state -> 'stats' ->> 'tierNightsPlayed')::numeric, 0)
      into v_nights_before
    from public.game_sessions where lobby_id = c.lobby_id;

    v_fin := public.finalize_tiernight_series_round(
      c.lobby_id, c.run_id, c.run_id || ':' || v_idx::text, v_idx, 'ranking', false
    );
    if v_fin ->> 'phase' is distinct from 'series_end'
       or coalesce((v_fin ->> 'isLastRound')::boolean, false) is not true then
      raise exception '% finalize: %', v_label, v_fin;
    end if;

    select coalesce((state -> 'stats' ->> 'tierNightsPlayed')::numeric, 0)
      into v_nights_after
    from public.game_sessions where lobby_id = c.lobby_id;
    if v_nights_after is distinct from v_nights_before + 1 then
      raise exception '% tierNightsPlayed % → %', v_label, v_nights_before, v_nights_after;
    end if;

    v_fin2 := public.finalize_tiernight_series_round(
      c.lobby_id, c.run_id, c.run_id || ':' || v_idx::text, v_idx, 'ranking', false
    );
    if not (
      coalesce((v_fin2 ->> 'ok')::boolean, false)
      and coalesce((v_fin2 ->> 'applied')::boolean, true) = false
      and v_fin2 ->> 'code' = 'ALREADY_APPLIED'
    ) then
      raise exception '% retry: %', v_label, v_fin2;
    end if;

    select coalesce((state -> 'stats' ->> 'tierNightsPlayed')::numeric, 0)
      into v_nights_retry
    from public.game_sessions where lobby_id = c.lobby_id;
    if v_nights_retry is distinct from v_nights_after then
      raise exception '% double increment', v_label;
    end if;

    raise notice '% OK nights=%', v_label, v_nights_after;
  end loop;
end $$;
-- Couvre L1–L6

-- ############################################################################
-- J. C1–C5 customs + count 8
-- ############################################################################

do $$
declare
  c record;
  v_fin jsonb;
  v_adv jsonb;
  v_shape jsonb;
begin
  -- C1–C3 : custom en queue[0], finalize + advance
  perform public.tnsd1b_spawn_fixture('custom', 3, 0, 'ranking', 'all', true, 0);
  select * into c from public.tnsd1b_smoke_ctx;
  select public.tiernight_series_validate_series_shape(
    state -> 'tierNight' -> 'series', c.run_id
  ) into v_shape
  from public.game_sessions where lobby_id = c.lobby_id;
  if coalesce((v_shape ->> 'ok')::boolean, false) is not true then
    raise exception 'C1 shape: %', v_shape;
  end if;

  v_fin := public.finalize_tiernight_series_round(
    c.lobby_id, c.run_id, c.run_id || ':0', 0, 'ranking', false
  );
  if v_fin ->> 'phase' is distinct from 'between_rounds' then
    raise exception 'C2 finalize: %', v_fin;
  end if;

  v_adv := public.advance_tiernight_series_round(
    c.lobby_id, c.run_id, c.run_id || ':0', 0, 'between_rounds'
  );
  if v_adv ->> 'phase' is distinct from 'ranking' then
    raise exception 'C3 advance: %', v_adv;
  end if;

  -- C4 count 8 + custom
  perform public.tnsd1b_spawn_fixture('count8_custom', 8, 0, 'ranking', 'all', true, 0);
  select * into c from public.tnsd1b_smoke_ctx;
  select public.tiernight_series_validate_series_shape(
    state -> 'tierNight' -> 'series', c.run_id
  ) into v_shape
  from public.game_sessions where lobby_id = c.lobby_id;
  if coalesce((v_shape ->> 'ok')::boolean, false) is not true then
    raise exception 'C4 shape: %', v_shape;
  end if;
  v_fin := public.finalize_tiernight_series_round(
    c.lobby_id, c.run_id, c.run_id || ':0', 0, 'ranking', false
  );
  if coalesce((v_fin ->> 'ok')::boolean, false) is not true then
    raise exception 'C4 finalize: %', v_fin;
  end if;

  raise notice 'C1–C5 OK (C5 = aucune dépendance catalogue : IDs smoke-only)';
end $$;

-- ############################################################################
-- K. R2–R5 round_result — BLOC AUTONOME (ne dépend d’aucune exécution précédente)
-- ############################################################################
-- IMPORTANT SQL Editor :
--   Exécuter ce DO seul OU après HELPERS. Ne jamais réutiliser un tnsd1b_smoke_ctx
--   issu d’un run précédent (cause du faux TNS_STALE_RUN observé en exécution
--   fragmentée). spawn_fixture nettoie et recrée lobby+ctx+JWT dans ce bloc.
--   TNS_STALE_RUN est INTERDIT ici une fois l’identité prouvée.

do $$
declare
  c record;
  v_msg text;
  v_shape jsonb;
  v_run text;
  v_state_before jsonb;
  v_state_after_fin jsonb;
  v_state_after_adv jsonb;
  v_phase text;
begin
  -- 1) Fixture R dédiée (cleanup interne + JWT hôte)
  perform public.tnsd1b_spawn_fixture('r_inject', 3, 0, 'ranking', 'all', false, 0);
  select * into c from public.tnsd1b_smoke_ctx;

  select state into v_state_before
  from public.game_sessions where lobby_id = c.lobby_id;

  -- 2) Identité avant inject
  if coalesce(v_state_before -> 'tierNight' ->> 'runId', '') is distinct from c.run_id then
    raise exception 'R2_RUNID_DRIFT_BEFORE ctx=% state=%',
      c.run_id, v_state_before -> 'tierNight' ->> 'runId';
  end if;
  if coalesce(v_state_before -> 'tierNight' -> 'series' -> 'queue' -> 0 ->> 'roundId', '')
     is distinct from (c.run_id || ':0') then
    raise exception 'R2_QUEUE_ROUND_MISMATCH';
  end if;

  -- 3) Inject phase uniquement
  update public.game_sessions gs
  set state = jsonb_set(
    state,
    '{tierNight,series,phase}',
    '"round_result"'::jsonb,
    true
  )
  where gs.lobby_id = c.lobby_id;

  select state into v_state_before
  from public.game_sessions where lobby_id = c.lobby_id;

  -- 4) Identité après inject (doit être inchangée)
  v_run := v_state_before -> 'tierNight' ->> 'runId';
  if v_run is distinct from c.run_id then
    raise exception 'R2_RUNID_DRIFT_AFTER ctx=% state=%', c.run_id, v_run;
  end if;
  if coalesce(v_state_before -> 'tierNight' -> 'series' ->> 'phase', '')
     is distinct from 'round_result' then
    raise exception 'R2_PHASE_NOT_INJECTED: %',
      v_state_before -> 'tierNight' -> 'series' ->> 'phase';
  end if;

  -- 5) Shape direct
  v_shape := public.tiernight_series_validate_series_shape(
    v_state_before -> 'tierNight' -> 'series',
    v_run
  );
  if coalesce(v_shape ->> 'code', '') is distinct from 'TNS_UNKNOWN_PHASE' then
    raise exception 'R2 shape expected TNS_UNKNOWN_PHASE: %', v_shape;
  end if;
  if coalesce(v_shape ->> 'detail', '') is distinct from 'round_result' then
    raise exception 'R2 shape detail expected round_result: %', v_shape;
  end if;

  -- 6) Finalize rejeté — runId LU depuis state ; TNS_STALE_RUN interdit
  begin
    perform public.finalize_tiernight_series_round(
      c.lobby_id, v_run, v_run || ':0', 0, 'ranking', false
    );
    raise exception 'R3_FINALIZE_EXPECTED_ERROR';
  exception when others then
    v_msg := SQLERRM;
    if position('TNS_STALE_RUN' in v_msg) > 0 then
      raise exception 'R3 finalize must NOT be TNS_STALE_RUN when identity proven: %', v_msg;
    end if;
    if position('TNS_UNKNOWN_PHASE' in v_msg) = 0
       and position('TNS_INVALID_SERIES' in v_msg) = 0
       and position('TNS_INVALID_PHASE' in v_msg) = 0 then
      raise exception 'R3 finalize unexpected: %', v_msg;
    end if;
    raise notice 'R3 finalize OK: %', v_msg;
  end;

  select state into v_state_after_fin
  from public.game_sessions where lobby_id = c.lobby_id;
  if v_state_after_fin is distinct from v_state_before then
    raise exception 'R3 finalize mutated state';
  end if;

  -- 7) Advance rejeté — même runId state ; TNS_STALE_RUN interdit
  begin
    perform public.advance_tiernight_series_round(
      c.lobby_id, v_run, v_run || ':0', 0, 'between_rounds'
    );
    raise exception 'R3_ADVANCE_EXPECTED_ERROR';
  exception when others then
    v_msg := SQLERRM;
    if position('TNS_STALE_RUN' in v_msg) > 0 then
      raise exception 'R3 advance must NOT be TNS_STALE_RUN when identity proven: %', v_msg;
    end if;
    if position('TNS_UNKNOWN_PHASE' in v_msg) = 0
       and position('TNS_INVALID_SERIES' in v_msg) = 0
       and position('TNS_INVALID_PHASE' in v_msg) = 0 then
      raise exception 'R3 advance unexpected: %', v_msg;
    end if;
    raise notice 'R3 advance OK: %', v_msg;
  end;

  select state into v_state_after_adv
  from public.game_sessions where lobby_id = c.lobby_id;
  if v_state_after_adv is distinct from v_state_before then
    raise exception 'R3 advance mutated state';
  end if;

  -- 8) Phase toujours round_result (pas de transition silencieuse)
  v_phase := v_state_after_adv -> 'tierNight' -> 'series' ->> 'phase';
  if v_phase is distinct from 'round_result' then
    raise exception 'R4 phase changed unexpectedly: %', v_phase;
  end if;

  raise notice 'R2–R5 OK autonome — phase retirée rejetée, aucune mutation, pas de STALE_RUN';
end $$;

-- ############################################################################
-- L. CLEANUP FINAL + DROP HELPERS
-- ############################################################################

select public.tnsd1b_cleanup_fixtures() as cleanup_final;

select count(*) as remaining_lobbies from public.lobbies where code like 'TNSD1B%';
-- Attendu : 0
select count(*) as remaining_sessions
from public.game_sessions gs
join public.lobbies l on l.id = gs.lobby_id
where l.code like 'TNSD1B%';
-- Attendu : 0 (join vide)
select count(*) as remaining_ctx from public.tnsd1b_smoke_ctx;
-- Attendu : 0

-- Optionnel : retirer les helpers smoke du schéma
drop function if exists public.tnsd1b_spawn_fixture(text, int, int, text, text, boolean, int);
drop function if exists public.tnsd1b_build_state(text, uuid, uuid, int, int, text, text, boolean, int);
drop function if exists public.tnsd1b_build_queue(text, int, boolean);
drop function if exists public.tnsd1b_queue_entry(text, int, text, boolean);
drop function if exists public.tnsd1b_full_placement(jsonb);
drop function if exists public.tnsd1b_set_host_jwt(uuid);
drop function if exists public.tnsd1b_resolve_actors();
drop function if exists public.tnsd1b_cleanup_fixtures();
drop table if exists public.tnsd1b_smoke_ctx;

-- =============================================================================
-- FIN HARNESS
-- =============================================================================
-- Si une tx est encore ouverte après C–F : ROLLBACK;
-- =============================================================================
