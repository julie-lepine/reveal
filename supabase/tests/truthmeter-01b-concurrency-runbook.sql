-- BUG-TRUTHMETER-01B — Runbook concurrence vote ↔ reveal (manuel, 2 sessions SQL)
-- Prérequis : game-sessions-i08-arch03.sql + game-sessions-truthmeter-01b-reveal-round.sql
-- Ce fichier N'EST PAS exécuté par `npm test`. Preuves transactionnelles FOR UPDATE.
--
-- =============================================================================
-- 0) Smoke déploiement
-- =============================================================================
--
-- SELECT
--   p.proname,
--   pg_get_function_identity_arguments(p.oid) AS args,
--   pg_get_function_result(p.oid) AS result,
--   has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_can_exec
-- FROM pg_proc p
-- JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE n.nspname = 'public'
--   AND p.proname IN (
--     'reveal_truth_meter_round',
--     'submit_truth_meter_vote',
--     'truth_meter_apply_reveal_scoring'
--   );
--
-- Attendu :
--   reveal_truth_meter_round(uuid, uuid, integer) → game_sessions · EXECUTE authenticated
--   submit_truth_meter_vote(uuid, uuid, integer, numeric) → game_sessions
--   truth_meter_apply_reveal_scoring(uuid, jsonb) → jsonb
--
-- =============================================================================
-- Setup (ROLLBACK)
-- =============================================================================

BEGIN;

DO $$
DECLARE
  v_host uuid := auth.uid();
  v_guest uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid;
  v_lobby uuid := gen_random_uuid();
  v_run uuid := gen_random_uuid();
BEGIN
  IF v_host IS NULL THEN
    RAISE EXCEPTION 'auth.uid() null — authentifier la session SQL Editor';
  END IF;

  INSERT INTO public.lobbies (id, code, host_id, status, game_id)
  VALUES (v_lobby, 'TM01B' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6), v_host, 'playing', 'truthmeter');

  INSERT INTO public.lobby_members (lobby_id, user_id, display_name, is_host, last_seen_at)
  VALUES
    (v_lobby, v_host, 'Host', true, now()),
    (v_lobby, v_guest, 'Guest', false, now());

  INSERT INTO public.game_sessions (lobby_id, game_id, screen, host_id, state)
  VALUES (
    v_lobby, 'truthmeter', 'truthmeter', v_host,
    jsonb_build_object(
      'truthMeter', jsonb_build_object(
        'runId', v_run::text,
        'lobbyStarted', true,
        'roundIdx', 0,
        'phase', 'voting',
        'roundScored', false,
        'affirmation', jsonb_build_object('text', 'Test', 'author', 'Host'),
        'authorEstimate', 80,
        'votes', jsonb_build_object(),
        'matchScores', '{}'::jsonb,
        'authorOrder', jsonb_build_array('Host', 'Guest')
      )
    )
  );

  RAISE NOTICE 'SETUP lobby=% run=% host=% guest=%', v_lobby, v_run, v_host, v_guest;
END;
$$;

ROLLBACK;

-- =============================================================================
-- Cas A — vote commit AVANT reveal
-- =============================================================================
-- Session Guest :
--   SELECT public.submit_truth_meter_vote(<lobby>, <run>, 0, 70);
-- Session Host :
--   SELECT public.reveal_truth_meter_round(<lobby>, <run>, 0);
-- Vérif : votes[guest]=70 inclus dans scoring · phase=reveal · roundScored=true · 1 seule transition
--
-- =============================================================================
-- Cas B — reveal AVANT vote
-- =============================================================================
-- Session Host :
--   SELECT public.reveal_truth_meter_round(<lobby>, <run>, 0);
-- Session Guest :
--   SELECT public.submit_truth_meter_vote(<lobby>, <run>, 0, 70);
-- Attendu : exception TRUTHMETER_INVALID_PHASE · scores inchangés
--
-- =============================================================================
-- Cas C — concurrence réelle (2 sessions, même instant)
-- =============================================================================
-- Session A (guest) : BEGIN; SELECT … FOR UPDATE via submit_truth_meter_vote; — laisser ouvert
-- Session B (host) : BEGIN; SELECT reveal_truth_meter_round …; — bloque jusqu'à commit A
-- Puis COMMIT A puis B (ou inverse) :
--   • soit vote compté puis reveal
--   • soit reveal gagne et vote → TRUTHMETER_INVALID_PHASE
--   • jamais vote persisté avant scoring mais absent du résultat
--   • jamais double scoring (vérifier matchScores / lastRound.deltas une seule fois)
--
-- =============================================================================
-- Double force reveal / auto+force
-- =============================================================================
-- 1) Deux reveal_truth_meter_round concurrents → second idempotent, deltas inchangés
-- 2) Dernier submit_truth_meter_vote (auto-reveal) + reveal_truth_meter_round → un seul scoring
--
-- =============================================================================
-- Retry timeout
-- =============================================================================
-- Appeler reveal deux fois après succès → même état, pas de double points
--
-- =============================================================================
-- Force reveal votes manquants / aucun vote / égalité
-- =============================================================================
-- votes = {} → groupAvg=0, auteur scorés vs 0, lastRound peut être null si aucun delta
-- 2 votants même distance → tous reçoivent pts ; mindReader = uid ASC
--
-- Mauvais runId / roundIdx / non-hôte → TRUTHMETER_STALE_* / réservé hôte
