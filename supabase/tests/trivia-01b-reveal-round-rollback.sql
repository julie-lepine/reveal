-- BUG-TRIVIA-01B — Tests transactionnels reveal_trivia_round (ROLLBACK)
-- Prérequis :
--   1) Migrations schema + game-sessions + i08 + 01A + 01B appliquées
--   2) Exécuter dans le SQL Editor Supabase avec une session authentifiée (auth.uid() non null)
--      ou : SELECT set_config('request.jwt.claims', json_build_object('sub','<host_uuid>')::text, true);
--
-- Runbook concurrence (deux sessions SQL, hors script) :
--   Session A : BEGIN; SELECT ... FROM game_sessions WHERE lobby_id = ? FOR UPDATE; (pause)
--   Session B : SELECT reveal_trivia_round(...);  → attend le lock A
--   Session A : COMMIT;
--   Session B : scoring sur answers figées au moment du lock B.

BEGIN;

-- ---------------------------------------------------------------------------
-- Helpers d'assertion (temporaires, rollback en fin de script)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION pg_temp.trivia_01b_assert(p_cond boolean, p_msg text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT p_cond THEN
    RAISE EXCEPTION 'TRIVIA_01B_ASSERT: %', p_msg;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.trivia_01b_expect_err(
  p_fn regprocedure,
  p_args text,
  p_substr text
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  BEGIN
    EXECUTE format('SELECT %s(%s)', p_fn, p_args);
    RAISE EXCEPTION 'TRIVIA_01B_ASSERT: expected error containing %', p_substr;
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%' || p_substr || '%' THEN
        RAISE EXCEPTION 'TRIVIA_01B_ASSERT: got [%] expected [%]', SQLERRM, p_substr;
      END IF;
  END;
END;
$$;

DO $$
DECLARE
  v_host uuid := auth.uid();
  v_lobby_id uuid := gen_random_uuid();
  v_run_id uuid := gen_random_uuid();
  v_other_run uuid := gen_random_uuid();
  v_row public.game_sessions;
  v_trivia jsonb;
  v_deck jsonb;
  v_scores jsonb;
  v_last jsonb;
  v_players jsonb;
BEGIN
  -- -------------------------------------------------------------------------
  -- Helpers deck / k (sans auth)
  -- -------------------------------------------------------------------------

  v_deck := jsonb_build_array(jsonb_build_object('r', 'q1', 'a', jsonb_build_array(0, 1, 2, 3), 'k', 1));
  PERFORM pg_temp.trivia_01b_assert(
    public.trivia_deck_correct_index(v_deck, 0) = 1,
    'k valide'
  );

  PERFORM pg_temp.trivia_01b_expect_err(
    'public.trivia_deck_correct_index(jsonb,int)'::regprocedure,
    format('%L, 0', jsonb_build_array(jsonb_build_object('r', 'q1', 'a', jsonb_build_array(0, 1, 2, 3)))),
    'TRIVIA_INVALID_STATE'
  );

  PERFORM pg_temp.trivia_01b_expect_err(
    'public.trivia_deck_correct_index(jsonb,int)'::regprocedure,
    format('%L, 0', jsonb_build_array(jsonb_build_object('r', 'q1', 'a', jsonb_build_array(0, 1, 2, 3), 'k', '1'))),
    'TRIVIA_INVALID_STATE'
  );

  PERFORM pg_temp.trivia_01b_expect_err(
    'public.trivia_deck_correct_index(jsonb,int)'::regprocedure,
    format('%L, 0', jsonb_build_array(jsonb_build_object('r', 'q1', 'a', jsonb_build_array(0, 1, 2, 3), 'k', 1.5))),
    'TRIVIA_INVALID_STATE'
  );

  PERFORM pg_temp.trivia_01b_expect_err(
    'public.trivia_deck_correct_index(jsonb,int)'::regprocedure,
    format('%L, 0', jsonb_build_array(jsonb_build_object('r', 'q1', 'a', jsonb_build_array(0, 1, 2, 3), 'k', -1))),
    'TRIVIA_INVALID_STATE'
  );

  PERFORM pg_temp.trivia_01b_expect_err(
    'public.trivia_deck_correct_index(jsonb,int)'::regprocedure,
    format('%L, 0', jsonb_build_array(jsonb_build_object('r', 'q1', 'a', jsonb_build_array(0, 1, 2, 3), 'k', 4))),
    'TRIVIA_INVALID_STATE'
  );

  PERFORM pg_temp.trivia_01b_expect_err(
    'public.trivia_deck_correct_index(jsonb,int)'::regprocedure,
    'NULL, 0',
    'TRIVIA_INVALID_STATE'
  );

  PERFORM pg_temp.trivia_01b_assert(
    public.trivia_answer_has_valid_index(jsonb_build_object('answerIndex', 1)),
    'answerIndex number entier valide'
  );
  PERFORM pg_temp.trivia_01b_assert(
    NOT public.trivia_answer_has_valid_index(jsonb_build_object('answerIndex', '01')),
    'answerIndex string rejeté'
  );
  PERFORM pg_temp.trivia_01b_assert(
    NOT public.trivia_answer_has_valid_index(jsonb_build_object('answerIndex', 1.5)),
    'answerIndex décimal rejeté'
  );
  PERFORM pg_temp.trivia_01b_assert(
    NOT public.trivia_answer_has_valid_index(jsonb_build_object('answerIndex', null)),
    'answerIndex null rejeté'
  );
  PERFORM pg_temp.trivia_01b_assert(
    NOT public.trivia_answer_has_valid_index(jsonb_build_object('answeredAt', 1)),
    'answerIndex absent rejeté'
  );

  -- -------------------------------------------------------------------------
  -- Intégration reveal_trivia_round (auth requis)
  -- -------------------------------------------------------------------------

  IF v_host IS NULL THEN
    RAISE NOTICE 'SKIP integration: auth.uid() null — exécuter avec JWT ou utilisateur authentifié';
    RETURN;
  END IF;

  INSERT INTO public.lobbies (id, code, host_id, status, game_id)
  VALUES (v_lobby_id, 'T01B' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8), v_host, 'playing', 'trivia');

  INSERT INTO public.lobby_members (lobby_id, user_id, display_name, is_host, last_seen_at)
  VALUES (v_lobby_id, v_host, 'HostTest', true, now());

  v_deck := jsonb_build_array(
    jsonb_build_object('r', 'q1', 'a', jsonb_build_array(0, 1, 2, 3), 'k', 1)
  );

  INSERT INTO public.game_sessions (lobby_id, game_id, screen, host_id, state)
  VALUES (
    v_lobby_id,
    'trivia',
    'trivia',
    v_host,
    jsonb_build_object(
      'trivia',
      jsonb_build_object(
        'runId', v_run_id::text,
        'lobbyStarted', true,
        'questionIdx', 0,
        'phase', 'question',
        'questionScored', false,
        'deck', v_deck,
        'answers', jsonb_build_object(
          'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', jsonb_build_object('answerIndex', 1, 'answeredAt', 200),
          'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', jsonb_build_object('answerIndex', 0, 'answeredAt', 100),
          'cccccccc-cccc-cccc-cccc-cccccccccccc', jsonb_build_object('answerIndex', 1, 'answeredAt', 150),
          'dddddddd-dddd-dddd-dddd-dddddddddddd', jsonb_build_object('answerIndex', '01', 'answeredAt', 50)
        ),
        'matchScores', jsonb_build_object('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 5)
      )
    )
  );

  -- Scoring nominal : 2 corrects, fastest cccc, string answer ignorée
  v_row := public.reveal_trivia_round(v_lobby_id, v_run_id, 0);
  v_trivia := v_row.state -> 'trivia';
  PERFORM pg_temp.trivia_01b_assert(v_trivia ->> 'phase' = 'reveal', 'phase reveal');
  PERFORM pg_temp.trivia_01b_assert((v_trivia ->> 'questionScored')::boolean IS TRUE, 'questionScored true');

  v_scores := v_trivia -> 'matchScores';
  PERFORM pg_temp.trivia_01b_assert((v_scores ->> 'cccccccc-cccc-cccc-cccc-cccccccccccc')::int = 15, 'fastest +15');
  PERFORM pg_temp.trivia_01b_assert((v_scores ->> 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')::int = 10, 'correct +10');
  PERFORM pg_temp.trivia_01b_assert((v_scores ->> 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')::int = 5, 'score antérieur conservé');
  PERFORM pg_temp.trivia_01b_assert(v_scores ? 'dddddddd-dddd-dddd-dddd-dddddddddddd' IS FALSE, 'string answer ignorée');

  v_last := v_trivia -> 'lastRound';
  v_players := v_last -> 'correctPlayers';
  PERFORM pg_temp.trivia_01b_assert(v_last ->> 'fastestPlayer' = 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'fastest uid');
  PERFORM pg_temp.trivia_01b_assert(
    v_players = jsonb_build_array(
      to_jsonb('cccccccc-cccc-cccc-cccc-cccccccccccc'::text),
      to_jsonb('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::text)
    ),
    'correctPlayers ordonnés answeredAt ASC uid ASC'
  );

  -- Idempotence : pas de double crédit
  v_row := public.reveal_trivia_round(v_lobby_id, v_run_id, 0);
  PERFORM pg_temp.trivia_01b_assert(
    (v_row.state -> 'trivia' -> 'matchScores' ->> 'cccccccc-cccc-cccc-cccc-cccccccccccc')::int = 15,
    'idempotent sans double score'
  );

  -- Tie-break même answeredAt
  UPDATE public.game_sessions gs
  SET state = jsonb_set(
    gs.state,
    '{trivia}',
    jsonb_build_object(
      'runId', gen_random_uuid()::text,
      'lobbyStarted', true,
      'questionIdx', 0,
      'phase', 'question',
      'questionScored', false,
      'deck', v_deck,
      'answers', jsonb_build_object(
        'zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz', jsonb_build_object('answerIndex', 1, 'answeredAt', 100),
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', jsonb_build_object('answerIndex', 1, 'answeredAt', 100)
      ),
      'matchScores', '{}'::jsonb
    ),
    true
  )
  WHERE gs.lobby_id = v_lobby_id
  RETURNING (state -> 'trivia' ->> 'runId')::uuid INTO v_other_run;

  v_row := public.reveal_trivia_round(v_lobby_id, v_other_run, 0);
  PERFORM pg_temp.trivia_01b_assert(
    v_row.state -> 'trivia' -> 'lastRound' ->> 'fastestPlayer' = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'tie-break uid ASC'
  );

  -- Stale run (phase reveal existante)
  PERFORM pg_temp.trivia_01b_expect_err(
    'public.reveal_trivia_round(uuid,uuid,int)'::regprocedure,
    format('%L, %L, 0', v_lobby_id, v_run_id),
    'TRIVIA_STALE_RUN'
  );

  -- Reset pour stale question
  UPDATE public.game_sessions gs
  SET state = jsonb_set(
    jsonb_set(gs.state, '{trivia,phase}', '"question"'),
    '{trivia,questionScored}', 'false'
  )
  WHERE gs.lobby_id = v_lobby_id;

  PERFORM pg_temp.trivia_01b_expect_err(
    'public.reveal_trivia_round(uuid,uuid,int)'::regprocedure,
    format('%L, %L, 1', v_lobby_id, v_other_run),
    'TRIVIA_STALE_QUESTION'
  );

  -- Gardes game_id
  UPDATE public.game_sessions SET game_id = 'consensus' WHERE lobby_id = v_lobby_id;
  PERFORM pg_temp.trivia_01b_expect_err(
    'public.reveal_trivia_round(uuid,uuid,int)'::regprocedure,
    format('%L, %L, 0', v_lobby_id, v_other_run),
    'TRIVIA_INVALID_PHASE'
  );

  UPDATE public.game_sessions SET game_id = 'trivia' WHERE lobby_id = v_lobby_id;

  -- lobbyStarted false
  UPDATE public.game_sessions gs
  SET state = jsonb_set(gs.state, '{trivia,lobbyStarted}', 'false')
  WHERE gs.lobby_id = v_lobby_id;
  PERFORM pg_temp.trivia_01b_expect_err(
    'public.reveal_trivia_round(uuid,uuid,int)'::regprocedure,
    format('%L, %L, 0', v_lobby_id, v_other_run),
    'TRIVIA_INVALID_PHASE'
  );

  -- deck k invalide
  UPDATE public.game_sessions gs
  SET state = jsonb_set(
    jsonb_set(gs.state, '{trivia,lobbyStarted}', 'true'),
    '{trivia,deck}',
    jsonb_build_array(jsonb_build_object('r', 'q1', 'a', jsonb_build_array(0, 1, 2, 3), 'k', 9))
  )
  WHERE gs.lobby_id = v_lobby_id;
  PERFORM pg_temp.trivia_01b_expect_err(
    'public.reveal_trivia_round(uuid,uuid,int)'::regprocedure,
    format('%L, %L, 0', v_lobby_id, v_other_run),
    'TRIVIA_INVALID_STATE'
  );

  RAISE NOTICE 'TRIVIA-01B SQL rollback tests OK';
END;
$$;

ROLLBACK;
