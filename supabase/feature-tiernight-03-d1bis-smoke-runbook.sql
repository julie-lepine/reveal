-- =============================================================================
-- FEATURE-TIERNIGHT-03-D1-bis — RUNBOOK POSTGRES FINAL (index)
-- =============================================================================
-- Préchecks lecture seule : sections P1–P8 ci-dessous.
--
-- Prérequis SQL (ordre) :
--   … → 03A finalize → 05 advance
--   → feature-tiernight-03-d1bis-series-shape-canonical.sql  ★ dernier validateur
--   → feature-tiernight-03-d1bis-finalize-v-rec-scope-fix.sql  ★ fix 42P01 v_rec
--   → harness mutationnel
--
-- SMOKES MUTATIONNELS :
--   supabase/feature-tiernight-03-d1bis-smoke-harness.sql
--   HELPERS une fois, puis A–L.
--   Bloc K (R2–R5) est AUTONOME : spawn + asserts identité + inject + RPC.
--   Ne jamais coller seulement la fin de K sans spawn (faux TNS_STALE_RUN).
--   TNS_STALE_RUN est INTERDIT dans R si identité prouvée.
--
-- Fixtures : lobbies.code LIKE 'TNSD1B%' (≥2 auth.users staging).
-- Cleanup : section L du harness.
-- =============================================================================

-- ############################################################################
-- GROUPE P — PRÉCHECKS (lecture seule)
-- ############################################################################

-- P1 Shape signature
select p.proname, pg_get_function_identity_arguments(p.oid) as args, p.prosecdef
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'tiernight_series_validate_series_shape';
-- Attendu : (jsonb, text) · prosecdef = false

-- P2 Finalize signature
select p.proname, pg_get_function_identity_arguments(p.oid) as args, p.prosecdef, p.proconfig
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'finalize_tiernight_series_round';
-- Attendu : (uuid, text, text, integer, text, boolean) · prosecdef=true
--           proconfig contient search_path=pg_catalog, public

-- P3 Advance signature
select p.proname, pg_get_function_identity_arguments(p.oid) as args, p.prosecdef, p.proconfig
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'advance_tiernight_series_round';
-- Attendu : (uuid, text, text, integer, text) · prosecdef=true · même search_path

-- P4 Helper shape NON exécutable par authenticated
select has_function_privilege(
  'authenticated',
  'public.tiernight_series_validate_series_shape(jsonb, text)',
  'EXECUTE'
) as shape_auth_exec;
-- Attendu : false

-- P5 Finalize/advance exécutables authenticated ; pas anon
select
  has_function_privilege('anon', 'public.finalize_tiernight_series_round(uuid,text,text,integer,text,boolean)', 'EXECUTE') as fin_anon,
  has_function_privilege('authenticated', 'public.finalize_tiernight_series_round(uuid,text,text,integer,text,boolean)', 'EXECUTE') as fin_auth,
  has_function_privilege('anon', 'public.advance_tiernight_series_round(uuid,text,text,integer,text)', 'EXECUTE') as adv_anon,
  has_function_privilege('authenticated', 'public.advance_tiernight_series_round(uuid,text,text,integer,text)', 'EXECUTE') as adv_auth;
-- Attendu : false, true, false, true

-- P6 Commentaire D1-bis
select obj_description(
  'public.tiernight_series_validate_series_shape(jsonb, text)'::regprocedure,
  'pg_proc'
) as shape_comment;
-- Attendu : contient 'D1-bis' et 'sans round_result'

-- P7 round_result rejeté
select public.tiernight_series_validate_series_shape(
  jsonb_build_object(
    'version', 1,
    'phase', 'round_result',
    'roundCount', 3,
    'roundIndex', 0,
    'categoryIds', '["*"]'::jsonb,
    'queue', '[]'::jsonb,
    'scoredRoundIds', '[]'::jsonb,
    'completedRoundIds', '[]'::jsonb,
    'roundHistory', '[]'::jsonb
  ),
  'smoke-phase'
) as p7_retired;
-- Attendu : ok=false, code=TNS_UNKNOWN_PHASE (detail round_result)

-- P8 : count 8 + custom / id numérique → voir a1bis runbook ou harness

-- ############################################################################
-- MUTATIONNELS + CLEANUP → harness
-- ############################################################################
-- supabase/feature-tiernight-03-d1bis-smoke-harness.sql
--   A schéma · B cleanup · C–G finalize · H advance · I last · J custom
--   K R2–R5 AUTONOME · L cleanup + drop helpers

-- ############################################################################
-- §Z — CASE À COCHER STAGING (2026-08-06)
-- ############################################################################
-- [x] P1–P8 verts
-- [x] v_rec fix appliqué (sans rejouer 03A complet)
-- [x] D1-bis = dernière def validateur
-- [x] F1–F11
-- [x] A1–A10
-- [x] L1–L6
-- [x] C1–C5
-- [x] R2–R5 autonome (identité prouvée ; STALE_RUN interdit)
-- [ ] Cleanup final : 0 lobby TNSD1B% · 0 ctx · helpers droppés
--
-- Cleanup OK → D1-bis serveur validée. E / gate ON / QA terrain toujours séparés.
-- FEATURE-TIERNIGHT-03 non clôturée.
