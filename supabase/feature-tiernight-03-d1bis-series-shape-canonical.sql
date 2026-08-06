-- =============================================================================
-- FEATURE-TIERNIGHT-03-D1-bis — Validateur shape CANONIQUE final
-- =============================================================================
-- Migration additive idempotente de consolidation.
--
-- Rôle :
--   1. Réinstalle la définition A1-bis (counts 3/5/7/8, customs stricts, types JSON)
--   2. Retire `round_result` des phases autorisées (Option A D1-bis)
--   3. Devient la DERNIÈRE définition obligatoire du validateur pour FEATURE-TIERNIGHT-03
--
-- Machine d’état canonique : ranking | between_rounds | series_end
--
-- Origine de round_result : FEATURE-TIERNIGHT-SERIES-00 (phase prévue).
-- Jamais écrite par finalize_tiernight_series_round (→ between_rounds|series_end)
-- ni par advance. Gate prod OFF → aucune session produit réelle attendue.
--
-- Prérequis : SERIES-03A finalize + SERIES-05 advance déjà appliqués (RPCs inchangées).
-- Ordre : … → A1 → A1-bis → **D1-bis (dernier, obligatoire)**
-- Si 03A est rejoué : ré-appliquer A1-bis puis D1-bis, ou D1-bis seul (contient A1-bis + phases).
-- Idempotent : CREATE OR REPLACE + REVOKE.
-- =============================================================================

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
  v_version int;
  v_round_count int;
  v_round_index int;
  v_entry_index int;
  v_queue jsonb;
  v_i int;
  v_entry jsonb;
  v_round_id text;
  v_topic_id text;
  v_snap jsonb;
  v_raw_id text;
  v_snap_id text;
  v_snap_name text;
  v_id_node jsonb;
  v_name_node jsonb;
  v_wire_custom boolean;
  v_snap_custom boolean;
  v_custom_node jsonb;
  v_custom_str text;
  v_seen_rounds text[] := array[]::text[];
  v_seen_topics text[] := array[]::text[];
  v_ledger jsonb;
  v_id text;
  v_hist jsonb;
  v_h jsonb;
  v_expected_round_id text;
  v_allowed_phases text[] := array['ranking', 'between_rounds', 'series_end'];
  -- D1-bis Option A : round_result retiré (jamais produit ; rejet explicite)
  v_allowed_counts int[] := array[3, 5, 7, 8];
  v_scored text[];
  v_completed text[];
  v_cats jsonb;
  v_cat text;
  v_seen_cats text[] := array[]::text[];
  v_has_star boolean := false;
  v_has_explicit boolean := false;
