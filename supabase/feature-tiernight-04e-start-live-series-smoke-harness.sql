-- =============================================================================
-- FEATURE-TIERNIGHT-04E — DEPRECATED monolith smoke harness (pointer stub)
-- =============================================================================
--
-- Ce fichier n'est PLUS le harness exécutable.
-- NE PAS l'exécuter comme SQL de smoke (ou notice-only ci-dessous).
--
-- Remplacé par deux fichiers à enchaîner :
--
--   1) A1 bootstrap (helpers + ctx + spawn fixture + R0 + preuve) :
--        supabase/feature-tiernight-04e-start-live-series-smoke-bootstrap.sql
--      → attendre SUCCESS ("TN04EA A1 READY")
--
--   2) A2 tests (R1–R18 + cleanup) :
--        supabase/feature-tiernight-04e-start-live-series-smoke-tests.sql
--
-- Cleanup d'urgence :
--        supabase/feature-tiernight-04e-start-live-series-smoke-cleanup.sql
--
-- Migration A (ne pas mélanger) :
--        supabase/feature-tiernight-04e-start-live-series.sql
-- =============================================================================

do $$
begin
  raise notice
    'TN04EA DEPRECATED monolith stub — execute A1 smoke-bootstrap.sql then A2 smoke-tests.sql';
end $$;
