-- BUG-TIERNIGHT-SERIES-QA-01 — allowlist écran terminal série TierNight
--
-- Défaut serveur démontré : complete_game_session_as_actor n’accepte que
-- results|leaderboard|game-select. Le classement de série (tiernight-end) est
-- désormais l’écran post-partie canonique ; l’acting host doit pouvoir y clôturer.
--
-- Ne change ni scoring, ni finalize, ni advance. Préserve l’état serveur
-- (finished + lobbyStarted false) déjà posé pour tierNight.

create or replace function public.complete_game_session_as_actor(
  p_lobby_id uuid,
  p_screen text default 'results'
)
returns public.game_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_host_id uuid;
  v_row public.game_sessions;
  v_state jsonb;
  v_key text;
  v_game_keys text[] := array[
    'hotTake','speedVote','clutch','wrongAnswer','traitre','trivia','consensus',
    'dilemma','truthMeter','playlistGuess','guessLie','tierNight','tierNightLive','filRouge'
  ];
  v_blob jsonb;
begin
  if v_uid is null then
    raise exception 'Authentification requise.';
  end if;

  if not (public.is_lobby_host(p_lobby_id) or public.is_acting_host(p_lobby_id)) then
    raise exception 'Clôture réservée à l''hôte ou à l''acting host.';
  end if;

  if p_screen is null or p_screen not in ('results','leaderboard','game-select','tiernight-end') then
    raise exception 'Écran de clôture non autorisé.';
  end if;

  select host_id into v_host_id from public.lobbies where id = p_lobby_id;
  if v_host_id is null then
    raise exception 'Lobby introuvable.';
  end if;

  update public.lobbies
  set status = 'playing',
      game_id = 'menu'
  where id = p_lobby_id;

  select * into v_row
  from public.game_sessions
  where lobby_id = p_lobby_id
  for update;

  if not found then
    raise exception 'Session de jeu introuvable.';
  end if;

  v_state := coalesce(v_row.state, '{}'::jsonb);

  foreach v_key in array v_game_keys
  loop
    v_blob := v_state -> v_key;
    if v_blob is not null and jsonb_typeof(v_blob) = 'object' then
      v_blob := v_blob || jsonb_build_object('lobbyStarted', false);
      if v_key = 'guessLie' then
        v_blob := v_blob || jsonb_build_object('lobbyComplete', false);
      end if;
      if v_key in ('tierNight','tierNightLive') then
        v_blob := v_blob || jsonb_build_object('finished', true);
      end if;
      v_state := jsonb_set(v_state, array[v_key], v_blob, true);
    end if;
  end loop;

  update public.game_sessions gs
  set game_id = 'menu',
      screen = p_screen,
      host_id = v_host_id,
      state = v_state
  where gs.lobby_id = p_lobby_id
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.complete_game_session_as_actor(uuid, text) from public;
grant execute on function public.complete_game_session_as_actor(uuid, text) to authenticated;