begin
  begin
    if p_series is null or jsonb_typeof(p_series) <> 'object' then
      return jsonb_build_object('ok', false, 'code', 'TNS_NO_SERIES');
    end if;

    begin
      v_version := (p_series ->> 'version')::int;
    exception when others then
      return jsonb_build_object('ok', false, 'code', 'TNS_UNSUPPORTED_VERSION');
    end;
    if v_version is null or v_version <> 1 then
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

    -- categoryIds : tableau non vide, strings non vides uniques, ["*"] XOR explicites
    v_cats := p_series -> 'categoryIds';
    if v_cats is null or jsonb_typeof(v_cats) <> 'array' then
      return jsonb_build_object('ok', false, 'code', 'TNS_INVALID_CATEGORY_IDS');
    end if;
    if jsonb_array_length(v_cats) = 0 then
      return jsonb_build_object('ok', false, 'code', 'TNS_INVALID_CATEGORY_IDS', 'detail', 'empty');
    end if;
    for v_i in 0 .. jsonb_array_length(v_cats) - 1 loop
      if jsonb_typeof(v_cats -> v_i) <> 'string' then
        return jsonb_build_object('ok', false, 'code', 'TNS_INVALID_CATEGORY_IDS', 'detail', 'non_string');
      end if;
      v_cat := trim(coalesce(v_cats ->> v_i, ''));
      if length(v_cat) = 0 then
        return jsonb_build_object('ok', false, 'code', 'TNS_INVALID_CATEGORY_IDS', 'detail', 'blank');
      end if;
      if v_cat = any (v_seen_cats) then
        return jsonb_build_object('ok', false, 'code', 'TNS_INVALID_CATEGORY_IDS', 'detail', 'duplicate');
      end if;
      v_seen_cats := array_append(v_seen_cats, v_cat);
      if v_cat = '*' then
        v_has_star := true;
      else
        v_has_explicit := true;
      end if;
    end loop;
    if v_has_star and v_has_explicit then
      return jsonb_build_object('ok', false, 'code', 'TNS_INVALID_CATEGORY_IDS', 'detail', 'star_mixed');
    end if;
    if v_has_star and jsonb_array_length(v_cats) <> 1 then
      return jsonb_build_object('ok', false, 'code', 'TNS_INVALID_CATEGORY_IDS', 'detail', 'star_not_alone');
    end if;
    -- Note : appartenance au catalogue officiel = validation JS (SQL ne duplique pas le catalogue).

    v_queue := p_series -> 'queue';
    if v_queue is null or jsonb_typeof(v_queue) <> 'array' then
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

      begin
        v_entry_index := (v_entry ->> 'roundIndex')::int;
      exception when others then
        return jsonb_build_object('ok', false, 'code', 'TNS_ROUND_INDEX_DISCONTINUITY', 'detail', v_i::text);
      end;
      if v_entry_index is null or v_entry_index <> v_i then
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
      v_raw_id := substr(v_topic_id, length('roster:') + 1);
      if length(trim(v_raw_id)) = 0 then
        return jsonb_build_object('ok', false, 'code', 'TNS_INVALID_TOPIC_ID', 'detail', v_topic_id);
      end if;
      if v_topic_id = any (v_seen_topics) then
        return jsonb_build_object('ok', false, 'code', 'TNS_DUPLICATE_TOPIC_ID', 'detail', v_topic_id);
      end if;
      v_seen_topics := array_append(v_seen_topics, v_topic_id);

      v_snap := v_entry -> 'topicSnapshot';
      if v_snap is null or jsonb_typeof(v_snap) <> 'object' then
        return jsonb_build_object('ok', false, 'code', 'TNS_INCOMPLETE_SNAPSHOT', 'detail', v_i::text);
      end if;

      -- id / name : string JSON strict (pas de coercion nombre/bool → texte)
      v_id_node := v_snap -> 'id';
      if v_id_node is null or jsonb_typeof(v_id_node) = 'null' then
        return jsonb_build_object('ok', false, 'code', 'TNS_INCOMPLETE_SNAPSHOT', 'detail', 'id_missing');
      end if;
      if jsonb_typeof(v_id_node) <> 'string' then
        return jsonb_build_object('ok', false, 'code', 'TNS_SNAPSHOT_ID_TYPE', 'detail', v_i::text);
      end if;
      v_snap_id := trim(coalesce(v_snap ->> 'id', ''));
      if length(v_snap_id) = 0 then
        return jsonb_build_object('ok', false, 'code', 'TNS_INCOMPLETE_SNAPSHOT', 'detail', 'id_blank');
      end if;

      v_name_node := v_snap -> 'name';
      if v_name_node is null or jsonb_typeof(v_name_node) = 'null' then
        return jsonb_build_object('ok', false, 'code', 'TNS_INCOMPLETE_SNAPSHOT', 'detail', 'name_missing');
      end if;
      if jsonb_typeof(v_name_node) <> 'string' then
        return jsonb_build_object('ok', false, 'code', 'TNS_SNAPSHOT_NAME_TYPE', 'detail', v_i::text);
      end if;
      v_snap_name := trim(coalesce(v_snap ->> 'name', ''));
      if length(v_snap_name) = 0 then
        return jsonb_build_object('ok', false, 'code', 'TNS_INCOMPLETE_SNAPSHOT', 'detail', 'name_blank');
      end if;

      if v_snap_id is distinct from v_raw_id then
        return jsonb_build_object('ok', false, 'code', 'TNS_SNAPSHOT_ID_MISMATCH');
      end if;

      v_wire_custom := position('custom-roster-' in v_raw_id) = 1;

      -- custom : absent ≠ null
      if not (v_snap ? 'custom') then
        -- Legacy officiel sans champ → false ; wire custom sans champ → reject
        if v_wire_custom then
          return jsonb_build_object(
            'ok', false,
            'code', 'TNS_CUSTOM_SNAPSHOT_INCONSISTENT',
            'detail', v_topic_id
          );
        end if;
        v_snap_custom := false;
      else
        v_custom_node := v_snap -> 'custom';
        if v_custom_node is null or jsonb_typeof(v_custom_node) = 'null' then
          return jsonb_build_object(
            'ok', false,
            'code', 'TNS_CUSTOM_FLAG_INVALID',
            'detail', 'null'
          );
        elsif jsonb_typeof(v_custom_node) = 'boolean' then
          v_snap_custom := (v_custom_node = 'true'::jsonb);
        elsif jsonb_typeof(v_custom_node) = 'string' then
          v_custom_str := lower(trim(coalesce(v_snap ->> 'custom', '')));
          if v_custom_str in ('true', 't') then
            v_snap_custom := true;
          elsif v_custom_str in ('false', 'f') then
            v_snap_custom := false;
          else
            return jsonb_build_object(
              'ok', false,
              'code', 'TNS_CUSTOM_FLAG_INVALID',
              'detail', v_custom_str
            );
          end if;
        else
          return jsonb_build_object(
            'ok', false,
            'code', 'TNS_CUSTOM_FLAG_INVALID',
            'detail', jsonb_typeof(v_custom_node)
          );
        end if;

        if v_wire_custom is distinct from v_snap_custom then
          return jsonb_build_object(
            'ok', false,
            'code', 'TNS_CUSTOM_SNAPSHOT_INCONSISTENT',
            'detail', v_topic_id
          );
        end if;
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
      if exists (
        select 1
        from jsonb_array_elements(v_ledger) e(value)
        where jsonb_typeof(value) <> 'string'
      ) then
        return jsonb_build_object('ok', false, 'code', 'TNS_LEDGER_INVALID_ENTRY');
      end if;
    end loop;

    begin
      select coalesce(array_agg(x), array[]::text[]) into v_scored
      from jsonb_array_elements_text(coalesce(p_series -> 'scoredRoundIds', '[]'::jsonb)) t(x);
      select coalesce(array_agg(x), array[]::text[]) into v_completed
      from jsonb_array_elements_text(coalesce(p_series -> 'completedRoundIds', '[]'::jsonb)) t(x);
    exception when others then
      return jsonb_build_object('ok', false, 'code', 'TNS_LEDGER_NOT_ARRAY');
    end;

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

    v_seen_rounds := array[]::text[];
    for v_i in 0 .. greatest(jsonb_array_length(v_hist) - 1, -1) loop
      exit when jsonb_array_length(v_hist) = 0;
      v_h := v_hist -> v_i;
      if v_h is null or jsonb_typeof(v_h) <> 'object' then
        return jsonb_build_object('ok', false, 'code', 'TNS_HISTORY_INVALID_ENTRY');
      end if;
      v_id := trim(coalesce(v_h ->> 'roundId', ''));
      if length(v_id) = 0 then
        return jsonb_build_object('ok', false, 'code', 'TNS_HISTORY_UNKNOWN_ROUND');
      end if;
      if position(trim(p_run_id) || ':' in v_id) <> 1 then
        return jsonb_build_object('ok', false, 'code', 'TNS_HISTORY_UNKNOWN_ROUND', 'detail', v_id);
      end if;
      if v_id = any (v_seen_rounds) then
        return jsonb_build_object('ok', false, 'code', 'TNS_HISTORY_DUPLICATE', 'detail', v_id);
      end if;
      v_seen_rounds := array_append(v_seen_rounds, v_id);
    end loop;

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
  exception when others then
    return jsonb_build_object('ok', false, 'code', 'TNS_SHAPE_EXCEPTION');
  end;
end;
$$;

comment on function public.tiernight_series_validate_series_shape(jsonb, text) is
  'FEATURE-TIERNIGHT-03-D1-bis: shape canonique finale (A1-bis + phases ranking|between_rounds|series_end ; sans round_result).';

revoke all on function public.tiernight_series_validate_series_shape(jsonb, text) from public;
revoke all on function public.tiernight_series_validate_series_shape(jsonb, text) from anon;
revoke all on function public.tiernight_series_validate_series_shape(jsonb, text) from authenticated;
