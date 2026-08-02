-- BUG-TRUTHMETER-01B — Harness rollback (scoring / idempotence / stale)
-- Exécuter dans SQL Editor après migration 01B. Tout est sous BEGIN…ROLLBACK.
-- Ne prouve PAS la concurrence multi-session (voir truthmeter-01b-concurrency-runbook.sql).

BEGIN;

DO $$
DECLARE
  v_host uuid := auth.uid();
  v_guest uuid := 'cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid;
  v_guest2 uuid := 'dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid;
  v_lobby uuid := gen_random_uuid();
  v_run uuid := gen_random_uuid();
  v_row public.game_sessions;
  v_tm jsonb;
  v_scores_before jsonb;
  v_scores_after jsonb;
BEGIN
  IF v_host IS NULL THEN
    RAISE EXCEPTION 'auth.uid() null';
  END IF;

  INSERT INTO public.lobbies (id, code, host_id, status, game_id)
  VALUES (v_lobby, 'TMROL' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 5), v_host, 'playing', 'truthmeter');

  INSERT INTO public.lobby_members (lobby_id, user_id, display_name, is_host, last_seen_at)
  VALUES
    (v_lobby, v_host, 'Host', true, now()),
    (v_lobby, v_guest, 'Guest', false, now()),
    (v_lobby, v_guest2, 'Guest2', false, now());

  -- Affirmation Host, estimate 50 ; votes Guest=40, Guest2=60 → avg=50, gap=0 → consensus auteur +10
  -- Closest: both dist 10 <= 12 → +15 chacun
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
        'affirmation', jsonb_build_object('text', 'Aff', 'author', 'Host'),
        'authorEstimate', 50,
        'votes', jsonb_build_object(
          v_guest::text, 40,
          v_guest2::text, 60
        ),
        'matchScores', '{}'::jsonb
      )
    )
  );

  -- 1) Reveal nominal
  v_row := public.reveal_truth_meter_round(v_lobby, v_run, 0);
  v_tm := v_row.state -> 'truthMeter';
  IF v_tm ->> 'phase' IS DISTINCT FROM 'reveal' THEN
    RAISE EXCEPTION 'phase attendue reveal, got %', v_tm ->> 'phase';
  END IF;
  IF coalesce((v_tm ->> 'roundScored')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'roundScored attendu';
  END IF;
  IF (v_tm #>> '{lastRound,groupAvg}')::int IS DISTINCT FROM 50 THEN
    RAISE EXCEPTION 'groupAvg attendu 50';
  END IF;
  IF (v_tm #>> '{lastRound,authorPoints}')::int IS DISTINCT FROM 10 THEN
    RAISE EXCEPTION 'author consensus +10 attendu';
  END IF;
  IF (v_tm #>> '{lastRound,voterPoints}')::int IS DISTINCT FROM 15 THEN
    RAISE EXCEPTION 'voter close +15 attendu';
  END IF;
  v_scores_before := v_tm -> 'matchScores';

  -- 2) Idempotence
  v_row := public.reveal_truth_meter_round(v_lobby, v_run, 0);
  v_scores_after := v_row.state -> 'truthMeter' -> 'matchScores';
  IF v_scores_after IS DISTINCT FROM v_scores_before THEN
    RAISE EXCEPTION 'idempotence cassée: matchScores mutés';
  END IF;

  -- 3) Stale run
  BEGIN
    PERFORM public.reveal_truth_meter_round(v_lobby, gen_random_uuid(), 0);
    RAISE EXCEPTION 'aurait dû lever TRUTHMETER_STALE_RUN';
  EXCEPTION
    WHEN others THEN
      IF SQLERRM NOT LIKE '%TRUTHMETER_STALE_RUN%' THEN
        RAISE;
      END IF;
  END;

  -- 4) Stale round
  BEGIN
    PERFORM public.reveal_truth_meter_round(v_lobby, v_run, 9);
    RAISE EXCEPTION 'aurait dû lever TRUTHMETER_STALE_ROUND';
  EXCEPTION
    WHEN others THEN
      IF SQLERRM NOT LIKE '%TRUTHMETER_STALE_ROUND%' THEN
        RAISE;
      END IF;
  END;

  -- 5) Vote post-reveal
  BEGIN
    PERFORM public.submit_truth_meter_vote(v_lobby, v_run, 0, 99);
    RAISE EXCEPTION 'aurait dû lever TRUTHMETER_INVALID_PHASE';
  EXCEPTION
    WHEN others THEN
      IF SQLERRM NOT LIKE '%TRUTHMETER_INVALID_PHASE%' THEN
        RAISE;
      END IF;
  END;

  -- 6) Force reveal aucun vote (nouvelle manche simulée)
  UPDATE public.game_sessions
  SET state = jsonb_set(
    state,
    '{truthMeter}',
    jsonb_build_object(
      'runId', v_run::text,
      'lobbyStarted', true,
      'roundIdx', 1,
      'phase', 'voting',
      'roundScored', false,
      'affirmation', jsonb_build_object('text', 'Aff2', 'author', 'Host'),
      'authorEstimate', 90,
      'votes', '{}'::jsonb,
      'matchScores', coalesce(state -> 'truthMeter' -> 'matchScores', '{}'::jsonb)
    ),
    true
  )
  WHERE lobby_id = v_lobby;

  v_row := public.reveal_truth_meter_round(v_lobby, v_run, 1);
  v_tm := v_row.state -> 'truthMeter';
  IF v_tm ->> 'phase' IS DISTINCT FROM 'reveal' THEN
    RAISE EXCEPTION 'reveal sans votes: phase reveal attendue';
  END IF;
  -- gap = |90-0|=90 → bluff auteur +15
  IF (v_tm #>> '{lastRound,authorPoints}')::int IS DISTINCT FROM 15 THEN
    RAISE EXCEPTION 'bluff sans votes: authorPoints 15 attendu, got %', v_tm #>> '{lastRound,authorPoints}';
  END IF;

  RAISE NOTICE 'truthmeter-01b-reveal-rollback OK lobby=%', v_lobby;
END;
$$;

ROLLBACK;
