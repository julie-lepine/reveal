-- FEATURE-TIERNIGHT-04C — customs Rank Live partagés (customLiveTierLists)
--
-- RPC dédiées (ne surcharge PAS upsert_player_custom_entry HT/Dilemma/roster).
-- Idempotent : CREATE OR REPLACE.
-- Déployer après feature-tiernight-03-clear-custom-roster-topics.sql.
--
-- Preserve : étend upsert_game_session_preserving_roster_topics pour aussi
-- conserver customLiveTierLists (additif, sans amputation des callers roster).

-- ---------------------------------------------------------------------------
-- Helpers : writable + lock predicate (prep ouvert / série lancée verrouillée)
-- ---------------------------------------------------------------------------

create or replace function public.tiernight_parse_custom_live_writable(p_state jsonb)
returns boolean
language plpgsql
immutable
as $$
declare
  v_raw jsonb;
begin
  if p_state is null or jsonb_typeof(p_state) <> 'object' then
    return true;
  end if;
  if not (p_state ? 'customLiveTierListsWritable') then
    return true;
  end if;
  v_raw := p_state -> 'customLiveTierListsWritable';
  if v_raw is null or jsonb_typeof(v_raw) = 'null' then
    return true;
  end if;
  if jsonb_typeof(v_raw) = 'boolean' then
    return (v_raw = 'true'::jsonb);
  end if;
  -- Valeurs invalides → fermé (défensif)
  return false;
end;
$$;

comment on function public.tiernight_parse_custom_live_writable(jsonb) is
  'FEATURE-TIERNIGHT-04C — missing/null = open ; false = closed ; invalid = closed';

revoke all on function public.tiernight_parse_custom_live_writable(jsonb) from public;
revoke all on function public.tiernight_parse_custom_live_writable(jsonb) from anon;
revoke all on function public.tiernight_parse_custom_live_writable(jsonb) from authenticated;

-- Pool writable pendant prep. Verrouillé dès launch (writable=false OU série live
-- active OU Rank Live mono legacy lobbyStarted && not finished).
create or replace function public.tiernight_live_custom_pool_writable(p_state jsonb)
returns boolean
language plpgsql
immutable
as $$
declare
  v_live jsonb;
  v_series jsonb;
  v_started boolean;
  v_finished boolean;
begin
  if not public.tiernight_parse_custom_live_writable(p_state) then
    return false;
  end if;

  if p_state is null or jsonb_typeof(p_state) <> 'object' then
    return true;
  end if;

  v_live := p_state -> 'tierNightLive';
  if v_live is null or jsonb_typeof(v_live) <> 'object' then
    return true;
  end if;

  v_series := v_live -> 'series';
  if v_series is not null
     and jsonb_typeof(v_series) = 'object'
     and coalesce(v_series ->> 'kind', '') = 'live' then
    return false;
  end if;

  v_started := coalesce((v_live ->> 'lobbyStarted')::boolean, false);
  -- finished peut être bool live ou objet legacy ; bool true = terminé
  if jsonb_typeof(v_live -> 'finished') = 'boolean' then
    v_finished := (v_live -> 'finished') = 'true'::jsonb;
  else
    v_finished := false;
  end if;

  if v_started and not v_finished then
    return false;
  end if;

  return true;
end;
$$;

comment on function public.tiernight_live_custom_pool_writable(jsonb) is
  'FEATURE-TIERNIGHT-04C — true = prep contributions OK ; false = launch lock';

revoke all on function public.tiernight_live_custom_pool_writable(jsonb) from public;
revoke all on function public.tiernight_live_custom_pool_writable(jsonb) from anon;
revoke all on function public.tiernight_live_custom_pool_writable(jsonb) from authenticated;

-- ---------------------------------------------------------------------------
-- Validate + build server entry (create-only semantics)
-- ---------------------------------------------------------------------------

create or replace function public.tiernight_live_build_custom_entry(
  p_entry jsonb,
  p_author text,
  p_author_uid text
)
returns jsonb
language plpgsql
immutable
as $$
declare
  v_id text;
  v_name text;
  v_emoji text;
  v_items jsonb;
  v_item text;
  v_norm text;
  v_seen text[] := array[]::text[];
  v_out_items jsonb := '[]'::jsonb;
  v_i int;
  v_len int;
  v_entry jsonb;
