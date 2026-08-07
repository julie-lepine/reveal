-- =============================================================================
-- CLEANUP-FILROUGE-02 — Retrait legacy serveur Fil Rouge (+ playlistGuess regressé)
-- =============================================================================
-- Base = définitions LIVE capturées D2 (md5 ci-dessous). Ne pas dériver d'une
-- migration historique « supposée » : toute dérive live abort avant modification.
--
-- MD5 D2 attendus (pg_get_functiondef) :
--   apply_acting_host_play        2e3b71353bb2382e73b6b9dc11e4f7e7
--   complete_game_session_as_actor 31d85c1ac8cd341d360e6cf1fed37d10
--   remap_lobby_user_id           259fe9e655dbd0577452a06dc7ccfcb2
--
-- Deltas métier UNIQUES :
--   apply    : retire filRougeScores du deny evening (déjà hors v_allowed)
--   complete : retire 'playlistGuess' et 'filRouge' de v_game_keys
--   remap    : retire le bloc to_regclass(fil_rouge_private)
--   puis     : DROP TABLE IF EXISTS public.fil_rouge_private;  (SANS CASCADE)
--
-- Transactionnelle : échec garde / CREATE / DROP → rollback complet.
-- CREATE OR REPLACE préserve ownership + ACL live (aucune réécriture de permissions).
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- Garde anti-drift : MD5 live == D2, sinon ABORT (aucune écriture)
-- ---------------------------------------------------------------------------
do $guard$
declare
  v_apply text;
  v_complete text;
  v_remap text;
  v_oid oid;
begin
  v_oid := to_regprocedure('public.apply_acting_host_play(uuid, text, text, jsonb, text, text)');
  if v_oid is null then
    raise exception 'CLEANUP-FILROUGE-02 aborted: apply_acting_host_play(uuid,text,text,jsonb,text,text) introuvable';
  end if;
  v_apply := md5(pg_get_functiondef(v_oid));
  if v_apply is distinct from '2e3b71353bb2382e73b6b9dc11e4f7e7' then
    raise exception
      'CLEANUP-FILROUGE-02 aborted: apply_acting_host_play drift (expected %, got %)',
      '2e3b71353bb2382e73b6b9dc11e4f7e7',
      v_apply;
  end if;

  v_oid := to_regprocedure('public.complete_game_session_as_actor(uuid, text)');
  if v_oid is null then
    raise exception 'CLEANUP-FILROUGE-02 aborted: complete_game_session_as_actor(uuid,text) introuvable';
  end if;
  v_complete := md5(pg_get_functiondef(v_oid));
  if v_complete is distinct from '31d85c1ac8cd341d360e6cf1fed37d10' then
    raise exception
      'CLEANUP-FILROUGE-02 aborted: complete_game_session_as_actor drift (expected %, got %)',
      '31d85c1ac8cd341d360e6cf1fed37d10',
      v_complete;
  end if;

  v_oid := to_regprocedure('public.remap_lobby_user_id(uuid, uuid, uuid)');
  if v_oid is null then
    raise exception 'CLEANUP-FILROUGE-02 aborted: remap_lobby_user_id(uuid,uuid,uuid) introuvable';
  end if;
  v_remap := md5(pg_get_functiondef(v_oid));
  if v_remap is distinct from '259fe9e655dbd0577452a06dc7ccfcb2' then
    raise exception
      'CLEANUP-FILROUGE-02 aborted: remap_lobby_user_id drift (expected %, got %)',
      '259fe9e655dbd0577452a06dc7ccfcb2',
      v_remap;
  end if;
end;
$guard$;

-- ---------------------------------------------------------------------------
-- 1) apply_acting_host_play — LIVE − filRougeScores (deny redondant)
-- ---------------------------------------------------------------------------
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
    'hottake','dilemma','speedvote','clutch','wronganswer','traitre',
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
      if v_key in ('scores','stats','playerStats','eveningGamesRecorded') then
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
      'trivia','consensus','truthmeter','guesslie','tiernight','menu'
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

-- ---------------------------------------------------------------------------
-- 2) complete_game_session_as_actor — LIVE − playlistGuess − filRouge
-- ---------------------------------------------------------------------------
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
    'dilemma','truthMeter','guessLie','tierNight','tierNightLive'
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

-- ---------------------------------------------------------------------------
-- 3) remap_lobby_user_id — LIVE − bloc fil_rouge_private
-- ---------------------------------------------------------------------------
create or replace function public.remap_lobby_user_id(
  p_lobby_id uuid,
  p_old_user_id uuid,
  p_new_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_lobby_id is null or p_old_user_id is null or p_new_user_id is null then
    return;
  end if;
  if p_old_user_id = p_new_user_id then
    return;
  end if;

  -- Spot the fake : rôle imposteur privé
  if to_regclass('public.traitre_private') is not null then
    update public.traitre_private
    set user_id = p_new_user_id
    where lobby_id = p_lobby_id
      and user_id = p_old_user_id;
  end if;

  -- Messages : cohérence affichage / RLS (non bloquant pour le gameplay)
  update public.lobby_messages
  set user_id = p_new_user_id
  where lobby_id = p_lobby_id
    and user_id = p_old_user_id;

  -- État de partie multijoueur (votes, ready, placements indexés par uid)
  if to_regclass('public.game_sessions') is not null then
    update public.game_sessions
    set state = public.jsonb_replace_uid(state, p_old_user_id::text, p_new_user_id::text)
    where lobby_id = p_lobby_id;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4) DROP table Fil Rouge (sans CASCADE — échoue si dépendance inattendue)
-- ---------------------------------------------------------------------------
drop table if exists public.fil_rouge_private;

commit;
