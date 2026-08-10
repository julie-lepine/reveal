-- =============================================================================
-- TierNight Rank Live — round counts 3 / 5 / 8 (ex 3 / 5 / 7)
-- =============================================================================
-- Prérequis : feature-tiernight-04e-start-live-series.sql déjà appliqué.
-- Idempotent : CREATE OR REPLACE des 3 fonctions qui valident roundCount.
--
-- Contrat :
--   • Nouveaux lancements : roundCount ∈ {3, 5, 8}
--   • 7 n'est plus accepté au start (séries déjà en cours restent côté client
--     via isReadableTierNightLiveRoundCount / queue.length — pas de re-gate SQL)
--
-- Greenfield : le fichier 04E source est déjà aligné 3/5/8 ; ce fichier sert
-- aux environnements où 04E a été déployé avec (3, 5, 7).
-- =============================================================================

create or replace function public.tiernight_live_validate_series_shape(p_series jsonb)
returns jsonb
language plpgsql
immutable
as $$
declare
  v_run text;
  v_n int;
  v_idx int;
  v_i int;
  v_entry jsonb;
  v_snap jsonb;
  v_round_id text;
  v_list_id text;
  v_seen_list text[] := array[]::text[];
  v_seen_round text[] := array[]::text[];
  v_items jsonb;
  v_item text;
  v_j int;
  v_bytes int;
  v_is_custom boolean;
  v_has_prefix boolean;
