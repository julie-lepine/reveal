-- FEATURE-TIERNIGHT-SERIES-03 — smoke checklist (SUPERSÉDÉ pour le métier par 03A)
-- Après hardening : utiliser
--   supabase/feature-tiernight-series-03a-smoke-runbook.sql
--   scripts/tiernight-series-03a-smoke.mjs
--   supabase/feature-tiernight-series-03a-golden-helpers.sql
--
-- Rappel : le SQL Editor n'injecte PAS auth.uid() hôte par magie.

-- =============================================================================
-- A. Déploiement
-- =============================================================================

-- A1) Fonction déployée + SECURITY DEFINER
select p.proname, p.prosecdef, pg_get_function_identity_arguments(p.oid) as args
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'finalize_tiernight_series_round';
-- Attendu : 1 ligne, prosecdef = true, args uuid, text, text, int, text, boolean

-- A2) EXECUTE réservé à authenticated
select grantee, privilege_type
from information_schema.routine_privileges
where routine_schema = 'public'
  and routine_name = 'finalize_tiernight_series_round';
-- Attendu : EXECUTE pour authenticated ; pas pour PUBLIC / anon

-- A3) Helpers scoring non exposés en GRANT public
select proname
from pg_proc
where proname like 'tiernight_series_%';
-- Présents ; revoke all from public déjà dans la migration

-- =============================================================================
-- B. Préconditions d’erreur (session staging)
-- =============================================================================
-- Construire d’abord une session tiernight avec series valide (SERIES-01/02),
-- placements + finished complets, phase = ranking.

-- B1) Session inexistante / mauvais lobby → TNS_SESSION_NOT_FOUND
-- select public.finalize_tiernight_series_round(
--   '00000000-0000-0000-0000-000000000000'::uuid,
--   'run-x', 'run-x:0', 0, 'ranking', false
-- );

-- B2) Acteur non hôte / non acting → TNS_UNAUTHORIZED
-- (appeler avec un JWT membre non-hôte)

-- B3) Mono-thème sans series → TNS_NO_SERIES
-- select public.finalize_tiernight_series_round('<lobby>'::uuid, '<run>', '<run>:0', 0, 'ranking', false);

-- B4) Série version ≠ 1 → TNS_UNSUPPORTED_VERSION

-- B5) Mauvais runId → TNS_STALE_RUN

-- B6) Mauvais roundId → TNS_STALE_ROUND_ID

-- B7) Mauvais roundIndex → TNS_STALE_ROUND_INDEX

-- B8) Phase ≠ ranking (ex. between_rounds) sans ledger → TNS_INVALID_PHASE

-- B9) Placements incomplets sans force → TNS_PLACEMENTS_INCOMPLETE

-- B10) Force sans aucun finished → TNS_FORCE_NO_FINISHED

-- B11) Anonyme / pas de JWT → TNS_AUTH_REQUIRED

-- =============================================================================
-- C. Happy path + idempotence
-- =============================================================================

-- C1) Première finalisation (manche non finale)
-- select public.finalize_tiernight_series_round(
--   '<lobby_id>'::uuid, '<run_id>', '<run_id>:0', 0, 'ranking', false
-- );
-- Attendu : ok=true, applied=true, phase=between_rounds
-- Vérifs :
--   state->'tierNight'->'series'->>'phase' = 'between_rounds'
--   scoredRoundIds contient roundId
--   roundRecap / roundHistory présents
--   scores / gameScores.tiernight / playerStats.tierConsensusPoints incrémentés (clés UID)
--   stats.tierNightsPlayed NON incrémenté

-- C2) Retry identique → ALREADY_APPLIED (applied=false), scores inchangés
-- (ré-exécuter C1)

-- C3) Retry avec autre force / mêmes ids → toujours ALREADY_APPLIED (pas de re-score)

-- C4) Dernière manche → series_end + tierNightsPlayed +1 (soirée + playerStats roster)
--   screen = tiernight-end
--   eveningGamesRecorded.tiernight = true

-- C5) Retry dernière manche → ALREADY_APPLIED ; tierNightsPlayed non re-incrémenté

-- =============================================================================
-- D. Concurrence (deux sessions SQL / deux clients)
-- =============================================================================

-- D1) Deux appels simultanés même round :
--     un applied=true, l’autre ALREADY_APPLIED (FOR UPDATE sérialise)
-- D2) Hôte + acting host concurrents → un seul commit
-- D3) Ancienne manche (roundId stale) pendant active → exception, pas de mutation

-- =============================================================================
-- E. Force results
-- =============================================================================

-- E1) force=true avec ≥1 finished + placements partiels :
--     seuls les UIDs roster avec placement non vide scorés
--     phase between_rounds si pas dernière ; series_end si dernière
--     forced=true dans roundRecap

-- =============================================================================
-- F. Vérifications ledger / atomicité
-- =============================================================================

-- select
--   state->'tierNight'->'series'->'scoredRoundIds' as ledger,
--   state->'tierNight'->'series'->>'phase' as phase,
--   state->'tierNight'->'series'->'roundRecap' as recap,
--   state->'scores' as scores,
--   state->'stats'->>'tierNightsPlayed' as nights
-- from public.game_sessions
-- where lobby_id = '<lobby_id>';

-- Invariant : pas de score sans ledger ; pas de phase avancée sans roundRecap pour ce roundId.
