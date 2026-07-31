-- BUG-TRIVIA-01A — Acting host Trivia : whitelist + validations de transition
-- Réexécutable. Exécuter dans le SQL Editor Supabase.

create or replace function public.validate_trivia_acting_host_patch(
  p_current jsonb,
  p_patch jsonb
)
returns void
language plpgsql
immutable
as $$
declare
  v_cur_phase text := p_current ->> 'phase';
  v_cur_idx int := coalesce((p_current ->> 'questionIdx')::int, 0);
  v_qcount int := coalesce((p_current ->> 'questionCount')::int, 5);
  v_last_idx int := greatest(0, v_qcount - 1);
  v_new_phase text := p_patch ->> 'phase';
  v_new_idx int;
  v_answers jsonb;
begin
  if p_patch ? 'roundScored' then
    raise exception 'Trivia: roundScored interdit';
  end if;

  if p_patch ? 'questionScored' and p_patch ? 'roundScored' then
    raise exception 'Trivia: questionScored et roundScored simultanés interdits';
  end if;

  if p_patch ? 'answers' then
    v_answers := p_patch -> 'answers';
    if v_answers is null or jsonb_typeof(v_answers) <> 'object' then
      raise exception 'Trivia: answers doit être un objet';
    end if;
    if v_answers <> '{}'::jsonb then
      raise exception 'Trivia: answers doit être vide';
    end if;
    if v_cur_phase is distinct from 'reveal' then
      raise exception 'Trivia: reset answers uniquement depuis reveal';
    end if;
    if v_new_phase is distinct from 'question' then
      raise exception 'Trivia: reset answers uniquement vers question';
    end if;
    v_new_idx := coalesce((p_patch ->> 'questionIdx')::int, v_cur_idx);
    if v_new_idx <> v_cur_idx + 1 then
      raise exception 'Trivia: questionIdx incohérent pour reset answers';
    end if;
  end if;

  if p_patch ? 'questionScored' then
    if (p_patch ->> 'questionScored')::boolean is true then
      if v_cur_phase is distinct from 'question' then
        raise exception 'Trivia: questionScored:true uniquement depuis question';
      end if;
      if v_new_phase is distinct from 'reveal' then
        raise exception 'Trivia: questionScored:true uniquement vers reveal';
      end if;
    elsif (p_patch ->> 'questionScored')::boolean is false then
      if v_cur_phase is distinct from 'reveal' then
        raise exception 'Trivia: questionScored:false uniquement depuis reveal';
      end if;
      if v_new_phase is distinct from 'question' then
        raise exception 'Trivia: questionScored:false uniquement vers question';
      end if;
      v_new_idx := coalesce((p_patch ->> 'questionIdx')::int, v_cur_idx);
      if v_new_idx <> v_cur_idx + 1 then
        raise exception 'Trivia: questionIdx incohérent pour nouvelle question';
      end if;
    end if;
  end if;

  if p_patch ? 'podiumApplied' then
    if coalesce((p_patch ->> 'podiumApplied')::boolean, false) is not true then
      raise exception 'Trivia: podiumApplied doit être true';
    end if;
    if v_cur_phase is distinct from 'reveal' then
      raise exception 'Trivia: podiumApplied uniquement depuis reveal';
    end if;
    if v_new_phase is distinct from 'final' then
      raise exception 'Trivia: podiumApplied uniquement vers final';
    end if;
    if v_cur_idx <> v_last_idx then
      raise exception 'Trivia: podiumApplied uniquement sur dernière question';
    end if;
  end if;
end;
$$;