begin
  if p_series is null or jsonb_typeof(p_series) <> 'object' then
    return jsonb_build_object('ok', false, 'code', 'TNS_LIVE_CORRUPT_STATE');
  end if;

  v_bytes := octet_length(p_series::text);
  if v_bytes > 65536 then
    return jsonb_build_object('ok', false, 'code', 'TNS_LIVE_CORRUPT_STATE', 'message', 'too_large');
  end if;

  if public.tiernight_live_jsonb_int(p_series, 'version') is distinct from 1 then
    return jsonb_build_object('ok', false, 'code', 'TNS_LIVE_CORRUPT_STATE', 'message', 'version');
  end if;
  if coalesce(p_series ->> 'kind', '') <> 'live' then
    return jsonb_build_object('ok', false, 'code', 'TNS_LIVE_CORRUPT_STATE', 'message', 'kind');
  end if;
  if jsonb_typeof(p_series -> 'categoryIds') <> 'array'
     or jsonb_array_length(p_series -> 'categoryIds') <> 1
     or coalesce(p_series -> 'categoryIds' ->> 0, '') <> '*' then
    return jsonb_build_object('ok', false, 'code', 'TNS_LIVE_CORRUPT_STATE', 'message', 'categoryIds');
  end if;

  v_run := trim(coalesce(p_series ->> 'runId', ''));
  if v_run = '' or char_length(v_run) > 80 then
    return jsonb_build_object('ok', false, 'code', 'TNS_LIVE_CORRUPT_STATE', 'message', 'runId');
  end if;

  v_n := public.tiernight_live_jsonb_int(p_series, 'roundCount');
  if v_n is null or v_n not in (3, 5, 8) then
    return jsonb_build_object('ok', false, 'code', 'TNS_LIVE_INVALID_ROUND_COUNT');
  end if;

  v_idx := public.tiernight_live_jsonb_int(p_series, 'roundIndex');
  if v_idx is distinct from 0 then
    return jsonb_build_object('ok', false, 'code', 'TNS_LIVE_CORRUPT_STATE', 'message', 'roundIndex');
  end if;

  if coalesce(p_series ->> 'phase', '') <> 'playing_list' then
    return jsonb_build_object('ok', false, 'code', 'TNS_LIVE_CORRUPT_STATE', 'message', 'phase');
  end if;
  if jsonb_typeof(p_series -> 'queue') <> 'array'
     or jsonb_array_length(p_series -> 'queue') <> v_n then
    return jsonb_build_object('ok', false, 'code', 'TNS_LIVE_CORRUPT_STATE', 'message', 'queue');
  end if;
  if jsonb_typeof(p_series -> 'completedRoundIds') <> 'array'
     or jsonb_array_length(p_series -> 'completedRoundIds') <> 0
     or jsonb_typeof(p_series -> 'scoredRoundIds') <> 'array'
     or jsonb_array_length(p_series -> 'scoredRoundIds') <> 0 then
    return jsonb_build_object('ok', false, 'code', 'TNS_LIVE_CORRUPT_STATE', 'message', 'ledgers');
  end if;

  for v_i in 0 .. v_n - 1 loop
    v_entry := p_series -> 'queue' -> v_i;
    if v_entry is null or jsonb_typeof(v_entry) <> 'object' then
      return jsonb_build_object('ok', false, 'code', 'TNS_LIVE_CORRUPT_STATE', 'message', 'entry');
    end if;
    if public.tiernight_live_jsonb_int(v_entry, 'roundIndex') is distinct from v_i then
      return jsonb_build_object('ok', false, 'code', 'TNS_LIVE_CORRUPT_STATE', 'message', 'qi');
    end if;
    v_round_id := coalesce(v_entry ->> 'roundId', '');
    if v_round_id <> (v_run || ':' || v_i::text) then
      return jsonb_build_object('ok', false, 'code', 'TNS_LIVE_CORRUPT_STATE', 'message', 'roundId');
    end if;
    if v_round_id = any (v_seen_round) then
      return jsonb_build_object('ok', false, 'code', 'TNS_LIVE_CORRUPT_STATE', 'message', 'roundId_dup');
    end if;
    v_seen_round := array_append(v_seen_round, v_round_id);

    v_list_id := trim(coalesce(v_entry ->> 'listId', ''));
    if v_list_id = '' then
      return jsonb_build_object('ok', false, 'code', 'TNS_LIVE_CORRUPT_STATE', 'message', 'listId');
    end if;
    if v_list_id = any (v_seen_list) then
      return jsonb_build_object('ok', false, 'code', 'TNS_LIVE_CORRUPT_STATE', 'message', 'listId_dup');
    end if;
    v_seen_list := array_append(v_seen_list, v_list_id);

    v_snap := v_entry -> 'listSnapshot';
    if v_snap is null or jsonb_typeof(v_snap) <> 'object' then
      return jsonb_build_object('ok', false, 'code', 'TNS_LIVE_CORRUPT_STATE', 'message', 'snap');
    end if;
    if coalesce(v_snap ->> 'id', '') is distinct from v_list_id then
      return jsonb_build_object('ok', false, 'code', 'TNS_LIVE_CORRUPT_STATE', 'message', 'snap_id');
    end if;
    if char_length(trim(coalesce(v_snap ->> 'name', ''))) < 1
       or char_length(trim(coalesce(v_snap ->> 'name', ''))) > 40 then
      return jsonb_build_object('ok', false, 'code', 'TNS_LIVE_CORRUPT_STATE', 'message', 'name');
    end if;
    if jsonb_typeof(v_snap -> 'custom') <> 'boolean' then
      return jsonb_build_object('ok', false, 'code', 'TNS_LIVE_CORRUPT_STATE', 'message', 'custom');
    end if;

    v_is_custom := (v_snap -> 'custom') = 'true'::jsonb;
    v_has_prefix := left(v_list_id, 12) = 'custom-live-';
    if v_has_prefix <> v_is_custom then
      return jsonb_build_object('ok', false, 'code', 'TNS_LIVE_CORRUPT_CUSTOM', 'message', 'custom_flag_prefix');
    end if;

    v_items := v_snap -> 'items';
    if v_items is null or jsonb_typeof(v_items) <> 'array'
       or jsonb_array_length(v_items) < 1
       or jsonb_array_length(v_items) > 16 then
      return jsonb_build_object('ok', false, 'code', 'TNS_LIVE_CORRUPT_STATE', 'message', 'items');
    end if;
    for v_j in 0 .. jsonb_array_length(v_items) - 1 loop
      v_item := trim(coalesce(v_items ->> v_j, ''));
      if v_item = '' or char_length(v_item) > 40 then
        return jsonb_build_object('ok', false, 'code', 'TNS_LIVE_CORRUPT_STATE', 'message', 'item');
      end if;
    end loop;

    if v_is_custom then
      if coalesce(trim(v_snap ->> 'authorUid'), '') = '' then
        return jsonb_build_object('ok', false, 'code', 'TNS_LIVE_CORRUPT_CUSTOM', 'message', 'authorUid');
      end if;
      if jsonb_array_length(v_items) < 4 then
        return jsonb_build_object('ok', false, 'code', 'TNS_LIVE_CORRUPT_CUSTOM', 'message', 'items_min');
      end if;
    end if;
  end loop;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.tiernight_live_validate_series_shape(jsonb) from public;
