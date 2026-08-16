-- =============================================================================
-- FEATURE-DRAWIT-CUSTOM-WORDS-01
-- Mots personnalisés Draw it ! (prépa) via upsert/delete_player_custom_entry.
--
-- Ordre d'application : APRÈS
--   feature-tiernight-03-clear-custom-roster-topics.sql
--   feature-drawit-07-erase-undo.sql
-- Ne PAS exécuter Git. Ne PAS considérer cette migration comme déjà appliquée.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- upsert_player_custom_entry — + drawit (customWords) + lock après launch
-- Base : feature-tiernight-03-clear-custom-roster-topics.sql
-- -----------------------------------------------------------------------------
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
  v_top_level boolean := false;
  v_row public.game_sessions;
  v_arr jsonb;
  v_entry jsonb;
  v_id text;
  v_text_a text;
  v_text_b text;
  v_path text[];
  i int;
  v_found boolean := false;
  v_writable boolean;
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
  elsif v_game = 'drawit' then
    v_state_key := 'drawIt';
    v_array_key := 'customWords';
  elsif v_game = 'tiernight' then
    v_top_level := true;
    v_array_key := 'customRosterTopics';
  else
    raise exception 'Customs uniquement pour Hot Take / Dilemma / Draw it / TierNight.';
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
  elsif v_game = 'dilemma' then
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
  elsif v_game = 'drawit' then
    v_text_a := left(trim(coalesce(p_entry ->> 'text', '')), 160);
    if length(v_text_a) < 1 then
      raise exception 'Texte custom requis.';
    end if;
    v_entry := jsonb_build_object(
      'id', v_id,
      'text', v_text_a,
      'author', v_name,
      'authorUid', v_uid::text
    );
  else
    if v_id not like 'custom-roster-%' then
      v_id := 'custom-roster-' || v_id;
    end if;
    v_text_a := left(trim(coalesce(p_entry ->> 'name', '')), 80);
    if length(v_text_a) < 2 then
      raise exception 'Nom de thème requis.';
    end if;
    v_entry := jsonb_build_object(
      'id', v_id,
      'name', v_text_a,
      'author', v_name,
      'authorUid', v_uid::text,
      'custom', true
    );
  end if;

  select * into v_row
  from public.game_sessions
  where lobby_id = p_lobby_id
  for update;

  if not found then
    raise exception 'Session de jeu introuvable.';
  end if;

  if v_game = 'tiernight' then
    v_writable := public.tiernight_parse_custom_roster_writable(v_row.state);
    if v_writable is not true then
      raise exception 'TNS_CUSTOM_ROSTER_CLOSED';
    end if;
  end if;

  if v_game = 'drawit' then
    if v_row.game_id is distinct from 'drawit' then
      raise exception 'DRAWIT_WRONG_GAME';
    end if;
    if coalesce((v_row.state -> 'drawIt' ->> 'lobbyStarted')::boolean, false) is true
       or length(trim(coalesce(v_row.state -> 'drawIt' ->> 'runId', ''))) > 0 then
      raise exception 'DRAWIT_CUSTOM_LOCKED';
    end if;
  end if;

  if v_top_level then
    v_arr := coalesce(v_row.state -> v_array_key, '[]'::jsonb);
    v_path := array[v_array_key];
  else
    v_arr := coalesce(v_row.state -> v_state_key -> v_array_key, '[]'::jsonb);
    v_path := array[v_state_key, v_array_key];
  end if;
  if jsonb_typeof(v_arr) <> 'array' then
    v_arr := '[]'::jsonb;
  end if;

  for i in 0 .. greatest(jsonb_array_length(v_arr) - 1, -1) loop
    if v_game = 'tiernight' or v_game = 'drawit' then
      if (v_arr -> i ->> 'id') = v_id
         and (
           (v_arr -> i ->> 'authorUid') = v_uid::text
           or (
             coalesce(v_arr -> i ->> 'authorUid', '') = ''
             and (v_arr -> i ->> 'author') = v_name
           )
         ) then
        v_arr := jsonb_set(v_arr, array[i::text], v_entry, false);
        v_found := true;
        exit;
      end if;
    else
      if (v_arr -> i ->> 'id') = v_id and (v_arr -> i ->> 'author') = v_name then
        v_arr := jsonb_set(v_arr, array[i::text], v_entry, false);
        v_found := true;
        exit;
      end if;
    end if;
  end loop;

  if not v_found then
    v_arr := v_arr || jsonb_build_array(v_entry);
  end if;

  update public.game_sessions gs
  set state = jsonb_set(
        coalesce(gs.state, '{}'::jsonb),
        v_path,
        v_arr,
        true
      )
  where gs.lobby_id = p_lobby_id
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.upsert_player_custom_entry(uuid, text, jsonb) from public;
revoke all on function public.upsert_player_custom_entry(uuid, text, jsonb) from anon;
grant execute on function public.upsert_player_custom_entry(uuid, text, jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- delete_player_custom_entry — + drawit + lock après launch
-- Base : feature-tiernight-02-lost-update-fix.sql
-- -----------------------------------------------------------------------------
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
  v_top_level boolean := false;
  v_row public.game_sessions;
  v_arr jsonb;
  v_next jsonb := '[]'::jsonb;
  v_path text[];
  i int;
  v_item jsonb;
  v_owned boolean;
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
  elsif v_game = 'drawit' then
    v_state_key := 'drawIt';
    v_array_key := 'customWords';
  elsif v_game = 'tiernight' then
    v_top_level := true;
    v_array_key := 'customRosterTopics';
  else
    raise exception 'Customs uniquement pour Hot Take / Dilemma / Draw it / TierNight.';
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

  if v_game = 'drawit' then
    if v_row.game_id is distinct from 'drawit' then
      raise exception 'DRAWIT_WRONG_GAME';
    end if;
    if coalesce((v_row.state -> 'drawIt' ->> 'lobbyStarted')::boolean, false) is true
       or length(trim(coalesce(v_row.state -> 'drawIt' ->> 'runId', ''))) > 0 then
      raise exception 'DRAWIT_CUSTOM_LOCKED';
    end if;
  end if;

  if v_top_level then
    v_arr := coalesce(v_row.state -> v_array_key, '[]'::jsonb);
    v_path := array[v_array_key];
  else
    v_arr := coalesce(v_row.state -> v_state_key -> v_array_key, '[]'::jsonb);
    v_path := array[v_state_key, v_array_key];
  end if;

  for i in 0 .. greatest(jsonb_array_length(v_arr) - 1, -1) loop
    v_item := v_arr -> i;
    if (v_item ->> 'id') = p_entry_id then
      if v_game = 'tiernight' or v_game = 'drawit' then
        v_owned :=
          (v_item ->> 'authorUid') = v_uid::text
          or (
            coalesce(v_item ->> 'authorUid', '') = ''
            and (v_item ->> 'author') is not distinct from v_name
          );
      else
        v_owned := (v_item ->> 'author') is not distinct from v_name;
      end if;
      if not v_owned then
        raise exception 'Tu ne peux supprimer que tes propres customs.';
      end if;
    else
      v_next := v_next || jsonb_build_array(v_item);
    end if;
  end loop;

  update public.game_sessions gs
  set state = jsonb_set(
        coalesce(gs.state, '{}'::jsonb),
        v_path,
        v_next,
        true
      )
  where gs.lobby_id = p_lobby_id
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.delete_player_custom_entry(uuid, text, text) from public;
revoke all on function public.delete_player_custom_entry(uuid, text, text) from anon;
grant execute on function public.delete_player_custom_entry(uuid, text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- launch_drawit_game — ne jamais publier customWords après launch
-- Base : feature-drawit-02-private-word.sql
-- -----------------------------------------------------------------------------
create or replace function public.launch_drawit_game(
  p_lobby_id uuid,
  p_drawit jsonb,
  p_rounds jsonb
)
returns public.game_sessions
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.game_sessions;
  v_run text;
  v_round_count int;
  v_drawer text;
  v_start timestamptz;
  v_end timestamptz;
  v_di jsonb;
begin
  if v_uid is null then
    raise exception 'Authentification requise.';
  end if;
  if not (public.is_lobby_host(p_lobby_id) or public.is_acting_host(p_lobby_id)) then
    raise exception 'Action réservée à l''hôte ou à l''acting host.';
  end if;

  select * into v_row
  from public.game_sessions
  where lobby_id = p_lobby_id
  for update;

  if not found then
    raise exception 'Session de jeu introuvable.';
  end if;
  if v_row.game_id is distinct from 'drawit' then
    raise exception 'DRAWIT_WRONG_GAME';
  end if;
  if p_drawit is null or jsonb_typeof(p_drawit) <> 'object' then
    raise exception 'DRAWIT_INVALID_LAUNCH';
  end if;

  v_run := trim(coalesce(p_drawit->>'runId', ''));
  v_round_count := coalesce((p_drawit->>'roundCount')::int, 0);
  v_drawer := coalesce(p_drawit->>'drawerUid', '');
  if v_run = ''
     or coalesce((p_drawit->>'lobbyStarted')::boolean, false) is not true
     or coalesce(p_drawit->>'phase', '') <> 'drawing'
     or coalesce((p_drawit->>'roundIdx')::int, -1) <> 0
     or v_round_count < 1
     or p_rounds is null
     or jsonb_typeof(p_rounds) <> 'array'
     or jsonb_array_length(p_rounds) <> v_round_count
     or jsonb_typeof(coalesce(p_drawit->'drawerOrder', 'null'::jsonb)) <> 'array'
     or jsonb_array_length(p_drawit->'drawerOrder') < 1
     or (p_drawit->'drawerOrder'->>0) is distinct from v_drawer
  then
    raise exception 'DRAWIT_INVALID_LAUNCH';
  end if;
  if p_drawit ?| array['wordId','wordLabel','deck','words','acceptedAnswers'] then
    raise exception 'DRAWIT_PUBLIC_SECRET';
  end if;

  perform public.write_drawit_private_rounds(p_lobby_id, v_run, p_rounds);

  v_start := clock_timestamp();
  v_end := v_start + interval '60 seconds';
  v_di := (p_drawit - 'roundStartAt' - 'roundEndsAt' - 'customWords')
    || jsonb_build_object(
      'roundIdx', 0,
      'phase', 'drawing',
      'roundStartAt', to_jsonb(v_start),
      'roundEndsAt', to_jsonb(v_end),
      'roundScored', false,
      'lastRound', null,
      'matchScores', '{}'::jsonb,
      'foundOrder', '[]'::jsonb,
      'guesses', '[]'::jsonb,
      'strokes', '[]'::jsonb,
      'canvasEpoch', 0,
      'strokeSeq', 0
    );

  update public.game_sessions
  set game_id = 'drawit',
      screen = 'drawit',
      state = jsonb_set(coalesce(state, '{}'::jsonb), '{drawIt}', v_di, true)
  where lobby_id = p_lobby_id
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.launch_drawit_game(uuid, jsonb, jsonb) from public;
grant execute on function public.launch_drawit_game(uuid, jsonb, jsonb) to authenticated;
