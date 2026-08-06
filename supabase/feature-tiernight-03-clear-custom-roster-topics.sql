-- =============================================================================
-- FEATURE-TIERNIGHT-03 — clear distant autoritatif customRosterTopics (hôte réel)
-- =============================================================================
-- Problème : clear client ownership-only ; invité déconnecté laisse des customs
--            en remote ; patch générique / upsert_preserving refusent [] .
--
-- Solution : RPC host-only CAS (expected session id) + vide collection + bump
--            epoch + flag writable ; canonisation JSON stricte.
--
-- Ne modifie PAS : D1-bis / finalize / advance / scoring / contribute_game_session_player.
--
-- Base upsert : feature-tiernight-02-lost-update-fix.sql
--   (dernière déf. incluant Hot Take + Dilemma multi-append + TierNight authorUid).
--   feature-dilemma-01-multi-custom.sql est chronologiquement postérieure mais
--   RÉGRESSE TierNight (branche retirée) — ne pas l’utiliser comme base.
-- Diff upsert minimal vs lost-update :
--   - v_writable + parse défensif
--   - rejet TNS_CUSTOM_ROSTER_CLOSED après FOR UPDATE
--   - ACL revoke anon explicite
--
-- Isolation métier (décision B) : customRosterTopics top-level ; pas d’exigence
--   game_id='tiernight'. Protection stale SERVEUR : p_expected_session_id (CAS).
--   RPC ne touche jamais customTierLists.
--
-- Canonicalité (politique A) : clés epoch/writable absentes = lisibles en
--   compat mais NON canoniques → premier clear canonise (applied:true).
-- ALREADY_CANONICAL seulement si le JSON brut est déjà la représentation stricte.
-- Epoch : max 2147483647 ; mutation requise à max → CUSTOM_ROSTER_EPOCH_EXHAUSTED
--   (pas de wrap / reset). ALREADY_CANONICAL autorisé à epoch max (pas de bump).
--
-- Atomicité : tout le fichier dans BEGIN…COMMIT (une unité transactionnelle PG).
-- Préflight lecture seule AVANT apply :
--   feature-tiernight-03-clear-custom-roster-topics-preflight.sql
--
-- NE PAS appliquer sans préflight + harness staging verts.
-- =============================================================================

begin;
-- -----------------------------------------------------------------------------
-- Helpers parsing / canonicité (owner-only EXECUTE — appelés via SECURITY DEFINER)
-- -----------------------------------------------------------------------------
create or replace function public.tiernight_parse_custom_roster_epoch(p_state jsonb)
returns integer
language plpgsql
immutable
set search_path = pg_catalog, public
as $$
declare
  v_raw jsonb;
  v_t text;
  v_n numeric;