revoke all on function public.tiernight_live_validate_series_shape(jsonb) from anon;
revoke all on function public.tiernight_live_validate_series_shape(jsonb) from authenticated;

create or replace function public.tiernight_live_validate_custom_queue_policy(
  p_series jsonb,
  p_customs jsonb,
  p_round int
)
returns jsonb
language plpgsql
immutable
as $$
declare
  v_c int := 0;
  v_q int := 0;
  v_i int;
  v_j int;
  v_entry jsonb;
  v_snap jsonb;
  v_id text;
  v_canon_ids text[] := array[]::text[];
  v_queue_custom_ids text[] := array[]::text[];
  v_found boolean;
begin
  if p_round is null or p_round not in (3, 5, 8) then
    return jsonb_build_object('ok', false, 'code', 'TNS_LIVE_INVALID_ROUND_COUNT');
  end if;
  if p_series is null or jsonb_typeof(p_series -> 'queue') <> 'array' then
    return jsonb_build_object('ok', false, 'code', 'TNS_LIVE_CORRUPT_STATE');
  end if;
  if p_customs is null or jsonb_typeof(p_customs) <> 'array' then
    return jsonb_build_object('ok', false, 'code', 'TNS_LIVE_CORRUPT_CUSTOM', 'message', 'canon_not_array');
  end if;

  for v_i in 0 .. greatest(jsonb_array_length(p_customs) - 1, -1) loop
    v_entry := p_customs -> v_i;
    if v_entry is null or jsonb_typeof(v_entry) <> 'object' then
      return jsonb_build_object('ok', false, 'code', 'TNS_LIVE_CORRUPT_CUSTOM', 'message', 'canon_entry');
    end if;
    v_id := trim(coalesce(v_entry ->> 'id', ''));
    if v_id = '' or left(v_id, 12) <> 'custom-live-' then
      return jsonb_build_object('ok', false, 'code', 'TNS_LIVE_CORRUPT_CUSTOM', 'message', 'canon_id');
    end if;
    if (v_entry -> 'custom') is distinct from 'true'::jsonb then
      return jsonb_build_object('ok', false, 'code', 'TNS_LIVE_CORRUPT_CUSTOM', 'message', 'canon_flag');
    end if;
    if v_id = any (v_canon_ids) then
      return jsonb_build_object('ok', false, 'code', 'TNS_LIVE_CORRUPT_CUSTOM', 'message', 'canon_dup');
    end if;
    v_canon_ids := array_append(v_canon_ids, v_id);
    v_c := v_c + 1;
  end loop;

  for v_i in 0 .. jsonb_array_length(p_series -> 'queue') - 1 loop
    v_snap := p_series -> 'queue' -> v_i -> 'listSnapshot';
    if (v_snap -> 'custom') = 'true'::jsonb then
      v_id := trim(coalesce(v_snap ->> 'id', ''));
      v_queue_custom_ids := array_append(v_queue_custom_ids, v_id);
      v_q := v_q + 1;
    end if;
  end loop;

  if v_c = 0 then
    if v_q <> 0 then
      return jsonb_build_object('ok', false, 'code', 'TNS_LIVE_CUSTOM_POOL_STALE', 'message', 'c0_has_custom');
    end if;
    return jsonb_build_object('ok', true, 'C', 0, 'Q', 0);
  end if;

  if v_c < p_round then
    if v_q <> v_c then
      return jsonb_build_object('ok', false, 'code', 'TNS_LIVE_CUSTOM_POOL_STALE', 'message', 'c_lt_n_count');
    end if;
    for v_i in 1 .. v_c loop
      v_id := v_canon_ids[v_i];
      v_found := false;
      for v_j in 1 .. v_q loop
        if v_queue_custom_ids[v_j] = v_id then
          v_found := true;
          exit;
        end if;
      end loop;
      if not v_found then
        return jsonb_build_object('ok', false, 'code', 'TNS_LIVE_CUSTOM_POOL_STALE', 'message', 'c_lt_n_missing');
      end if;
    end loop;
    return jsonb_build_object('ok', true, 'C', v_c, 'Q', v_q);
  end if;

  if v_q <> p_round then
    return jsonb_build_object('ok', false, 'code', 'TNS_LIVE_CUSTOM_POOL_STALE', 'message', 'c_ge_n_count');
  end if;
  return jsonb_build_object('ok', true, 'C', v_c, 'Q', v_q);
