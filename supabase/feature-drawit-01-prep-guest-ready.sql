-- FEATURE-DRAWIT-01 — Draw it ! : mapping session + ready invité (prépa)
--
-- T2 sync/routing uniquement. N'ajoute PAS de vote / guess / canvas.
-- Redéfinit (CREATE OR REPLACE) les fonctions dont l'allowlist ready
-- et le mapping game_id → blob doivent inclure `drawit`.
--
-- Sources (version active reprise ici) :
--   - game_session_state_key         <- supabase/feature-vibecheck-01-remove-allowlist.sql
--   - game_session_expected_game_id  <- supabase/feature-vibecheck-01-remove-allowlist.sql
--   - contribute_game_session_player <- supabase/feature-vibecheck-01-remove-allowlist.sql
--
-- Ce fichier NE doit PAS être appliqué automatiquement par le client.
-- Migration distante = hors ticket T2.

-- ---------------------------------------------------------------------------
-- 1) game_session_state_key / game_session_expected_game_id
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

-- ---------------------------------------------------------------------------
-- 2) contribute_game_session_player — ready Draw it ! uniquement
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
    'trivia','consensus','truthmeter','drawit'
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
