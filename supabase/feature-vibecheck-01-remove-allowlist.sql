-- FEATURE-VIBECHECK-01 — Retrait VibeCheck / PlaylistGuess des allowlists serveur
--
-- Contexte : le jeu VibeCheck (game_id client `playlistguess` / écran `playlistguess-prep`)
-- est retiré du produit (data/games.js, data/gameRules.js, js/main.js, gameSync.js, …).
-- Ce fichier NE modifie PAS le comportement des jeux restants : il redéfinit (CREATE OR
-- REPLACE) les fonctions serveur ACTUELLEMENT EN PRODUCTION qui listaient `playlistguess`,
-- en retirant uniquement ces entrées. Corps sinon identique à la version en place.
--
-- Sources (version active reprise ici, PAS les fichiers historiques superseded) :
--   - reveal_poll_allowed_game_ids      <- supabase/lobby-polls.sql
--   - game_session_state_key            <- supabase/game-sessions-i08-arch03.sql
--   - game_session_expected_game_id     <- supabase/game-sessions-i08-arch03.sql
--   - contribute_game_session_player    <- supabase/game-sessions-i08-arch03.sql
--   - apply_acting_host_play            <- supabase/game-sessions-trivia-01a-acting-host.sql (remplace i08/hotfix)
--   - complete_game_session_as_actor    <- supabase/game-sessions-i08-arch03.sql
--
-- Effet pour les sessions orphelines existantes (game_id = 'playlistguess' /
-- screen = 'playlistguess-prep') : les RPC ci-dessous refusent désormais ce jeu
-- (« Jeu non autorisé » / « Écran non autorisé » / « game_id non autorisé »). Le client
-- traite déjà ce cas côté UI (aucun écran playlistguess enregistré, aucune offre de
-- reprise) — voir gameResume.js / gameSync.js. Ne casse aucun jeu restant.
--
-- Réexécutable (create or replace). Appliquer une seule fois en Staging puis Production ;
-- consigner dans docs/DEPLOYMENTS_SQL.md après exécution.

-- ---------------------------------------------------------------------------
-- 1) reveal_poll_allowed_game_ids — sondages « prochain jeu »
-- ---------------------------------------------------------------------------

create or replace function public.reveal_poll_allowed_game_ids()
returns text[]
language sql
immutable
set search_path = pg_catalog, public
as $$
  -- REVEAL_POLL_GAME_ALLOWLIST_BEGIN
  select array[
    'traitre-prep',
    'consensus-prep',
    'hottake-prep',
    'guesslie',
    'speedvote-prep',
    'clutch-prep',
    'wronganswer-prep',
    'dilemma-prep',
    'truthmeter-prep',
    'tiernight-select',
    'trivia-prep'
  ]::text[];
  -- REVEAL_POLL_GAME_ALLOWLIST_END
$$;

revoke all on function public.reveal_poll_allowed_game_ids() from public;
grant execute on function public.reveal_poll_allowed_game_ids() to authenticated;

-- ---------------------------------------------------------------------------
-- 2) game_session_state_key / game_session_expected_game_id
-- ---------------------------------------------------------------------------

create or replace function public.game_session_state_key(p_game text)
returns text
language sql
immutable
set search_path = pg_catalog, public
as $$
  select case lower(p_game)
    when 'hottake' then 'hotTake'
    when 'dilemma' then 'dilemma'
    when 'speedvote' then 'speedVote'
    when 'clutch' then 'clutch'
    when 'wronganswer' then 'wrongAnswer'
    when 'traitre' then 'traitre'
    when 'trivia' then 'trivia'
    when 'consensus' then 'consensus'
    when 'truthmeter' then 'truthMeter'
    when 'guesslie' then 'guessLie'
    when 'tiernight' then 'tierNight'
    when 'tiernightlive' then 'tierNightLive'
    else null
  end;
$$;

create or replace function public.game_session_expected_game_id(p_game text)
returns text
language sql
immutable
set search_path = pg_catalog, public
as $$
  select case lower(p_game)
    when 'hottake' then 'hottake'
    when 'dilemma' then 'dilemma'
    when 'speedvote' then 'speedvote'
    when 'clutch' then 'clutch'
    when 'wronganswer' then 'wronganswer'
    when 'traitre' then 'traitre'
    when 'trivia' then 'trivia'
    when 'consensus' then 'consensus'
    when 'truthmeter' then 'truthmeter'
    when 'guesslie' then 'guesslie'
    when 'tiernight' then 'tiernight'
    when 'tiernightlive' then 'tiernight'
    else null
  end;
$$;

-- ---------------------------------------------------------------------------
-- 3) contribute_game_session_player — retrait playlistguess des whitelists ready/vote
-- ---------------------------------------------------------------------------

