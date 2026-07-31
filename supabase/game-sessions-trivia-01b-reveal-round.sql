-- BUG-TRIVIA-01B — Reveal Trivia atomique (hôte réel + acting host)
-- Réexécutable. Exécuter dans le SQL Editor Supabase après 01A.
--
-- Formats deck acceptés pour le scoring :
--   { "r": "<id>", "a": [<perm>], "k": <int> }  — déshydraté 01B (k requis)
--   { "c": { ..., "answers": [...], "correct": <int> } }  — inline custom
--   { ..., "answers": [...], "correct": <int> }  — legacy objet complet
-- Rejeté : { "r", "a" } sans k (pas de banque côté serveur), k invalide, deck absent.

-- ---------------------------------------------------------------------------
-- Helpers validation JSON (jamais de cast direct non validé)
-- ---------------------------------------------------------------------------

create or replace function public.trivia_jsonb_is_integer_number(p_val jsonb)
returns boolean
language sql
immutable
as $$
  select
    p_val is not null
    and jsonb_typeof(p_val) = 'number'
    and (p_val::numeric = trunc(p_val::numeric));
$$;

create or replace function public.trivia_answer_has_valid_index(p_answer jsonb)
returns boolean
language sql
immutable
as $$
  select public.trivia_jsonb_is_integer_number(p_answer -> 'answerIndex');
$$;

create or replace function public.trivia_parse_uuid_text(p_text text)
returns uuid
language plpgsql
immutable
as $$
declare
  v_uuid uuid;
begin
  if p_text is null or length(trim(p_text)) = 0 then
    raise exception 'TRIVIA_INVALID_STATE';
  end if;
  begin
    v_uuid := trim(p_text)::uuid;
  exception
    when others then
      raise exception 'TRIVIA_INVALID_STATE';
  end;
  return v_uuid;
end;
$$;

create or replace function public.trivia_deck_display_answer_count(p_entry jsonb)
returns int
language plpgsql
immutable
as $$
declare
  v_len int;
begin
  if p_entry ? 'c' then
    if jsonb_typeof(p_entry -> 'c') <> 'object' then
      raise exception 'TRIVIA_INVALID_STATE';
    end if;
    if jsonb_typeof(p_entry -> 'c' -> 'answers') <> 'array' then
      raise exception 'TRIVIA_INVALID_STATE';
    end if;
    return jsonb_array_length(p_entry -> 'c' -> 'answers');
  end if;

  if p_entry ? 'a' and jsonb_typeof(p_entry -> 'a') = 'array' then
    return jsonb_array_length(p_entry -> 'a');
  end if;

  if p_entry ? 'answers' and jsonb_typeof(p_entry -> 'answers') = 'array' then
    return jsonb_array_length(p_entry -> 'answers');
  end if;

  raise exception 'TRIVIA_INVALID_STATE';
end;
$$;

create or replace function public.trivia_deck_validate_correct_index(
  p_entry jsonb,
  p_correct jsonb
)
returns int
language plpgsql
immutable
as $$
declare
  v_idx int;
  v_count int;
begin
  if not public.trivia_jsonb_is_integer_number(p_correct) then
    raise exception 'TRIVIA_INVALID_STATE';
  end if;

  v_idx := (p_correct)::int;
  v_count := public.trivia_deck_display_answer_count(p_entry);

  if v_idx < 0 or v_idx >= v_count then
    raise exception 'TRIVIA_INVALID_STATE';
  end if;

  return v_idx;
end;
$$;

create or replace function public.trivia_deck_correct_index(
  p_deck jsonb,
  p_idx int
)
returns int
language plpgsql
immutable
as $$
declare
  v_entry jsonb;
begin
  if p_deck is null or jsonb_typeof(p_deck) <> 'array' then
    raise exception 'TRIVIA_INVALID_STATE';
  end if;
  if p_idx < 0 or p_idx >= jsonb_array_length(p_deck) then
    raise exception 'TRIVIA_INVALID_STATE';
  end if;

  v_entry := p_deck -> p_idx;

  if jsonb_typeof(v_entry) <> 'object' then
    raise exception 'TRIVIA_INVALID_STATE';
  end if;

  -- Inline custom { c: { correct, answers } }
  if v_entry ? 'c' then
    return public.trivia_deck_validate_correct_index(
      v_entry,
      v_entry -> 'c' -> 'correct'
    );
  end if;

  -- Déshydraté 01B { r, a, k }
  if v_entry ? 'k' then
    return public.trivia_deck_validate_correct_index(v_entry, v_entry -> 'k');
  end if;

  -- Legacy objet complet avec correct
  if v_entry ? 'correct' then
    return public.trivia_deck_validate_correct_index(v_entry, v_entry -> 'correct');
  end if;

  -- { r, a } sans k : non résolvable côté serveur
  raise exception 'TRIVIA_INVALID_STATE';
