-- =============================================================================
-- FEATURE-TIERNIGHT-04C — DEPRECATED monolith smoke harness (pointer stub)
-- =============================================================================
--
-- Ce fichier n'est PLUS le harness exécutable.
-- NE PAS l'exécuter comme SQL de smoke (ou notice-only ci-dessous).
--
-- Remplacé par deux fichiers à enchaîner :
--
--   1) B1 bootstrap (helpers + ctx + R0/R1 + spawn) :
--        supabase/feature-tiernight-04c-custom-live-tier-lists-smoke-bootstrap.sql
--      → attendre SUCCESS
--
--   2) B2 tests (C1–C25 + cleanup) :
--        supabase/feature-tiernight-04c-custom-live-tier-lists-smoke-tests.sql
--
-- Cleanup d'urgence :
--        supabase/feature-tiernight-04c-custom-live-tier-lists-smoke-cleanup.sql
--
-- Migration A (ne pas mélanger) :
--        supabase/feature-tiernight-04c-custom-live-tier-lists.sql
-- =============================================================================

do $$
begin
  raise notice
    'TN04C DEPRECATED monolith stub — execute B1 smoke-bootstrap.sql then B2 smoke-tests.sql';
end $$;