create or replace function public.contribute_game_session_player(
  p_lobby_id uuid,
  p_game text,
  p_kind text,
  p_value jsonb
)
returns public.game_sessions
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid;
  v_uid_text text;
  v_state_key text;
  v_expected_gid text;
  v_kind text := lower(trim(p_kind));
  v_game text := lower(trim(p_game));
  v_row public.game_sessions;
  v_map text;
  v_phase text;
  v_screen text;
  v_path text[];
  v_bytes int;
begin
  v_uid := public.assert_lobby_member(p_lobby_id);
  v_uid_text := v_uid::text;
  v_state_key := public.game_session_state_key(v_game);
  v_expected_gid := public.game_session_expected_game_id(v_game);

  if v_state_key is null or v_expected_gid is null then
    raise exception 'Jeu non autorisé: %', p_game;
  end if;

  if p_value is null then
    raise exception 'Valeur requise.';
  end if;

  v_bytes := octet_length(p_value::text);
  if v_bytes > 16384 then
    raise exception 'Contribution trop volumineuse.';
  end if;

  -- Whitelist kind -> map JSON
  v_map := case v_kind
    when 'ready' then 'ready'
    when 'vote' then 'votes'
    when 'answer' then 'answers'
    when 'tap' then 'taps'
    when 'deal_ack' then 'dealAcks'
    when 'submission' then 'submissions'
    when 'placement' then 'placements'
    when 'finished' then 'finished'
    else null
  end;

  if v_map is null then
    raise exception 'Type de contribution non autorisé: %', p_kind;
  end if;

  -- Compatibilité jeu / kind
  if v_kind = 'ready' and v_game not in (
    'hottake','dilemma','speedvote','clutch','wronganswer','traitre',
    'trivia','consensus','truthmeter'
  ) then
    raise exception 'Ready non supporté pour ce jeu.';
  end if;
  if v_kind = 'vote' and v_game not in (
    'hottake','dilemma','speedvote','wronganswer','traitre',
    'truthmeter','guesslie','tiernightlive'
  ) then
    raise exception 'Vote non supporté pour ce jeu.';
  end if;
  if v_kind = 'answer' and v_game not in ('wronganswer','trivia','consensus') then
    raise exception 'Réponse non supportée pour ce jeu.';
  end if;
  if v_kind = 'tap' and v_game <> 'clutch' then
    raise exception 'Tap réservé à Clutch.';
  end if;
  if v_kind = 'deal_ack' and v_game <> 'traitre' then
    raise exception 'Deal ack réservé au Traître.';
  end if;
  if v_kind = 'submission' and v_game <> 'guesslie' then
    raise exception 'Submission réservée à Guess The Lie.';
  end if;
  if v_kind in ('placement','finished') and v_game <> 'tiernight' then
    raise exception 'Placement/finished réservés à TierNight classic.';
  end if;

  select * into v_row
  from public.game_sessions
  where lobby_id = p_lobby_id
  for update;

  if not found then
    raise exception 'Session de jeu introuvable.';
  end if;

  if v_row.game_id is distinct from v_expected_gid
     and not (v_kind = 'ready' and v_row.game_id in (v_expected_gid, 'menu'))
     and not (v_kind = 'submission' and v_row.game_id in ('guesslie', 'menu'))
  then
    -- Ready prep : screen prep souvent avec game_id du jeu déjà posé par l'hôte
    if v_kind = 'ready' then
      null; -- phase/screen checks below
    elsif v_kind = 'submission' and v_row.screen like 'guesslie%' then
      null;
    elsif v_kind in ('placement','finished') and v_row.game_id = 'tiernight' then
      null;
    else
      raise exception 'Jeu de session incompatible (attendu %, reçu %).', v_expected_gid, v_row.game_id;
    end if;
  end if;

  v_screen := coalesce(v_row.screen, '');
  v_phase := v_row.state #>> array[v_state_key, 'phase'];

  -- Phase / écran checks (stricts sur actions sensibles)
  if v_kind = 'ready' then
    if v_screen not like '%prep%'
       and v_screen not like '%setup%'
       and v_screen not in ('guesslie-menu', 'guesslie-wait', 'guesslie-setup')
    then
      raise exception 'Ready uniquement en préparation (écran %).', v_screen;
    end if;
    if jsonb_typeof(p_value) <> 'boolean' then
      raise exception 'Ready: booléen attendu.';
    end if;
  elsif v_kind = 'vote' then
    if v_phase is not null and v_phase not in ('voting','question','display','speak','vote') then
      -- display = truth meter votes after affirmation
      if not (v_game = 'truthmeter' and v_phase = 'display')
         and not (v_game = 'guesslie' and v_phase in ('voting','guessing', 'play', 'round'))
         and not (v_game = 'traitre' and v_phase in ('vote','speak','voting'))
      then
        if v_phase not in ('voting', 'question') then
          raise exception 'Vote interdit en phase %.', v_phase;
        end if;
      end if;
    end if;
    if jsonb_typeof(p_value) not in ('string','number','boolean') then
      raise exception 'Vote: valeur scalaire attendue.';
    end if;
    -- Si valeur UUID (cible joueur), vérifier membre
    if jsonb_typeof(p_value) = 'string'
       and (p_value #>> '{}') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then
      if not exists (
        select 1 from public.lobby_members
        where lobby_id = p_lobby_id and user_id = (p_value #>> '{}')::uuid
      ) then
        raise exception 'Cible de vote invalide.';
      end if;
    end if;
  elsif v_kind = 'answer' then
    if v_phase is not null and v_phase not in ('answer','question','answering') then
      raise exception 'Réponse interdite en phase %.', v_phase;
    end if;
    if jsonb_typeof(p_value) <> 'object' then
      raise exception 'Réponse: objet attendu.';
    end if;
  elsif v_kind = 'tap' then
    if v_phase is not null and v_phase not in ('active','play','tapping') then
      raise exception 'Tap interdit en phase %.', v_phase;
    end if;
    if jsonb_typeof(p_value) <> 'object' then
      raise exception 'Tap: objet attendu.';
    end if;
  elsif v_kind = 'deal_ack' then
    if v_phase is not null and v_phase not in ('deal','speak','vote') then
      raise exception 'Deal ack interdit en phase %.', v_phase;
    end if;
    if p_value <> 'true'::jsonb then
      raise exception 'Deal ack: true attendu.';
    end if;
  elsif v_kind = 'submission' then
    if jsonb_typeof(p_value) <> 'object' then
      raise exception 'Submission: objet attendu.';
    end if;
  elsif v_kind = 'placement' then
    if jsonb_typeof(p_value) <> 'object' then
      raise exception 'Placement: objet attendu.';
    end if;
  elsif v_kind = 'finished' then
    if p_value <> 'true'::jsonb then
      raise exception 'Finished: true attendu.';
    end if;
  end if;

  v_path := array[v_state_key, v_map, v_uid_text];

  update public.game_sessions gs
  set state = jsonb_set(
        coalesce(gs.state, '{}'::jsonb),
        v_path,
        p_value,
        true
      )
  where gs.lobby_id = p_lobby_id
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.contribute_game_session_player(uuid, text, text, jsonb) from public;
grant execute on function public.contribute_game_session_player(uuid, text, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 4) apply_acting_host_play — retrait playlistguess de v_allowed_screens
--    (version active = game-sessions-trivia-01a-acting-host.sql)
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

revoke all on function public.apply_acting_host_play(uuid, text, text, jsonb, text, text) from public;
grant execute on function public.apply_acting_host_play(uuid, text, text, jsonb, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5) complete_game_session_as_actor — retrait playlistGuess de v_game_keys
-- ---------------------------------------------------------------------------

create or replace function public.complete_game_session_as_actor(
  p_lobby_id uuid,
  p_screen text default 'results'
)
returns public.game_sessions
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_host_id uuid;
  v_row public.game_sessions;
  v_state jsonb;
  v_key text;
  v_game_keys text[] := array[
    'hotTake','speedVote','clutch','wrongAnswer','traitre','trivia','consensus',
    'dilemma','truthMeter','guessLie','tierNight','tierNightLive','filRouge'
  ];
  v_blob jsonb;
begin
  if v_uid is null then
    raise exception 'Authentification requise.';
  end if;

  if not (public.is_lobby_host(p_lobby_id) or public.is_acting_host(p_lobby_id)) then
    raise exception 'Clôture réservée à l''hôte ou à l''acting host.';
  end if;

  if p_screen is null or p_screen not in ('results','leaderboard','game-select') then
    raise exception 'Écran de clôture non autorisé.';
  end if;

  select host_id into v_host_id from public.lobbies where id = p_lobby_id;
  if v_host_id is null then
    raise exception 'Lobby introuvable.';
  end if;

  -- Between-games (équivalent setLobbyBetweenGames)
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

  -- Pas de blob scores client : on conserve l'existant serveur tel quel
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

-- ---------------------------------------------------------------------------
-- Note orphelins : une session existante avec game_id = 'playlistguess' /
-- screen = 'playlistguess-prep' n'est PAS supprimée par ce fichier (aucun DELETE /
-- UPDATE de données ici, uniquement redéfinition de fonctions). Elle devient
-- simplement injoignable via les RPC ci-dessus jusqu'à sa clôture naturelle
-- (purge_stale_lobbies / dissolve / leave). Le client REVEAL ne l'affiche plus
-- (écran non enregistré, resume filtré) — voir gameResume.js / gameSync.js.
