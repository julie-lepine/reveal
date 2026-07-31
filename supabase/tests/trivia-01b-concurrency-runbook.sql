-- BUG-TRIVIA-01B — Runbook concurrence answer ↔ reveal (manuel, 2 sessions SQL)
-- Prérequis : migrations 01A + 01B + 01B-bis appliquées.
-- Ce fichier N'EST PAS exécuté par `npm test`. Il documente des preuves transactionnelles
-- réelles (FOR UPDATE), non reproductibles via mocks JS.
--
-- ============================================================================ : démontrer les invariants A / B / C du ticket 01B.
--
-- =============================================================================
-- 0) Smoke déploiement (lecture seule) — une session SQL Editor authentifiée
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
--   AND p.proname IN ('reveal_trivia_round', 'submit_trivia_answer', 'trivia_apply_reveal_scoring');
--
-- Attendu :
--   reveal_trivia_round(uuid, uuid, integer) → game_sessions · EXECUTE authenticated
--   submit_trivia_answer(uuid, uuid, integer, integer, bigint) → game_sessions
--   trivia_apply_reveal_scoring(jsonb, integer) → jsonb
--
-- =============================================================================
-- Setup commun (session Setup) — ROLLBACK à la fin
-- =============================================================================

BEGIN;

-- Remplacer par auth.uid() réel ou set_config JWT claims.
-- SELECT set_config('request.jwt.claims', json_build_object('sub', '<host_uuid>')::text, true);

DO $$
DECLARE
  v_host uuid := auth.uid();
  v_guest uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid;
  v_lobby uuid := gen_random_uuid();
  v_run uuid := gen_random_uuid();
  v_deck jsonb := jsonb_build_array(
    jsonb_build_object('r', 'q1', 'a', jsonb_build_array(0, 1, 2, 3), 'k', 1)
  );
BEGIN
  IF v_host IS NULL THEN
    RAISE EXCEPTION 'auth.uid() null — authentifier la session SQL Editor';
  END IF;

  INSERT INTO public.lobbies (id, code, host_id, status, game_id)
  VALUES (v_lobby, 'T01BC' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6), v_host, 'playing', 'trivia');

  INSERT INTO public.lobby_members (lobby_id, user_id, display_name, is_host, last_seen_at)
  VALUES
    (v_lobby, v_host, 'Host', true, now()),
    (v_lobby, v_guest, 'Guest', false, now());

  INSERT INTO public.game_sessions (lobby_id, game_id, screen, host_id, state)
  VALUES (
    v_lobby, 'trivia', 'trivia', v_host,
    jsonb_build_object(
      'trivia', jsonb_build_object(
        'runId', v_run::text,
        'lobbyStarted', true,
        'questionIdx', 0,
        'phase', 'question',
        'questionScored', false,
        'deck', v_deck,
        'questionPlayerUids', jsonb_build_array(v_host::text, v_guest::text),
        'answers', jsonb_build_object(
          v_host::text, jsonb_build_object('answerIndex', 1, 'answeredAt', 100)
        ),
        'matchScores', '{}'::jsonb
      )
    )
  );

  RAISE NOTICE 'SETUP lobby=% run=% host=% guest=%', v_lobby, v_run, v_host, v_guest;
END;
$$;

-- Noter lobby_id / run_id depuis les NOTICE, puis ROLLBACK du setup si besoin
-- ou garder la session ouverte pour les cas A/B (commit partiel hors prod).

ROLLBACK;

-- =============================================================================
-- Cas A — réponse commitée AVANT reveal (sérialisé)
-- =============================================================================
-- Session Guest (JWT guest) :
--   SELECT public.submit_trivia_answer(<lobby>, <run>, 0, 1, 200);
--   → answers[guest] présent, phase peut devenir reveal si tous ont répondu
--
-- Session Host :
--   SELECT public.reveal_trivia_round(<lobby>, <run>, 0);
--   → si déjà reveal (auto) : idempotent, scores inchangés
--   → sinon : score inclut guest
--
-- Vérif :
--   SELECT state->'trivia'->>'phase',
--          state->'trivia'->'answers',
--          state->'trivia'->'matchScores',
--          state->'trivia'->'lastRound'
--   FROM game_sessions WHERE lobby_id = <lobby>;
--
-- Attendu : guest dans answers scorés · phase reveal · un seul lastRound · pas de double +10

-- =============================================================================
-- Cas B — reveal GAGNE avant réponse
-- =============================================================================
-- Session Host :
--   SELECT public.reveal_trivia_round(<lobby>, <run>, 0);
--   → phase=reveal, questionScored=true
--
-- Session Guest :
--   SELECT public.submit_trivia_answer(<lobby>, <run>, 0, 1, 300);
--   → EXCEPTION TRIVIA_INVALID_PHASE
--
-- Vérif : answers sans guest (ou sans nouvelle clé) · matchScores inchangés vs post-reveal

-- =============================================================================
-- Cas C — concurrence réelle (deux sessions, pause sur FOR UPDATE)
-- =============================================================================
-- Préparer une manche en phase=question avec host déjà répondu, guest pas encore.
--
-- Session A (Host) — pause sous verrou :
--   BEGIN;
--   SELECT * FROM public.game_sessions WHERE lobby_id = <lobby> FOR UPDATE;
--   -- PAUSE ICI (ne pas COMMIT)
--
-- Session B (Guest) :
--   SELECT public.submit_trivia_answer(<lobby>, <run>, 0, 1, 250);
--   -- BLOQUÉ jusqu'au COMMIT de A (attend le même row lock)
--
-- Variante C1 — reveal gagne :
--   Session A (toujours dans BEGIN) :
--     SELECT public.reveal_trivia_round(<lobby>, <run>, 0);
--     COMMIT;
--   Session B se débloque → TRIVIA_INVALID_PHASE
--
-- Variante C2 — answer gagne :
--   Session A :
--     ROLLBACK;  -- libère sans reveal
--   Puis Session B obtient le lock, commit answer (+ auto-reveal si complet)
--   Puis Host :
--     SELECT public.reveal_trivia_round(...) → idempotent si déjà reveal
--
-- Variante C3 — double reveal :
--   Deux sessions Host/acting appellent reveal_trivia_round en parallèle.
--   Une seule applique trivia_apply_reveal_scoring ; l'autre retourne idempotent
--   (phase reveal + questionScored + lastRound) sans double crédit.
--
-- Invariant sérialisable : FOR UPDATE sur game_sessions.lobby_id dans les deux RPC.
-- Aucune lecture answers hors verrou pour le scoring.

-- =============================================================================
-- Cas E — erreur scoring → rollback transactionnel
-- =============================================================================
-- Forcer un deck invalide (k hors plage) sous phase=question, puis :
--   SELECT public.reveal_trivia_round(<lobby>, <run>, 0);
--   → TRIVIA_INVALID_STATE
-- Vérif : phase reste question · questionScored false · matchScores inchangés
-- Retenter après correction du deck → succès.
--
-- (Couvert aussi par supabase/tests/trivia-01b-reveal-round-rollback.sql)

-- =============================================================================
-- Contrat — force reveal et auto-reveal partagent trivia_apply_reveal_scoring
-- =============================================================================
-- Après 01B-bis :
--   reveal_trivia_round → trivia_apply_reveal_scoring
--   submit_trivia_answer (tous répondus) → trivia_apply_reveal_scoring
-- Même helper ⇒ mêmes points / fastest / deltas.
