-- =============================================================================
-- FEATURE-TIERNIGHT-03-A — Contrat série : counts 3/5/8 (+7 legacy) · customs OK
-- =============================================================================
-- Prérequis : feature-tiernight-series-03a-finalize-round-hardening.sql appliqué
--   (fonction public.tiernight_series_validate_series_shape déjà présente).
--
-- Idempotent : CREATE OR REPLACE.
-- Ne pas modifier silencieusement le fichier 03a déjà exécuté — appliquer CE fichier.
--
-- ⚠️  FEATURE-TIERNIGHT-03-A1 : après ce fichier, appliquer
--     feature-tiernight-03-a1-series-shape-total.sql
--     (validateur TOTAL + REVOKE authenticated + categoryIds).
--     Greenfield : A1 seul peut remplacer la shape si 03A est déjà là.
--
-- Changements vs 03A :
--   1. roundCount autorisés : 3, 5, 8 (nouveaux) + 7 (lecture défensive legacy)
--   2. customs autorisés dans la queue si wire roster:custom-roster-* et
--      topicSnapshot.custom = true (cohérents) ; texte name requis
--   3. code TNS_CUSTOM_IN_SERIES_QUEUE retiré ; TNS_CUSTOM_SNAPSHOT_INCONSISTENT ajouté
--
-- Ordre d'exécution (si SQL série pas encore en prod) :
--   1. feature-tiernight-series-03-finalize-round.sql (si besoin)
--   2. feature-tiernight-series-03a-finalize-round-hardening.sql
--   3. feature-tiernight-series-05-advance-round.sql (si advance)
--   4. CE fichier (feature-tiernight-03-series-contract.sql)
--   5. feature-tiernight-03-a1-series-shape-total.sql  ← obligatoire avant QA
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
  v_round_count int;
  v_round_index int;
  v_queue jsonb;
  v_i int;
  v_entry jsonb;
  v_round_id text;
  v_topic_id text;
  v_snap jsonb;
  v_raw_id text;
  v_wire_custom boolean;
  v_snap_custom boolean;
  v_seen_rounds text[] := array[]::text[];
  v_seen_topics text[] := array[]::text[];
  v_ledger jsonb;
  v_id text;
  v_hist jsonb;
  v_h jsonb;
  v_expected_round_id text;
  v_allowed_phases text[] := array['ranking', 'round_result', 'between_rounds', 'series_end'];
  -- 3/5/8 = contrat 03-A ; 7 = sessions legacy encore finalisables
  v_allowed_counts int[] := array[3, 5, 7, 8];
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
    -- FEATURE-TIERNIGHT-01 wire : roster:custom-roster-… ; FEATURE-TIERNIGHT-03-A : customs OK
    v_raw_id := substr(v_topic_id, length('roster:') + 1);
    if v_topic_id = any (v_seen_topics) then
      return jsonb_build_object('ok', false, 'code', 'TNS_DUPLICATE_TOPIC_ID', 'detail', v_topic_id);
    end if;
    v_seen_topics := array_append(v_seen_topics, v_topic_id);

    v_snap := v_entry -> 'topicSnapshot';
    if v_snap is null or jsonb_typeof(v_snap) <> 'object' then
      return jsonb_build_object('ok', false, 'code', 'TNS_INCOMPLETE_SNAPSHOT', 'detail', v_i::text);
    end if;
    if length(trim(coalesce(v_snap ->> 'id', ''))) = 0
       or length(trim(coalesce(v_snap ->> 'name', ''))) = 0 then
      return jsonb_build_object('ok', false, 'code', 'TNS_INCOMPLETE_SNAPSHOT', 'detail', v_i::text);
    end if;
    if coalesce(v_snap ->> 'id', '') is distinct from v_raw_id then
      return jsonb_build_object('ok', false, 'code', 'TNS_SNAPSHOT_ID_MISMATCH');
    end if;

    v_wire_custom := position('custom-roster-' in v_raw_id) = 1;
    v_snap_custom := coalesce(v_snap ->> 'custom', 'false') in ('true', 't');
    if v_wire_custom is distinct from v_snap_custom then
      return jsonb_build_object(
        'ok', false,
        'code', 'TNS_CUSTOM_SNAPSHOT_INCONSISTENT',
        'detail', v_topic_id
      );
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
    if jsonb_typeof(v_h) <> 'object' then
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
end;
$$;

comment on function public.tiernight_series_validate_series_shape(jsonb, text) is
  'FEATURE-TIERNIGHT-03-A: shape série — counts 3/5/8 (+7 legacy) ; customs snapshotés OK si flag cohérent.';

-- Permissions : A1 REVOKE aussi authenticated. Ici on aligne déjà le helper.
revoke all on function public.tiernight_series_validate_series_shape(jsonb, text) from public;
revoke all on function public.tiernight_series_validate_series_shape(jsonb, text) from anon;
revoke all on function public.tiernight_series_validate_series_shape(jsonb, text) from authenticated;
