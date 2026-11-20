-- =============================================================================
-- Tests — feature-acting-host-evening-scores.sql (AUDIT CLUTCH N°10)
-- =============================================================================
-- À exécuter sur une BRANCHE DE TEST Supabase, après la migration.
-- Un seul bloc DO : tout est créé puis annulé (rollback volontaire à la fin).
-- Résultat attendu : une erreur « TESTS_OK … (rollback volontaire) ».
-- Toute autre erreur = un test a échoué (le message dit lequel).
-- Rôle : postgres (SQL Editor / MCP), pour créer les fixtures auth.users.
-- =============================================================================

do $$
declare
  -- UID « acting » le plus petit : élu remplaçant par is_acting_host (tri UID asc).
  c_acting constant uuid := '00000000-0000-4000-8000-00000000a001';
  c_guest  constant uuid := '00000000-0000-4000-8000-00000000a002';
  c_host   constant uuid := '00000000-0000-4000-8000-00000000a003';
  v_lobby uuid;
  v_state jsonb;
  v_res jsonb;
begin
  -- ---------------------------------------------------------------------------
  -- A. Calcul pur
  -- ---------------------------------------------------------------------------
  v_res := public.evening_credit_from_match_scores(
    '{"scores":{"u1":10},"gameScores":{"clutch":{"u1":4}},"gameScoreOrder":["dilemma"]}'::jsonb,
    'clutch',
    '{"u1":4,"u2":0}'::jsonb,
    '{"u1":7,"u2":2,"u3":0}'::jsonb
  );
  if (v_res #>> '{scores,u1}')::numeric <> 13 then raise exception 'A1 scores.u1 % <> 13', v_res #>> '{scores,u1}'; end if;
  if (v_res #>> '{scores,u2}')::numeric <> 2 then raise exception 'A2 scores.u2 % <> 2', v_res #>> '{scores,u2}'; end if;
  if v_res #> '{scores,u3}' is not null then raise exception 'A3 hausse nulle créditée'; end if;
  if (v_res #>> '{gameScores,clutch,u1}')::numeric <> 7 then raise exception 'A4 gameScores.clutch.u1'; end if;
  if (v_res #>> '{gameScores,clutch,u2}')::numeric <> 2 then raise exception 'A5 gameScores.clutch.u2'; end if;
  if v_res -> 'gameScoreOrder' <> '["dilemma","clutch"]'::jsonb then raise exception 'A6 gameScoreOrder %', v_res -> 'gameScoreOrder'; end if;

  -- Baisse ou égalité : rien.
  v_res := public.evening_credit_from_match_scores(
    '{"scores":{"u1":10}}'::jsonb, 'clutch', '{"u1":5}'::jsonb, '{"u1":3}'::jsonb);
  if v_res <> '{"scores":{"u1":10}}'::jsonb then raise exception 'A7 baisse créditée: %', v_res; end if;

  -- Décimales, ancien score absent.
  v_res := public.evening_credit_from_match_scores('{}'::jsonb, 'speedvote', null, '{"u1":1.5}'::jsonb);
  if (v_res #>> '{scores,u1}')::numeric <> 1.5 then raise exception 'A8 décimales'; end if;

  -- Valeur non numérique ignorée.
  v_res := public.evening_credit_from_match_scores('{}'::jsonb, 'clutch', '{}'::jsonb, '{"u1":"x"}'::jsonb);
  if v_res <> '{}'::jsonb then raise exception 'A9 non numérique'; end if;

  -- ---------------------------------------------------------------------------
  -- B. Règle automatique sur game_sessions
  -- ---------------------------------------------------------------------------
  insert into auth.users (id, aud, role, email)
  values
    (c_acting, 'authenticated', 'authenticated', 'acting-evening-test@example.invalid'),
    (c_guest,  'authenticated', 'authenticated', 'guest-evening-test@example.invalid'),
    (c_host,   'authenticated', 'authenticated', 'host-evening-test@example.invalid');

  insert into public.lobbies (code, host_id, status)
  values ('EVTEST', c_host, 'playing')
  returning id into v_lobby;

  -- Hôte absent depuis 10 min ; les deux autres présents.
  insert into public.lobby_members (lobby_id, user_id, display_name, is_host, last_seen_at)
  values
    (v_lobby, c_host,   'Hôte',   true,  now() - interval '10 minutes'),
    (v_lobby, c_acting, 'Acting', false, now()),
    (v_lobby, c_guest,  'Invité', false, now());

  v_state := jsonb_build_object(
    'scores', jsonb_build_object(c_acting::text, 5, c_guest::text, 3),
    'gameScores', jsonb_build_object('clutch', jsonb_build_object(c_acting::text, 2)),
    'gameScoreOrder', '["clutch"]'::jsonb,
    'clutch', jsonb_build_object(
      'phase', 'active',
      'matchScores', jsonb_build_object(c_acting::text, 2, c_guest::text, 0)
    )
  );
  insert into public.game_sessions (lobby_id, game_id, screen, host_id, state)
  values (v_lobby, 'clutch', 'clutch', c_host, v_state);

  -- B1. Remplaçant (hôte absent) : la hausse est créditée.
  perform set_config('request.jwt.claims', json_build_object('sub', c_acting::text, 'role', 'authenticated')::text, true);
  if auth.uid() is distinct from c_acting then raise exception 'B0 JWT non appliqué'; end if;
  update public.game_sessions
  set state = jsonb_set(state, '{clutch,matchScores}',
    jsonb_build_object(c_acting::text, 5, c_guest::text, 1))
  where lobby_id = v_lobby;
  select state into v_state from public.game_sessions where lobby_id = v_lobby;
  if (v_state #>> array['scores', c_acting::text])::numeric <> 8 then raise exception 'B1 scores acting % <> 8', v_state #>> array['scores', c_acting::text]; end if;
  if (v_state #>> array['scores', c_guest::text])::numeric <> 4 then raise exception 'B1 scores guest % <> 4', v_state #>> array['scores', c_guest::text]; end if;
  if (v_state #>> array['gameScores', 'clutch', c_acting::text])::numeric <> 5 then raise exception 'B1 gameScores acting'; end if;

  -- B2. Même envoi relancé : pas de double comptage.
  update public.game_sessions
  set state = jsonb_set(state, '{clutch,matchScores}',
    jsonb_build_object(c_acting::text, 5, c_guest::text, 1))
  where lobby_id = v_lobby;
  select state into v_state from public.game_sessions where lobby_id = v_lobby;
  if (v_state #>> array['scores', c_acting::text])::numeric <> 8 then raise exception 'B2 double comptage'; end if;

  -- B3. Écriture qui ne touche pas matchScores : rien.
  update public.game_sessions set state = jsonb_set(state, '{clutch,phase}', '"reveal"') where lobby_id = v_lobby;
  select state into v_state from public.game_sessions where lobby_id = v_lobby;
  if (v_state #>> array['scores', c_acting::text])::numeric <> 8 then raise exception 'B3 crédit sans hausse'; end if;

  -- B4. Hôte réel qui écrit : rien (il crédite côté client).
  perform set_config('request.jwt.claims', json_build_object('sub', c_host::text, 'role', 'authenticated')::text, true);
  update public.game_sessions
  set state = jsonb_set(state, '{clutch,matchScores}',
    jsonb_build_object(c_acting::text, 9, c_guest::text, 1))
  where lobby_id = v_lobby;
  select state into v_state from public.game_sessions where lobby_id = v_lobby;
  if (v_state #>> array['scores', c_acting::text])::numeric <> 8 then raise exception 'B4 crédit pour l''hôte réel'; end if;

  -- B5. Hôte réel revenu (présent) : un autre joueur qui écrit ne crédite rien.
  update public.lobby_members set last_seen_at = now() where lobby_id = v_lobby and user_id = c_host;
  perform set_config('request.jwt.claims', json_build_object('sub', c_acting::text, 'role', 'authenticated')::text, true);
  update public.game_sessions
  set state = jsonb_set(state, '{clutch,matchScores}',
    jsonb_build_object(c_acting::text, 12, c_guest::text, 1))
  where lobby_id = v_lobby;
  select state into v_state from public.game_sessions where lobby_id = v_lobby;
  if (v_state #>> array['scores', c_acting::text])::numeric <> 8 then raise exception 'B5 crédit avec hôte présent'; end if;

  -- B6. Écriture service (sans utilisateur) : rien.
  update public.lobby_members set last_seen_at = now() - interval '10 minutes' where lobby_id = v_lobby and user_id = c_host;
  perform set_config('request.jwt.claims', '', true);
  update public.game_sessions
  set state = jsonb_set(state, '{clutch,matchScores}',
    jsonb_build_object(c_acting::text, 15, c_guest::text, 1))
  where lobby_id = v_lobby;
  select state into v_state from public.game_sessions where lobby_id = v_lobby;
  if (v_state #>> array['scores', c_acting::text])::numeric <> 8 then raise exception 'B6 crédit sans utilisateur'; end if;

  -- B7. Chemin réel : apply_acting_host_play par le remplaçant élu (hôte absent).
  perform set_config('request.jwt.claims', json_build_object('sub', c_acting::text, 'role', 'authenticated')::text, true);
  if not public.is_acting_host(v_lobby) then raise exception 'B7 acting non élu'; end if;
  perform public.apply_acting_host_play(
    v_lobby, 'merge_play', 'clutch',
    jsonb_build_object('phase', 'reveal', 'roundScored', true,
      'matchScores', jsonb_build_object(c_acting::text, 18, c_guest::text, 4)),
    'clutch', null
  );
  select state into v_state from public.game_sessions where lobby_id = v_lobby;
  -- 15 → 18 (+3) pour acting, 1 → 4 (+3) pour guest.
  if (v_state #>> array['scores', c_acting::text])::numeric <> 11 then raise exception 'B7 RPC acting % <> 11', v_state #>> array['scores', c_acting::text]; end if;
  if (v_state #>> array['scores', c_guest::text])::numeric <> 7 then raise exception 'B7 RPC guest % <> 7', v_state #>> array['scores', c_guest::text]; end if;

  -- B8. Jeu hors scope (trivia) : rien.
  update public.game_sessions
  set game_id = 'trivia',
      state = state || jsonb_build_object('trivia', jsonb_build_object('matchScores', jsonb_build_object(c_acting::text, 0)))
  where lobby_id = v_lobby;
  update public.game_sessions
  set state = jsonb_set(state, '{trivia,matchScores}', jsonb_build_object(c_acting::text, 50))
  where lobby_id = v_lobby;
  select state into v_state from public.game_sessions where lobby_id = v_lobby;
  if (v_state #>> array['scores', c_acting::text])::numeric <> 11 then raise exception 'B8 crédit hors scope'; end if;

  raise exception 'TESTS_OK — toutes les vérifications sont passées (rollback volontaire)';
end;
$$;
