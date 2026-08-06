-- FEATURE-TIERNIGHT-SERIES-03A — Hardening finalize_tiernight_series_round
-- Inclut correctifs 03B (pré-déploiement, fichier unique à exécuter) :
--   • wire custom = roster:custom-roster-… (CUSTOM_ROSTER_TOPIC_ID_PREFIX)
--   • moteur unique tiernight_series_compute_scores appelé par la RPC
--   • finished roster : booléens JSON stricts (TNS_FINISHED_INVALID_VALUE)
-- Prérequis : feature-tiernight-series-03-finalize-round.sql déjà appliqué en staging.
-- Idempotent : CREATE OR REPLACE + REVOKE/GRANT explicites (dont anon).
--
-- Corrections :
--   1) validation canonique placements (pas de fallback D silencieux)
--   2) force = roster ∩ finished ∩ placement valide exhaustif
--   3) validation structurelle série / queue / ledger / roster / items
--   4) idempotence après résolution round (ALREADY_APPLIED ok en between_rounds|series_end)
--   5) revoke EXECUTE anon + helpers non exposés

-- ===========================================================================
-- Helpers purs (scoring) — inchangés fonctionnellement, ACL renforcées
-- ===========================================================================

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

-- Fallback défensif uniquement ; la RPC valide l'exhaustivité avant usage scoring.
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

-- Après validate_finished : seul le booléen JSON true compte.
-- coalesce(..., false) : clé absente / comparaison NULL → FALSE (jamais NULL).
create or replace function public.tiernight_series_is_finished_flag(
  p_finished jsonb,
  p_uid text
)
returns boolean
language sql
immutable
as $$
  select coalesce(p_uid, '') <> ''
    and coalesce(
      (coalesce(p_finished, '{}'::jsonb) -> p_uid) = to_jsonb(true),
      false
    );
$$;

-- Valeurs roster : uniquement boolean JSON (true|false). Absent = non terminé.
-- Clés hors roster ignorées pour l'éligibilité (jamais scorables via cette map).
create or replace function public.tiernight_series_validate_finished(
  p_finished jsonb,
  p_roster jsonb
)
returns jsonb
language plpgsql
immutable
as $$
declare
  v_uid text;
  v_val jsonb;
begin
  if p_finished is null then
    return jsonb_build_object('ok', true);
  end if;
  if jsonb_typeof(p_finished) <> 'object' then
    return jsonb_build_object('ok', false, 'code', 'TNS_FINISHED_INVALID');
  end if;
  if p_roster is null or jsonb_typeof(p_roster) <> 'array' then
    return jsonb_build_object('ok', false, 'code', 'TNS_MISSING_ROSTER');
  end if;

  for v_uid in
    select r ->> 'userId'
    from jsonb_array_elements(p_roster) r
    where coalesce(r ->> 'userId', '') <> ''
  loop
    if not (p_finished ? v_uid) then
      continue;
    end if;
    v_val := p_finished -> v_uid;
    if jsonb_typeof(v_val) is distinct from 'boolean' then
      return jsonb_build_object(
        'ok', false,
        'code', 'TNS_FINISHED_INVALID_VALUE',
        'detail', v_uid
      );
    end if;
  end loop;

  return jsonb_build_object('ok', true);
end;
$$;

-- ===========================================================================
-- Validation expected items
-- ===========================================================================

create or replace function public.tiernight_series_validate_expected_items(p_expected_items jsonb)
returns jsonb
language plpgsql
immutable
as $$
declare
  v_item text;
  v_seen text[] := array[]::text[];
  v_i int;
  v_n int;
