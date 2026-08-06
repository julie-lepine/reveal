-- =============================================================================
-- BUG-TIERNIGHT-PREP-GUEST-01 — contributions invité prep série TierNight
-- =============================================================================
-- Base CANONIQUE : feature-vibecheck-01-remove-allowlist.sql (contribute_…)
--   + expectedSetupEpoch (anti-stale ready)
--   + isolation STRICTE game_id / screen pour TierNight prep
--   + pool_invalidate_request lié à un customEntryId appartenant à auth.uid()
--
-- INTERDIT :
--   - booléen nu pour ready tiernight
--   - contournement game_id via `null` interne
--   - LIKE '%prep%' pour contributions TierNight série
--   - game_id='menu' pour TierNight prep (hôte pose toujours game_id=tiernight
--     via enterTierNightSeriesPrep / sync prep)
--
-- Ne modifie PAS D1-bis / finalize / advance / scoring / SERIES-03A.
-- =============================================================================

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
    when 'pool_invalidate_request' then 'poolInvalidateRequestId'
    else null
  end;

  if v_map is null then
    raise exception 'Type de contribution non autorisé: %', p_kind;
  end if;

  -- Compatibilité jeu / kind
  if v_kind = 'ready' and v_game not in (
    'hottake','dilemma','speedvote','clutch','wronganswer','traitre',
    'trivia','consensus','truthmeter','tiernight'
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

  -- -------------------------------------------------------------------------
  -- TierNight prep : isolation STRICTE (pas de bypass null, pas de menu)
  -- Produit : enterTierNightSeriesPrep pose toujours game_id='tiernight'
  --           + screen='tiernight-prep'.
  -- -------------------------------------------------------------------------
  if v_game = 'tiernight' and v_kind in ('ready', 'pool_invalidate_request') then
    if v_row.game_id is distinct from 'tiernight' then
      raise exception
        'Jeu de session incompatible pour TierNight prep (attendu tiernight, reçu %).',
        v_row.game_id;
    end if;
    if v_screen is distinct from 'tiernight-prep' then
      raise exception
        'Contribution TierNight prep uniquement sur tiernight-prep (écran %).',
        v_screen;
    end if;
  elsif v_row.game_id is distinct from v_expected_gid
     and not (v_kind = 'ready' and v_row.game_id in (v_expected_gid, 'menu'))
     and not (v_kind = 'submission' and v_row.game_id in ('guesslie', 'menu'))
  then
    -- Contrats génériques inchangés (autres jeux) — JAMAIS pour TierNight prep
    if v_kind = 'ready' then
      null; -- phase/screen checks below (hottake-prep, etc.)
    elsif v_kind = 'submission' and v_row.screen like 'guesslie%' then
      null;
    elsif v_kind in ('placement','finished') and v_row.game_id = 'tiernight' then
      null;
    else
      raise exception 'Jeu de session incompatible (attendu %, reçu %).', v_expected_gid, v_row.game_id;
    end if;
  end if;

  v_phase := v_row.state #>> array[v_state_key, 'phase'];

  -- Phase / écran checks
  if v_kind = 'ready' then
    if v_game = 'tiernight' then
      -- écran déjà garanti = tiernight-prep ci-dessus
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
      begin
        v_cur_epoch := coalesce((v_row.state #>> '{tierNightPrep,setupEpoch}')::int, 0);
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
    -- Valeur : { requestId, customEntryId } — custom doit exister et appartenir à auth.uid()
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
    -- Persiste uniquement l’id de requête (string) sous tierNightPrep
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

  -- Chemins d'écriture
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
    v_path := array['tierNightPrep', 'ready', v_uid_text];
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

revoke all on function public.contribute_game_session_player(uuid, text, text, jsonb) from public;
revoke all on function public.contribute_game_session_player(uuid, text, text, jsonb) from anon;
grant execute on function public.contribute_game_session_player(uuid, text, text, jsonb) to authenticated;
