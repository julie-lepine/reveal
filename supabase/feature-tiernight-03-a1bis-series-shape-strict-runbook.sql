-- =============================================================================
-- FEATURE-TIERNIGHT-03-A1-bis — Runbook + smokes codes métier (pas SHAPE_EXCEPTION)
-- =============================================================================
-- 1. Exécuter : feature-tiernight-03-a1bis-series-shape-strict.sql
-- 2. Preuves ci-dessous (rôle postgres ; helper sans EXECUTE authenticated)
--
-- Chaque cas DOIT retourner le code métier indiqué — JAMAIS TNS_SHAPE_EXCEPTION.
-- =============================================================================

-- S1) version non numérique
select public.tiernight_series_validate_series_shape(
  '{"version":"x","phase":"ranking","roundCount":3,"roundIndex":0,"categoryIds":["*"],"queue":[]}'::jsonb,
  'run'
);
-- Attendu : TNS_UNSUPPORTED_VERSION

-- S2) roundIndex non numérique
select public.tiernight_series_validate_series_shape(
  '{"version":1,"phase":"ranking","roundCount":3,"roundIndex":"nope","categoryIds":["*"],"queue":[{},{},{}]}'::jsonb,
  'run'
);
-- Attendu : TNS_ROUND_INDEX_OUT_OF_BOUNDS

-- S3) queue.roundIndex non numérique (nécessite queue length = 3)
select public.tiernight_series_validate_series_shape(
  jsonb_build_object(
    'version', 1, 'phase', 'ranking', 'roundCount', 3, 'roundIndex', 0,
    'categoryIds', '["*"]'::jsonb,
    'scoredRoundIds', '[]'::jsonb, 'completedRoundIds', '[]'::jsonb, 'roundHistory', '[]'::jsonb,
    'queue', jsonb_build_array(
      jsonb_build_object('roundId','run:0','roundIndex','x','topicId','roster:a','topicSnapshot', jsonb_build_object('id','a','name','A','custom',false)),
      jsonb_build_object('roundId','run:1','roundIndex',1,'topicId','roster:b','topicSnapshot', jsonb_build_object('id','b','name','B','custom',false)),
      jsonb_build_object('roundId','run:2','roundIndex',2,'topicId','roster:c','topicSnapshot', jsonb_build_object('id','c','name','C','custom',false))
    )
  ),
  'run'
);
-- Attendu : TNS_ROUND_INDEX_DISCONTINUITY

-- S4) id mauvais type (nombre)
-- (construire série valide puis remplacer id par 123)
-- Attendu : TNS_SNAPSHOT_ID_TYPE

-- S5) name mauvais type (bool)
-- Attendu : TNS_SNAPSHOT_NAME_TYPE

-- S6) custom chaîne arbitraire
-- Attendu : TNS_CUSTOM_FLAG_INVALID

-- S7) custom entier
-- Attendu : TNS_CUSTOM_FLAG_INVALID

-- S8) custom objet
-- Attendu : TNS_CUSTOM_FLAG_INVALID

-- S9) ledger entier
-- Attendu : TNS_LEDGER_INVALID_ENTRY

-- S10) ledger objet
-- Attendu : TNS_LEDGER_INVALID_ENTRY

-- S11) categoryIds invalide (star mixte)
select public.tiernight_series_validate_series_shape(
  '{"version":1,"phase":"ranking","roundCount":3,"roundIndex":0,"categoryIds":["*","survival"],"queue":[]}'::jsonb,
  'run'
);
-- Attendu : TNS_INVALID_CATEGORY_IDS

-- S12) custom:null
-- Attendu : TNS_CUSTOM_FLAG_INVALID
