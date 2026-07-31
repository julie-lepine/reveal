-- BUG-TRIVIA-01B-bis — submit_trivia_answer + scoring partagé + auto-reveal serveur
-- Réexécutable. Exécuter dans le SQL Editor Supabase après 01B.
--
-- Politique joueurs attendus :
--   1) trivia.questionPlayerUids (snapshot UID au début de chaque question, client)
--   2) sinon tous les lobby_members actuels (fallback serveur)
--
-- answeredAt : bigint epoch ms (contrat JSON existant), pas timestamptz.

-- ---------------------------------------------------------------------------
-- Joueurs attendus pour la manche (UID text[])
-- ---------------------------------------------------------------------------

create or replace function public.trivia_question_player_uids(
  p_lobby_id uuid,
  p_trivia jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uids jsonb;
begin
  if p_trivia ? 'questionPlayerUids'
     and jsonb_typeof(p_trivia -> 'questionPlayerUids') = 'array'
     and jsonb_array_length(p_trivia -> 'questionPlayerUids') > 0 then
    return p_trivia -> 'questionPlayerUids';
  end if;

  select coalesce(jsonb_agg(lm.user_id::text order by lm.user_id::text), '[]'::jsonb)
    into v_uids
  from public.lobby_members lm
  where lm.lobby_id = p_lobby_id;

  return v_uids;
end;
$$;

create or replace function public.trivia_all_expected_players_answered(
  p_lobby_id uuid,
  p_trivia jsonb
)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_expected jsonb;
  v_answers jsonb;
  v_uid text;
begin
  v_expected := public.trivia_question_player_uids(p_lobby_id, p_trivia);
  if jsonb_array_length(v_expected) = 0 then
    return false;
  end if;

  v_answers := coalesce(p_trivia -> 'answers', '{}'::jsonb);

  for v_uid in
    select jsonb_array_elements_text(v_expected)
  loop
    if not public.trivia_answer_has_valid_index(v_answers -> v_uid) then
      return false;
    end if;
  end loop;

  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- Scoring partagé (reveal_trivia_round + auto-reveal submit)
-- ---------------------------------------------------------------------------

create or replace function public.trivia_apply_reveal_scoring(
  p_trivia jsonb,
  p_question_idx int
)
returns jsonb
language plpgsql
immutable
as $$
declare
  v_trivia jsonb := p_trivia;
  v_deck jsonb;
  v_answers jsonb;
  v_match_scores jsonb;
  v_correct int;
  v_correct_answer text;
  v_last_round jsonb;
  v_new_scores jsonb;
  v_deltas jsonb := '{}'::jsonb;
  v_correct_uids jsonb := '[]'::jsonb;
  v_fastest_uid text;
  v_rec record;
  v_const_correct constant int := 10;
  v_const_fastest constant int := 5;
begin
  v_deck := v_trivia -> 'deck';
  v_answers := coalesce(v_trivia -> 'answers', '{}'::jsonb);
  v_match_scores := coalesce(v_trivia -> 'matchScores', '{}'::jsonb);

  v_correct := public.trivia_deck_correct_index(v_deck, p_question_idx);
  v_correct_answer := coalesce(
    public.trivia_deck_correct_answer_text(v_deck, p_question_idx, v_correct),
    ''
  );

  v_new_scores := v_match_scores;

  select coalesce(
           jsonb_agg(to_jsonb(ordered.uid) order by ordered.answered_at asc nulls last, ordered.uid asc),
           '[]'::jsonb
         )
    into v_correct_uids
    from (
      select ca.uid, ca.answered_at
      from (
        select
          key as uid,
          case
            when public.trivia_jsonb_is_integer_number(value -> 'answeredAt')
              then (value -> 'answeredAt')::bigint
          end as answered_at,
          value
        from jsonb_each(v_answers)
      ) ca
      where public.trivia_answer_has_valid_index(ca.value)
        and (ca.value -> 'answerIndex')::int = v_correct
    ) ordered;

  for v_rec in
    select ordered.uid, ordered.answered_at
    from (
      select ca.uid, ca.answered_at
      from (
        select
          key as uid,
          case
            when public.trivia_jsonb_is_integer_number(value -> 'answeredAt')
              then (value -> 'answeredAt')::bigint
          end as answered_at,
          value
        from jsonb_each(v_answers)
      ) ca
      where public.trivia_answer_has_valid_index(ca.value)
        and (ca.value -> 'answerIndex')::int = v_correct
    ) ordered
    order by ordered.answered_at asc nulls last, ordered.uid asc
  loop
    v_deltas := jsonb_set(
      v_deltas,
      array[v_rec.uid],
      to_jsonb(coalesce((v_deltas ->> v_rec.uid)::int, 0) + v_const_correct),
      true
    );
    v_new_scores := jsonb_set(
      v_new_scores,
      array[v_rec.uid],
      to_jsonb(coalesce((v_new_scores ->> v_rec.uid)::int, 0) + v_const_correct),
      true
    );
  end loop;

  select sub.uid into v_fastest_uid
  from (
    select ca.uid, ca.answered_at
    from (
      select
        key as uid,
        case
          when public.trivia_jsonb_is_integer_number(value -> 'answeredAt')
            then (value -> 'answeredAt')::bigint
        end as answered_at,
        value
      from jsonb_each(v_answers)
    ) ca
    where public.trivia_answer_has_valid_index(ca.value)
      and (ca.value -> 'answerIndex')::int = v_correct
      and public.trivia_jsonb_is_integer_number(ca.value -> 'answeredAt')
  ) sub
  order by sub.answered_at asc, sub.uid asc
  limit 1;

  if v_fastest_uid is not null then
    v_deltas := jsonb_set(
      v_deltas,
      array[v_fastest_uid],
      to_jsonb(coalesce((v_deltas ->> v_fastest_uid)::int, 0) + v_const_fastest),
      true
    );
    v_new_scores := jsonb_set(
      v_new_scores,
      array[v_fastest_uid],
      to_jsonb(coalesce((v_new_scores ->> v_fastest_uid)::int, 0) + v_const_fastest),
      true
    );
  end if;

  v_last_round := jsonb_build_object(
    'correctIndex', v_correct,
    'correctAnswer', v_correct_answer,
    'correctPlayers', v_correct_uids,
    'fastestPlayer', v_fastest_uid,
    'deltas', v_deltas
  );

  return v_trivia || jsonb_build_object(
    'phase', 'reveal',
    'questionScored', true,
    'matchScores', v_new_scores,
    'lastRound', v_last_round
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- reveal_trivia_round — refactor scoring partagé (force reveal inchangé)
-- ---------------------------------------------------------------------------

create or replace function public.reveal_trivia_round(
  p_lobby_id uuid,
  p_run_id uuid,
  p_question_idx integer
)
returns public.game_sessions
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.game_sessions;
  v_trivia jsonb;
  v_run_id uuid;
  v_cur_idx int;
  v_phase text;
begin
  if v_uid is null then
    raise exception 'Authentification requise.';
  end if;

  perform public.assert_lobby_member(p_lobby_id);

  if not (public.is_lobby_host(p_lobby_id) or public.is_acting_host(p_lobby_id)) then
    raise exception 'Action réservée à l''hôte ou à l''acting host.';
  end if;

  if p_run_id is null then
    raise exception 'TRIVIA_STALE_RUN';
  end if;
  if p_question_idx is null then
    raise exception 'TRIVIA_STALE_QUESTION';
  end if;

  select * into v_row
  from public.game_sessions
  where lobby_id = p_lobby_id
  for update;

  if not found then
    raise exception 'Session de jeu introuvable.';
  end if;

  if v_row.game_id is distinct from 'trivia' then
    raise exception 'TRIVIA_INVALID_PHASE';
  end if;

  v_trivia := v_row.state -> 'trivia';
  if v_trivia is null or jsonb_typeof(v_trivia) <> 'object' then
    raise exception 'TRIVIA_INVALID_STATE';
  end if;

  if jsonb_typeof(v_trivia -> 'lobbyStarted') <> 'boolean'
     or (v_trivia -> 'lobbyStarted')::boolean is not true then
    raise exception 'TRIVIA_INVALID_PHASE';
  end if;

  v_run_id := public.trivia_parse_uuid_text(v_trivia ->> 'runId');

  if not public.trivia_jsonb_is_integer_number(v_trivia -> 'questionIdx') then
    raise exception 'TRIVIA_INVALID_STATE';
  end if;
  v_cur_idx := (v_trivia -> 'questionIdx')::int;

  if v_trivia ? 'phase' and jsonb_typeof(v_trivia -> 'phase') not in ('string', 'null') then
    raise exception 'TRIVIA_INVALID_STATE';
  end if;
  v_phase := v_trivia ->> 'phase';

  if v_trivia ? 'questionScored'
     and jsonb_typeof(v_trivia -> 'questionScored') <> 'boolean' then
    raise exception 'TRIVIA_INVALID_STATE';
  end if;

  if jsonb_typeof(v_trivia -> 'answers') not in ('object', 'null') then
    raise exception 'TRIVIA_INVALID_STATE';
  end if;

  if jsonb_typeof(v_trivia -> 'matchScores') not in ('object', 'null') then
    raise exception 'TRIVIA_INVALID_STATE';
  end if;

  if v_run_id <> p_run_id then
    raise exception 'TRIVIA_STALE_RUN';
  end if;

  if v_cur_idx <> p_question_idx then
    raise exception 'TRIVIA_STALE_QUESTION';
  end if;

  if v_phase = 'reveal'
     and coalesce((v_trivia ->> 'questionScored')::boolean, false)
     and v_trivia ? 'lastRound' then
    return v_row;
  end if;

  if v_phase is distinct from 'question' then
    raise exception 'TRIVIA_INVALID_PHASE';
  end if;

  v_trivia := public.trivia_apply_reveal_scoring(v_trivia, p_question_idx);

  update public.game_sessions gs
  set state = jsonb_set(
        coalesce(gs.state, '{}'::jsonb),
        '{trivia}',
        v_trivia,
        true
      )
  where gs.lobby_id = p_lobby_id
  returning * into v_row;

  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- submit_trivia_answer — réponse atomique + auto-reveal si tous répondu
-- ---------------------------------------------------------------------------

create or replace function public.submit_trivia_answer(
  p_lobby_id uuid,
  p_run_id uuid,
  p_question_idx integer,
  p_answer_index integer,
  p_answered_at bigint
)
returns public.game_sessions
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_uid_text text;
  v_row public.game_sessions;
  v_trivia jsonb;
  v_run_id uuid;
  v_cur_idx int;
  v_phase text;
  v_answers jsonb;
  v_existing jsonb;
  v_existing_idx int;
  v_answer_count int;
  v_answer jsonb;
begin
  if v_uid is null then
    raise exception 'Authentification requise.';
  end if;

  v_uid_text := v_uid::text;

  perform public.assert_lobby_member(p_lobby_id);

  if p_run_id is null then
    raise exception 'TRIVIA_STALE_RUN';
  end if;
  if p_question_idx is null then
    raise exception 'TRIVIA_STALE_QUESTION';
  end if;
  if p_answer_index is null then
    raise exception 'TRIVIA_INVALID_STATE';
  end if;
  if p_answered_at is null then
    raise exception 'TRIVIA_INVALID_STATE';
  end if;

  select * into v_row
  from public.game_sessions
  where lobby_id = p_lobby_id
  for update;

  if not found then
    raise exception 'Session de jeu introuvable.';
  end if;

  if v_row.game_id is distinct from 'trivia' then
    raise exception 'TRIVIA_INVALID_PHASE';
  end if;

  v_trivia := v_row.state -> 'trivia';
  if v_trivia is null or jsonb_typeof(v_trivia) <> 'object' then
    raise exception 'TRIVIA_INVALID_STATE';
  end if;

  if jsonb_typeof(v_trivia -> 'lobbyStarted') <> 'boolean'
     or (v_trivia -> 'lobbyStarted')::boolean is not true then
    raise exception 'TRIVIA_INVALID_PHASE';
  end if;

  v_run_id := public.trivia_parse_uuid_text(v_trivia ->> 'runId');

  if not public.trivia_jsonb_is_integer_number(v_trivia -> 'questionIdx') then
    raise exception 'TRIVIA_INVALID_STATE';
  end if;
  v_cur_idx := (v_trivia -> 'questionIdx')::int;

  if v_trivia ? 'phase' and jsonb_typeof(v_trivia -> 'phase') not in ('string', 'null') then
    raise exception 'TRIVIA_INVALID_STATE';
  end if;
  v_phase := v_trivia ->> 'phase';

  if v_run_id <> p_run_id then
    raise exception 'TRIVIA_STALE_RUN';
  end if;

  if v_cur_idx <> p_question_idx then
    raise exception 'TRIVIA_STALE_QUESTION';
  end if;

  v_answers := coalesce(v_trivia -> 'answers', '{}'::jsonb);
  v_existing := v_answers -> v_uid_text;

  -- Idempotence / réponse après reveal
  if v_phase = 'reveal'
     and coalesce((v_trivia ->> 'questionScored')::boolean, false) then
    if v_existing is not null
       and public.trivia_answer_has_valid_index(v_existing)
       and (v_existing -> 'answerIndex')::int = p_answer_index then
      return v_row;
    end if;
    raise exception 'TRIVIA_INVALID_PHASE';
  end if;

  if v_phase is distinct from 'question' then
    raise exception 'TRIVIA_INVALID_PHASE';
  end if;

  -- Valider answer_index contre le deck
  v_answer_count := public.trivia_deck_display_answer_count(v_trivia -> 'deck' -> p_question_idx);
  if p_answer_index < 0 or p_answer_index >= v_answer_count then
    raise exception 'TRIVIA_INVALID_STATE';
  end if;

  -- Idempotence : même réponse déjà enregistrée (answeredAt inchangé)
  if v_existing is not null and public.trivia_answer_has_valid_index(v_existing) then
    v_existing_idx := (v_existing -> 'answerIndex')::int;
    if v_existing_idx = p_answer_index then
      if public.trivia_all_expected_players_answered(p_lobby_id, v_trivia)
         and not coalesce((v_trivia ->> 'questionScored')::boolean, false) then
        v_trivia := public.trivia_apply_reveal_scoring(v_trivia, p_question_idx);
        update public.game_sessions gs
        set state = jsonb_set(coalesce(gs.state, '{}'::jsonb), '{trivia}', v_trivia, true)
        where gs.lobby_id = p_lobby_id
        returning * into v_row;
      end if;
      return v_row;
    end if;
    -- Réponse différente : remplacement autorisé avant reveal (contrat produit actuel)
  end if;

  v_answer := jsonb_build_object(
    'answerIndex', p_answer_index,
    'answeredAt', p_answered_at
  );

  v_answers := jsonb_set(v_answers, array[v_uid_text], v_answer, true);
  v_trivia := jsonb_set(v_trivia, '{answers}', v_answers, true);

  if public.trivia_all_expected_players_answered(p_lobby_id, v_trivia) then
    v_trivia := public.trivia_apply_reveal_scoring(v_trivia, p_question_idx);
  end if;

  update public.game_sessions gs
  set state = jsonb_set(
        coalesce(gs.state, '{}'::jsonb),
        '{trivia}',
        v_trivia,
        true
      )
  where gs.lobby_id = p_lobby_id
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.trivia_question_player_uids(uuid, jsonb) from public;
grant execute on function public.trivia_question_player_uids(uuid, jsonb) to authenticated;

revoke all on function public.trivia_all_expected_players_answered(uuid, jsonb) from public;
grant execute on function public.trivia_all_expected_players_answered(uuid, jsonb) to authenticated;

revoke all on function public.trivia_apply_reveal_scoring(jsonb, int) from public;
grant execute on function public.trivia_apply_reveal_scoring(jsonb, int) to authenticated;

revoke all on function public.submit_trivia_answer(uuid, uuid, int, int, bigint) from public;
grant execute on function public.submit_trivia_answer(uuid, uuid, int, int, bigint) to authenticated;

revoke all on function public.reveal_trivia_round(uuid, uuid, int) from public;
grant execute on function public.reveal_trivia_round(uuid, uuid, int) to authenticated;