begin
  if p_expected_items is null or jsonb_typeof(p_expected_items) <> 'array' then
    return jsonb_build_object('ok', false, 'code', 'TNS_ITEMS_NOT_ARRAY');
  end if;
  v_n := jsonb_array_length(p_expected_items);
  if v_n < 1 then
    return jsonb_build_object('ok', false, 'code', 'TNS_ITEMS_EMPTY');
  end if;
  for v_i in 0 .. v_n - 1 loop
    if jsonb_typeof(p_expected_items -> v_i) <> 'string' then
      return jsonb_build_object('ok', false, 'code', 'TNS_ITEMS_INVALID_VALUE');
    end if;
    v_item := p_expected_items ->> v_i;
    if v_item is null or length(v_item) = 0 then
      return jsonb_build_object('ok', false, 'code', 'TNS_ITEMS_INVALID_VALUE');
    end if;
    if v_item = any (v_seen) then
      return jsonb_build_object('ok', false, 'code', 'TNS_ITEMS_DUPLICATE', 'detail', v_item);
    end if;
    v_seen := array_append(v_seen, v_item);
  end loop;
  return jsonb_build_object('ok', true, 'items', p_expected_items);
end;
$$;

-- ===========================================================================
-- Validation placement canonique
-- ===========================================================================

create or replace function public.tiernight_series_validate_placement(
  p_placement jsonb,
  p_expected_items jsonb
)
returns jsonb
language plpgsql
immutable
as $$
declare
  v_items_check jsonb;
  v_expected text[];
  v_key text;
  v_arr jsonb;
  v_el jsonb;
  v_item text;
  v_seen text[] := array[]::text[];
  v_i int;
  v_n int;
  v_allowed text[] := array['S', 'A', 'B', 'C', 'D'];
begin
  v_items_check := public.tiernight_series_validate_expected_items(p_expected_items);
  if coalesce((v_items_check ->> 'ok')::boolean, false) is not true then
    return v_items_check;
  end if;

  select array_agg(x order by ord)
    into v_expected
  from jsonb_array_elements_text(p_expected_items) with ordinality as t(x, ord);

  if p_placement is null or jsonb_typeof(p_placement) <> 'object' then
    return jsonb_build_object('ok', false, 'code', 'TNS_PLACEMENT_NOT_OBJECT');
  end if;

  for v_key in select jsonb_object_keys(p_placement)
  loop
    if not (v_key = any (v_allowed)) then
      return jsonb_build_object('ok', false, 'code', 'TNS_PLACEMENT_UNKNOWN_TIER', 'detail', v_key);
    end if;
    v_arr := p_placement -> v_key;
    if jsonb_typeof(v_arr) <> 'array' then
      return jsonb_build_object('ok', false, 'code', 'TNS_PLACEMENT_TIER_NOT_ARRAY', 'detail', v_key);
    end if;
    v_n := jsonb_array_length(v_arr);
    for v_i in 0 .. greatest(v_n - 1, -1) loop
      exit when v_n = 0;
      v_el := v_arr -> v_i;
      if jsonb_typeof(v_el) <> 'string' then
        return jsonb_build_object('ok', false, 'code', 'TNS_PLACEMENT_ITEM_NOT_TEXT', 'detail', v_key);
      end if;
      v_item := v_arr ->> v_i;
      if v_item is null or length(v_item) = 0 then
        return jsonb_build_object('ok', false, 'code', 'TNS_PLACEMENT_ITEM_NOT_TEXT', 'detail', v_key);
      end if;
      if not (v_item = any (v_expected)) then
        return jsonb_build_object('ok', false, 'code', 'TNS_PLACEMENT_UNKNOWN_ITEM', 'detail', v_item);
      end if;
      if v_item = any (v_seen) then
        return jsonb_build_object('ok', false, 'code', 'TNS_PLACEMENT_DUPLICATE_ITEM', 'detail', v_item);
      end if;
      v_seen := array_append(v_seen, v_item);
    end loop;
  end loop;

  foreach v_item in array v_expected
  loop
    if not (v_item = any (v_seen)) then
      return jsonb_build_object('ok', false, 'code', 'TNS_PLACEMENT_MISSING_ITEM', 'detail', v_item);
    end if;
  end loop;

  if coalesce(array_length(v_seen, 1), 0) <> coalesce(array_length(v_expected, 1), 0) then
    return jsonb_build_object('ok', false, 'code', 'TNS_PLACEMENT_COUNT_MISMATCH');
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

