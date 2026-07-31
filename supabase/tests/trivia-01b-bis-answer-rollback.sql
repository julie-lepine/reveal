-- BUG-TRIVIA-01B-bis — Tests transactionnels submit_trivia_answer (ROLLBACK)
-- Prérequis :
--   1) Migrations schema + game-sessions + i08 + 01A + 01B + 01B-bis appliquées
--   2) Exécuter dans le SQL Editor Supabase avec auth.uid() non null
--
-- Concurrence réelle (deux sessions) : voir runbook 01B — même FOR UPDATE sur game_sessions.

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.trivia_01b_bis_assert(p_cond boolean, p_msg text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT p_cond THEN
    RAISE EXCEPTION 'TRIVIA_01B_BIS_ASSERT: %', p_msg;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.trivia_01b_bis_expect_err(
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
    RAISE EXCEPTION 'TRIVIA_01B_BIS_ASSERT: expected error containing %', p_substr;
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%' || p_substr || '%' THEN
        RAISE EXCEPTION 'TRIVIA_01B_BIS_ASSERT: got [%] expected [%]', SQLERRM, p_substr;
      END IF;
  END;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.trivia_01b_bis_set_uid(p_uid uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', p_uid::text)::text,
    true
  );
END;
$$;

DO $$
DECLARE
  v_host uuid := auth.uid();
  v_guest uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid;
  v_lobby_id uuid := gen_random_uuid();
  v_run_id uuid := gen_random_uuid();
  v_other_run uuid := gen_random_uuid();
  v_deck jsonb;
  v_row public.game_sessions;
  v_trivia jsonb;
  v_answers jsonb;
  v_last jsonb;
  v_scores jsonb;
BEGIN
  IF v_host IS NULL THEN
    RAISE NOTICE 'SKIP integration: auth.uid() null';
    RETURN;
  END IF;

  v_deck := jsonb_build_array(
    jsonb_build_object('r', 'q1', 'a', jsonb_build_array(0, 1, 2, 3), 'k', 1)
  );

  INSERT INTO public.lobbies (id, code, host_id, status, game_id)
  VALUES (v_lobby_id, 'T01BB' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 7), v_host, 'playing', 'trivia');

  INSERT INTO public.lobby_members (lobby_id, user_id, display_name, is_host, last_seen_at)
  VALUES
    (v_lobby_id, v_host, 'HostTest', true, now()),
    (v_lobby_id, v_guest, 'GuestTest', false, now());

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
        'answers', '{}'::jsonb,
        'matchScores', '{}'::jsonb,
        'questionPlayerUids', jsonb_build_array(v_host::text, v_guest::text)
      )
    )
  );

  -- -------------------------------------------------------------------------
  -- Ordre guest puis host : deux réponses, pas encore reveal
  -- -------------------------------------------------------------------------
  PERFORM pg_temp.trivia_01b_bis_set_uid(v_guest);
  v_row := public.submit_trivia_answer(v_lobby_id, v_run_id, 0, 0, 100);
  v_trivia := v_row.state -> 'trivia';
  PERFORM pg_temp.trivia_01b_bis_assert(v_trivia ->> 'phase' = 'question', 'guest answer: phase question');
  PERFORM pg_temp.trivia_01b_bis_assert(
    public.trivia_answer_has_valid_index(v_trivia -> 'answers' -> v_guest::text),
    'guest answer enregistrée'
  );

  PERFORM pg_temp.trivia_01b_bis_set_uid(v_host);
  v_row := public.submit_trivia_answer(v_lobby_id, v_run_id, 0, 1, 200);
  v_trivia := v_row.state -> 'trivia';
  v_answers := v_trivia -> 'answers';
  PERFORM pg_temp.trivia_01b_bis_assert(v_trivia ->> 'phase' = 'reveal', 'host last answer: auto-reveal');
  PERFORM pg_temp.trivia_01b_bis_assert((v_trivia ->> 'questionScored')::boolean IS TRUE, 'questionScored true');
  PERFORM pg_temp.trivia_01b_bis_assert(
    public.trivia_answer_has_valid_index(v_answers -> v_guest::text),
    'guest answer conservée après host'
  );
  PERFORM pg_temp.trivia_01b_bis_assert(
    public.trivia_answer_has_valid_index(v_answers -> v_host::text),
    'host answer enregistrée'
  );

  v_last := v_trivia -> 'lastRound';
  PERFORM pg_temp.trivia_01b_bis_assert(
    v_last -> 'correctPlayers' @> to_jsonb(v_host::text),
    'host correct dans correctPlayers (k=1)'
  );

  -- -------------------------------------------------------------------------
  -- Reset manche : ordre host puis guest (même résultat métier)
  -- -------------------------------------------------------------------------
  UPDATE public.game_sessions gs
  SET state = jsonb_set(
    gs.state,
    '{trivia}',
    jsonb_build_object(
      'runId', v_run_id::text,
      'lobbyStarted', true,
      'questionIdx', 0,
      'phase', 'question',
      'questionScored', false,
      'deck', v_deck,
      'answers', '{}'::jsonb,
      'matchScores', v_trivia -> 'matchScores',
      'questionPlayerUids', jsonb_build_array(v_host::text, v_guest::text)
    ),
    true
  )
  WHERE gs.lobby_id = v_lobby_id;

  PERFORM pg_temp.trivia_01b_bis_set_uid(v_host);
  v_row := public.submit_trivia_answer(v_lobby_id, v_run_id, 0, 1, 50);
  PERFORM pg_temp.trivia_01b_bis_assert(
    (v_row.state -> 'trivia' ->> 'phase') = 'question',
    'host first: pas reveal'
  );

  PERFORM pg_temp.trivia_01b_bis_set_uid(v_guest);
  v_row := public.submit_trivia_answer(v_lobby_id, v_run_id, 0, 1, 150);
  v_answers := v_row.state -> 'trivia' -> 'answers';
  PERFORM pg_temp.trivia_01b_bis_assert(
    (v_row.state -> 'trivia' ->> 'phase') = 'reveal',
    'guest last: auto-reveal'
  );
  PERFORM pg_temp.trivia_01b_bis_assert(
    public.trivia_answer_has_valid_index(v_answers -> v_host::text)
    AND public.trivia_answer_has_valid_index(v_answers -> v_guest::text),
    'ordre inversé: deux UID présents'
  );

  -- -------------------------------------------------------------------------
  -- Idempotence : même réponse deux fois (answeredAt inchangé)
  -- -------------------------------------------------------------------------
  PERFORM pg_temp.trivia_01b_bis_set_uid(v_guest);
  v_row := public.submit_trivia_answer(v_lobby_id, v_run_id, 0, 1, 999);
  PERFORM pg_temp.trivia_01b_bis_assert(
    (v_row.state -> 'trivia' -> 'answers' -> v_guest::text ->> 'answeredAt')::bigint = 150,
    'idempotent: answeredAt inchangé'
  );
  PERFORM pg_temp.trivia_01b_bis_assert(
    (v_row.state -> 'trivia' -> 'matchScores' ->> v_guest::text)::int = 15,
    'idempotent: pas de double score'
  );

  -- -------------------------------------------------------------------------
  -- Réponse après reveal : idempotent si même index
  -- -------------------------------------------------------------------------
  v_row := public.submit_trivia_answer(v_lobby_id, v_run_id, 0, 1, 150);
  PERFORM pg_temp.trivia_01b_bis_assert(
    (v_row.state -> 'trivia' ->> 'phase') = 'reveal',
    'post-reveal idempotent row'
  );

  PERFORM pg_temp.trivia_01b_bis_expect_err(
    'public.submit_trivia_answer(uuid,uuid,int,int,bigint)'::regprocedure,
    format('%L, %L, 0, 0, 200', v_lobby_id, v_run_id),
    'TRIVIA_INVALID_PHASE'
  );

  -- -------------------------------------------------------------------------
  -- Stale run / question
  -- -------------------------------------------------------------------------
  PERFORM pg_temp.trivia_01b_bis_expect_err(
    'public.submit_trivia_answer(uuid,uuid,int,int,bigint)'::regprocedure,
    format('%L, %L, 0, 1, 100', v_lobby_id, v_other_run),
    'TRIVIA_STALE_RUN'
  );

  PERFORM pg_temp.trivia_01b_bis_expect_err(
    'public.submit_trivia_answer(uuid,uuid,int,int,bigint)'::regprocedure,
    format('%L, %L, 1, 1, 100', v_lobby_id, v_run_id),
    'TRIVIA_STALE_QUESTION'
  );

  -- -------------------------------------------------------------------------
  -- Force reveal avec réponse manquante (reveal_trivia_round)
  -- -------------------------------------------------------------------------
  UPDATE public.game_sessions gs
  SET state = jsonb_set(
    gs.state,
    '{trivia}',
    jsonb_build_object(
      'runId', v_other_run::text,
      'lobbyStarted', true,
      'questionIdx', 0,
      'phase', 'question',
      'questionScored', false,
      'deck', v_deck,
      'answers', jsonb_build_object(
        v_host::text, jsonb_build_object('answerIndex', 1, 'answeredAt', 100)
      ),
      'matchScores', '{}'::jsonb,
      'questionPlayerUids', jsonb_build_array(v_host::text, v_guest::text)
    ),
    true
  )
  WHERE gs.lobby_id = v_lobby_id;

  PERFORM pg_temp.trivia_01b_bis_set_uid(v_host);
  v_row := public.reveal_trivia_round(v_lobby_id, v_other_run, 0);
  v_trivia := v_row.state -> 'trivia';
  PERFORM pg_temp.trivia_01b_bis_assert(v_trivia ->> 'phase' = 'reveal', 'force reveal phase');
  PERFORM pg_temp.trivia_01b_bis_assert(
    public.trivia_answer_has_valid_index(v_trivia -> 'answers' -> v_host::text),
    'force reveal: réponse hôte conservée'
  );
  PERFORM pg_temp.trivia_01b_bis_assert(
    NOT (v_trivia -> 'answers' ? v_guest::text),
    'force reveal: absent non inventé'
  );
  PERFORM pg_temp.trivia_01b_bis_assert(
    (v_trivia -> 'matchScores' ->> v_host::text)::int = 15,
    'force reveal: score hôte seul'
  );

  RAISE NOTICE 'TRIVIA-01B-bis SQL rollback tests OK';
END;
$$;

ROLLBACK;
