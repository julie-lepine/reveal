-- FEATURE-TIERNIGHT-SERIES-03 — finalize_tiernight_series_round
-- Transition transactionnelle ranking → between_rounds | series_end + scoring exactly-once.
--
-- Dépendances : game-sessions.sql, game-sessions-i08-arch03.sql (assert_lobby_member,
--   is_lobby_host, is_acting_host), SERIES-01/02 (shape tierNight.series côté client).
-- Idempotent : CREATE OR REPLACE.
--
-- Architecture : Option A — calcul serveur depuis placements + roster snapshotés.
-- Scores / playerStats / gameScores écrits en clés UID (comme eveningStateToRemote).

-- ---------------------------------------------------------------------------
-- Helpers purs (scoring)
-- ---------------------------------------------------------------------------

create or replace function public.tiernight_series_tier_rank(p_tier text)
returns int
language sql
immutable
as $$
  select case upper(coalesce(p_tier, 'D'))
    when 'S' then 0
    when 'A' then 1
    when 'B' then 2
    when 'C' then 3
    else 4
  end;
$$;

create or replace function public.tiernight_series_rank_to_tier(p_rank int)
returns text
language sql
immutable
as $$
  select case greatest(0, least(4, coalesce(p_rank, 2)))
    when 0 then 'S'
    when 1 then 'A'
    when 2 then 'B'
    when 3 then 'C'
    else 'D'
  end;
$$;

create or replace function public.tiernight_series_points_for_diff(
  p_diff int,
  p_reverse boolean default false
)
returns int
language sql
immutable
as $$
  select case
    when coalesce(p_reverse, false) then
      case
        when coalesce(p_diff, 0) >= 3 then 15
        when p_diff = 2 then 10
        else 0
      end
    else
      case
        when coalesce(p_diff, 0) <= 0 then 15
        when p_diff = 1 then 10
        else 0
      end
  end;
$$;

create or replace function public.tiernight_series_median_rank(p_ranks int[])
returns int
language plpgsql
immutable
as $$
declare
  v_sorted int[];
  v_n int;
begin
  if p_ranks is null or coalesce(array_length(p_ranks, 1), 0) = 0 then
    return 2;
  end if;
  select array_agg(r order by r)
    into v_sorted
  from unnest(p_ranks) as r;
  v_n := array_length(v_sorted, 1);
  if v_n % 2 = 1 then
    return v_sorted[(v_n / 2) + 1];
  end if;
  return floor((v_sorted[v_n / 2] + v_sorted[(v_n / 2) + 1])::numeric / 2)::int;
end;
$$;

create or replace function public.tiernight_series_tier_of_item(
  p_placed jsonb,
  p_item text
)
returns text
language plpgsql
immutable
as $$
declare
  v_tier text;
  v_arr jsonb;
begin
  if p_placed is null or jsonb_typeof(p_placed) <> 'object' then
    return 'D';
  end if;
  foreach v_tier in array array['S', 'A', 'B', 'C', 'D']
  loop
    v_arr := p_placed -> v_tier;
    if jsonb_typeof(v_arr) = 'array'
       and exists (
         select 1
         from jsonb_array_elements_text(v_arr) t(val)
         where t.val = p_item
       )
    then
      return v_tier;
    end if;
  end loop;
  return 'D';
end;
$$;

create or replace function public.tiernight_series_placement_item_count(p_placed jsonb)
returns int
language sql
immutable
as $$
  select coalesce((
    select sum(jsonb_array_length(value))::int
    from jsonb_each(coalesce(p_placed, '{}'::jsonb))
    where jsonb_typeof(value) = 'array'
  ), 0);
$$;

-- ---------------------------------------------------------------------------
-- RPC principale
-- ---------------------------------------------------------------------------