begin
  if p_entry is null or jsonb_typeof(p_entry) <> 'object' then
    raise exception 'Entrée custom live invalide.';
  end if;

  if octet_length(p_entry::text) > 4096 then
    raise exception 'Entrée custom live trop volumineuse.';
  end if;

  -- ID : contrat JS 04B = prefix `custom-live-` + suffixe non vide
  -- (isCustomLiveTierListId). createCustomLiveTierListId préfère un UUID
  -- mais le fallback non-UUID reste accepté. Pas d'exigence UUID stricte SQL.
  v_id := trim(coalesce(p_entry ->> 'id', ''));
  if v_id not like 'custom-live-%' or length(v_id) <= length('custom-live-') then
    raise exception 'ID custom live invalide.';
  end if;

  -- custom doit être présent et boolean JSON true (pas de réparation silencieuse).
  if not (p_entry ? 'custom')
     or jsonb_typeof(p_entry -> 'custom') <> 'boolean'
     or (p_entry -> 'custom') is distinct from 'true'::jsonb then
    raise exception 'Flag custom live invalide.';
  end if;

  -- Bornes length() = caractères Unicode Postgres.
  -- 04B JS utilise String.length UTF-16 : pas d'équivalence stricte.
  -- Serveur : trim puis reject hors [2,40] — JAMAIS de troncature silencieuse.
  v_name := trim(coalesce(p_entry ->> 'name', ''));
  if length(v_name) < 2 then
    raise exception 'Nom de tier list requis.';
  end if;
  if length(v_name) > 40 then
    raise exception 'Nom de tier list trop long.';
  end if;

  -- emoji : absent/vide → ✨ (aligné normalize 04B) ; non vide hors borne → reject.
  v_emoji := trim(coalesce(p_entry ->> 'emoji', ''));
  if length(v_emoji) < 1 then
    v_emoji := '✨';
  elsif length(v_emoji) > 4 then
    raise exception 'Emoji custom live trop long.';
  end if;

  v_items := p_entry -> 'items';
  if v_items is null or jsonb_typeof(v_items) <> 'array' then
    raise exception 'Items custom live invalides.';
  end if;

  v_len := jsonb_array_length(v_items);
  if v_len < 4 or v_len > 16 then
    raise exception 'Nombre d''items custom live invalide.';
  end if;

  for v_i in 0 .. v_len - 1 loop
    if jsonb_typeof(v_items -> v_i) <> 'string' then
      raise exception 'Item custom live invalide.';
    end if;
    v_item := trim(coalesce(v_items ->> v_i, ''));
    if length(v_item) < 1 then
      raise exception 'Item custom live vide.';
    end if;
    if length(v_item) > 40 then
      raise exception 'Item custom live trop long.';
    end if;
    v_norm := lower(v_item);
    if v_norm = any (v_seen) then
      raise exception 'Items custom live en doublon.';
    end if;
    v_seen := array_append(v_seen, v_norm);
    v_out_items := v_out_items || jsonb_build_array(v_item);
  end loop;

  if p_author is null or length(trim(p_author)) < 1 then
    raise exception 'Auteur custom live requis.';
  end if;
  if p_author_uid is null or length(trim(p_author_uid)) < 1 then
    raise exception 'authorUid custom live requis.';
  end if;

  v_entry := jsonb_build_object(
    'id', v_id,
    'name', v_name,
    'emoji', v_emoji,
    'items', v_out_items,
    'author', trim(p_author),
    'authorUid', trim(p_author_uid),
    'custom', true
  );

  if octet_length(v_entry::text) > 4096 then
    raise exception 'Entrée custom live trop volumineuse.';
  end if;

  return v_entry;
end;
$$;

revoke all on function public.tiernight_live_build_custom_entry(jsonb, text, text) from public;
revoke all on function public.tiernight_live_build_custom_entry(jsonb, text, text) from anon;
revoke all on function public.tiernight_live_build_custom_entry(jsonb, text, text) from authenticated;

-- ---------------------------------------------------------------------------
-- UPSERT (create-only + idempotent retry same payload)
-- ---------------------------------------------------------------------------