-- ===========================================================================
-- Validation série / roster / items session
-- ===========================================================================

create or replace function public.tiernight_series_validate_series_shape(
  p_series jsonb,
  p_run_id text
)
returns jsonb
language plpgsql
immutable
as $$
declare
  v_phase text;
  v_round_count int;
  v_round_index int;
  v_queue jsonb;
  v_i int;
  v_entry jsonb;
  v_round_id text;
  v_topic_id text;
  v_snap jsonb;
  v_raw_id text;
  v_seen_rounds text[] := array[]::text[];
  v_seen_topics text[] := array[]::text[];
  v_ledger jsonb;
  v_id text;
  v_hist jsonb;
  v_h jsonb;
  v_expected_round_id text;
  v_allowed_phases text[] := array['ranking', 'round_result', 'between_rounds', 'series_end'];
  v_allowed_counts int[] := array[3, 5, 7];
  v_scored text[];
  v_completed text[];
begin
  if p_series is null or jsonb_typeof(p_series) <> 'object' then
    return jsonb_build_object('ok', false, 'code', 'TNS_NO_SERIES');
  end if;

  if coalesce((p_series ->> 'version')::int, 0) <> 1 then
    return jsonb_build_object('ok', false, 'code', 'TNS_UNSUPPORTED_VERSION');
  end if;

  v_phase := coalesce(p_series ->> 'phase', '');
  if not (v_phase = any (v_allowed_phases)) then
    return jsonb_build_object('ok', false, 'code', 'TNS_UNKNOWN_PHASE', 'detail', v_phase);
  end if;

  begin
    v_round_count := (p_series ->> 'roundCount')::int;
  exception when others then
    return jsonb_build_object('ok', false, 'code', 'TNS_INVALID_ROUND_COUNT');
  end;
  if v_round_count is null or not (v_round_count = any (v_allowed_counts)) then
    return jsonb_build_object('ok', false, 'code', 'TNS_INVALID_ROUND_COUNT');
  end if;

  v_queue := p_series -> 'queue';
  if jsonb_typeof(v_queue) <> 'array' then
    return jsonb_build_object('ok', false, 'code', 'TNS_INVALID_QUEUE');
  end if;
  if jsonb_array_length(v_queue) <> v_round_count then
    return jsonb_build_object('ok', false, 'code', 'TNS_QUEUE_LENGTH_MISMATCH');
  end if;

  begin
    v_round_index := (p_series ->> 'roundIndex')::int;
  exception when others then
    return jsonb_build_object('ok', false, 'code', 'TNS_ROUND_INDEX_OUT_OF_BOUNDS');
  end;
  if v_round_index is null or v_round_index < 0 or v_round_index >= v_round_count then
    return jsonb_build_object('ok', false, 'code', 'TNS_ROUND_INDEX_OUT_OF_BOUNDS');
  end if;

  if p_run_id is null or length(trim(p_run_id)) = 0 then
    return jsonb_build_object('ok', false, 'code', 'TNS_INVALID_RUN_ID');
  end if;

  for v_i in 0 .. v_round_count - 1 loop
    v_entry := v_queue -> v_i;
    if v_entry is null or jsonb_typeof(v_entry) <> 'object' then
      return jsonb_build_object('ok', false, 'code', 'TNS_INVALID_QUEUE_ENTRY', 'detail', v_i::text);
    end if;
    if coalesce((v_entry ->> 'roundIndex')::int, -1) <> v_i then
      return jsonb_build_object('ok', false, 'code', 'TNS_ROUND_INDEX_DISCONTINUITY', 'detail', v_i::text);
    end if;
    v_round_id := trim(coalesce(v_entry ->> 'roundId', ''));
    if length(v_round_id) = 0 then
      return jsonb_build_object('ok', false, 'code', 'TNS_MISSING_ROUND_ID');
    end if;
    if v_round_id = any (v_seen_rounds) then
      return jsonb_build_object('ok', false, 'code', 'TNS_DUPLICATE_ROUND_ID', 'detail', v_round_id);
    end if;
    v_seen_rounds := array_append(v_seen_rounds, v_round_id);

    v_expected_round_id := trim(p_run_id) || ':' || v_i::text;
    if v_round_id is distinct from v_expected_round_id then
      return jsonb_build_object(
        'ok', false,
        'code', 'TNS_ROUND_ID_MISMATCH',
        'detail', v_expected_round_id || ' vs ' || v_round_id
      );
    end if;

    v_topic_id := trim(coalesce(v_entry ->> 'topicId', ''));
    if length(v_topic_id) = 0 or position('roster:' in v_topic_id) <> 1 then
      return jsonb_build_object('ok', false, 'code', 'TNS_INVALID_TOPIC_ID', 'detail', v_topic_id);
    end if;
    -- Contrat réel FEATURE-TIERNIGHT-01 : raw id = custom-roster-… ;
    -- wire id = roster:custom-roster-… (pas roster:custom:).
    v_raw_id := substr(v_topic_id, length('roster:') + 1);
    if position('custom-roster-' in v_raw_id) = 1
       or position('roster:custom-roster-' in v_topic_id) = 1 then
      return jsonb_build_object('ok', false, 'code', 'TNS_CUSTOM_IN_SERIES_QUEUE', 'detail', v_topic_id);
    end if;
    if v_topic_id = any (v_seen_topics) then
      return jsonb_build_object('ok', false, 'code', 'TNS_DUPLICATE_TOPIC_ID', 'detail', v_topic_id);
    end if;
    v_seen_topics := array_append(v_seen_topics, v_topic_id);

    v_snap := v_entry -> 'topicSnapshot';
    if v_snap is null or jsonb_typeof(v_snap) <> 'object' then
      return jsonb_build_object('ok', false, 'code', 'TNS_INCOMPLETE_SNAPSHOT', 'detail', v_i::text);
    end if;
    if coalesce(v_snap ->> 'custom', 'false') in ('true', 't') then
      return jsonb_build_object('ok', false, 'code', 'TNS_CUSTOM_IN_SERIES_QUEUE');
    end if;
    if length(trim(coalesce(v_snap ->> 'id', ''))) = 0
       or length(trim(coalesce(v_snap ->> 'name', ''))) = 0 then
      return jsonb_build_object('ok', false, 'code', 'TNS_INCOMPLETE_SNAPSHOT', 'detail', v_i::text);
    end if;
    if coalesce(v_snap ->> 'id', '') is distinct from v_raw_id then
      return jsonb_build_object('ok', false, 'code', 'TNS_SNAPSHOT_ID_MISMATCH');
    end if;
  end loop;

  foreach v_ledger in array array[p_series -> 'scoredRoundIds', p_series -> 'completedRoundIds']
  loop
    if v_ledger is null then
      continue;
    end if;
    if jsonb_typeof(v_ledger) <> 'array' then
      return jsonb_build_object('ok', false, 'code', 'TNS_LEDGER_NOT_ARRAY');
    end if;
  end loop;

  select coalesce(array_agg(x), array[]::text[]) into v_scored
  from jsonb_array_elements_text(coalesce(p_series -> 'scoredRoundIds', '[]'::jsonb)) t(x);
  select coalesce(array_agg(x), array[]::text[]) into v_completed
  from jsonb_array_elements_text(coalesce(p_series -> 'completedRoundIds', '[]'::jsonb)) t(x);

  if coalesce(array_length(v_scored, 1), 0)
     <> (select count(distinct x) from unnest(v_scored) x) then
    return jsonb_build_object('ok', false, 'code', 'TNS_LEDGER_DUPLICATE');
  end if;
  if coalesce(array_length(v_completed, 1), 0)
     <> (select count(distinct x) from unnest(v_completed) x) then
    return jsonb_build_object('ok', false, 'code', 'TNS_LEDGER_DUPLICATE');
  end if;

  foreach v_id in array coalesce(v_scored, array[]::text[])
  loop
    if not (v_id = any (v_seen_rounds)) then
      return jsonb_build_object('ok', false, 'code', 'TNS_LEDGER_UNKNOWN_ROUND_ID', 'detail', v_id);
    end if;
  end loop;
  foreach v_id in array coalesce(v_completed, array[]::text[])
  loop
    if not (v_id = any (v_seen_rounds)) then
      return jsonb_build_object('ok', false, 'code', 'TNS_LEDGER_UNKNOWN_ROUND_ID', 'detail', v_id);
    end if;
  end loop;

  -- scored ⊆ completed (contrat métier SERIES : points ⇒ manche complétée)
  foreach v_id in array coalesce(v_scored, array[]::text[])
  loop
    if not (v_id = any (coalesce(v_completed, array[]::text[]))) then
      return jsonb_build_object('ok', false, 'code', 'TNS_LEDGER_SCORED_NOT_COMPLETED', 'detail', v_id);
    end if;
  end loop;

  v_hist := coalesce(p_series -> 'roundHistory', '[]'::jsonb);
  if jsonb_typeof(v_hist) <> 'array' then
    return jsonb_build_object('ok', false, 'code', 'TNS_HISTORY_NOT_ARRAY');
  end if;
  v_seen_rounds := array[]::text[]; -- reuse for history roundIds
  for v_i in 0 .. greatest(jsonb_array_length(v_hist) - 1, -1) loop
    exit when jsonb_array_length(v_hist) = 0;
    v_h := v_hist -> v_i;
    if jsonb_typeof(v_h) <> 'object' then
      return jsonb_build_object('ok', false, 'code', 'TNS_HISTORY_INVALID_ENTRY');
    end if;
    v_id := trim(coalesce(v_h ->> 'roundId', ''));
    if length(v_id) = 0 then
      return jsonb_build_object('ok', false, 'code', 'TNS_HISTORY_UNKNOWN_ROUND');
    end if;
    -- history round must belong to queue — recompute from queue length via expected pattern
    if position(trim(p_run_id) || ':' in v_id) <> 1 then
      return jsonb_build_object('ok', false, 'code', 'TNS_HISTORY_UNKNOWN_ROUND', 'detail', v_id);
    end if;
    if v_id = any (v_seen_rounds) then
      return jsonb_build_object('ok', false, 'code', 'TNS_HISTORY_DUPLICATE', 'detail', v_id);
    end if;
    v_seen_rounds := array_append(v_seen_rounds, v_id);
  end loop;

  -- Verify history roundIds are in queue (second pass with queue ids)
  for v_i in 0 .. jsonb_array_length(v_hist) - 1 loop
    v_id := trim(coalesce((v_hist -> v_i) ->> 'roundId', ''));
    if not exists (
      select 1 from jsonb_array_elements(v_queue) q
      where coalesce(q ->> 'roundId', '') = v_id
    ) then
      return jsonb_build_object('ok', false, 'code', 'TNS_HISTORY_UNKNOWN_ROUND', 'detail', v_id);
    end if;
  end loop;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.tiernight_series_validate_roster(p_roster jsonb)