create or replace function public.finalize_tiernight_series_round(
  p_lobby_id uuid,
  p_run_id text,
  p_round_id text,
  p_round_index int,
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
  v_display text;
  v_local_tier text;
  v_spread int;
  v_best_spread int := -1;
  v_controversial text := null;
  v_cons_rank int;
  v_diff int;
  v_max_diff int;
  v_outsider int;
  v_points int;
  v_scores jsonb;
  v_player_stats jsonb;
  v_game_scores jsonb;
  v_tn_scores jsonb;
  v_stats jsonb;
  v_round_recap jsonb;
  v_now timestamptz := clock_timestamp();
  v_finished_count int := 0;
  v_roster_n int;
  v_has_placement boolean;
  v_expected_phase text := lower(trim(coalesce(p_expected_phase, 'ranking')));
begin
  if v_uid is null then
    raise exception 'TNS_AUTH_REQUIRED';
  end if;

  perform public.assert_lobby_member(p_lobby_id);

  if not (public.is_lobby_host(p_lobby_id) or public.is_acting_host(p_lobby_id)) then
    raise exception 'TNS_UNAUTHORIZED';
  end if;

  if p_run_id is null or length(trim(p_run_id)) = 0 then
    raise exception 'TNS_INVALID_RUN_ID';
  end if;
  if p_round_id is null or length(trim(p_round_id)) = 0 then
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

  if coalesce(v_tn ->> 'runId', '') is distinct from trim(p_run_id) then
    raise exception 'TNS_STALE_RUN';
  end if;

  -- Mono-thème legacy : pas de série
  if not (v_tn ? 'series') or v_tn -> 'series' is null
     or jsonb_typeof(v_tn -> 'series') <> 'object' then
    raise exception 'TNS_NO_SERIES';
  end if;

  v_series := v_tn -> 'series';
  if coalesce((v_series ->> 'version')::int, 0) <> 1 then
    raise exception 'TNS_UNSUPPORTED_VERSION';
  end if;

  v_phase := coalesce(v_series ->> 'phase', '');
  v_round_index := coalesce((v_series ->> 'roundIndex')::int, -1);
  v_round_count := coalesce((v_series ->> 'roundCount')::int, 0);
  v_queue := v_series -> 'queue';
  v_scored := coalesce(v_series -> 'scoredRoundIds', '[]'::jsonb);
  v_completed := coalesce(v_series -> 'completedRoundIds', '[]'::jsonb);
  v_history := coalesce(v_series -> 'roundHistory', '[]'::jsonb);

  if jsonb_typeof(v_queue) <> 'array' then
    raise exception 'TNS_INVALID_SERIES';
  end if;

  -- Idempotence : déjà scorée
  if exists (
    select 1
    from jsonb_array_elements_text(v_scored) s(val)
    where s.val = trim(p_round_id)
  ) then
    return jsonb_build_object(
      'ok', true,
      'applied', false,
      'code', 'ALREADY_APPLIED',
      'phase', v_phase,
      'roundId', trim(p_round_id),
      'roundIndex', v_round_index,
      'lobbyId', p_lobby_id,
      'screen', v_row.screen,
      'state', v_state
    );
  end if;

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

  if p_round_index >= jsonb_array_length(v_queue) then
    raise exception 'TNS_ROUND_OUT_OF_BOUNDS';
  end if;

  v_entry := v_queue -> p_round_index;
  if v_entry is null or jsonb_typeof(v_entry) <> 'object' then
    raise exception 'TNS_MISSING_ROUND';
  end if;

  if coalesce(v_entry ->> 'roundId', '') is distinct from trim(p_round_id) then
    raise exception 'TNS_STALE_ROUND_ID';
  end if;

  if coalesce((v_entry ->> 'roundIndex')::int, -1) is distinct from p_round_index then
    raise exception 'TNS_ROUND_INDEX_MISMATCH';
  end if;

  -- topicId actif aligné
  if coalesce(v_tn ->> 'topicId', '') is distinct from coalesce(v_entry ->> 'topicId', '') then
    raise exception 'TNS_TOPIC_MISMATCH';
  end if;

  v_roster := v_tn -> 'playerRoster';
  v_items := v_tn -> 'items';
  v_placements := coalesce(v_tn -> 'placements', '{}'::jsonb);
  v_finished := coalesce(v_tn -> 'finished', '{}'::jsonb);
  v_modifier := coalesce(v_tn ->> 'modifier', 'normal');
  v_reverse := (v_modifier = 'reverse');

  if jsonb_typeof(v_roster) <> 'array' or jsonb_array_length(v_roster) = 0 then
    raise exception 'TNS_MISSING_ROSTER';
  end if;
  if jsonb_typeof(v_items) <> 'array' or jsonb_array_length(v_items) = 0 then
    raise exception 'TNS_MISSING_ITEMS';
  end if;

  v_roster_n := jsonb_array_length(v_roster);

  select count(*)::int into v_finished_count
  from jsonb_each(v_finished) f
  where f.value = 'true'::jsonb or f.value = to_jsonb(true);

  if coalesce(p_force, false) then
    if v_finished_count < 1 then
      raise exception 'TNS_FORCE_NO_FINISHED';
    end if;
  else
    -- Tous les membres du roster doivent avoir finished=true
    if exists (
      select 1
      from jsonb_array_elements(v_roster) r
      where coalesce(r ->> 'userId', '') <> ''
        and not (
          (v_finished -> (r ->> 'userId')) = 'true'::jsonb
          or (v_finished -> (r ->> 'userId')) = to_jsonb(true)
        )
    ) then
      raise exception 'TNS_PLACEMENTS_INCOMPLETE';
    end if;
  end if;

  -- Participants scorables : roster UIDs avec placements non vides
  for v_uid_text in
    select r ->> 'userId'
    from jsonb_array_elements(v_roster) r
    where coalesce(r ->> 'userId', '') <> ''
  loop
    v_placed := v_placements -> v_uid_text;
    v_has_placement := public.tiernight_series_placement_item_count(v_placed) > 0;
    if coalesce(p_force, false) then
      if v_has_placement then
        v_participating := array_append(v_participating, v_uid_text);
      end if;
    else
      if not v_has_placement then
        raise exception 'TNS_PLACEMENTS_INCOMPLETE';
      end if;
      v_participating := array_append(v_participating, v_uid_text);
    end if;
  end loop;

  if coalesce(array_length(v_participating, 1), 0) = 0 then
    raise exception 'TNS_NO_PARTICIPANTS';
  end if;

  -- Consensus médian par item
  for v_item in
    select jsonb_array_elements_text(v_items)
  loop
    v_ranks := array[]::int[];
    foreach v_uid_text in array v_participating
    loop
      v_ranks := array_append(
        v_ranks,
        public.tiernight_series_tier_rank(
          public.tiernight_series_tier_of_item(v_placements -> v_uid_text, v_item)
        )
      );
    end loop;
    v_median := public.tiernight_series_median_rank(v_ranks);
    v_cons_tier := public.tiernight_series_rank_to_tier(v_median);
    v_consensus := jsonb_set(
      v_consensus,
      array[v_cons_tier],
      coalesce(v_consensus -> v_cons_tier, '[]'::jsonb) || to_jsonb(v_item),
      true
    );
  end loop;

  -- Item le plus clivant
  for v_item in
    select jsonb_array_elements_text(v_items)
  loop
    v_ranks := array[]::int[];
    foreach v_uid_text in array v_participating
    loop
      v_ranks := array_append(
        v_ranks,
        public.tiernight_series_tier_rank(
          public.tiernight_series_tier_of_item(v_placements -> v_uid_text, v_item)
        )
      );
    end loop;
    if coalesce(array_length(v_ranks, 1), 0) > 0 then
      v_spread := (select max(x) - min(x) from unnest(v_ranks) as x);
      if v_spread > v_best_spread then
        v_best_spread := v_spread;
        v_controversial := v_item;
      end if;
    end if;
  end loop;

  -- Recaps + points
  foreach v_uid_text in array v_participating
  loop
    v_placed := v_placements -> v_uid_text;
    select coalesce(r ->> 'displayName', v_uid_text)
      into v_display
    from jsonb_array_elements(v_roster) r
    where r ->> 'userId' = v_uid_text
    limit 1;

    v_pts_sum := 0;
    v_item_n := 0;
    for v_item in
      select jsonb_array_elements_text(v_items)
    loop
      v_local_tier := public.tiernight_series_tier_of_item(v_placed, v_item);
      v_cons_tier := public.tiernight_series_tier_of_item(v_consensus, v_item);
      v_pts_sum := v_pts_sum + public.tiernight_series_points_for_diff(
        abs(
          public.tiernight_series_tier_rank(v_local_tier)
          - public.tiernight_series_tier_rank(v_cons_tier)
        ),
        v_reverse
      );
      v_item_n := v_item_n + 1;
    end loop;

    v_proximity := case when v_item_n > 0 then round(v_pts_sum / v_item_n)::int else 0 end;

    v_recaps := v_recaps || jsonb_build_array(
      jsonb_build_object(
        'uid', v_uid_text,
        'player', coalesce((
          select r ->> 'displayName'
          from jsonb_array_elements(v_roster) r
          where r ->> 'userId' = v_uid_text
          limit 1
        ), v_uid_text),
        'placed', v_placed,
        'proximityPoints', v_proximity,
        'outsiderBonus', 0,
        'consensusPoints', v_proximity
      )
    );
  end loop;

  -- Outsider bonus (2e passe)
  if v_controversial is not null and v_best_spread >= 1 then
    v_cons_rank := public.tiernight_series_tier_rank(
      public.tiernight_series_tier_of_item(v_consensus, v_controversial)
    );
    v_max_diff := 0;
    foreach v_uid_text in array v_participating
    loop
      v_diff := abs(
        public.tiernight_series_tier_rank(
          public.tiernight_series_tier_of_item(v_placements -> v_uid_text, v_controversial)
        ) - v_cons_rank
      );
      if v_diff > v_max_diff then
        v_max_diff := v_diff;
      end if;
    end loop;

    if v_max_diff >= 1 then
      v_recaps := (
        select coalesce(jsonb_agg(
          case
            when abs(
              public.tiernight_series_tier_rank(
                public.tiernight_series_tier_of_item(r.elem -> 'placed', v_controversial)
              ) - v_cons_rank
            ) = v_max_diff then
              jsonb_set(
                jsonb_set(
                  r.elem,
                  '{outsiderBonus}',
                  to_jsonb(15),
                  true
                ),
                '{consensusPoints}',
                to_jsonb(coalesce((r.elem ->> 'proximityPoints')::int, 0) + 15),
                true
              )
            else r.elem
          end
          order by r.ord
        ), '[]'::jsonb)
        from jsonb_array_elements(v_recaps) with ordinality as r(elem, ord)
      );
    end if;
  end if;

  -- Appliquer scores (UID)
  v_scores := coalesce(v_state -> 'scores', '{}'::jsonb);
  v_player_stats := coalesce(v_state -> 'playerStats', '{}'::jsonb);
  v_game_scores := coalesce(v_state -> 'gameScores', '{}'::jsonb);
  v_tn_scores := coalesce(v_game_scores -> 'tiernight', '{}'::jsonb);
  v_stats := coalesce(v_state -> 'stats', '{}'::jsonb);

  for v_rec in
    select value as elem
    from jsonb_array_elements(v_recaps)
  loop
    v_uid_text := v_rec.elem ->> 'uid';
    v_points := greatest(0, coalesce((v_rec.elem ->> 'consensusPoints')::int, 0));
    if v_points > 0 then
      v_scores := jsonb_set(
        v_scores,
        array[v_uid_text],
        to_jsonb(coalesce((v_scores ->> v_uid_text)::numeric, 0) + v_points),
        true
      );
      v_tn_scores := jsonb_set(
        v_tn_scores,
        array[v_uid_text],
        to_jsonb(coalesce((v_tn_scores ->> v_uid_text)::numeric, 0) + v_points),
        true
      );
    end if;

    v_player_stats := jsonb_set(
      v_player_stats,
      array[v_uid_text],
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
    -- tierNightsPlayed +1 / joueur du roster + stats soirée une fois
    for v_uid_text in
      select r ->> 'userId'
      from jsonb_array_elements(v_roster) r
      where coalesce(r ->> 'userId', '') <> ''
    loop
      v_player_stats := jsonb_set(
        v_player_stats,
        array[v_uid_text],
        coalesce(v_player_stats -> v_uid_text, '{}'::jsonb)
          || jsonb_build_object(
            'tierNightsPlayed',
            coalesce((v_player_stats -> v_uid_text ->> 'tierNightsPlayed')::numeric, 0) + 1
          ),
        true
      );
    end loop;
    v_stats := jsonb_set(
      v_stats,
      '{tierNightsPlayed}',
      to_jsonb(coalesce((v_stats ->> 'tierNightsPlayed')::numeric, 0) + 1),
      true
    );
    v_state := jsonb_set(
      v_state,
      '{eveningGamesRecorded,tiernight}',
      'true'::jsonb,
      true
    );
  end if;

  v_snap := v_entry -> 'topicSnapshot';
  v_round_recap := jsonb_build_object(
    'roundId', trim(p_round_id),
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

  v_scored := v_scored || to_jsonb(trim(p_round_id));
  v_completed := v_completed || to_jsonb(trim(p_round_id));
  v_history := v_history || jsonb_build_array(v_round_recap);

  v_series := v_series
    || jsonb_build_object(
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
    v_tn := v_tn || jsonb_build_object(
      'recap', jsonb_build_object(
        'runId', trim(p_run_id),
        'topicId', v_entry ->> 'topicId',
        'listName', coalesce(v_snap ->> 'name', ''),
        'topicEmoji', coalesce(v_snap ->> 'emoji', ''),
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

  v_state := v_state
    || jsonb_build_object(
      'tierNight', v_tn,
      'scores', v_scores,
      'playerStats', v_player_stats,
      'gameScores', v_game_scores,
      'stats', v_stats
    );

  -- gameScoreOrder
  if not exists (
    select 1
    from jsonb_array_elements_text(coalesce(v_state -> 'gameScoreOrder', '[]'::jsonb)) x(val)
    where x.val = 'tiernight'
  ) then
    v_state := jsonb_set(
      v_state,
      '{gameScoreOrder}',
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
    'roundId', trim(p_round_id),
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

revoke all on function public.finalize_tiernight_series_round(uuid, text, text, int, text, boolean) from public;
grant execute on function public.finalize_tiernight_series_round(uuid, text, text, int, text, boolean) to authenticated;

revoke all on function public.tiernight_series_tier_rank(text) from public;
revoke all on function public.tiernight_series_rank_to_tier(int) from public;
revoke all on function public.tiernight_series_points_for_diff(int, boolean) from public;
revoke all on function public.tiernight_series_median_rank(int[]) from public;
revoke all on function public.tiernight_series_tier_of_item(jsonb, text) from public;
revoke all on function public.tiernight_series_placement_item_count(jsonb) from public;

comment on function public.finalize_tiernight_series_round(uuid, text, text, int, text, boolean) is
  'FEATURE-TIERNIGHT-SERIES-03 — finalise une manche de série TierNight (scoring atomique + phase). Idempotent via scoredRoundIds. Hôte ou acting host.';