create or replace function public.apply_acting_host_play(
  p_lobby_id uuid,
  p_action text,
  p_game text,
  p_play_patch jsonb default '{}'::jsonb,
  p_screen text default null,
  p_game_id text default null
)
returns public.game_sessions
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_action text := lower(trim(p_action));
  v_game text := lower(trim(p_game));
  v_state_key text;
  v_row public.game_sessions;
  v_patch jsonb := '{}'::jsonb;
  v_key text;
  v_val jsonb;
  v_allowed text[] := array[
    'phase','roundIdx','takeIdx','questionIdx','votes','voteEndsAt','roundScored',
    'questionScored','podiumApplied',
    'takeScored','intermissionEndsAt','voteTimerRemaining',
    'pausedBy','taps','answers','dealAcks','currentDilemma','currentTake',
    'affirmation','authorEstimate','finished','placements','matchScores','lastRound',
    'roundResults','speakEndsAt','answerEndsAt','displayEndsAt','forceReveal',
    'allAnswered','podium','final','roundIdx','deckCursor','itemIdx','tierVotes',
    'accumulated','currentItem','itemsLeft','revealIndex','scored'
  ];
  v_allowed_screens text[] := array[
    'hottake','dilemma','speedvote','clutch','wronganswer','traitre','playlistguess',
    'trivia','consensus','truthmeter','guesslie','tiernight','tiernight-live','tiernight-end'
  ];
  v_trivia_current jsonb;
begin
  if v_uid is null then
    raise exception 'Authentification requise.';
  end if;

  if not (public.is_lobby_host(p_lobby_id) or public.is_acting_host(p_lobby_id)) then
    raise exception 'Action réservée à l''hôte ou à l''acting host.';
  end if;

  if v_action in ('launch','restart','delete','set_host','evening_scores') then
    raise exception 'Action interdite pour acting host play.';
  end if;

  if v_action not in ('merge_play', 'set_screen') then
    raise exception 'Action host-play inconnue: %', p_action;
  end if;

  v_state_key := public.game_session_state_key(v_game);
  if v_state_key is null then
    raise exception 'Jeu invalide.';
  end if;

  select * into v_row
  from public.game_sessions
  where lobby_id = p_lobby_id
  for update;

  if not found then
    raise exception 'Session de jeu introuvable.';
  end if;

  if v_action = 'merge_play' then
    if p_play_patch is null or jsonb_typeof(p_play_patch) <> 'object' then
      raise exception 'play_patch objet requis.';
    end if;
    if octet_length(p_play_patch::text) > 65536 then
      raise exception 'play_patch trop volumineux.';
    end if;

    for v_key, v_val in select * from jsonb_each(p_play_patch)
    loop
      if not (v_key = any (v_allowed)) then
        raise exception 'Champ play non autorisé: %', v_key;
      end if;
      if v_key in ('scores','stats','playerStats','filRougeScores','eveningGamesRecorded') then
        raise exception 'Scores soirée interdits.';
      end if;
      v_patch := v_patch || jsonb_build_object(v_key, v_val);
    end loop;

    if v_game = 'trivia' then
      v_trivia_current := coalesce(v_row.state -> v_state_key, '{}'::jsonb);
      perform public.validate_trivia_acting_host_patch(v_trivia_current, v_patch);
    end if;

    update public.game_sessions gs
    set state = jsonb_set(
          coalesce(gs.state, '{}'::jsonb),
          array[v_state_key],
          coalesce(gs.state -> v_state_key, '{}'::jsonb) || v_patch,
          true
        ),
        screen = case
          when p_screen is not null and p_screen = any (v_allowed_screens)
            then p_screen
          else gs.screen
        end
    where gs.lobby_id = p_lobby_id
    returning * into v_row;

  elsif v_action = 'set_screen' then
    if p_screen is null or not (p_screen = any (v_allowed_screens)) then
      raise exception 'Écran non autorisé.';
    end if;
    if p_game_id is not null and p_game_id not in (
      'hottake','dilemma','speedvote','clutch','wronganswer','traitre',
      'playlistguess','trivia','consensus','truthmeter','guesslie','tiernight','menu'
    ) then
      raise exception 'game_id non autorisé.';
    end if;

    update public.game_sessions gs
    set screen = p_screen,
        game_id = coalesce(p_game_id, gs.game_id)
    where gs.lobby_id = p_lobby_id
    returning * into v_row;
  end if;

  return v_row;
end;
$$;

revoke all on function public.validate_trivia_acting_host_patch(jsonb, jsonb) from public;
grant execute on function public.validate_trivia_acting_host_patch(jsonb, jsonb) to authenticated;

revoke all on function public.apply_acting_host_play(uuid, text, text, jsonb, text, text) from public;
grant execute on function public.apply_acting_host_play(uuid, text, text, jsonb, text, text) to authenticated;
