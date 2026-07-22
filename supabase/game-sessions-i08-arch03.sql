-- REVEAL — I-08 + ARCH-03
-- Sécurisation game_sessions : contributions joueur + acting host via RPC
--
-- ORDRE D'APPLICATION (production) :
-- 1) Exécuter ce fichier ENTIER jusqu'à la section « POLICY FINALE » EXCLUE
--    (les RPC existent, l'ancienne policy membre reste active).
-- 2) Déployer le client qui appelle les RPC.
-- 3) QA des flux RPC.
-- 4) Exécuter uniquement la section « POLICY FINALE » (UPDATE = host_id seul).
--
-- ROLLBACK policy :
--   recreate policy game_sessions_update using is_lobby_member (voir bas de fichier).
--
-- Dépendances : schema.sql, game-sessions.sql, fix-rls-recursion.sql (is_lobby_member)

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.is_lobby_host(p_lobby_id uuid)
returns boolean
language sql
security definer
set search_path = pg_catalog, public
stable
as $$
  select exists (
    select 1 from public.lobbies
    where id = p_lobby_id and host_id = auth.uid()
  );
$$;

revoke all on function public.is_lobby_host(uuid) from public;
grant execute on function public.is_lobby_host(uuid) to authenticated;

/**
 * Acting host (ARCH-03) — décision 100 % serveur.
 * Aligné client (hostPresence.js) :
 * - seuil 120 s
 * - last_seen_at IS NULL => membre considéré PRÉSENT (legacy / pas de faux acting)
 * - host présent => seul le host réel
 * - host absent => plus petit user_id::text parmi membres éligibles présents
 *   (ORDER BY … LIMIT 1 — pas min(uuid), absent en PostgreSQL)
 */