begin
  if p_state is null or jsonb_typeof(p_state) <> 'object' then
    return 0;
  end if;
  if not (p_state ? 'customRosterTopicsEpoch') then
    return 0;
  end if;
  v_raw := p_state -> 'customRosterTopicsEpoch';
  if v_raw is null or jsonb_typeof(v_raw) = 'null' then
    return 0;
  end if;
  if jsonb_typeof(v_raw) = 'number' then
    v_n := (v_raw #>> '{}')::numeric;
    if v_n is null or v_n < 0 or v_n > 2147483647 then
      return 0;
    end if;
    return trunc(v_n)::integer;
  end if;
  if jsonb_typeof(v_raw) = 'string' then
    v_t := trim(v_raw #>> '{}');
    if v_t = '' or v_t !~ '^[0-9]+$' then
      return 0;
    end if;
    begin
      v_n := v_t::numeric;
    exception when others then
      return 0;
    end;
    if v_n > 2147483647 then
      return 0;
    end if;
    return trunc(v_n)::integer;
  end if;
  return 0;
end;
$$;

create or replace function public.tiernight_parse_custom_roster_writable(p_state jsonb)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, public
as $$
declare
  v_raw jsonb;
  v_t text;
begin
  -- Absente / null → legacy ouverte (compat lecture TN-02). Pas canonique stocké.
  if p_state is null or jsonb_typeof(p_state) <> 'object' then
    return true;
  end if;
  if not (p_state ? 'customRosterTopicsWritable') then
    return true;
  end if;
  v_raw := p_state -> 'customRosterTopicsWritable';
  if v_raw is null or jsonb_typeof(v_raw) = 'null' then
    return true;
  end if;
  if jsonb_typeof(v_raw) = 'boolean' then
    return (v_raw = 'true'::jsonb);
  end if;
  if jsonb_typeof(v_raw) = 'string' then
    v_t := lower(trim(v_raw #>> '{}'));
    if v_t in ('true', 't', '1') then
      return true;
    end if;
    if v_t in ('false', 'f', '0') then
      return false;
    end if;
    return false;
  end if;
  return false;
end;
$$;

-- Représentation canonique brute pour ALREADY_CANONICAL (politique A).
create or replace function public.tiernight_is_custom_roster_clear_canonical(
  p_state jsonb,
  p_target_writable boolean
)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, public
as $$
declare
  v_topics jsonb;
  v_writable jsonb;
  v_epoch jsonb;
  v_n numeric;
begin
  if p_state is null or jsonb_typeof(p_state) <> 'object' then
    return false;
  end if;

  if not (p_state ? 'customRosterTopics') then
    return false;
  end if;
  v_topics := p_state -> 'customRosterTopics';
  if v_topics is null
     or jsonb_typeof(v_topics) <> 'array'
     or jsonb_array_length(v_topics) <> 0 then
    return false;
  end if;

  if not (p_state ? 'customRosterTopicsWritable') then
    return false;
  end if;
  v_writable := p_state -> 'customRosterTopicsWritable';
  if v_writable is null or jsonb_typeof(v_writable) <> 'boolean' then
    return false;
  end if;
  if (v_writable = 'true'::jsonb) is distinct from coalesce(p_target_writable, false) then
    return false;
  end if;

  if not (p_state ? 'customRosterTopicsEpoch') then
    return false;
  end if;
  v_epoch := p_state -> 'customRosterTopicsEpoch';
  if v_epoch is null or jsonb_typeof(v_epoch) <> 'number' then
    return false;
  end if;
  begin
    v_n := (v_epoch #>> '{}')::numeric;
  exception when others then
    return false;
  end;
  if v_n is null or v_n < 0 or v_n > 2147483647 then
    return false;
  end if;
  -- Entier strict (rejette 1.7, etc.)
  if v_n <> trunc(v_n) then
    return false;
  end if;

  return true;
end;
$$;

revoke all on function public.tiernight_parse_custom_roster_epoch(jsonb) from public;
revoke all on function public.tiernight_parse_custom_roster_epoch(jsonb) from anon;
revoke all on function public.tiernight_parse_custom_roster_epoch(jsonb) from authenticated;

revoke all on function public.tiernight_parse_custom_roster_writable(jsonb) from public;
revoke all on function public.tiernight_parse_custom_roster_writable(jsonb) from anon;
revoke all on function public.tiernight_parse_custom_roster_writable(jsonb) from authenticated;

revoke all on function public.tiernight_is_custom_roster_clear_canonical(jsonb, boolean) from public;
revoke all on function public.tiernight_is_custom_roster_clear_canonical(jsonb, boolean) from anon;
revoke all on function public.tiernight_is_custom_roster_clear_canonical(jsonb, boolean) from authenticated;

-- Remplace l’ancienne signature (uuid, boolean) si présente.
drop function if exists public.clear_tiernight_custom_roster_topics(uuid, boolean);

-- -----------------------------------------------------------------------------
create or replace function public.clear_tiernight_custom_roster_topics(
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
  v_uid uuid := auth.uid();
  v_row public.game_sessions;
  v_epoch int;
  v_target_writable boolean := coalesce(p_reopen, false);
  v_next jsonb;
  v_topics_raw jsonb;
  v_was_empty boolean;
  v_actual uuid;
begin
  if v_uid is null then
    return jsonb_build_object(
      'ok', false,
      'code', 'AUTH_REQUIRED',
      'applied', false
    );
  end if;

  if p_lobby_id is null then
    return jsonb_build_object(
      'ok', false,
      'code', 'INVALID_ARGS',
      'applied', false
    );
  end if;

  if not public.is_lobby_host(p_lobby_id) then
    return jsonb_build_object(
      'ok', false,
      'code', 'NOT_HOST',
      'applied', false
    );
  end if;

  select * into v_row
  from public.game_sessions
  where lobby_id = p_lobby_id
  for update;

  if not found then
    -- Session absente : clear de facto. Reopen sans session = refusé.
    -- p_expected_session_id peut être non-null (ancienne session A) — OK.
    if v_target_writable then
      return jsonb_build_object(
        'ok', false,
        'code', 'SESSION_ABSENT_CANNOT_REOPEN',
        'applied', false,
        'alreadyEmpty', true,
        'epoch', 0,
        'writable', false,
        'state', null
      );
    end if;
    return jsonb_build_object(
      'ok', true,
      'code', 'SESSION_ABSENT',
      'applied', false,
      'alreadyEmpty', true,
      'epoch', 0,
      'writable', false,
      'state', null
    );
  end if;

  -- Session existante : identité obligatoire (CAS anti-clear sur session B).
  if p_expected_session_id is null then
    return jsonb_build_object(
      'ok', false,
      'code', 'EXPECTED_SESSION_REQUIRED',
      'applied', false,
      'actualSessionId', v_row.id,
      'lobbyId', p_lobby_id
    );
  end if;

  if v_row.id is distinct from p_expected_session_id then
    return jsonb_build_object(
      'ok', false,
      'code', 'STALE_SESSION',
      'applied', false,
      'actualSessionId', v_row.id,
      'lobbyId', p_lobby_id
    );
  end if;

  v_topics_raw := v_row.state -> 'customRosterTopics';
  v_was_empty :=
    v_topics_raw is not null
    and jsonb_typeof(v_topics_raw) = 'array'
    and jsonb_array_length(v_topics_raw) = 0;

  -- No-op strict : JSON brut déjà canonique pour la cible (y compris epoch max).
  if public.tiernight_is_custom_roster_clear_canonical(v_row.state, v_target_writable) then
    return jsonb_build_object(
      'ok', true,
      'code', 'ALREADY_CANONICAL',
      'applied', false,
      'alreadyEmpty', true,
      'epoch', public.tiernight_parse_custom_roster_epoch(v_row.state),
      'writable', v_target_writable,
      'lobbyId', p_lobby_id,
      'sessionId', v_row.id,
      'state', v_row.state
    );
  end if;

  -- Mutation / canonisation requise : refuser si bump integer impossible.
  v_epoch := public.tiernight_parse_custom_roster_epoch(v_row.state);
  if v_epoch >= 2147483647 then
    return jsonb_build_object(
      'ok', false,
      'code', 'CUSTOM_ROSTER_EPOCH_EXHAUSTED',
      'applied', false,
      'alreadyEmpty', v_was_empty,
      'epoch', v_epoch,
      'writable', public.tiernight_parse_custom_roster_writable(v_row.state),
      'lobbyId', p_lobby_id,
      'sessionId', v_row.id,
      'state', v_row.state
    );
  end if;

  v_epoch := v_epoch + 1;
  v_next := coalesce(v_row.state, '{}'::jsonb);
  v_next := jsonb_set(v_next, '{customRosterTopics}', '[]'::jsonb, true);
  v_next := jsonb_set(v_next, '{customRosterTopicsEpoch}', to_jsonb(v_epoch), true);
  v_next := jsonb_set(
    v_next,
    '{customRosterTopicsWritable}',
    to_jsonb(v_target_writable),
    true
  );

  update public.game_sessions gs
  set
    state = v_next,
    updated_at = now()
  where gs.lobby_id = p_lobby_id
    and gs.id = p_expected_session_id
  returning * into v_row;

  if not found then
    -- Course : session remplacée entre SELECT et UPDATE.
    select gs.id into v_actual
    from public.game_sessions gs
    where gs.lobby_id = p_lobby_id;
    return jsonb_build_object(
      'ok', false,
      'code', 'STALE_SESSION',
      'applied', false,
      'actualSessionId', v_actual,
      'lobbyId', p_lobby_id
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'code', null,
    'applied', true,
    'alreadyEmpty', v_was_empty,
    'epoch', v_epoch,
    'writable', v_target_writable,
    'lobbyId', p_lobby_id,
    'sessionId', v_row.id,
    'state', v_row.state
  );
end;
$$;

revoke all on function public.clear_tiernight_custom_roster_topics(uuid, uuid, boolean) from public;
revoke all on function public.clear_tiernight_custom_roster_topics(uuid, uuid, boolean) from anon;
grant execute on function public.clear_tiernight_custom_roster_topics(uuid, uuid, boolean) to authenticated;

-- -----------------------------------------------------------------------------
-- upsert_player_custom_entry — base lost-update-fix + gate writable défensif
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
revoke all on function public.upsert_player_custom_entry(uuid, text, jsonb) from anon;
grant execute on function public.upsert_player_custom_entry(uuid, text, jsonb) to authenticated;

comment on function public.clear_tiernight_custom_roster_topics(uuid, uuid, boolean) is
  'FEATURE-TIERNIGHT-03 — hôte : CAS session + clear/canonise. ALREADY_CANONICAL = JSON brut. CUSTOM_ROSTER_EPOCH_EXHAUSTED si bump impossible.';
comment on function public.tiernight_parse_custom_roster_epoch(jsonb) is
  'Parse défensif epoch → int >=0 (fallback 0). Owner-only.';
comment on function public.tiernight_parse_custom_roster_writable(jsonb) is
  'Parse défensif writable : absent/null=true lecture ; invalid=false. Owner-only.';
comment on function public.tiernight_is_custom_roster_clear_canonical(jsonb, boolean) is
  'True ssi JSON brut : topics=[], writable bool=cible, epoch nombre entier 0..MAX. Owner-only.';

commit;