end;
$$;

create or replace function public.trivia_deck_correct_answer_text(
  p_deck jsonb,
  p_idx int,
  p_correct int
)
returns text
language plpgsql
immutable
as $$
declare
  v_entry jsonb;
  v_answers jsonb;
begin
  if p_deck is null or jsonb_typeof(p_deck) <> 'array' then
    return '';
  end if;
  if p_idx < 0 or p_idx >= jsonb_array_length(p_deck) then
    return '';
  end if;

  v_entry := p_deck -> p_idx;

  if v_entry ? 'c' then
    v_answers := v_entry -> 'c' -> 'answers';
    if jsonb_typeof(v_answers) = 'array'
       and p_correct >= 0
       and p_correct < jsonb_array_length(v_answers) then
      return v_answers ->> p_correct;
    end if;
    return '';
  end if;

  if v_entry ? 'answers' and jsonb_typeof(v_entry -> 'answers') = 'array' then
    v_answers := v_entry -> 'answers';
    if p_correct >= 0 and p_correct < jsonb_array_length(v_answers) then
      return v_answers ->> p_correct;
    end if;
  end if;

  return '';
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC reveal atomique
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

  -- Garde jeu courant (aucune mutation)
  if v_row.game_id is distinct from 'trivia' then
    raise exception 'TRIVIA_INVALID_PHASE';
  end if;

  v_trivia := v_row.state -> 'trivia';
  if v_trivia is null or jsonb_typeof(v_trivia) <> 'object' then
    raise exception 'TRIVIA_INVALID_STATE';
  end if;

  -- Partie démarrée
  if jsonb_typeof(v_trivia -> 'lobbyStarted') <> 'boolean'
     or (v_trivia -> 'lobbyStarted')::boolean is not true then
    raise exception 'TRIVIA_INVALID_PHASE';
  end if;

  -- Structure Trivia (runId, questionIdx, phase, questionScored)
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

  -- Anti-stale : runId → questionIdx → idempotence → phase
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

  v_deck := v_trivia -> 'deck';
  v_answers := coalesce(v_trivia -> 'answers', '{}'::jsonb);
  v_match_scores := coalesce(v_trivia -> 'matchScores', '{}'::jsonb);

  v_correct := public.trivia_deck_correct_index(v_deck, p_question_idx);
  v_correct_answer := coalesce(
    public.trivia_deck_correct_answer_text(v_deck, p_question_idx, v_correct),
    ''
  );

  v_new_scores := v_match_scores;

  -- correctPlayers ordonnés : answeredAt ASC, uid ASC (identique au fastest)
  select coalesce(
           jsonb_agg(to_jsonb(ordered.uid) order by ordered.answered_at asc nulls last, ordered.uid asc),
           '[]'::jsonb
         )
    into v_correct_uids
    from (
      select
        ca.uid,
        ca.answered_at
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
      select
        ca.uid,
        ca.answered_at
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
    select
      ca.uid,
      ca.answered_at
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

  v_trivia := v_trivia || jsonb_build_object(
    'phase', 'reveal',
    'questionScored', true,
    'matchScores', v_new_scores,
    'lastRound', v_last_round
  );

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

revoke all on function public.trivia_jsonb_is_integer_number(jsonb) from public;
grant execute on function public.trivia_jsonb_is_integer_number(jsonb) to authenticated;

revoke all on function public.trivia_answer_has_valid_index(jsonb) from public;
grant execute on function public.trivia_answer_has_valid_index(jsonb) to authenticated;

revoke all on function public.trivia_parse_uuid_text(text) from public;
grant execute on function public.trivia_parse_uuid_text(text) to authenticated;

revoke all on function public.trivia_deck_display_answer_count(jsonb) from public;
grant execute on function public.trivia_deck_display_answer_count(jsonb) to authenticated;

revoke all on function public.trivia_deck_validate_correct_index(jsonb, jsonb) from public;
grant execute on function public.trivia_deck_validate_correct_index(jsonb, jsonb) to authenticated;

revoke all on function public.trivia_deck_correct_index(jsonb, int) from public;
grant execute on function public.trivia_deck_correct_index(jsonb, int) to authenticated;

revoke all on function public.trivia_deck_correct_answer_text(jsonb, int, int) from public;
grant execute on function public.trivia_deck_correct_answer_text(jsonb, int, int) to authenticated;

revoke all on function public.reveal_trivia_round(uuid, uuid, int) from public;
grant execute on function public.reveal_trivia_round(uuid, uuid, int) to authenticated;
