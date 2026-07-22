-- REVEAL — ARCH-03 hotfix : whitelist Hot Take acting host play
-- Cause QA : apply_acting_host_play refuse `takeScored` / `intermissionEndsAt`
-- → reveal acting host échoue ; UI locale pouvait avancer avant (désync F5).
--
-- Réexécutable. Ne touche PAS aux policies ni aux RPC joueur.
-- Exécuter dans le SQL Editor Supabase AVANT retest Brave/Mozilla.

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

revoke all on function public.apply_acting_host_play(uuid, text, text, jsonb, text, text) from public;
grant execute on function public.apply_acting_host_play(uuid, text, text, jsonb, text, text) to authenticated;