returns jsonb
language plpgsql
immutable
as $$
declare
  v_i int;
  v_n int;
  v_entry jsonb;
  v_uid text;
  v_seen text[] := array[]::text[];
  v_uuid_re text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
begin
  if p_roster is null or jsonb_typeof(p_roster) <> 'array' then
    return jsonb_build_object('ok', false, 'code', 'TNS_MISSING_ROSTER');
  end if;
  v_n := jsonb_array_length(p_roster);
  if v_n < 1 then
    return jsonb_build_object('ok', false, 'code', 'TNS_MISSING_ROSTER');
  end if;
  for v_i in 0 .. v_n - 1 loop
    v_entry := p_roster -> v_i;
    if jsonb_typeof(v_entry) <> 'object' then
      return jsonb_build_object('ok', false, 'code', 'TNS_ROSTER_INVALID_ENTRY');
    end if;
    v_uid := trim(coalesce(v_entry ->> 'userId', ''));
    if length(v_uid) = 0 then
      return jsonb_build_object('ok', false, 'code', 'TNS_ROSTER_EMPTY_UID');
    end if;
    if v_uid !~ v_uuid_re then
      return jsonb_build_object('ok', false, 'code', 'TNS_ROSTER_INVALID_UID', 'detail', v_uid);
    end if;
    if v_uid = any (v_seen) then
      return jsonb_build_object('ok', false, 'code', 'TNS_ROSTER_DUPLICATE_UID', 'detail', v_uid);
    end if;
    v_seen := array_append(v_seen, v_uid);
    -- displayName sérialisable (string ou absent)
    if v_entry ? 'displayName' and jsonb_typeof(v_entry -> 'displayName') not in ('string', 'null') then
      return jsonb_build_object('ok', false, 'code', 'TNS_ROSTER_INVALID_NAME');
    end if;
  end loop;
  return jsonb_build_object('ok', true);
