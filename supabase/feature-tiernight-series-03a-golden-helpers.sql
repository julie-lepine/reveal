-- FEATURE-TIERNIGHT-SERIES-03A — golden helpers (lecture seule, rôle postgres / SQL Editor)
-- Aucun JWT requis. À exécuter APRÈS feature-tiernight-series-03a-finalize-round-hardening.sql
-- Comparer les scores aux fixtures JS buildTierNightSeriesGoldenFixtures().

-- A) ACL helpers (ne doivent PAS être EXECUTE pour anon / authenticated)
select p.proname,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_exec
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname like 'tiernight_series_%'
order by 1;
-- Attendu : anon_exec=false, auth_exec=false pour tous

-- B) ACL RPC
select has_function_privilege('anon', 'public.finalize_tiernight_series_round(uuid,text,text,integer,text,boolean)', 'EXECUTE') as anon_rpc,
       has_function_privilege('authenticated', 'public.finalize_tiernight_series_round(uuid,text,text,integer,text,boolean)', 'EXECUTE') as auth_rpc;
-- Attendu : anon_rpc=false, auth_rpc=true

-- C) Placement invalide (item manquant) — pas de fallback D
select public.tiernight_series_validate_placement(
  '{"S":["a"],"A":[],"B":[],"C":[],"D":[]}'::jsonb,
  '["a","b"]'::jsonb
);
-- Attendu : ok=false code=TNS_PLACEMENT_MISSING_ITEM

-- D) Placement valide
select public.tiernight_series_validate_placement(
  '{"S":["a"],"A":["b"],"B":[],"C":[],"D":[]}'::jsonb,
  '["a","b"]'::jsonb
);
-- Attendu : ok=true

-- E) Golden empty-tiers / exact consensus (2 joueurs même placement)
select public.tiernight_series_compute_scores(
  '["solo"]'::jsonb,
  jsonb_build_object(
    '11111111-1111-4111-8111-111111111111',
    '{"S":["solo"],"A":[],"B":[],"C":[],"D":[]}'::jsonb,
    '22222222-2222-4222-8222-222222222222',
    '{"S":["solo"],"A":[],"B":[],"C":[],"D":[]}'::jsonb
  ),
  '["11111111-1111-4111-8111-111111111111","22222222-2222-4222-8222-222222222222"]'::jsonb,
  false
);
-- Attendu : ok=true ; chaque consensusPoints=15 ; outsiderBonus=0

-- F) Médiane paire floor((0+4)/2)=2 → B
select public.tiernight_series_median_rank(array[0,4]);
-- Attendu : 2

-- G) Points reverse
select public.tiernight_series_points_for_diff(3, true),
       public.tiernight_series_points_for_diff(2, true),
       public.tiernight_series_points_for_diff(1, true);
-- Attendu : 15, 10, 0

-- H) Finished : chaîne "true" sur UID roster → invalide
select public.tiernight_series_validate_finished(
  '{"11111111-1111-4111-8111-111111111111":"true"}'::jsonb,
  '[{"userId":"11111111-1111-4111-8111-111111111111"}]'::jsonb
);
-- Attendu : ok=false code=TNS_FINISHED_INVALID_VALUE

-- I) Custom wire réel rejeté (custom-roster-, pas custom:)
select public.tiernight_series_validate_series_shape(
  jsonb_build_object(
    'version', 1,
    'phase', 'ranking',
    'roundCount', 3,
    'roundIndex', 0,
    'scoredRoundIds', '[]'::jsonb,
    'completedRoundIds', '[]'::jsonb,
    'roundHistory', '[]'::jsonb,
    'categoryIds', '["survival"]'::jsonb,
    'queue', jsonb_build_array(
      jsonb_build_object(
        'roundId', 'runx:0', 'roundIndex', 0,
        'topicId', 'roster:custom-roster-abc',
        'topicSnapshot', jsonb_build_object('id','custom-roster-abc','name','X','custom', false)
      ),
      jsonb_build_object(
        'roundId', 'runx:1', 'roundIndex', 1,
        'topicId', 'roster:t1',
        'topicSnapshot', jsonb_build_object('id','t1','name','Y')
      ),
      jsonb_build_object(
        'roundId', 'runx:2', 'roundIndex', 2,
        'topicId', 'roster:t2',
        'topicSnapshot', jsonb_build_object('id','t2','name','Z')
      )
    )
  ),
  'runx'
);
-- Attendu : ok=false code=TNS_CUSTOM_IN_SERIES_QUEUE