create or replace function public.upsert_player_custom_live_tier_list(
  p_lobby_id uuid,
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
  v_row public.game_sessions;
  v_arr jsonb;
  v_entry jsonb;
  v_id text;
  v_i int;
  v_found boolean := false;
  v_existing jsonb;
begin
  v_uid := public.assert_lobby_member(p_lobby_id);

  select display_name into v_name
  from public.lobby_members
  where lobby_id = p_lobby_id and user_id = v_uid;

  if v_name is null or length(trim(v_name)) < 1 then
    raise exception 'Pseudo introuvable.';
  end if;

  v_entry := public.tiernight_live_build_custom_entry(
    p_entry,
    v_name,
    v_uid::text
  );
  v_id := v_entry ->> 'id';

  select * into v_row
  from public.game_sessions
  where lobby_id = p_lobby_id
  for update;

  if not found then
    raise exception 'Session de jeu introuvable.';
  end if;

  if not public.tiernight_live_custom_pool_writable(v_row.state) then
    raise exception 'TNS_LIVE_CUSTOM_LOCKED';
  end if;

  v_arr := coalesce(v_row.state -> 'customLiveTierLists', '[]'::jsonb);
  if jsonb_typeof(v_arr) <> 'array' then
    v_arr := '[]'::jsonb;
  end if;

  for v_i in 0 .. greatest(jsonb_array_length(v_arr) - 1, -1) loop
    if (v_arr -> v_i ->> 'id') = v_id then
      v_found := true;
      v_existing := v_arr -> v_i;
      if coalesce(v_existing ->> 'authorUid', '') is distinct from v_uid::text then
        raise exception 'TNS_LIVE_CUSTOM_NOT_OWNER';
      end if;
      -- Create/delete only : même contenu = retry idempotent ; sinon refuse l''édition.
      if v_existing is not distinct from v_entry then
        return v_row;
      end if;
      raise exception 'TNS_LIVE_CUSTOM_EDIT_FORBIDDEN';
    end if;
  end loop;

  if not v_found then
    v_arr := v_arr || jsonb_build_array(v_entry);
  end if;

  update public.game_sessions gs
  set state = jsonb_set(
        coalesce(gs.state, '{}'::jsonb),
        '{customLiveTierLists}',
        v_arr,
        true
      ),
      updated_at = now()
  where gs.lobby_id = p_lobby_id
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.upsert_player_custom_live_tier_list(uuid, jsonb) from public;
revoke all on function public.upsert_player_custom_live_tier_list(uuid, jsonb) from anon;
grant execute on function public.upsert_player_custom_live_tier_list(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- DELETE own (UID only — no display-name fallback)
-- ---------------------------------------------------------------------------

create or replace function public.delete_player_custom_live_tier_list(
  p_lobby_id uuid,
  p_entry_id text
)
returns public.game_sessions
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid;
  v_row public.game_sessions;
  v_arr jsonb;
  v_next jsonb := '[]'::jsonb;
  v_i int;
  v_id text := trim(coalesce(p_entry_id, ''));
  v_entry jsonb;
begin
  v_uid := public.assert_lobby_member(p_lobby_id);

  if length(v_id) < 1 then
    raise exception 'ID custom live requis.';
  end if;

  select * into v_row
  from public.game_sessions
  where lobby_id = p_lobby_id
  for update;

  if not found then
    raise exception 'Session de jeu introuvable.';
  end if;

  if not public.tiernight_live_custom_pool_writable(v_row.state) then
    raise exception 'TNS_LIVE_CUSTOM_LOCKED';
  end if;

  v_arr := coalesce(v_row.state -> 'customLiveTierLists', '[]'::jsonb);
  if jsonb_typeof(v_arr) <> 'array' then
    v_arr := '[]'::jsonb;
  end if;

  for v_i in 0 .. greatest(jsonb_array_length(v_arr) - 1, -1) loop
    v_entry := v_arr -> v_i;
    if (v_entry ->> 'id') = v_id then
      if coalesce(v_entry ->> 'authorUid', '') is distinct from v_uid::text then
        raise exception 'TNS_LIVE_CUSTOM_NOT_OWNER';
      end if;
      -- owned : skip (delete)
      continue;
    end if;
    v_next := v_next || jsonb_build_array(v_entry);
  end loop;

  update public.game_sessions gs
  set state = jsonb_set(
        coalesce(gs.state, '{}'::jsonb),
        '{customLiveTierLists}',
        v_next,
        true
      ),
      updated_at = now()
  where gs.lobby_id = p_lobby_id
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.delete_player_custom_live_tier_list(uuid, text) from public;
revoke all on function public.delete_player_custom_live_tier_list(uuid, text) from anon;
grant execute on function public.delete_player_custom_live_tier_list(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- CLEAR ALL (autoritatif — déclenchement métier 04F/04G ; API prête en 04C)
-- ---------------------------------------------------------------------------

create or replace function public.clear_tiernight_custom_live_tier_lists(
  p_lobby_id uuid,
  p_expected_session_id uuid,
  p_reopen boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid;
  v_row public.game_sessions;
  v_epoch int;
  v_next jsonb;
  v_lists jsonb;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Authentification requise.';
  end if;

  -- Host canonique lobby : is_lobby_host(uuid) (game-sessions-i08-arch03).
  -- Identité = auth.uid() interne — PAS acting-host (clear lifecycle = host réel).
  if not public.is_lobby_host(p_lobby_id) then
    raise exception 'Hôte requis.';
  end if;

  select * into v_row
  from public.game_sessions
  where lobby_id = p_lobby_id
  for update;

  if not found then
    if p_reopen then
      return jsonb_build_object('ok', false, 'code', 'SESSION_ABSENT_CANNOT_REOPEN');
    end if;
    return jsonb_build_object('ok', true, 'code', 'SESSION_ABSENT');
  end if;

  if p_expected_session_id is null or v_row.id is distinct from p_expected_session_id then
    return jsonb_build_object('ok', false, 'code', 'STALE_SESSION');
  end if;

  v_lists := coalesce(v_row.state -> 'customLiveTierLists', '[]'::jsonb);
  if jsonb_typeof(v_lists) <> 'array' then
    v_lists := '[]'::jsonb;
  end if;

  v_epoch := coalesce((v_row.state ->> 'customLiveTierListsEpoch')::int, 0);
  if jsonb_array_length(v_lists) = 0
     and public.tiernight_parse_custom_live_writable(v_row.state) = p_reopen
     and (v_row.state ? 'customLiveTierListsEpoch') then
    return jsonb_build_object(
      'ok', true,
      'code', 'ALREADY_CANONICAL',
      'epoch', v_epoch,
      'writable', p_reopen
    );
  end if;

  if v_epoch >= 2147483647 then
    return jsonb_build_object('ok', false, 'code', 'CUSTOM_LIVE_EPOCH_EXHAUSTED');
  end if;
  v_epoch := v_epoch + 1;

  v_next := coalesce(v_row.state, '{}'::jsonb);
  v_next := jsonb_set(v_next, '{customLiveTierLists}', '[]'::jsonb, true);
  v_next := jsonb_set(v_next, '{customLiveTierListsEpoch}', to_jsonb(v_epoch), true);
  v_next := jsonb_set(v_next, '{customLiveTierListsWritable}', to_jsonb(p_reopen), true);

  update public.game_sessions
  set state = v_next, updated_at = now()
  where lobby_id = p_lobby_id;

  return jsonb_build_object(
    'ok', true,
    'code', 'CLEARED',
    'epoch', v_epoch,
    'writable', p_reopen
  );
end;
$$;

revoke all on function public.clear_tiernight_custom_live_tier_lists(uuid, uuid, boolean) from public;
revoke all on function public.clear_tiernight_custom_live_tier_lists(uuid, uuid, boolean) from anon;
grant execute on function public.clear_tiernight_custom_live_tier_lists(uuid, uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Full-state replace : preserve roster + live customs (additif)
-- ---------------------------------------------------------------------------

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
  v_live jsonb;
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
    v_live := coalesce(v_row.state -> 'customLiveTierLists', '[]'::jsonb);
  else
    v_topics := '[]'::jsonb;
    v_live := '[]'::jsonb;
  end if;
  if jsonb_typeof(v_topics) <> 'array' then
    v_topics := '[]'::jsonb;
  end if;
  if jsonb_typeof(v_live) <> 'array' then
    v_live := '[]'::jsonb;
  end if;

  -- Roster : sémantique TN02 inchangée (hint client si base vide).
  if jsonb_array_length(v_topics) = 0
     and p_state is not null
     and jsonb_typeof(p_state -> 'customRosterTopics') = 'array'
     and jsonb_array_length(p_state -> 'customRosterTopics') > 0 then
    v_topics := p_state -> 'customRosterTopics';
  end if;

  -- Live : même hint réparation, SAUF après clear autoritatif (epoch présent + []).
  -- Empêche un startGameSession stale de ressusciter customLiveTierLists post-clear.
  if jsonb_array_length(v_live) = 0
     and not (found and (v_row.state ? 'customLiveTierListsEpoch'))
     and p_state is not null
     and jsonb_typeof(p_state -> 'customLiveTierLists') = 'array'
     and jsonb_array_length(p_state -> 'customLiveTierLists') > 0 then
    v_live := p_state -> 'customLiveTierLists';
  end if;

  v_next := jsonb_set(
    coalesce(p_state, '{}'::jsonb),
    '{customRosterTopics}',
    v_topics,
    true
  );
  v_next := jsonb_set(v_next, '{customLiveTierLists}', v_live, true);

  -- Preserve epoch/writable companions when present on server (anti stale wipe).
  if found then
    if (v_row.state ? 'customRosterTopicsEpoch') then
      v_next := jsonb_set(v_next, '{customRosterTopicsEpoch}', v_row.state -> 'customRosterTopicsEpoch', true);
    end if;
    if (v_row.state ? 'customRosterTopicsWritable') then
      v_next := jsonb_set(v_next, '{customRosterTopicsWritable}', v_row.state -> 'customRosterTopicsWritable', true);
    end if;
    if (v_row.state ? 'customLiveTierListsEpoch') then
      v_next := jsonb_set(v_next, '{customLiveTierListsEpoch}', v_row.state -> 'customLiveTierListsEpoch', true);
    end if;
    if (v_row.state ? 'customLiveTierListsWritable') then
      v_next := jsonb_set(v_next, '{customLiveTierListsWritable}', v_row.state -> 'customLiveTierListsWritable', true);
    end if;
  end if;

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
revoke all on function public.upsert_game_session_preserving_roster_topics(uuid, text, text, jsonb) from anon;
grant execute on function public.upsert_game_session_preserving_roster_topics(uuid, text, text, jsonb) to authenticated;
