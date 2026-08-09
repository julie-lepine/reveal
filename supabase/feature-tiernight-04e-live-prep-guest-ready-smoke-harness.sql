-- =============================================================================
-- FEATURE-TIERNIGHT-04E (migration B) — DEPRECATED monolith smoke harness
-- =============================================================================
--
-- Ce fichier n'est PLUS le harness exécutable.
-- NE PAS l'exécuter comme SQL de smoke (ou notice-only ci-dessous).
--
-- Remplacé par deux fichiers à enchaîner :
--
--   1) B1 bootstrap (helpers + ctx + J ACL + spawn fixture + preuve) :
--        supabase/feature-tiernight-04e-live-prep-guest-ready-smoke-bootstrap.sql
--      → attendre SUCCESS ("TN04EB B1 READY")
--
--   2) B2 tests (A, M, C, N, O, H, transition, B, L, D, G, I, K cleanup) :
--        supabase/feature-tiernight-04e-live-prep-guest-ready-smoke-tests.sql
--
-- Cleanup d'urgence :
--        supabase/feature-tiernight-04e-live-prep-guest-ready-smoke-cleanup.sql
--
-- Migration B (ne pas mélanger / ne pas re-exécuter) :
--        supabase/feature-tiernight-04e-live-prep-guest-ready.sql
-- =============================================================================

do $$
begin
  raise notice
    'TN04EB DEPRECATED monolith stub — execute B1 smoke-bootstrap.sql then B2 smoke-tests.sql';
end $$;
