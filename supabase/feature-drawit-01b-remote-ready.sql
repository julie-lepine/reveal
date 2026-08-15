-- FEATURE-DRAWIT-01B — allowlist ready Draw it ! (prod actuelle)
--
-- QA : « Jeu non autorisé: drawit » au clic invité « Je suis prêt ».
-- Cause : game_session_state_key / expected_game_id (VIBECHECK-01) et
-- contribute (TIERNIGHT-04E) ne connaissent pas encore `drawit`.
--
-- À appliquer dans le SQL Editor Supabase (staging puis prod).
--
-- NE PAS appliquer feature-drawit-01-prep-guest-ready.sql après 04E :
--   ce fichier T2 reprend un contribute VIBECHECK et casserait le ready
--   TierNight live / pool_invalidate.
--
-- Ce fichier :
--   1) ajoute drawit aux mappings session
--   2) reprend contribute 04E + ready drawit uniquement (pas vote/guess)
--
-- 01b NE crée PAS submit_drawit_guess ni drawit_private.
-- Pour le feed T5 / mot privé T4, appliquer ensuite :
--   feature-drawit-02-private-word.sql
--   feature-drawit-03-guesses.sql

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
    when 'drawit' then 'drawIt'
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
    when 'drawit' then 'drawit'
    else null
  end;
