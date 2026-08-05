-- =============================================================================
-- FEATURE-TIERNIGHT-SERIES-05 — advance_tiernight_series_round
-- =============================================================================
-- Transition transactionnelle : between_rounds → ranking (manche suivante).
--
-- Prérequis staging : SERIES-03A/03B appliqués
--   (helpers tiernight_series_validate_series_shape / roster / items,
--    is_lobby_host, is_acting_host, assert_lobby_member).
--
-- Ce fichier :
--   - est idempotent / rejouable (CREATE OR REPLACE + REVOKE/GRANT) ;
--   - N’EST PAS appliqué automatiquement ;
--   - ne redéfinit PAS les helpers de validation (réutilise 03A).
--
-- La RPC :
--   - ne score PAS ;
--   - ne touche PAS scores / playerStats / gameScores / stats / eveningGamesRecorded ;
--   - ne modifie PAS queue / ledgers / roundHistory / roster / items / runId / modifier ;
--   - lit le thème suivant UNIQUEMENT depuis la queue verrouillée ;
--   - idempotence : ALREADY_ADVANCED uniquement si preuve COMPLÈTE
--     (scored+completed+history×1+screen tiernight+topic queue[N+1] ; pas de roundRecap).
-- =============================================================================

create or replace function public.advance_tiernight_series_round(
  p_lobby_id uuid,
  p_run_id text,
  p_current_round_id text,
  p_current_round_index integer,
  p_expected_phase text default 'between_rounds'
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.game_sessions;
  v_state jsonb;
  v_tn jsonb;
  v_series jsonb;
  v_queue jsonb;
  v_entry jsonb;
  v_next_entry jsonb;
  v_snap jsonb;
  v_roster jsonb;
  v_items jsonb;
  v_round_count int;
  v_round_index int;
  v_phase text;
  v_scored jsonb;
  v_completed jsonb;
  v_history jsonb;
  v_round_recap jsonb;
  v_hist_count int;
  v_next_index int;
  v_next_round_id text;
  v_check jsonb;
  v_now timestamptz := clock_timestamp();
  v_expected_phase text := lower(trim(coalesce(p_expected_phase, 'between_rounds')));
  v_run text := trim(coalesce(p_run_id, ''));
  v_round text := trim(coalesce(p_current_round_id, ''));
  v_expected_round_id text;
  v_scores_before jsonb;
  v_player_stats_before jsonb;
  v_game_scores_before jsonb;
  v_stats_before jsonb;
  v_evening_before jsonb;
  v_queue_before jsonb;
  v_scored_before jsonb;
  v_completed_before jsonb;
  v_history_before jsonb;
  v_roster_before jsonb;
  v_items_before jsonb;
  v_modifier_before text;
begin
  -- ---------------------------------------------------------------------------
  -- Auth / autorisation
  -- ---------------------------------------------------------------------------
  if v_uid is null then
    raise exception 'TNS_AUTH_REQUIRED';
  end if;

  perform public.assert_lobby_member(p_lobby_id);

  if not (public.is_lobby_host(p_lobby_id) or public.is_acting_host(p_lobby_id)) then
    raise exception 'TNS_UNAUTHORIZED';
  end if;

  if length(v_run) = 0 then
    raise exception 'TNS_INVALID_RUN_ID';
  end if;
  if length(v_round) = 0 then
    raise exception 'TNS_INVALID_ROUND_ID';
  end if;
  if p_current_round_index is null or p_current_round_index < 0 then
    raise exception 'TNS_INVALID_ROUND_INDEX';
  end if;

  -- ---------------------------------------------------------------------------
  -- Verrouillage session
  -- ---------------------------------------------------------------------------
  select * into v_row
  from public.game_sessions
  where lobby_id = p_lobby_id
  for update;

  if not found then
    raise exception 'TNS_SESSION_NOT_FOUND';
  end if;

  if v_row.game_id is distinct from 'tiernight' then
    raise exception 'TNS_WRONG_GAME';
  end if;

  v_state := coalesce(v_row.state, '{}'::jsonb);
  v_tn := v_state -> 'tierNight';
  if v_tn is null or jsonb_typeof(v_tn) <> 'object' then
    raise exception 'TNS_NO_TIERNIGHT';
  end if;

  if coalesce(v_tn ->> 'runId', '') is distinct from v_run then
    raise exception 'TNS_STALE_RUN';
  end if;

  if not (v_tn ? 'series') or v_tn -> 'series' is null
     or jsonb_typeof(v_tn -> 'series') <> 'object' then
    raise exception 'TNS_NO_SERIES';
  end if;

  v_series := v_tn -> 'series';
  v_check := public.tiernight_series_validate_series_shape(v_series, v_run);
  if coalesce((v_check ->> 'ok')::boolean, false) is not true then
    raise exception '%', coalesce(v_check ->> 'code', 'TNS_INVALID_SERIES');
  end if;

  v_roster := v_tn -> 'playerRoster';
  v_items := v_tn -> 'items';
  v_check := public.tiernight_series_validate_roster(v_roster);
  if coalesce((v_check ->> 'ok')::boolean, false) is not true then
    raise exception '%', coalesce(v_check ->> 'code', 'TNS_MISSING_ROSTER');
  end if;
  v_check := public.tiernight_series_validate_expected_items(v_items);
  if coalesce((v_check ->> 'ok')::boolean, false) is not true then
    raise exception '%', coalesce(v_check ->> 'code', 'TNS_MISSING_ITEMS');
  end if;

  v_phase := coalesce(v_series ->> 'phase', '');
  v_round_index := coalesce((v_series ->> 'roundIndex')::int, -1);
  v_round_count := coalesce((v_series ->> 'roundCount')::int, 0);
  v_queue := v_series -> 'queue';
  v_scored := coalesce(v_series -> 'scoredRoundIds', '[]'::jsonb);
  v_completed := coalesce(v_series -> 'completedRoundIds', '[]'::jsonb);
  v_history := coalesce(v_series -> 'roundHistory', '[]'::jsonb);
  v_round_recap := v_series -> 'roundRecap';

  -- Snapshots immutabilité (retour diagnostic + asserts internes)
  v_scores_before := v_state -> 'scores';
  v_player_stats_before := v_state -> 'playerStats';
  v_game_scores_before := v_state -> 'gameScores';
  v_stats_before := v_state -> 'stats';
  v_evening_before := v_state -> 'eveningGamesRecorded';
  v_queue_before := v_queue;
  v_scored_before := v_scored;
  v_completed_before := v_completed;
  v_history_before := v_history;
  v_roster_before := v_roster;
  v_items_before := v_items;
  v_modifier_before := coalesce(v_tn ->> 'modifier', 'normal');

  -- ---------------------------------------------------------------------------
  -- Résoudre le round courant AVANT idempotence (contrat 03A)
  -- ---------------------------------------------------------------------------
  if p_current_round_index >= jsonb_array_length(v_queue) then
    raise exception 'TNS_ROUND_OUT_OF_BOUNDS';
  end if;

  v_entry := v_queue -> p_current_round_index;
  if v_entry is null or jsonb_typeof(v_entry) <> 'object' then
    raise exception 'TNS_MISSING_ROUND';
  end if;

  v_expected_round_id := v_run || ':' || p_current_round_index::text;
  if v_round is distinct from v_expected_round_id then
    raise exception 'TNS_ROUND_ID_MISMATCH';
  end if;
  if coalesce(v_entry ->> 'roundId', '') is distinct from v_round then
    raise exception 'TNS_STALE_ROUND_ID';
  end if;
  if coalesce((v_entry ->> 'roundIndex')::int, -1) is distinct from p_current_round_index then
    raise exception 'TNS_ROUND_INDEX_MISMATCH';
  end if;

  v_next_index := p_current_round_index + 1;

  -- ---------------------------------------------------------------------------
  -- Idempotence : déjà avancé de N → N+1 (phase ranking, index N+1)
  -- Preuve COMPLÈTE (alignée sur les préconditions du 1er appel, hors roundRecap) :
  --   runId, roundId N, queue[N], phase ranking, index N+1, N+1 < roundCount,
  --   queue[N+1] valide + roundId, topic = queue[N+1], screen = tiernight,
  --   N ∈ scoredRoundIds, N ∈ completedRoundIds, history exactement 1× round N.
  -- Preuve incomplète → erreur structurée, AUCUNE mutation, pas ALREADY_ADVANCED.
  -- ---------------------------------------------------------------------------
  if v_phase = 'ranking'
     and v_round_index = v_next_index
     and v_next_index < v_round_count
  then
    v_next_entry := v_queue -> v_next_index;
    v_next_round_id := v_run || ':' || v_next_index::text;

    if v_next_entry is null or jsonb_typeof(v_next_entry) <> 'object' then
      raise exception 'TNS_MISSING_NEXT_ROUND';
    end if;
    if coalesce(v_next_entry ->> 'roundId', '') is distinct from v_next_round_id then
      raise exception 'TNS_NEXT_ROUND_ID_MISMATCH';
    end if;
    if coalesce(v_tn ->> 'topicId', '') is distinct from coalesce(v_next_entry ->> 'topicId', '') then
      raise exception 'TNS_TOPIC_MISMATCH';
    end if;
    if coalesce(v_row.screen, '') is distinct from 'tiernight' then
      raise exception 'TNS_SCREEN_MISMATCH';
    end if;
    if not exists (
      select 1 from jsonb_array_elements_text(v_scored) s(val) where s.val = v_round
    ) then
      raise exception 'TNS_ROUND_NOT_SCORED';
    end if;
    if not exists (
      select 1 from jsonb_array_elements_text(v_completed) s(val) where s.val = v_round
    ) then
      raise exception 'TNS_ROUND_NOT_COMPLETED';
    end if;

    select count(*)::int into v_hist_count
    from jsonb_array_elements(v_history) h
    where coalesce(h ->> 'roundId', '') = v_round;

    if v_hist_count = 0 then
      raise exception 'TNS_HISTORY_MISSING_ROUND';
    end if;
    if v_hist_count <> 1 then
      raise exception 'TNS_HISTORY_AMBIGUOUS_ROUND';
    end if;

    -- Preuve complète → retry exact réussi
    return jsonb_build_object(
      'ok', true,
      'applied', false,
      'code', 'ALREADY_ADVANCED',
      'phase', v_phase,
      'roundId', v_next_round_id,
      'roundIndex', v_next_index,
      'fromRoundId', v_round,
      'fromRoundIndex', p_current_round_index,
      'lobbyId', p_lobby_id,
      'screen', v_row.screen,
      'state', v_state
    );
  end if;

  -- ---------------------------------------------------------------------------
  -- Première application : préconditions métier
  -- ---------------------------------------------------------------------------
  if v_phase = 'series_end' then
    raise exception 'TNS_SERIES_ENDED';
  end if;

  if v_expected_phase is distinct from 'between_rounds'
     and v_expected_phase is distinct from v_phase then
    raise exception 'TNS_INVALID_PHASE';
  end if;

  if v_phase is distinct from 'between_rounds' then
    raise exception 'TNS_INVALID_PHASE';
  end if;

  if v_round_index is distinct from p_current_round_index then
    raise exception 'TNS_STALE_ROUND_INDEX';
  end if;

  -- Pendant between_rounds, le thème actif reste celui de la manche courante
  if coalesce(v_tn ->> 'topicId', '') is distinct from coalesce(v_entry ->> 'topicId', '') then
    raise exception 'TNS_TOPIC_MISMATCH';
  end if;

  if not exists (
    select 1 from jsonb_array_elements_text(v_scored) s(val) where s.val = v_round
  ) then
    raise exception 'TNS_ROUND_NOT_SCORED';
  end if;

  if not exists (
    select 1 from jsonb_array_elements_text(v_completed) s(val) where s.val = v_round
  ) then
    raise exception 'TNS_ROUND_NOT_COMPLETED';
  end if;

  select count(*)::int into v_hist_count
  from jsonb_array_elements(v_history) h
  where coalesce(h ->> 'roundId', '') = v_round;

  if v_hist_count = 0 then
    raise exception 'TNS_HISTORY_MISSING_ROUND';
  end if;
  if v_hist_count <> 1 then
    raise exception 'TNS_HISTORY_AMBIGUOUS_ROUND';
  end if;

  if v_round_recap is null or jsonb_typeof(v_round_recap) <> 'object' then
    raise exception 'TNS_ROUND_RECAP_MISSING';
  end if;
  if coalesce(v_round_recap ->> 'roundId', '') is distinct from v_round then
    raise exception 'TNS_ROUND_RECAP_MISMATCH';
  end if;

  if p_current_round_index >= v_round_count - 1 then
    raise exception 'TNS_NO_NEXT_ROUND';
  end if;

  if v_next_index >= jsonb_array_length(v_queue) then
    raise exception 'TNS_NO_NEXT_ROUND';
  end if;

  v_next_entry := v_queue -> v_next_index;
  if v_next_entry is null or jsonb_typeof(v_next_entry) <> 'object' then
    raise exception 'TNS_MISSING_NEXT_ROUND';
  end if;

  v_next_round_id := v_run || ':' || v_next_index::text;
  if coalesce(v_next_entry ->> 'roundId', '') is distinct from v_next_round_id then
    raise exception 'TNS_NEXT_ROUND_ID_MISMATCH';
  end if;

  v_snap := v_next_entry -> 'topicSnapshot';
  if v_snap is null or jsonb_typeof(v_snap) <> 'object' then
    raise exception 'TNS_INCOMPLETE_SNAPSHOT';
  end if;

  -- ---------------------------------------------------------------------------
  -- Mutation atomique (aucun score)
  -- ---------------------------------------------------------------------------
  v_series := v_series || jsonb_build_object(
    'roundIndex', v_next_index,
    'phase', 'ranking',
    'roundRecap', null,
    'scoredRoundIds', v_scored,
    'completedRoundIds', v_completed,
    'roundHistory', v_history,
    'queue', v_queue
  );

  v_tn := v_tn || jsonb_build_object(
    'series', v_series,
    'runId', v_run,
    'topicId', v_next_entry ->> 'topicId',
    'listName', coalesce(v_snap ->> 'name', ''),
    'topicEmoji', coalesce(v_snap ->> 'emoji', ''),
    'placements', '{}'::jsonb,
    'finished', '{}'::jsonb,
    'lobbyStarted', true,
    'playerRoster', v_roster,
    'items', v_items,
    'modifier', v_modifier_before
  );

  v_state := jsonb_set(v_state, '{tierNight}', v_tn, true);

  -- Garanties immutabilité scores / stats (réécriture explicite des mêmes valeurs)
  if v_scores_before is not null then
    v_state := jsonb_set(v_state, '{scores}', v_scores_before, true);
  end if;
  if v_player_stats_before is not null then
    v_state := jsonb_set(v_state, '{playerStats}', v_player_stats_before, true);
  end if;
  if v_game_scores_before is not null then
    v_state := jsonb_set(v_state, '{gameScores}', v_game_scores_before, true);
  end if;
  if v_stats_before is not null then
    v_state := jsonb_set(v_state, '{stats}', v_stats_before, true);
  end if;
  if v_evening_before is not null then
    v_state := jsonb_set(v_state, '{eveningGamesRecorded}', v_evening_before, true);
  end if;

  -- Asserts internes (fail closed si corruption inattendue)
  if (v_state -> 'tierNight' -> 'series' -> 'queue') is distinct from v_queue_before then
    raise exception 'TNS_QUEUE_MUTATED';
  end if;
  if (v_state -> 'tierNight' -> 'series' -> 'scoredRoundIds') is distinct from v_scored_before then
    raise exception 'TNS_LEDGER_MUTATED';
  end if;
  if (v_state -> 'tierNight' -> 'series' -> 'completedRoundIds') is distinct from v_completed_before then
    raise exception 'TNS_LEDGER_MUTATED';
  end if;
  if (v_state -> 'tierNight' -> 'series' -> 'roundHistory') is distinct from v_history_before then
    raise exception 'TNS_HISTORY_MUTATED';
  end if;
  if (v_state -> 'tierNight' -> 'playerRoster') is distinct from v_roster_before then
    raise exception 'TNS_ROSTER_MUTATED';
  end if;
  if (v_state -> 'tierNight' -> 'items') is distinct from v_items_before then
    raise exception 'TNS_ITEMS_MUTATED';
  end if;

  update public.game_sessions gs
  set
    state = v_state,
    screen = 'tiernight',
    updated_at = v_now
  where gs.lobby_id = p_lobby_id
  returning * into v_row;

  return jsonb_build_object(
    'ok', true,
    'applied', true,
    'code', null,
    'phase', 'ranking',
    'roundId', v_next_round_id,
    'roundIndex', v_next_index,
    'fromRoundId', v_round,
    'fromRoundIndex', p_current_round_index,
    'topicId', v_next_entry ->> 'topicId',
    'lobbyId', p_lobby_id,
    'screen', v_row.screen,
    'state', v_row.state
  );
end;
$$;

comment on function public.advance_tiernight_series_round(uuid, text, text, integer, text) is
  'FEATURE-TIERNIGHT-SERIES-05: between_rounds → ranking (manche suivante). Pas de scoring. Idempotent ALREADY_ADVANCED.';

-- =============================================================================
-- Permissions
-- =============================================================================

do $perm$
begin
  execute 'revoke all on function public.advance_tiernight_series_round(uuid, text, text, integer, text) from public';
  execute 'revoke all on function public.advance_tiernight_series_round(uuid, text, text, integer, text) from anon';
  execute 'grant execute on function public.advance_tiernight_series_round(uuid, text, text, integer, text) to authenticated';
end $perm$;

-- Helpers internes : rester non exposés (réaffirme le contrat 03A)
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname like 'tiernight_series_%'
  loop
    execute format('revoke all on function %s from public', r.sig);
    execute format('revoke all on function %s from anon', r.sig);
    execute format('revoke all on function %s from authenticated', r.sig);
  end loop;
end $$;