end;
$$;

-- ===========================================================================
-- Calcul pur (golden tests SQL sans session)
-- ===========================================================================

create or replace function public.tiernight_series_compute_scores(
  p_items jsonb,
  p_placements jsonb,
  p_participant_uids jsonb,
  p_reverse boolean default false
)
returns jsonb
language plpgsql
immutable
as $$
declare
  v_check jsonb;
  v_uid text;
  v_item text;
  v_ranks int[];
  v_median int;
  v_cons_tier text;
  v_consensus jsonb := jsonb_build_object(
    'S', '[]'::jsonb, 'A', '[]'::jsonb, 'B', '[]'::jsonb, 'C', '[]'::jsonb, 'D', '[]'::jsonb
  );
  v_recaps jsonb := '[]'::jsonb;
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
  v_uids text[];
  v_i int;
begin
  v_check := public.tiernight_series_validate_expected_items(p_items);
  if coalesce((v_check ->> 'ok')::boolean, false) is not true then
    return v_check;
  end if;
  if p_participant_uids is null or jsonb_typeof(p_participant_uids) <> 'array'
     or jsonb_array_length(p_participant_uids) < 1 then
    return jsonb_build_object('ok', false, 'code', 'TNS_NO_PARTICIPANTS');
  end if;
  if p_placements is null or jsonb_typeof(p_placements) <> 'object' then
    return jsonb_build_object('ok', false, 'code', 'TNS_PLACEMENTS_INVALID');
  end if;

  select coalesce(array_agg(x order by ord), array[]::text[])
    into v_uids
  from jsonb_array_elements_text(p_participant_uids) with ordinality as t(x, ord);

  foreach v_uid in array v_uids
  loop
    v_check := public.tiernight_series_validate_placement(p_placements -> v_uid, p_items);
    if coalesce((v_check ->> 'ok')::boolean, false) is not true then
      return v_check || jsonb_build_object('uid', v_uid);
    end if;
  end loop;

  for v_item in select jsonb_array_elements_text(p_items)
  loop
    v_ranks := array[]::int[];
    foreach v_uid in array v_uids
    loop
      v_ranks := array_append(
        v_ranks,
        public.tiernight_series_tier_rank(
          public.tiernight_series_tier_of_item(p_placements -> v_uid, v_item)
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

  for v_item in select jsonb_array_elements_text(p_items)
  loop
    v_ranks := array[]::int[];
    foreach v_uid in array v_uids
    loop
      v_ranks := array_append(
        v_ranks,
        public.tiernight_series_tier_rank(
          public.tiernight_series_tier_of_item(p_placements -> v_uid, v_item)
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

  foreach v_uid in array v_uids
  loop
    v_placed := p_placements -> v_uid;
    v_pts_sum := 0;
    v_item_n := 0;
    for v_item in select jsonb_array_elements_text(p_items)
    loop
      v_local_tier := public.tiernight_series_tier_of_item(v_placed, v_item);
      v_cons_tier := public.tiernight_series_tier_of_item(v_consensus, v_item);
      v_pts_sum := v_pts_sum + public.tiernight_series_points_for_diff(
        abs(
          public.tiernight_series_tier_rank(v_local_tier)
          - public.tiernight_series_tier_rank(v_cons_tier)
        ),
        coalesce(p_reverse, false)
      );
      v_item_n := v_item_n + 1;
    end loop;
    v_proximity := case when v_item_n > 0 then round(v_pts_sum / v_item_n)::int else 0 end;
    v_recaps := v_recaps || jsonb_build_array(
      jsonb_build_object(
        'uid', v_uid,
        'proximityPoints', v_proximity,
        'outsiderBonus', 0,
        'consensusPoints', v_proximity
      )
    );
  end loop;

  if v_controversial is not null and v_best_spread >= 1 then
    v_cons_rank := public.tiernight_series_tier_rank(
      public.tiernight_series_tier_of_item(v_consensus, v_controversial)
    );
    v_max_diff := 0;
    foreach v_uid in array v_uids
    loop
      v_diff := abs(
        public.tiernight_series_tier_rank(
          public.tiernight_series_tier_of_item(p_placements -> v_uid, v_controversial)
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
                public.tiernight_series_tier_of_item(p_placements -> (r.elem ->> 'uid'), v_controversial)
              ) - v_cons_rank
            ) = v_max_diff then
              jsonb_set(
                jsonb_set(r.elem, '{outsiderBonus}', to_jsonb(15), true),
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

  return jsonb_build_object(
    'ok', true,
    'consensus', v_consensus,
    'controversialItem', to_jsonb(v_controversial),
    'controversialSpread', v_best_spread,
    'scores', v_recaps
  );
end;
$$;

-- ===========================================================================

-- ===========================================================================
-- RPC principale (remplace SERIES-03)
-- ===========================================================================

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

  -- Résoudre l'entrée AVANT idempotence
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

  -- Idempotence : round résolu déjà scoré (phase peut être between_rounds | series_end)
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

  -- Première application : phase ranking + index actif
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
    -- Force : roster ∩ finished=true ∩ placement strictement valide
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

  -- Moteur canonique UNIQUE (golden = même helper)
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

  -- v_rec est jsonb (scalaire) : la boucle assigne `value`, pas un RECORD.
  -- v_rec.elem serait interprété comme table.colonne → 42P01.
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
    -- Marqueur soirée : n'empêche PAS cette RPC (déjà derrière ledger).
    -- Empêche seulement un futur recordTierNightPlayed client local.
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
    -- Bridge legacy dernière manche UNIQUEMENT — canon série = series.roundHistory
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

-- ===========================================================================
-- Permissions
-- ===========================================================================

do $perm$
begin
  execute 'revoke all on function public.finalize_tiernight_series_round(uuid, text, text, integer, text, boolean) from public';
  execute 'revoke all on function public.finalize_tiernight_series_round(uuid, text, text, integer, text, boolean) from anon';
  execute 'grant execute on function public.finalize_tiernight_series_round(uuid, text, text, integer, text, boolean) to authenticated';
end $perm$;

-- Helpers : non exposés (SECURITY DEFINER les appelle en interne)
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

comment on function public.finalize_tiernight_series_round(uuid, text, text, integer, text, boolean) is
  'FEATURE-TIERNIGHT-SERIES-03A — finalise manche série (placements stricts, force roster∩finished, idempotence après résolution round).';
