-- FEATURE-TIERNIGHT-02 (correctif lost-update) — authorUid + préservation atomique
--
-- Déployer APRÈS feature-tiernight-02-custom-roster-sync.sql
-- Idempotent : CREATE OR REPLACE.
--
-- 1) upsert/delete tiernight : authorUid = auth.uid() (propriété stable au rename)
-- 2) upsert_game_session_preserving_roster_topics : replace state sans écraser
--    customRosterTopics (FOR UPDATE — sérialise avec upsert_player_custom_entry)

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
  elsif v_game = 'tiernight' then
    v_top_level := true;
    v_array_key := 'customRosterTopics';
  else
    raise exception 'Customs uniquement pour Hot Take / Dilemma / TierNight.';
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
  else
    if v_id not like 'custom-roster-%' then
      v_id := 'custom-roster-' || v_id;
    end if;
    v_text_a := left(trim(coalesce(p_entry ->> 'name', '')), 80);
    if length(v_text_a) < 2 then
      raise exception 'Nom de thème requis.';
    end if;
    -- authorUid canonique (auth) ; author = display name cosmétique
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
    if v_game = 'tiernight' then
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
  elsif v_game = 'tiernight' then
    v_top_level := true;
    v_array_key := 'customRosterTopics';
  else
    raise exception 'Customs uniquement pour Hot Take / Dilemma / TierNight.';
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
      if v_game = 'tiernight' then
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
      -- skip (delete)
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
grant execute on function public.delete_player_custom_entry(uuid, text, text) to authenticated;

-- Replace complet de session : conserve customRosterTopics déjà en base (anti lost-update).
create or replace function public.upsert_game_session_preserving_roster_topics(
  p_lobby_id uuid,
  p_game_id text,
  p_screen text,
  p_state jsonb
)
returns public.game_sessions
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid;
  v_row public.game_sessions;
  v_topics jsonb;
  v_next jsonb;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Authentification requise.';
  end if;

  if not exists (
    select 1 from public.lobbies l
    where l.id = p_lobby_id and l.host_id = v_uid
  ) then
    raise exception 'Hôte requis.';
  end if;

  select * into v_row
  from public.game_sessions
  where lobby_id = p_lobby_id
  for update;

  if found then
    v_topics := coalesce(v_row.state -> 'customRosterTopics', '[]'::jsonb);
  else
    v_topics := '[]'::jsonb;
  end if;
  if jsonb_typeof(v_topics) <> 'array' then
    v_topics := '[]'::jsonb;
  end if;

  v_next := jsonb_set(
    coalesce(p_state, '{}'::jsonb),
    '{customRosterTopics}',
    v_topics,
    true
  );

  if found then
    update public.game_sessions gs
    set
      game_id = coalesce(nullif(trim(p_game_id), ''), gs.game_id),
      screen = coalesce(nullif(trim(p_screen), ''), gs.screen),
      host_id = v_uid,
      state = v_next,
      updated_at = now()
    where gs.lobby_id = p_lobby_id
    returning * into v_row;
  else
    insert into public.game_sessions (lobby_id, game_id, screen, host_id, state)
    values (
      p_lobby_id,
      coalesce(nullif(trim(p_game_id), ''), 'menu'),
      coalesce(nullif(trim(p_screen), ''), 'game-select'),
      v_uid,
      v_next
    )
    returning * into v_row;
  end if;

  return v_row;
end;
$$;

revoke all on function public.upsert_game_session_preserving_roster_topics(uuid, text, text, jsonb) from public;
grant execute on function public.upsert_game_session_preserving_roster_topics(uuid, text, text, jsonb) to authenticated;
