-- =============================================================================
-- FEATURE-TIERNIGHT-SERIES-05 — Smoke / checklist staging
-- =============================================================================
-- Smoke JWT recommandé (création 05B) :
--   node scripts/tiernight-series-05-smoke.mjs
--   Voir docs/FEATURE-TIERNIGHT-SERIES-05B.md (variables, dry-read, restore).
--
-- NE PAS coller ce fichier SQL entier d'un coup pour le métier.
-- Prérequis : SERIES-03A/03B + SERIES-05 appliqués.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- SECTION 0 — LECTURE SEULE (ACL)
-- -----------------------------------------------------------------------------

select p.proname, p.prosecdef,
       pg_get_function_identity_arguments(p.oid) as args
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'advance_tiernight_series_round';

select grantee, privilege_type
from information_schema.routine_privileges
where routine_schema = 'public'
  and routine_name = 'advance_tiernight_series_round';
-- Attendu : authenticated EXECUTE ; PAS anon

select
  has_function_privilege(
    'anon',
    'public.advance_tiernight_series_round(uuid,text,text,integer,text)',
    'EXECUTE'
  ) as anon_ok,
  has_function_privilege(
    'authenticated',
    'public.advance_tiernight_series_round(uuid,text,text,integer,text)',
    'EXECUTE'
  ) as auth_ok;
-- Attendu : anon_ok=false, auth_ok=true

-- -----------------------------------------------------------------------------
-- SECTION 1 — Matrice de tests SQL (manuel / staging isolé)
-- -----------------------------------------------------------------------------
-- Pour chaque cas : préparer lobby + game_sessions.state.tierNight.series
-- en between_rounds (après finalize) sauf indication contraire.
--
--  1. auth absente              → TNS_AUTH_REQUIRED
--  2. acteur non autorisé       → TNS_UNAUTHORIZED (guest)
--  3. session inexistante       → TNS_SESSION_NOT_FOUND
--  4. mauvais jeu               → TNS_WRONG_GAME
--  5. mono-thème (pas series)   → TNS_NO_SERIES
--  6. série invalide            → TNS_* shape
--  7. mauvais run               → TNS_STALE_RUN
--  8. mauvais round id          → TNS_ROUND_ID_MISMATCH / TNS_STALE_ROUND_ID
--  9. mauvais index             → TNS_STALE_ROUND_INDEX
-- 10. phase ranking (pas retry) → TNS_INVALID_PHASE
-- 11. phase series_end          → TNS_SERIES_ENDED
-- 12. round non scoré           → TNS_ROUND_NOT_SCORED
-- 13. round non completed       → TNS_ROUND_NOT_COMPLETED
-- 14. historique manquant       → TNS_HISTORY_MISSING_ROUND
-- 15. roundRecap incohérent     → TNS_ROUND_RECAP_MISMATCH
-- 16. dernière manche           → TNS_NO_NEXT_ROUND
-- 17. avance valide             → ok applied=true phase=ranking
-- 18. index +1                  → roundIndex = N+1
-- 19. topic suivant             → topicId = queue[N+1].topicId
-- 20. reset placements          → {}
-- 21. reset finished            → {}
-- 22. reset roundRecap          → null
-- 23. queue conservée           → equal before/after
-- 24. roster conservé           → equal
-- 25. items conservés           → equal
-- 26. scores inchangés          → equal scores/playerStats/gameScores/stats
-- 27. ledger inchangé           → scored/completed equal
-- 28. historique inchangé       → roundHistory equal
-- 29. retry identique           → ALREADY_ADVANCED applied=false index N+1
-- 29a. ranking N+1 sans completed → TNS_ROUND_NOT_COMPLETED (pas ALREADY_ADVANCED)
-- 29b. ranking N+1 sans history → TNS_HISTORY_MISSING_ROUND
-- 29c. ranking N+1 history×2    → TNS_HISTORY_AMBIGUOUS_ROUND
-- 29d. ranking N+1 screen between → TNS_SCREEN_MISMATCH
-- 29e. ranking N+1 topic faux   → TNS_TOPIC_MISMATCH
-- 29f. appel from N, serveur N+2 → TNS_INVALID_PHASE (jamais ALREADY_ADVANCED)
-- 30. double appel concurrent   → un applied, un ALREADY_ADVANCED ; jamais N+2
-- 31. hôte/AH concurrents       → idem
-- 32. ancien round stale        → TNS_STALE_ROUND_INDEX (sauf retry exact N→N+1)
--
-- Exemple succès (après finalize round 0) :
--   select public.advance_tiernight_series_round(
--     :lobby_id, :run_id, :run_id || ':0', 0, 'between_rounds'
--   );
-- -----------------------------------------------------------------------------
