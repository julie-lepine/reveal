-- BUG-TIERNIGHT-SERIES-QA-02 — outsider bonus TierNight +15 → +5
-- Nécessité serveur : tiernight_series_compute_scores hardcode 15 pour outsider.
-- Proximité (15/10/0 via tiernight_series_points_for_diff) INCHANGÉE.
-- Appliquer après feature-tiernight-series-03a-finalize-round-hardening.sql / d1bis.
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
                jsonb_set(r.elem, '{outsiderBonus}', to_jsonb(5), true),
                '{consensusPoints}',
                to_jsonb(coalesce((r.elem ->> 'proximityPoints')::int, 0) + 5),
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
