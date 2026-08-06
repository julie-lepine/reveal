-- =============================================================================
-- FEATURE-TIERNIGHT-03-D1-bis — Fix portée v_rec dans finalize_tiernight_series_round
-- =============================================================================
-- Bug : v_rec declare jsonb ; boucle FOR assignait value mais le corps utilisait
--       v_rec.elem (syntaxe RECORD / table.colonne) → ERROR 42P01.
-- Correctif : for v_rec in select value ... ; v_rec ->> 'uid' (operateurs jsonb).
-- Aucun changement de contrat metier / scoring / phases / ledgers.
-- Idempotent : CREATE OR REPLACE finalize uniquement (PAS le validateur shape).
-- Appliquer APRES 03A ; D1-bis shape reste la derniere def du validateur.
-- =============================================================================
create or replace function public.finalize_tiernight_series_round(
  p_lobby_id uuid,
  p_run_id text,
  p_round_id text,
  p_round_index integer,
  p_expected_phase text default 'ranking',
  p_force boolean default false
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
  v_snap jsonb;
  v_roster jsonb;
  v_items jsonb;
  v_placements jsonb;
  v_finished jsonb;
  v_modifier text;
  v_reverse boolean := false;
  v_round_count int;
  v_round_index int;
  v_phase text;
  v_scored jsonb;
  v_completed jsonb;
  v_history jsonb;
  v_is_last boolean;
  v_next_phase text;
  v_participating text[] := array[]::text[];
  v_uid_text text;
  v_item text;
  v_ranks int[];
  v_median int;
  v_cons_tier text;
  v_consensus jsonb := jsonb_build_object(
    'S', '[]'::jsonb, 'A', '[]'::jsonb, 'B', '[]'::jsonb, 'C', '[]'::jsonb, 'D', '[]'::jsonb
  );
  v_recaps jsonb := '[]'::jsonb;
  v_rec jsonb;
  v_placed jsonb;
  v_pts_sum numeric;
  v_item_n int;
  v_proximity int;
  v_local_tier text;
  v_spread int;
  v_best_spread int := -1;
  v_controversial text := null;
  v_cons_rank int;
  v_diff int;
  v_max_diff int;
  v_points int;
  v_scores jsonb;
  v_player_stats jsonb;
  v_game_scores jsonb;
  v_tn_scores jsonb;
  v_stats jsonb;
  v_round_recap jsonb;
  v_now timestamptz := clock_timestamp();
  v_expected_phase text := lower(trim(coalesce(p_expected_phase, 'ranking')));
  v_check jsonb;
  v_score_result jsonb;
  v_participant_uids_json jsonb;
  v_run text := trim(coalesce(p_run_id, ''));
  v_round text := trim(coalesce(p_round_id, ''));
  v_expected_round_id text;
begin
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
  if p_round_index is null or p_round_index < 0 then
    raise exception 'TNS_INVALID_ROUND_INDEX';
  end if;

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

  v_phase := coalesce(v_series ->> 'phase', '');
  v_round_index := coalesce((v_series ->> 'roundIndex')::int, -1);
  v_round_count := coalesce((v_series ->> 'roundCount')::int, 0);
  v_queue := v_series -> 'queue';
  v_scored := coalesce(v_series -> 'scoredRoundIds', '[]'::jsonb);
  v_completed := coalesce(v_series -> 'completedRoundIds', '[]'::jsonb);
  v_history := coalesce(v_series -> 'roundHistory', '[]'::jsonb);

  -- RÃ©soudre l'entrÃ©e AVANT idempotence
  if p_round_index >= jsonb_array_length(v_queue) then
    raise exception 'TNS_ROUND_OUT_OF_BOUNDS';
  end if;

  v_entry := v_queue -> p_round_index;
  if v_entry is null or jsonb_typeof(v_entry) <> 'object' then
    raise exception 'TNS_MISSING_ROUND';
  end if;

  v_expected_round_id := v_run || ':' || p_round_index::text;
  if v_round is distinct from v_expected_round_id then
    raise exception 'TNS_ROUND_ID_MISMATCH';
  end if;
  if coalesce(v_entry ->> 'roundId', '') is distinct from v_round then
    raise exception 'TNS_STALE_ROUND_ID';
  end if;
  if coalesce((v_entry ->> 'roundIndex')::int, -1) is distinct from p_round_index then
    raise exception 'TNS_ROUND_INDEX_MISMATCH';
  end if;
  if coalesce(v_tn ->> 'topicId', '') is distinct from coalesce(v_entry ->> 'topicId', '') then
    raise exception 'TNS_TOPIC_MISMATCH';
  end if;

  -- Idempotence : round rÃ©solu dÃ©jÃ  scorÃ© (phase peut Ãªtre between_rounds | series_end)
  if exists (
    select 1
    from jsonb_array_elements_text(v_scored) s(val)
    where s.val = v_round
  ) then
    return jsonb_build_object(
      'ok', true,
      'applied', false,
      'code', 'ALREADY_APPLIED',
      'phase', v_phase,
      'roundId', v_round,
      'roundIndex', p_round_index,
      'lobbyId', p_lobby_id,
      'screen', v_row.screen,
      'state', v_state
    );
  end if;

  -- PremiÃ¨re application : phase ranking + index actif
  if v_phase = 'series_end' then
    raise exception 'TNS_SERIES_ENDED';
  end if;
  if v_round_index is distinct from p_round_index then
    raise exception 'TNS_STALE_ROUND_INDEX';
  end if;
  if v_expected_phase is distinct from 'ranking' and v_expected_phase is distinct from v_phase then
    raise exception 'TNS_INVALID_PHASE';
  end if;
  if v_phase is distinct from 'ranking' then
    raise exception 'TNS_INVALID_PHASE';
  end if;

  v_roster := v_tn -> 'playerRoster';
  v_items := v_tn -> 'items';
  v_placements := coalesce(v_tn -> 'placements', '{}'::jsonb);
  v_finished := coalesce(v_tn -> 'finished', '{}'::jsonb);
  v_modifier := coalesce(v_tn ->> 'modifier', 'normal');
  v_reverse := (v_modifier = 'reverse');

  v_check := public.tiernight_series_validate_roster(v_roster);
  if coalesce((v_check ->> 'ok')::boolean, false) is not true then
    raise exception '%', coalesce(v_check ->> 'code', 'TNS_MISSING_ROSTER');
  end if;

  v_check := public.tiernight_series_validate_expected_items(v_items);
  if coalesce((v_check ->> 'ok')::boolean, false) is not true then
    raise exception '%', coalesce(v_check ->> 'code', 'TNS_MISSING_ITEMS');
  end if;

  if jsonb_typeof(v_placements) <> 'object' then
    raise exception 'TNS_PLACEMENTS_INVALID';
  end if;
  if jsonb_typeof(v_finished) <> 'object' then
    raise exception 'TNS_FINISHED_INVALID';
  end if;

  v_check := public.tiernight_series_validate_finished(v_finished, v_roster);
  if coalesce((v_check ->> 'ok')::boolean, false) is not true then
    raise exception '%', coalesce(v_check ->> 'code', 'TNS_FINISHED_INVALID');
  end if;

  if coalesce(p_force, false) then
    -- Force : roster âˆ© finished=true âˆ© placement strictement valide
    for v_uid_text in
      select r ->> 'userId'
      from jsonb_array_elements(v_roster) r
      where coalesce(r ->> 'userId', '') <> ''
    loop
      if public.tiernight_series_is_finished_flag(v_finished, v_uid_text) then
        v_placed := v_placements -> v_uid_text;
        v_check := public.tiernight_series_validate_placement(v_placed, v_items);
        if coalesce((v_check ->> 'ok')::boolean, false) is not true then
          raise exception '%', coalesce(v_check ->> 'code', 'TNS_PLACEMENT_INVALID');
        end if;
        v_participating := array_append(v_participating, v_uid_text);
      end if;
    end loop;
    if coalesce(array_length(v_participating, 1), 0) = 0 then
      raise exception 'TNS_FORCE_NO_FINISHED';
    end if;
  else
    for v_uid_text in
      select r ->> 'userId'
      from jsonb_array_elements(v_roster) r
      where coalesce(r ->> 'userId', '') <> ''
    loop
      if not public.tiernight_series_is_finished_flag(v_finished, v_uid_text) then
        raise exception 'TNS_PLACEMENTS_INCOMPLETE';
      end if;
      v_placed := v_placements -> v_uid_text;
      v_check := public.tiernight_series_validate_placement(v_placed, v_items);
      if coalesce((v_check ->> 'ok')::boolean, false) is not true then
        raise exception '%', coalesce(v_check ->> 'code', 'TNS_PLACEMENT_INVALID');
      end if;
      v_participating := array_append(v_participating, v_uid_text);
    end loop;
  end if;

  if coalesce(array_length(v_participating, 1), 0) = 0 then
    raise exception 'TNS_NO_PARTICIPANTS';
  end if;

  -- Moteur canonique UNIQUE (golden = mÃªme helper)
  select coalesce(jsonb_agg(to_jsonb(u) order by ord), '[]'::jsonb)
    into v_participant_uids_json
  from unnest(v_participating) with ordinality as t(u, ord);

  v_score_result := public.tiernight_series_compute_scores(
    v_items,
    v_placements,
    v_participant_uids_json,
    v_reverse
  );
  if coalesce((v_score_result ->> 'ok')::boolean, false) is not true then
    raise exception '%', coalesce(v_score_result ->> 'code', 'TNS_SCORE_COMPUTE_FAILED');
  end if;

  v_consensus := v_score_result -> 'consensus';
  if jsonb_typeof(v_score_result -> 'controversialItem') = 'string' then
    v_controversial := v_score_result ->> 'controversialItem';
  else
    v_controversial := null;
  end if;
  v_best_spread := coalesce((v_score_result ->> 'controversialSpread')::int, -1);

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'uid', s.elem ->> 'uid',
      'player', coalesce((
        select r ->> 'displayName'
        from jsonb_array_elements(v_roster) r
        where r ->> 'userId' = (s.elem ->> 'uid')
        limit 1
      ), s.elem ->> 'uid'),
      'placed', v_placements -> (s.elem ->> 'uid'),
      'proximityPoints', coalesce((s.elem ->> 'proximityPoints')::int, 0),
      'outsiderBonus', coalesce((s.elem ->> 'outsiderBonus')::int, 0),
      'consensusPoints', coalesce((s.elem ->> 'consensusPoints')::int, 0)
    )
    order by s.ord
  ), '[]'::jsonb)
    into v_recaps
  from jsonb_array_elements(coalesce(v_score_result -> 'scores', '[]'::jsonb))
    with ordinality as s(elem, ord);


  v_scores := coalesce(v_state -> 'scores', '{}'::jsonb);
  v_player_stats := coalesce(v_state -> 'playerStats', '{}'::jsonb);
  v_game_scores := coalesce(v_state -> 'gameScores', '{}'::jsonb);
  v_tn_scores := coalesce(v_game_scores -> 'tiernight', '{}'::jsonb);
  v_stats := coalesce(v_state -> 'stats', '{}'::jsonb);

  -- v_rec est jsonb (scalaire) : la boucle assigne value, pas un RECORD.
  -- v_rec.elem serait interprete comme table.colonne -> 42P01.
  for v_rec in select value from jsonb_array_elements(v_recaps)
  loop
    v_uid_text := v_rec ->> 'uid';
    v_points := greatest(0, coalesce((v_rec ->> 'consensusPoints')::int, 0));
    if v_points > 0 then
      v_scores := jsonb_set(
        v_scores, array[v_uid_text],
        to_jsonb(coalesce((v_scores ->> v_uid_text)::numeric, 0) + v_points), true
      );
      v_tn_scores := jsonb_set(
        v_tn_scores, array[v_uid_text],
        to_jsonb(coalesce((v_tn_scores ->> v_uid_text)::numeric, 0) + v_points), true
      );
    end if;
    v_player_stats := jsonb_set(
      v_player_stats, array[v_uid_text],
      coalesce(v_player_stats -> v_uid_text, '{}'::jsonb)
        || jsonb_build_object(
          'tierConsensusPoints',
          coalesce((v_player_stats -> v_uid_text ->> 'tierConsensusPoints')::numeric, 0) + v_points
        ),
      true
    );
  end loop;

  v_is_last := (v_round_index >= v_round_count - 1);
  v_next_phase := case when v_is_last then 'series_end' else 'between_rounds' end;

  if v_is_last then
    for v_uid_text in
      select r ->> 'userId' from jsonb_array_elements(v_roster) r
      where coalesce(r ->> 'userId', '') <> ''
    loop
      v_player_stats := jsonb_set(
        v_player_stats, array[v_uid_text],
        coalesce(v_player_stats -> v_uid_text, '{}'::jsonb)
          || jsonb_build_object(
            'tierNightsPlayed',
            coalesce((v_player_stats -> v_uid_text ->> 'tierNightsPlayed')::numeric, 0) + 1
          ),
        true
      );
    end loop;
    v_stats := jsonb_set(
      v_stats, '{tierNightsPlayed}',
      to_jsonb(coalesce((v_stats ->> 'tierNightsPlayed')::numeric, 0) + 1), true
    );
    -- Marqueur soirÃ©e : n'empÃªche PAS cette RPC (dÃ©jÃ  derriÃ¨re ledger).
    -- EmpÃªche seulement un futur recordTierNightPlayed client local.
    v_state := jsonb_set(v_state, '{eveningGamesRecorded,tiernight}', 'true'::jsonb, true);
  end if;

  v_snap := v_entry -> 'topicSnapshot';
  v_round_recap := jsonb_build_object(
    'roundId', v_round,
    'roundIndex', p_round_index,
    'topicId', v_entry ->> 'topicId',
    'topicSnapshot', v_snap,
    'recaps', v_recaps,
    'consensus', v_consensus,
    'controversialItem', to_jsonb(v_controversial),
    'controversialSpread', v_best_spread,
    'forced', coalesce(p_force, false),
    'scoredAt', v_now,
    'scoresApplied', true
  );

  v_scored := v_scored || to_jsonb(v_round);
  v_completed := v_completed || to_jsonb(v_round);
  v_history := v_history || jsonb_build_array(v_round_recap);

  v_series := v_series || jsonb_build_object(
    'phase', v_next_phase,
    'scoredRoundIds', v_scored,
    'completedRoundIds', v_completed,
    'roundHistory', v_history,
    'roundRecap', v_round_recap
  );

  v_tn := v_tn || jsonb_build_object(
    'series', v_series,
    'lobbyStarted', case when v_is_last then false else true end
  );

  if v_is_last then
    -- Bridge legacy derniÃ¨re manche UNIQUEMENT â€” canon sÃ©rie = series.roundHistory
    v_tn := v_tn || jsonb_build_object(
      'recap', jsonb_build_object(
        'runId', v_run,
        'topicId', v_entry ->> 'topicId',
        'listName', coalesce(v_snap ->> 'name', ''),
        'topicEmoji', coalesce(v_snap ->> 'emoji', ''),
        'seriesCanon', 'roundHistory',
        'recaps', (
          select coalesce(jsonb_agg(
            jsonb_build_object(
              'player', r ->> 'player',
              'placed', r -> 'placed',
              'consensusPoints', coalesce((r ->> 'consensusPoints')::int, 0),
              'outsiderBonus', coalesce((r ->> 'outsiderBonus')::int, 0)
            )
          ), '[]'::jsonb)
          from jsonb_array_elements(v_recaps) r
        ),
        'consensus', v_consensus,
        'controversialItem', to_jsonb(v_controversial),
        'controversialSpread', v_best_spread,
        'scoresApplied', true
      )
    );
  end if;

  v_game_scores := jsonb_set(v_game_scores, '{tiernight}', v_tn_scores, true);
  v_state := v_state || jsonb_build_object(
    'tierNight', v_tn,
    'scores', v_scores,
    'playerStats', v_player_stats,
    'gameScores', v_game_scores,
    'stats', v_stats
  );

  if not exists (
    select 1 from jsonb_array_elements_text(coalesce(v_state -> 'gameScoreOrder', '[]'::jsonb)) x(val)
    where x.val = 'tiernight'
  ) then
    v_state := jsonb_set(
      v_state, '{gameScoreOrder}',
      coalesce(v_state -> 'gameScoreOrder', '[]'::jsonb) || '"tiernight"'::jsonb,
      true
    );
  end if;

  update public.game_sessions gs
  set
    state = v_state,
    screen = case when v_is_last then 'tiernight-end' else gs.screen end,
    updated_at = v_now
  where gs.lobby_id = p_lobby_id
  returning * into v_row;

  return jsonb_build_object(
    'ok', true,
    'applied', true,
    'code', null,
    'phase', v_next_phase,
    'roundId', v_round,
    'roundIndex', p_round_index,
    'isLastRound', v_is_last,
    'forced', coalesce(p_force, false),
    'lobbyId', p_lobby_id,
    'screen', v_row.screen,
    'roundRecap', v_round_recap,
    'state', v_row.state
  );
end;
$$;
-- Permissions (reaffirme, n'affecte pas le shape)
do $perm$
begin
  execute 'revoke all on function public.finalize_tiernight_series_round(uuid, text, text, integer, text, boolean) from public';
  execute 'revoke all on function public.finalize_tiernight_series_round(uuid, text, text, integer, text, boolean) from anon';
  execute 'grant execute on function public.finalize_tiernight_series_round(uuid, text, text, integer, text, boolean) to authenticated';
end $perm$;