end;
$$;

revoke all on function public.tiernight_live_validate_custom_queue_policy(jsonb, jsonb, int) from public;
revoke all on function public.tiernight_live_validate_custom_queue_policy(jsonb, jsonb, int) from anon;
revoke all on function public.tiernight_live_validate_custom_queue_policy(jsonb, jsonb, int) from authenticated;

create or replace function public.start_tiernight_live_series(
  p_lobby_id uuid,
  p_expected_setup_epoch integer,
  p_series jsonb
)
returns public.game_sessions
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid;
  v_row public.game_sessions;
  v_state jsonb;
  v_prep jsonb;
  v_epoch int;
  v_round int;
  v_customs jsonb;
  v_series jsonb := p_series;
  v_check jsonb;
  v_existing jsonb;
  v_existing_run text;
  v_prop_run text;
  v_i int;
  v_n int;
  v_entry jsonb;
  v_snap jsonb;
  v_id text;
  v_canon jsonb;
  v_found boolean;
  v_j int;
  v_deck jsonb;
  v_live jsonb;
  v_roster jsonb := '[]'::jsonb;
  v_member record;
begin
  v_uid := public.assert_lobby_member(p_lobby_id);

  if not (public.is_lobby_host(p_lobby_id) or public.is_acting_host(p_lobby_id)) then
    raise exception 'TNS_LIVE_HOST_REQUIRED';
  end if;

  select * into v_row
  from public.game_sessions
  where lobby_id = p_lobby_id
  for update;

  if not found then
    raise exception 'Session de jeu introuvable.';
  end if;

  v_state := coalesce(v_row.state, '{}'::jsonb);
  v_existing := v_state -> 'tierNightLive';
  v_prop_run := trim(coalesce(v_series ->> 'runId', ''));

  if v_existing is not null and jsonb_typeof(v_existing) = 'object' then
    if (v_existing ? 'lobbyStarted')
       and jsonb_typeof(v_existing -> 'lobbyStarted') is distinct from 'boolean' then
      raise exception 'TNS_LIVE_CORRUPT_STATE';
    end if;
    if (v_existing ? 'finished')
       and jsonb_typeof(v_existing -> 'finished') is distinct from 'boolean' then
      raise exception 'TNS_LIVE_CORRUPT_STATE';
    end if;
    if coalesce((v_existing -> 'lobbyStarted') = 'true'::jsonb, false)
       and coalesce((v_existing -> 'finished') = 'true'::jsonb, false) is not true
       and jsonb_typeof(v_existing -> 'series') = 'object'
       and coalesce(v_existing -> 'series' ->> 'kind', '') = 'live' then
      v_existing_run := trim(coalesce(v_existing -> 'series' ->> 'runId', coalesce(v_existing ->> 'runId', '')));
      if v_prop_run <> '' and v_existing_run = v_prop_run then
        return v_row;
      end if;
      raise exception 'TNS_LIVE_ALREADY_STARTED';
    end if;
  end if;

  v_prep := v_state -> 'tierNightLivePrep';
  if v_prep is null or jsonb_typeof(v_prep) <> 'object' then
    raise exception 'TNS_LIVE_CORRUPT_STATE';
  end if;

  v_epoch := public.tiernight_live_jsonb_int(v_prep, 'setupEpoch');
  if v_epoch is null then
    v_epoch := 0;
  end if;
  if p_expected_setup_epoch is null or p_expected_setup_epoch <> v_epoch then
    raise exception 'TNS_LIVE_PREP_STALE';
  end if;

  v_round := public.tiernight_live_jsonb_int(v_prep, 'roundCount');
  if v_round is null or v_round not in (3, 5, 8) then
    raise exception 'TNS_LIVE_INVALID_ROUND_COUNT';
  end if;
  if public.tiernight_live_jsonb_int(v_series, 'roundCount') is distinct from v_round then
    raise exception 'TNS_LIVE_PREP_STALE';
  end if;

  v_check := public.tiernight_live_validate_series_shape(v_series);
  if coalesce((v_check ->> 'ok')::boolean, false) is not true then
    raise exception '%', coalesce(v_check ->> 'code', 'TNS_LIVE_CORRUPT_STATE');
  end if;

  v_customs := coalesce(v_state -> 'customLiveTierLists', '[]'::jsonb);
  if jsonb_typeof(v_customs) <> 'array' then
    v_customs := '[]'::jsonb;
  end if;

  v_check := public.tiernight_live_validate_custom_queue_policy(v_series, v_customs, v_round);
  if coalesce((v_check ->> 'ok')::boolean, false) is not true then
    raise exception '%', coalesce(v_check ->> 'code', 'TNS_LIVE_CUSTOM_POOL_STALE');
  end if;

  v_n := jsonb_array_length(v_series -> 'queue');
  for v_i in 0 .. v_n - 1 loop
    v_entry := v_series -> 'queue' -> v_i;
    v_snap := v_entry -> 'listSnapshot';
    if (v_snap -> 'custom') = 'true'::jsonb then
      v_id := coalesce(v_snap ->> 'id', '');
      v_found := false;
      for v_j in 0 .. greatest(jsonb_array_length(v_customs) - 1, -1) loop
        v_canon := v_customs -> v_j;
        if coalesce(v_canon ->> 'id', '') = v_id then
          v_found := true;
          if not public.tiernight_live_custom_snapshot_matches_canon(v_snap, v_canon) then
            raise exception 'TNS_LIVE_CUSTOM_SNAPSHOT_MISMATCH';
          end if;
          exit;
        end if;
      end loop;
      if not v_found then
        raise exception 'TNS_LIVE_CUSTOM_SNAPSHOT_MISMATCH';
      end if;
    end if;
  end loop;

  for v_member in
    select user_id, display_name
    from public.lobby_members
    where lobby_id = p_lobby_id
    order by is_host desc nulls last, display_name
  loop
    if v_member.user_id is not null then
      v_roster := v_roster || jsonb_build_array(
        jsonb_build_object(
          'userId', v_member.user_id::text,
          'displayName', coalesce(nullif(trim(v_member.display_name), ''), 'Joueur')
        )
      );
    end if;
  end loop;

  v_deck := public.tiernight_live_jsonb_shuffle(v_series -> 'queue' -> 0 -> 'listSnapshot' -> 'items');

  v_live := jsonb_build_object(
    'runId', v_prop_run,
    'lobbyStarted', true,
    'finished', false,
    'series', v_series,
    'topicId', v_series -> 'queue' -> 0 -> 'listSnapshot' ->> 'id',
    'listName', coalesce(v_series -> 'queue' -> 0 -> 'listSnapshot' ->> 'name', ''),
    'deck', v_deck,
    'playerRoster', v_roster,
    'placements', '{}'::jsonb,
    'roundIdx', 0,
    'phase', 'voting',
    'votes', '{}'::jsonb
  );

  update public.game_sessions gs
  set
    state = (
      coalesce(gs.state, '{}'::jsonb)
      || jsonb_build_object(
        'tierNightLive', v_live,
        'customLiveTierListsWritable', false
      )
    ),
    screen = 'tiernight-live',
    game_id = 'tiernight',
    updated_at = now()
  where gs.lobby_id = p_lobby_id
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.start_tiernight_live_series(uuid, integer, jsonb) is
  'FEATURE-TIERNIGHT-04E — commit atomique série Rank Live ; roundCount ∈ {3,5,8}.';

revoke all on function public.start_tiernight_live_series(uuid, integer, jsonb) from public;
revoke all on function public.start_tiernight_live_series(uuid, integer, jsonb) from anon;
grant execute on function public.start_tiernight_live_series(uuid, integer, jsonb) to authenticated;