$$;

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
  v_req text;
  v_custom_id text;
  v_expected_epoch int;
  v_cur_epoch int;
  v_ready_bool jsonb;
  v_owned boolean := false;
  v_entry jsonb;
  v_prep_key text;
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

  v_map := case v_kind
    when 'ready' then 'ready'
    when 'vote' then 'votes'
    when 'answer' then 'answers'
    when 'tap' then 'taps'
    when 'deal_ack' then 'dealAcks'
    when 'submission' then 'submissions'
    when 'placement' then 'placements'
    when 'finished' then 'finished'
    when 'pool_invalidate_request' then 'poolInvalidateRequestId'
    else null
  end;

  if v_map is null then
    raise exception 'Type de contribution non autorisé: %', p_kind;
  end if;

  if v_kind = 'ready' and v_game not in (
    'hottake','dilemma','speedvote','clutch','wronganswer','traitre',
    'trivia','consensus','truthmeter','tiernight','drawit'
  ) then
    raise exception 'Ready non supporté pour ce jeu.';
  end if;
  if v_kind = 'pool_invalidate_request' and v_game <> 'tiernight' then
    raise exception 'pool_invalidate_request réservé à TierNight série prep.';
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

  v_screen := coalesce(v_row.screen, '');

  if v_game = 'tiernight' and v_kind = 'ready' then
    if v_row.game_id is distinct from 'tiernight' then
      raise exception
        'Jeu de session incompatible pour TierNight prep (attendu tiernight, reçu %).',
        v_row.game_id;
    end if;
    if v_screen is distinct from 'tiernight-prep'
       and v_screen is distinct from 'tiernight-live-prep' then
      raise exception
        'Contribution TierNight ready uniquement sur tiernight-prep|tiernight-live-prep (écran %).',
        v_screen;
    end if;
  elsif v_game = 'tiernight' and v_kind = 'pool_invalidate_request' then
    if v_row.game_id is distinct from 'tiernight' then
      raise exception
        'Jeu de session incompatible pour TierNight prep (attendu tiernight, reçu %).',
        v_row.game_id;
    end if;
    if v_screen is distinct from 'tiernight-prep' then
      raise exception
        'pool_invalidate_request uniquement sur tiernight-prep (écran %).',
        v_screen;
    end if;
  elsif v_row.game_id is distinct from v_expected_gid
     and not (v_kind = 'ready' and v_row.game_id in (v_expected_gid, 'menu'))
     and not (v_kind = 'submission' and v_row.game_id in ('guesslie', 'menu'))
  then
    if v_kind = 'ready' then
      null;
    elsif v_kind = 'submission' and v_row.screen like 'guesslie%' then
      null;
    elsif v_kind in ('placement','finished') and v_row.game_id = 'tiernight' then
      null;
    else
      raise exception 'Jeu de session incompatible (attendu %, reçu %).', v_expected_gid, v_row.game_id;
    end if;
  end if;

  v_phase := v_row.state #>> array[v_state_key, 'phase'];

  if v_kind = 'ready' then
    if v_game = 'tiernight' then
      if jsonb_typeof(p_value) <> 'object' then
        raise exception 'Ready TierNight: objet {ready, expectedSetupEpoch} attendu.';
      end if;
      if jsonb_typeof(p_value -> 'ready') <> 'boolean' then
        raise exception 'Ready TierNight: booléen ready attendu.';
      end if;
      begin
        v_expected_epoch := (p_value ->> 'expectedSetupEpoch')::int;
      exception when others then
        raise exception 'Ready TierNight: expectedSetupEpoch entier requis.';
      end;
      if v_expected_epoch is null or v_expected_epoch < 0 then
        raise exception 'Ready TierNight: expectedSetupEpoch entier requis.';
      end if;

      v_prep_key := case
        when v_screen = 'tiernight-live-prep' then 'tierNightLivePrep'
        else 'tierNightPrep'
      end;

      begin
        v_cur_epoch := coalesce((v_row.state #>> array[v_prep_key, 'setupEpoch'])::int, 0);
      exception when others then
        v_cur_epoch := 0;
      end;
      if v_expected_epoch is distinct from v_cur_epoch then
        raise exception 'Ready obsolète: setupEpoch divergé (% vs %).', v_expected_epoch, v_cur_epoch;
      end if;
      v_ready_bool := p_value -> 'ready';
      p_value := v_ready_bool;
    else
      if v_screen not like '%prep%'
         and v_screen not like '%setup%'
         and v_screen not in ('guesslie-menu', 'guesslie-wait', 'guesslie-setup')
      then
        raise exception 'Ready uniquement en préparation (écran %).', v_screen;
      end if;
      if jsonb_typeof(p_value) <> 'boolean' then
        raise exception 'Ready: booléen attendu.';
      end if;
    end if;
  elsif v_kind = 'pool_invalidate_request' then
    if jsonb_typeof(p_value) <> 'object' then
      raise exception 'pool_invalidate_request: objet {requestId, customEntryId} attendu.';
    end if;
    v_req := left(trim(coalesce(p_value ->> 'requestId', '')), 128);
    v_custom_id := left(trim(coalesce(p_value ->> 'customEntryId', '')), 128);
    if v_req is null or length(v_req) < 1 then
      raise exception 'pool_invalidate_request: requestId requis.';
    end if;
    if v_custom_id is null or length(v_custom_id) < 1 then
      raise exception 'pool_invalidate_request: customEntryId requis.';
    end if;
    for v_entry in
      select value
      from jsonb_array_elements(coalesce(v_row.state -> 'customRosterTopics', '[]'::jsonb))
    loop
      if coalesce(v_entry ->> 'id', '') = v_custom_id
         and coalesce(v_entry ->> 'authorUid', '') = v_uid_text
      then
        v_owned := true;
        exit;
      end if;
    end loop;
    if not v_owned then
      raise exception 'pool_invalidate_request: custom inexistant ou non possédé.';
    end if;
    p_value := to_jsonb(v_req);
  elsif v_kind = 'vote' then
    if v_phase is not null and v_phase not in ('voting','question','display','speak','vote') then
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

  if v_kind = 'pool_invalidate_request' then
    update public.game_sessions gs
    set state = jsonb_set(
          jsonb_set(
            coalesce(gs.state, '{}'::jsonb),
            array['tierNightPrep'],
            coalesce(gs.state -> 'tierNightPrep', '{}'::jsonb),
            true
          ),
          array['tierNightPrep', 'poolInvalidateRequestId'],
          p_value,
          true
        )
    where gs.lobby_id = p_lobby_id
    returning * into v_row;
    return v_row;
  end if;

  if v_kind = 'ready' and v_game = 'tiernight' then
    v_prep_key := case
      when v_screen = 'tiernight-live-prep' then 'tierNightLivePrep'
      else 'tierNightPrep'
    end;
    v_path := array[v_prep_key, 'ready', v_uid_text];
  else
    v_path := array[v_state_key, v_map, v_uid_text];
  end if;

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

comment on function public.contribute_game_session_player(uuid, text, text, jsonb) is
  'Contributions joueur ; ready drawit ; TierNight ready → tierNightPrep|tierNightLivePrep.';

revoke all on function public.contribute_game_session_player(uuid, text, text, jsonb) from public;
revoke all on function public.contribute_game_session_player(uuid, text, text, jsonb) from anon;
grant execute on function public.contribute_game_session_player(uuid, text, text, jsonb) to authenticated;