create or replace function public.is_acting_host(p_lobby_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
stable
as $$
declare
  v_uid uuid := auth.uid();
  v_host_id uuid;
  v_host_present boolean;
  v_elected uuid;
  v_stale interval := interval '120 seconds';
begin
  if v_uid is null then
    return false;
  end if;

  if not public.is_lobby_member(p_lobby_id) then
    return false;
  end if;

  select host_id into v_host_id
  from public.lobbies
  where id = p_lobby_id;

  if v_host_id is null then
    return false;
  end if;

  -- Hôte réel présent ?
  select exists (
    select 1
    from public.lobby_members m
    where m.lobby_id = p_lobby_id
      and m.user_id = v_host_id
      and (
        m.last_seen_at is null
        or m.last_seen_at >= (now() - v_stale)
      )
  ) into v_host_present;

  if v_host_present then
    return v_uid = v_host_id;
  end if;

  -- Hôte absent : élection déterministe (compatible UUID)
  select lm.user_id
  into v_elected
  from public.lobby_members lm
  where lm.lobby_id = p_lobby_id
    and lm.user_id is not null
    and (
      lm.last_seen_at is null
      or lm.last_seen_at >= (now() - v_stale)
    )
  order by lm.user_id::text asc
  limit 1;

  return v_elected is not null and v_uid = v_elected;
end;
$$;

revoke all on function public.is_acting_host(uuid) from public;
grant execute on function public.is_acting_host(uuid) to authenticated;

create or replace function public.assert_lobby_member(p_lobby_id uuid)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Authentification requise.';
  end if;
  if not public.is_lobby_member(p_lobby_id) then
    raise exception 'Tu n''es pas membre de ce lobby.';
  end if;
  return v_uid;
end;
$$;

revoke all on function public.assert_lobby_member(uuid) from public;
grant execute on function public.assert_lobby_member(uuid) to authenticated;

-- Map p_game (client) -> clé JSON state + game_id attendu
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
    when 'playlistguess' then 'playlistGuess'
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
    when 'playlistguess' then 'playlistguess'
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
-- contribute_game_session_player
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
    'playlistguess','trivia','consensus','truthmeter'
  ) then
    raise exception 'Ready non supporté pour ce jeu.';
  end if;
  if v_kind = 'vote' and v_game not in (
    'hottake','dilemma','speedvote','wronganswer','traitre',
    'playlistguess','truthmeter','guesslie','tiernightlive'
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
-- Customs Hot Take / Dilemma
-- ---------------------------------------------------------------------------

create or replace function public.upsert_player_custom_entry(
  p_lobby_id uuid,
  p_game text,
  p_entry jsonb
)
returns public.game_sessions
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid;
  v_name text;
  v_game text := lower(trim(p_game));
  v_state_key text;
  v_array_key text;
  v_row public.game_sessions;
  v_arr jsonb;
  v_entry jsonb;
  v_id text;
  v_text_a text;
  v_text_b text;
  i int;
  v_found boolean := false;
begin
  v_uid := public.assert_lobby_member(p_lobby_id);

  select display_name into v_name
  from public.lobby_members
  where lobby_id = p_lobby_id and user_id = v_uid;

  if v_name is null or length(trim(v_name)) < 1 then
    raise exception 'Pseudo introuvable.';
  end if;

  if v_game = 'hottake' then
    v_state_key := 'hotTake';
    v_array_key := 'customTakes';
  elsif v_game = 'dilemma' then
    v_state_key := 'dilemma';
    v_array_key := 'customDilemmas';
  else
    raise exception 'Customs uniquement pour Hot Take / Dilemma.';
  end if;

  if p_entry is null or jsonb_typeof(p_entry) <> 'object' then
    raise exception 'Entrée custom invalide.';
  end if;

  if octet_length(p_entry::text) > 2048 then
    raise exception 'Entrée custom trop volumineuse.';
  end if;

  v_id := coalesce(nullif(trim(p_entry ->> 'id'), ''), 'custom-' || gen_random_uuid()::text);

  if v_game = 'hottake' then
    v_text_a := left(trim(coalesce(p_entry ->> 'text', '')), 160);
    if length(v_text_a) < 1 then
      raise exception 'Texte custom requis.';
    end if;
    v_entry := jsonb_build_object(
      'id', v_id,
      'text', v_text_a,
      'author', v_name
    );
  else
    v_text_a := left(trim(coalesce(p_entry ->> 'optionA', '')), 160);
    v_text_b := left(trim(coalesce(p_entry ->> 'optionB', '')), 160);
    if length(v_text_a) < 1 or length(v_text_b) < 1 then
      raise exception 'Options du dilemme requises.';
    end if;
    v_entry := jsonb_build_object(
      'id', v_id,
      'optionA', v_text_a,
      'optionB', v_text_b,
      'author', v_name,
      'tier', 'custom'
    );
  end if;

  select * into v_row
  from public.game_sessions
  where lobby_id = p_lobby_id
  for update;

  if not found then
    raise exception 'Session de jeu introuvable.';
  end if;

  v_arr := coalesce(v_row.state -> v_state_key -> v_array_key, '[]'::jsonb);
  if jsonb_typeof(v_arr) <> 'array' then
    v_arr := '[]'::jsonb;
  end if;

  -- Remplace si même id + même auteur, sinon append (max 1 custom dilemma par auteur)
  for i in 0 .. greatest(jsonb_array_length(v_arr) - 1, -1) loop
    if (v_arr -> i ->> 'id') = v_id and (v_arr -> i ->> 'author') = v_name then
      v_arr := jsonb_set(v_arr, array[i::text], v_entry, false);
      v_found := true;
      exit;
    end if;
  end loop;

  if not v_found then
    if v_game = 'dilemma' then
      for i in 0 .. greatest(jsonb_array_length(v_arr) - 1, -1) loop
        if (v_arr -> i ->> 'author') = v_name then
          raise exception 'Tu as déjà soumis un dilemme custom.';
        end if;
      end loop;
    end if;
    v_arr := v_arr || jsonb_build_array(v_entry);
  end if;

  update public.game_sessions gs
  set state = jsonb_set(
        coalesce(gs.state, '{}'::jsonb),
        array[v_state_key, v_array_key],
        v_arr,
        true
      )
  where gs.lobby_id = p_lobby_id
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.upsert_player_custom_entry(uuid, text, jsonb) from public;
grant execute on function public.upsert_player_custom_entry(uuid, text, jsonb) to authenticated;

create or replace function public.delete_player_custom_entry(
  p_lobby_id uuid,
  p_game text,
  p_entry_id text
)
returns public.game_sessions
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid;
  v_name text;
  v_game text := lower(trim(p_game));
  v_state_key text;
  v_array_key text;
  v_row public.game_sessions;
  v_arr jsonb;
  v_next jsonb := '[]'::jsonb;
  i int;
  v_item jsonb;
begin
  v_uid := public.assert_lobby_member(p_lobby_id);

  select display_name into v_name
  from public.lobby_members
  where lobby_id = p_lobby_id and user_id = v_uid;

  if v_game = 'hottake' then
    v_state_key := 'hotTake';
    v_array_key := 'customTakes';
  elsif v_game = 'dilemma' then
    v_state_key := 'dilemma';
    v_array_key := 'customDilemmas';
  else
    raise exception 'Customs uniquement pour Hot Take / Dilemma.';
  end if;

  if p_entry_id is null or length(trim(p_entry_id)) < 1 then
    raise exception 'Id custom requis.';
  end if;

  select * into v_row
  from public.game_sessions
  where lobby_id = p_lobby_id
  for update;

  if not found then
    raise exception 'Session de jeu introuvable.';
  end if;

  v_arr := coalesce(v_row.state -> v_state_key -> v_array_key, '[]'::jsonb);
  for i in 0 .. greatest(jsonb_array_length(v_arr) - 1, -1) loop
    v_item := v_arr -> i;
    if (v_item ->> 'id') = p_entry_id then
      if (v_item ->> 'author') is distinct from v_name then
        raise exception 'Tu ne peux supprimer que tes propres customs.';
      end if;
      -- skip (delete)
    else
      v_next := v_next || jsonb_build_array(v_item);
    end if;
  end loop;

  update public.game_sessions gs
  set state = jsonb_set(
        coalesce(gs.state, '{}'::jsonb),
        array[v_state_key, v_array_key],
        v_next,
        true
      )
  where gs.lobby_id = p_lobby_id
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.delete_player_custom_entry(uuid, text, text) from public;
grant execute on function public.delete_player_custom_entry(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Truth Meter affirmation
-- ---------------------------------------------------------------------------

create or replace function public.submit_truth_meter_affirmation(
  p_lobby_id uuid,
  p_text text,
  p_author_estimate numeric
)
returns public.game_sessions
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid;
  v_name text;
  v_row public.game_sessions;
  v_tm jsonb;
  v_phase text;
  v_expected_author text;
  v_clean text;
  v_patch jsonb;
begin
  v_uid := public.assert_lobby_member(p_lobby_id);

  select display_name into v_name
  from public.lobby_members
  where lobby_id = p_lobby_id and user_id = v_uid;

  v_clean := left(trim(coalesce(p_text, '')), 160);
  if length(v_clean) < 1 then
    raise exception 'Affirmation vide.';
  end if;

  if p_author_estimate is null or p_author_estimate < 0 or p_author_estimate > 100 then
    raise exception 'Estimation invalide (0–100).';
  end if;

  select * into v_row
  from public.game_sessions
  where lobby_id = p_lobby_id
  for update;

  if not found then
    raise exception 'Session de jeu introuvable.';
  end if;

  if v_row.game_id is distinct from 'truthmeter' then
    raise exception 'Session Truth Meter requise.';
  end if;

  v_tm := coalesce(v_row.state -> 'truthMeter', '{}'::jsonb);
  v_phase := v_tm ->> 'phase';
  if v_phase is distinct from 'writing' then
    raise exception 'Affirmation uniquement en phase writing (phase %).', v_phase;
  end if;

  v_expected_author := coalesce(
    v_tm #>> '{affirmation,author}',
    v_tm ->> 'currentAuthor',
    v_tm ->> 'author'
  );

  -- Si un auteur est déjà désigné pour le round, il doit matcher
  if v_expected_author is not null
     and length(trim(v_expected_author)) > 0
     and v_expected_author is distinct from v_name
  then
    raise exception 'Seul l''auteur du round peut soumettre l''affirmation.';
  end if;

  v_patch := jsonb_build_object(
    'affirmation', jsonb_build_object('text', v_clean, 'author', v_name),
    'authorEstimate', p_author_estimate,
    'phase', 'display',
    'votes', '{}'::jsonb,
    'roundScored', false
  );

  update public.game_sessions gs
  set state = jsonb_set(
        coalesce(gs.state, '{}'::jsonb),
        '{truthMeter}',
        coalesce(gs.state -> 'truthMeter', '{}'::jsonb) || v_patch,
        true
      )
  where gs.lobby_id = p_lobby_id
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.submit_truth_meter_affirmation(uuid, text, numeric) from public;
grant execute on function public.submit_truth_meter_affirmation(uuid, text, numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- Acting host play (pas d'UPDATE libre)
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

  -- Host réel OU acting host serveur (jamais un claim client)
  if not (public.is_lobby_host(p_lobby_id) or public.is_acting_host(p_lobby_id)) then
    raise exception 'Action réservée à l''hôte ou à l''acting host.';
  end if;

  -- Acting host uniquement ici pour les non-hosts ; le host réel peut aussi l'utiliser
  -- mais le client host garde update direct. Interdits absolus :
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
      -- Interdit d'embarquer evening / scores globaux
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

-- ---------------------------------------------------------------------------
-- complete_game_session_as_actor
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
-- POLICY FINALE (à exécuter APRÈS déploiement client RPC + QA)
-- ---------------------------------------------------------------------------
-- DÉCOMMENTER / EXÉCUTER EN ÉTAPE 4 UNIQUEMENT :

-- drop policy if exists "game_sessions_update" on public.game_sessions;
-- create policy "game_sessions_update" on public.game_sessions
-- for update
-- using (auth.uid() = host_id)
-- with check (auth.uid() = host_id);

-- ROLLBACK policy (remettre membre) :
-- drop policy if exists "game_sessions_update" on public.game_sessions;
-- create policy "game_sessions_update" on public.game_sessions
-- for update
-- using (public.is_lobby_member(lobby_id))
-- with check (public.is_lobby_member(lobby_id));
