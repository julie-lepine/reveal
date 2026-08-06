-- =============================================================================
-- FEATURE-TIERNIGHT-03 — HARNESS SQL STAGING clear customRosterTopics (R0–R12)
-- =============================================================================
-- Prérequis :
--   1. feature-tiernight-03-clear-custom-roster-topics.sql APPLIQUÉE sur staging
--   2. ≥ 3 auth.users SANS membership vivant (voir tnclr03_user_has_living_membership)
--   3. SQL Editor : postgres / supabase_admin
--
-- Living = présence dans lobby_members JOIN lobbies (aligné
--   create_lobby_atomically + index UNIQUE lobby_members_one_living_per_user).
-- Fixtures : lobbies.code LIKE 'TNCLR03%' uniquement — aucun DELETE de lobby réel.
--
-- Cleanup de secours (réexécutable si échec avant R12) :
--   select public.tnclr03_cleanup_fixtures();
--
-- Success. No rows returned = OK.
-- =============================================================================

create table if not exists public.tnclr03_smoke_ctx (
  id int primary key default 1 check (id = 1),
  lobby_id uuid,
  other_lobby_id uuid,
  host_id uuid,
  guest_id uuid,
  other_host_id uuid,
  code text,
  guest_custom_id text,
  host_custom_id text,
  session_id uuid,
  other_session_id uuid,
  epoch_after_clear int,
  updated_at timestamptz not null default now()
);

alter table public.tnclr03_smoke_ctx add column if not exists other_host_id uuid;
alter table public.tnclr03_smoke_ctx add column if not exists other_session_id uuid;

create or replace function public.tnclr03_set_jwt(p_uid uuid)
returns uuid
language plpgsql
as $$
begin
  if p_uid is null then
    raise exception 'TNCLR03_NO_UID';
  end if;
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_uid::text, 'role', 'authenticated')::text,
    true
  );
  if auth.uid() is distinct from p_uid then
    raise exception 'TNCLR03_JWT_FAILED want=% auth.uid()=%', p_uid, auth.uid();
  end if;
  return auth.uid();
end;
$$;

-- Living membership : même sémantique que create_lobby_atomically
-- (lobby_members INNER JOIN lobbies). L’index UNIQUE
-- lobby_members_one_living_per_user porte sur user_id (leave = DELETE).
create or replace function public.tnclr03_user_has_living_membership(p_uid uuid)
returns boolean
language sql
stable
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.lobby_members m
    inner join public.lobbies l on l.id = m.lobby_id
    where m.user_id = p_uid
  );
$$;

create or replace function public.tnclr03_resolve_actors()
returns table (host_id uuid, guest_id uuid, other_host_id uuid)
language plpgsql
as $$
declare
  v_host uuid;
  v_guest uuid;
  v_other_host uuid;
begin
  -- Acteurs libres uniquement : aucun membership vivant.
  select u.id into v_host
  from auth.users u
  where not public.tnclr03_user_has_living_membership(u.id)
  order by u.created_at asc nulls last, u.id asc
  limit 1;

  select u.id into v_guest
  from auth.users u
  where u.id is distinct from v_host
    and not public.tnclr03_user_has_living_membership(u.id)
  order by u.created_at asc nulls last, u.id asc
  limit 1;

  select u.id into v_other_host
  from auth.users u
  where u.id is distinct from v_host
    and u.id is distinct from v_guest
    and not public.tnclr03_user_has_living_membership(u.id)
  order by u.created_at asc nulls last, u.id asc
  limit 1;

  if v_host is null or v_guest is null or v_other_host is null then
    raise exception
      'TNCLR03_NEED_3_FREE_AUTH_USERS host=% guest=% other_host=% (living = lobby_members⋈lobbies)',
      v_host, v_guest, v_other_host;
  end if;

  host_id := v_host;
  guest_id := v_guest;
  other_host_id := v_other_host;
  return next;
end;
$$;

create or replace function public.tnclr03_build_state(
  p_host uuid,
  p_guest uuid,
  p_guest_custom text,
  p_host_custom text,
  p_epoch int default 2,
  p_writable jsonb default 'true'::jsonb
)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'customRosterTopics', jsonb_build_array(
      jsonb_build_object(
        'id', p_guest_custom, 'name', 'TNCLR03 Guest Theme', 'custom', true,
        'authorUid', p_guest::text, 'author', 'TNCLR03 Guest'
      ),
      jsonb_build_object(
        'id', p_host_custom, 'name', 'TNCLR03 Host Theme', 'custom', true,
        'authorUid', p_host::text, 'author', 'TNCLR03 Host'
      )
    ),
    'customRosterTopicsEpoch', p_epoch,
    'customRosterTopicsWritable', p_writable,
    'customTierLists', jsonb_build_array(
      jsonb_build_object('id', 'live-preserve', 'name', 'Rank Live Keep', 'items', jsonb_build_array('a'))
    ),
    'consumedCustomRosterTopicIds', jsonb_build_array('custom-roster-consumed'),
    'tierNight', jsonb_build_object(
      'series', jsonb_build_object(
        'phase', 'between_rounds',
        'queue', jsonb_build_array(jsonb_build_object('topicId', 'q1')),
        'roundHistory', jsonb_build_array(
          jsonb_build_object('topicSnapshot', jsonb_build_object('id', p_guest_custom, 'name', 'snap'))
        ),
        'scores', jsonb_build_object(p_host::text, 42)
      )
    ),
    'hotTake', jsonb_build_object('customTakes', '[]'::jsonb),
    'dilemma', jsonb_build_object('customDilemmas', '[]'::jsonb)
  );
$$;

create or replace function public.tnclr03_cleanup_fixtures()
returns jsonb
language plpgsql
as $$
declare
  v_lobbies int; v_members int; v_sessions int;
begin
  -- Uniquement fixtures TNCLR03% — jamais de lobbies réels.
  delete from public.game_sessions gs
  using public.lobbies l where gs.lobby_id = l.id and l.code like 'TNCLR03%';
  get diagnostics v_sessions = row_count;
  delete from public.lobby_members lm
  using public.lobbies l where lm.lobby_id = l.id and l.code like 'TNCLR03%';
  get diagnostics v_members = row_count;
  delete from public.lobbies where code like 'TNCLR03%';
  get diagnostics v_lobbies = row_count;
  delete from public.tnclr03_smoke_ctx;
  return jsonb_build_object(
    'lobbies', v_lobbies,
    'members', v_members,
    'sessions', v_sessions
  );
end;
$$;

create or replace function public.tnclr03_spawn_fixture()
returns jsonb
language plpgsql
as $$
declare
  v_host uuid;
  v_guest uuid;
  v_other_host uuid;
  v_lobby uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_code text := 'TNCLR03' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);
  v_guest_custom text := 'custom-roster-tnclr03-guest';
  v_host_custom text := 'custom-roster-tnclr03-host';
  v_state jsonb;
  v_session uuid;
  v_other_session uuid;
  v_member_count int;
  v_lobby_count int;
  v_session_count int;
begin
  -- 1) Cleanup préventif fixtures smoke seulement (libère acteurs TNCLR03).
  perform public.tnclr03_cleanup_fixtures();

  -- 2) Résolution acteurs libres (même bloc / tx que l’insert).
  select a.host_id, a.guest_id, a.other_host_id
  into v_host, v_guest, v_other_host
  from public.tnclr03_resolve_actors() a;

  -- Re-check immédiat (course avec activité réelle).
  if public.tnclr03_user_has_living_membership(v_host)
     or public.tnclr03_user_has_living_membership(v_guest)
     or public.tnclr03_user_has_living_membership(v_other_host) then
    raise exception
      'TNCLR03_ACTORS_BUSY_AFTER_RESOLVE host=% guest=% other=% — relancer spawn',
      v_host, v_guest, v_other_host;
  end if;

  begin
    insert into public.lobbies (id, code, host_id, status, game_id) values
      (v_lobby, v_code, v_host, 'playing', 'tiernight'),
      (v_other, v_code || 'X', v_other_host, 'playing', 'tiernight');

    -- 3 membres, 3 UID distincts — jamais le même UID dans deux lobbies.
    insert into public.lobby_members (lobby_id, user_id, display_name, emoji, color, is_host, ready) values
      (v_lobby, v_host, 'TNCLR03 Host', '👑', '#F59E0B', true, true),
      (v_lobby, v_guest, 'TNCLR03 Guest', '🙂', '#60A5FA', false, true),
      (v_other, v_other_host, 'TNCLR03 OtherHost', '🎯', '#34D399', true, true);
  exception
    when unique_violation then
      perform public.tnclr03_cleanup_fixtures();
      raise exception
        'TNCLR03_ACTOR_BECAME_BUSY unique_violation (lobby_members_one_living_per_user) — relancer ; aucun fallback vers user occupé'
        using errcode = 'P0001';
  end;

  v_state := public.tnclr03_build_state(
    v_host, v_guest, v_guest_custom, v_host_custom, 2, 'true'::jsonb
  );

  insert into public.game_sessions (lobby_id, game_id, screen, host_id, state)
  values (v_lobby, 'tiernight', 'tiernight-board', v_host, v_state)
  returning id into v_session;

  insert into public.game_sessions (lobby_id, game_id, screen, host_id, state)
  values (
    v_other, 'tiernight', 'tiernight-board', v_other_host,
    jsonb_build_object(
      'customRosterTopics', jsonb_build_array(
        jsonb_build_object(
          'id', 'custom-roster-other-lobby', 'name', 'Other Lobby Theme',
          'custom', true, 'authorUid', v_other_host::text, 'author', 'TNCLR03 OtherHost'
        )
      ),
      'customRosterTopicsEpoch', 9,
      'customRosterTopicsWritable', true
    )
  )
  returning id into v_other_session;

  -- Assertions structure fixture (2 lobbies, 3 membres, 2 sessions).
  select count(*)::int into v_lobby_count
  from public.lobbies where code like 'TNCLR03%';
  select count(*)::int into v_member_count
  from public.lobby_members lm
  join public.lobbies l on l.id = lm.lobby_id
  where l.code like 'TNCLR03%';
  select count(*)::int into v_session_count
  from public.game_sessions gs
  join public.lobbies l on l.id = gs.lobby_id
  where l.code like 'TNCLR03%';

  if v_lobby_count is distinct from 2
     or v_member_count is distinct from 3
     or v_session_count is distinct from 2 then
    perform public.tnclr03_cleanup_fixtures();
    raise exception
      'TNCLR03_SPAWN_SHAPE lobbies=% members=% sessions=% (attendu 2/3/2)',
      v_lobby_count, v_member_count, v_session_count;
  end if;

  if (
    select count(distinct lm.user_id)::int
    from public.lobby_members lm
    join public.lobbies l on l.id = lm.lobby_id
    where l.code like 'TNCLR03%'
  ) is distinct from 3 then
    perform public.tnclr03_cleanup_fixtures();
    raise exception 'TNCLR03_SPAWN_SHARED_UID — un UID partagé entre lobbies';
  end if;

  insert into public.tnclr03_smoke_ctx as c (
    id, lobby_id, other_lobby_id, host_id, guest_id, other_host_id, code,
    guest_custom_id, host_custom_id, session_id, other_session_id,
    epoch_after_clear, updated_at
  ) values (
    1, v_lobby, v_other, v_host, v_guest, v_other_host, v_code,
    v_guest_custom, v_host_custom, v_session, v_other_session,
    null, now()
  )
  on conflict (id) do update set
    lobby_id = excluded.lobby_id,
    other_lobby_id = excluded.other_lobby_id,
    host_id = excluded.host_id,
    guest_id = excluded.guest_id,
    other_host_id = excluded.other_host_id,
    code = excluded.code,
    guest_custom_id = excluded.guest_custom_id,
    host_custom_id = excluded.host_custom_id,
    session_id = excluded.session_id,
    other_session_id = excluded.other_session_id,
    epoch_after_clear = null,
    updated_at = now();

  return jsonb_build_object(
    'ok', true,
    'lobby_id', v_lobby,
    'other_lobby_id', v_other,
    'session_id', v_session,
    'other_session_id', v_other_session,
    'host_id', v_host,
    'guest_id', v_guest,
    'other_host_id', v_other_host,
    'code', v_code
  );
end;
$$;

create or replace function public.tnclr03_assert_rpc_acl(p_name text, p_label text)
returns void
language plpgsql
as $$
declare
  v_definer boolean; v_config text[]; v_auth boolean; v_anon boolean; v_public boolean;
  v_oid oid; v_args text;
begin
  select p.oid, p.prosecdef, p.proconfig, pg_get_function_identity_arguments(p.oid)
  into v_oid, v_definer, v_config, v_args
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = p_name
  order by p.oid desc limit 1;

  if v_oid is null then raise exception '% missing %', p_label, p_name; end if;
  if v_definer is not true then raise exception '% DEFINER attendu', p_label; end if;
  if v_config is null or not exists (
    select 1 from unnest(coalesce(v_config, array[]::text[])) c
    where c ilike '%pg_catalog%' and c ilike '%public%'
  ) then
    raise exception '% search_path attendu ; got %', p_label, v_config;
  end if;

  v_auth := has_function_privilege('authenticated', v_oid, 'EXECUTE');
  v_anon := has_function_privilege('anon', v_oid, 'EXECUTE');
  v_public := has_function_privilege('public', v_oid, 'EXECUTE');
  if v_auth is not true then raise exception '% authenticated EXECUTE', p_label; end if;
  if v_anon is not false then raise exception '% anon EXECUTE interdit', p_label; end if;
  if v_public is not false then raise exception '% public EXECUTE interdit', p_label; end if;
end;
$$;

create or replace function public.tnclr03_assert_helper_owner_only(p_name text)
returns void
language plpgsql
as $$
declare
  v_oid oid;
begin
  select p.oid into v_oid
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = p_name
  order by p.oid desc limit 1;
  if v_oid is null then raise exception 'helper missing %', p_name; end if;
  if has_function_privilege('authenticated', v_oid, 'EXECUTE') then
    raise exception 'helper % ne doit PAS grant authenticated', p_name;
  end if;
  if has_function_privilege('anon', v_oid, 'EXECUTE') then
    raise exception 'helper % ne doit PAS grant anon', p_name;
  end if;
  if has_function_privilege('public', v_oid, 'EXECUTE') then
    raise exception 'helper % ne doit PAS grant public', p_name;
  end if;
end;
$$;

create or replace function public.tnclr03_assert_canonical_state(p_state jsonb, p_writable boolean)
returns void
language plpgsql
as $$
begin
  if jsonb_typeof(p_state -> 'customRosterTopics') is distinct from 'array' then
    raise exception 'topics type';
  end if;
  if jsonb_array_length(p_state -> 'customRosterTopics') <> 0 then
    raise exception 'topics non vides';
  end if;
  if jsonb_typeof(p_state -> 'customRosterTopicsWritable') is distinct from 'boolean' then
    raise exception 'writable type';
  end if;
  if ((p_state -> 'customRosterTopicsWritable') = 'true'::jsonb) is distinct from p_writable then
    raise exception 'writable valeur';
  end if;
  if jsonb_typeof(p_state -> 'customRosterTopicsEpoch') is distinct from 'number' then
    raise exception 'epoch type';
  end if;
  if ((p_state ->> 'customRosterTopicsEpoch')::numeric)
       <> trunc((p_state ->> 'customRosterTopicsEpoch')::numeric) then
    raise exception 'epoch non entier';
  end if;
end;
$$;

-- ############################################################################
-- Cleanup de secours (réexécutable) — si un spawn précédent a laissé des TNCLR03%
-- ############################################################################
select public.tnclr03_cleanup_fixtures() as emergency_cleanup_before_r0;

-- ############################################################################
-- R0) Signature CAS + ACL + helpers owner-only
-- ############################################################################

do $$
declare
  v_args text;
begin
  select pg_get_function_identity_arguments(p.oid) into v_args
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'clear_tiernight_custom_roster_topics'
  order by p.oid desc limit 1;

  if v_args is distinct from 'p_lobby_id uuid, p_expected_session_id uuid, p_reopen boolean'
     and v_args is distinct from 'uuid, uuid, boolean' then
    -- Accepte noms ou types seuls selon version PG
    if position('uuid' in coalesce(v_args, '')) = 0
       or (select count(*) from regexp_matches(coalesce(v_args, ''), 'uuid', 'g')) < 2 then
      raise exception 'R0 signature CAS attendue (lobby, expected_session, reopen) got %', v_args;
    end if;
  end if;

  -- Ancienne signature (uuid, boolean) ne doit plus exister
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'clear_tiernight_custom_roster_topics'
      and pg_get_function_identity_arguments(p.oid) in (
        'p_lobby_id uuid, p_reopen boolean',
        'uuid, boolean'
      )
  ) then
    raise exception 'R0 ancienne signature (uuid,boolean) encore présente';
  end if;

  -- Une seule signature clear attendue
  if (
    select count(*)::int from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'clear_tiernight_custom_roster_topics'
  ) is distinct from 1 then
    raise exception 'R0 nombre de signatures clear ≠ 1';
  end if;

  perform public.tnclr03_assert_rpc_acl('clear_tiernight_custom_roster_topics', 'R0 clear');
  perform public.tnclr03_assert_rpc_acl('upsert_player_custom_entry', 'R0 upsert');
  perform public.tnclr03_assert_helper_owner_only('tiernight_parse_custom_roster_epoch');
  perform public.tnclr03_assert_helper_owner_only('tiernight_parse_custom_roster_writable');
  perform public.tnclr03_assert_helper_owner_only('tiernight_is_custom_roster_clear_canonical');
  raise notice 'R0 OK — CAS signature unique + ACL + helpers owner-only args=%', v_args;
end $$;

select public.tnclr03_spawn_fixture() as spawn;

-- ############################################################################
-- R1) Clear sain + preserve
-- ############################################################################

do $$
declare
  c public.tnclr03_smoke_ctx%rowtype;
  v_before jsonb; v_after jsonb; v_res jsonb; v_epoch_before int;
begin
  select * into strict c from public.tnclr03_smoke_ctx where id = 1;
  perform public.tnclr03_set_jwt(c.host_id);
  select state into v_before from public.game_sessions where lobby_id = c.lobby_id;
  v_epoch_before := (v_before ->> 'customRosterTopicsEpoch')::int;

  v_res := public.clear_tiernight_custom_roster_topics(c.lobby_id, c.session_id, false);
  if v_res ->> 'ok' is distinct from 'true' or (v_res ->> 'applied')::boolean is not true then
    raise exception 'R1 clear: %', v_res;
  end if;
  if (v_res ->> 'epoch')::int is distinct from v_epoch_before + 1 then
    raise exception 'R1 epoch';
  end if;

  select state into v_after from public.game_sessions where lobby_id = c.lobby_id;
  perform public.tnclr03_assert_canonical_state(v_after, false);

  if v_after -> 'customTierLists' is distinct from v_before -> 'customTierLists' then
    raise exception 'R1 Rank Live';
  end if;
  if v_after #>'{tierNight,series}' is distinct from v_before #>'{tierNight,series}' then
    raise exception 'R1 series';
  end if;
  if (
    select jsonb_array_length(state -> 'customRosterTopics')
    from public.game_sessions where lobby_id = c.other_lobby_id
  ) is distinct from 1 then
    raise exception 'R1 other lobby';
  end if;

  update public.tnclr03_smoke_ctx set epoch_after_clear = (v_res ->> 'epoch')::int where id = 1;
  raise notice 'R1 OK';
end $$;

-- ############################################################################
-- R2) Idempotence stricte + STALE_SESSION + nouvelle session intacte
-- ############################################################################

do $$
declare
  c public.tnclr03_smoke_ctx%rowtype;
  v_before jsonb; v_after jsonb; v_res jsonb;
  v_upd_b timestamptz; v_upd_a timestamptz;
  v_old_session uuid; v_new_session uuid;
  v_new_state jsonb;
begin
  select * into strict c from public.tnclr03_smoke_ctx where id = 1;
  perform public.tnclr03_set_jwt(c.host_id);

  select state, updated_at into v_before, v_upd_b
  from public.game_sessions where lobby_id = c.lobby_id;

  v_res := public.clear_tiernight_custom_roster_topics(c.lobby_id, c.session_id, false);
  select state, updated_at into v_after, v_upd_a
  from public.game_sessions where lobby_id = c.lobby_id;

  if v_res ->> 'code' is distinct from 'ALREADY_CANONICAL' then
    raise exception 'R2a ALREADY_CANONICAL: %', v_res;
  end if;
  if (v_res ->> 'applied')::boolean is not false then raise exception 'R2a applied'; end if;
  if v_after is distinct from v_before or v_upd_a is distinct from v_upd_b then
    raise exception 'R2a mutation';
  end if;

  -- expectedSessionId différent → STALE, state inchangé
  v_res := public.clear_tiernight_custom_roster_topics(c.lobby_id, gen_random_uuid(), false);
  if v_res ->> 'code' is distinct from 'STALE_SESSION' or (v_res ->> 'applied')::boolean is not false then
    raise exception 'R2b STALE_SESSION: %', v_res;
  end if;
  if (select state from public.game_sessions where lobby_id = c.lobby_id) is distinct from v_before then
    raise exception 'R2b state muté';
  end if;

  -- Ancienne requête après création nouvelle session → B intacte
  v_old_session := c.session_id;
  delete from public.game_sessions where lobby_id = c.lobby_id;
  insert into public.game_sessions (lobby_id, game_id, screen, host_id, state)
  values (
    c.lobby_id, 'tiernight', 'tiernight-prep', c.host_id,
    jsonb_build_object(
      'customRosterTopics', jsonb_build_array(
        jsonb_build_object('id', 'custom-roster-new-session', 'name', 'Keep Me', 'custom', true,
          'authorUid', c.host_id::text, 'author', 'TNCLR03 Host')
      ),
      'customRosterTopicsEpoch', 1,
      'customRosterTopicsWritable', true
    )
  )
  returning id into v_new_session;

  v_res := public.clear_tiernight_custom_roster_topics(c.lobby_id, v_old_session, false);
  if v_res ->> 'code' is distinct from 'STALE_SESSION' then
    raise exception 'R2c stale après nouvelle session: %', v_res;
  end if;
  select state into v_new_state from public.game_sessions where id = v_new_session;
  if jsonb_array_length(v_new_state -> 'customRosterTopics') is distinct from 1 then
    raise exception 'R2c nouvelle session vidée à tort';
  end if;

  -- Restaure contexte pour suites (session B, clear canonique closed)
  update public.tnclr03_smoke_ctx set session_id = v_new_session where id = 1;
  v_res := public.clear_tiernight_custom_roster_topics(c.lobby_id, v_new_session, false);
  if (v_res ->> 'applied')::boolean is not true then
    raise exception 'R2d re-clear: %', v_res;
  end if;
  update public.tnclr03_smoke_ctx
  set epoch_after_clear = (v_res ->> 'epoch')::int, session_id = v_new_session
  where id = 1;

  raise notice 'R2 OK — idempotence + STALE_SESSION + session B intacte';
end $$;

-- ############################################################################
-- R3) Reopen + second reopen
-- ############################################################################

do $$
declare
  c public.tnclr03_smoke_ctx%rowtype;
  v_res1 jsonb; v_res2 jsonb; v_epoch1 int;
  v_before jsonb; v_after jsonb; v_upd_b timestamptz; v_upd_a timestamptz;
begin
  select * into strict c from public.tnclr03_smoke_ctx where id = 1;
  perform public.tnclr03_set_jwt(c.host_id);

  v_res1 := public.clear_tiernight_custom_roster_topics(c.lobby_id, c.session_id, true);
  if (v_res1 ->> 'applied')::boolean is not true or (v_res1 ->> 'writable')::boolean is not true then
    raise exception 'R3a: %', v_res1;
  end if;
  v_epoch1 := (v_res1 ->> 'epoch')::int;

  select state, updated_at into v_before, v_upd_b from public.game_sessions where lobby_id = c.lobby_id;
  v_res2 := public.clear_tiernight_custom_roster_topics(c.lobby_id, c.session_id, true);
  select state, updated_at into v_after, v_upd_a from public.game_sessions where lobby_id = c.lobby_id;

  if v_res2 ->> 'code' is distinct from 'ALREADY_CANONICAL' then raise exception 'R3b: %', v_res2; end if;
  if v_after is distinct from v_before or v_upd_a is distinct from v_upd_b then
    raise exception 'R3b mutation';
  end if;
  update public.tnclr03_smoke_ctx set epoch_after_clear = v_epoch1 where id = 1;
  raise notice 'R3 OK';
end $$;

-- ############################################################################
-- R4) Invité
-- ############################################################################

do $$
declare
  c public.tnclr03_smoke_ctx%rowtype;
  v_before jsonb; v_res jsonb;
begin
  select * into strict c from public.tnclr03_smoke_ctx where id = 1;
  select state into v_before from public.game_sessions where lobby_id = c.lobby_id;
  perform public.tnclr03_set_jwt(c.guest_id);
  v_res := public.clear_tiernight_custom_roster_topics(c.lobby_id, c.session_id, false);
  if v_res ->> 'code' is distinct from 'NOT_HOST' then raise exception 'R4: %', v_res; end if;
  if (select state from public.game_sessions where lobby_id = c.lobby_id) is distinct from v_before then
    raise exception 'R4 state';
  end if;
  raise notice 'R4 OK';
end $$;

-- ############################################################################
-- R5 / R6) Upsert closed / reopen
-- ############################################################################

do $$
declare
  c public.tnclr03_smoke_ctx%rowtype;
  v_err text; v_row public.game_sessions;
begin
  select * into strict c from public.tnclr03_smoke_ctx where id = 1;
  perform public.tnclr03_set_jwt(c.host_id);
  perform public.clear_tiernight_custom_roster_topics(c.lobby_id, c.session_id, false);

  begin
    perform public.upsert_player_custom_entry(
      c.lobby_id, 'tiernight', jsonb_build_object('name', 'Should Fail')
    );
    raise exception 'R5 devrait fail';
  exception when others then
    v_err := SQLERRM;
    if position('TNS_CUSTOM_ROSTER_CLOSED' in v_err) = 0 then
      raise exception 'R5: %', v_err;
    end if;
  end;

  perform public.clear_tiernight_custom_roster_topics(c.lobby_id, c.session_id, true);
  v_row := public.upsert_player_custom_entry(
    c.lobby_id, 'tiernight', jsonb_build_object('name', 'Reopen Theme')
  );
  if jsonb_array_length(v_row.state -> 'customRosterTopics') < 1 then
    raise exception 'R6';
  end if;
  raise notice 'R5/R6 OK';
end $$;

-- ############################################################################
-- R7) Wipe multi-auteurs (invité déconnecté)
-- ############################################################################

do $$
declare
  c public.tnclr03_smoke_ctx%rowtype;
  v_res jsonb; v_len int;
begin
  select * into strict c from public.tnclr03_smoke_ctx where id = 1;
  update public.game_sessions
  set state = public.tnclr03_build_state(
    c.host_id, c.guest_id, c.guest_custom_id, c.host_custom_id, 5, 'true'::jsonb
  )
  where lobby_id = c.lobby_id;

  delete from public.lobby_members where lobby_id = c.lobby_id and user_id = c.guest_id;
  perform public.tnclr03_set_jwt(c.host_id);
  v_res := public.clear_tiernight_custom_roster_topics(c.lobby_id, c.session_id, false);
  if (v_res ->> 'applied')::boolean is not true then raise exception 'R7: %', v_res; end if;
  select jsonb_array_length(state -> 'customRosterTopics') into v_len
  from public.game_sessions where lobby_id = c.lobby_id;
  if v_len is distinct from 0 then raise exception 'R7 len=%', v_len; end if;

  if not exists (
    select 1 from public.lobby_members where lobby_id = c.lobby_id and user_id = c.guest_id
  ) then
    insert into public.lobby_members (lobby_id, user_id, display_name, emoji, color, is_host, ready)
    values (c.lobby_id, c.guest_id, 'TNCLR03 Guest', '🙂', '#60A5FA', false, true);
  end if;
  raise notice 'R7 OK';
end $$;

-- ############################################################################
-- R8) Canonisation legacy/corrompu — assertions MÉTIER uniquement
-- Ne pas utiliser updated_at : trigger game_sessions_updated_at → set_updated_at()
-- force NEW.updated_at = now() sur tout UPDATE.
-- Isolation inter-cas : chaque cas = v_base_preserved || v_case (baseline immuable),
--   jamais coalesce(state courant) || v_case (contamination writable/epoch hérités).
-- Preuve no-op : ALREADY_CANONICAL + applied:false + state inchangé.
-- ############################################################################

do $$
declare
  c public.tnclr03_smoke_ctx%rowtype;
  v_cases jsonb[] := array[
    '{"customRosterTopics":{}}'::jsonb,
    '{"customRosterTopics":null}'::jsonb,
    '{"customRosterTopics":[],"customRosterTopicsWritable":"false","customRosterTopicsEpoch":0}'::jsonb,
    '{"customRosterTopics":[],"customRosterTopicsWritable":"garbage","customRosterTopicsEpoch":0}'::jsonb,
    '{"customRosterTopics":[],"customRosterTopicsEpoch":0}'::jsonb,
    '{"customRosterTopics":[],"customRosterTopicsWritable":false,"customRosterTopicsEpoch":"3"}'::jsonb,
    '{"customRosterTopics":[],"customRosterTopicsWritable":false,"customRosterTopicsEpoch":"abc"}'::jsonb,
    '{"customRosterTopics":[],"customRosterTopicsWritable":false,"customRosterTopicsEpoch":1.7}'::jsonb,
    '{"customRosterTopics":[],"customRosterTopicsWritable":false,"customRosterTopicsEpoch":-4}'::jsonb,
    '{"customRosterTopics":[],"customRosterTopicsWritable":false,"customRosterTopicsEpoch":{"x":1}}'::jsonb,
    '{"customRosterTopics":[],"customRosterTopicsWritable":false,"customRosterTopicsEpoch":true}'::jsonb,
    '{"customRosterTopics":[],"customRosterTopicsWritable":false,"customRosterTopicsEpoch":[1]}'::jsonb,
    '{}'::jsonb,
    -- writable ABSENT + cible true (politique A) — isolé, pas hérité du cas précédent
    '{"customRosterTopics":[],"customRosterTopicsEpoch":0}'::jsonb
  ];
  v_targets boolean[] := array[
    false, false, false, false, false, false, false, false, false, false, false, false, false, true
  ];
  v_case jsonb; v_target boolean; v_res jsonb; v_res2 jsonb;
  v_before jsonb; v_after jsonb; v_after2 jsonb;
  v_epoch_before int; v_epoch_after int;
  v_preserve_a jsonb;
  v_base_preserved jsonb;
  v_live_session uuid;
  i int;
begin
  select * into strict c from public.tnclr03_smoke_ctx where id = 1;
  perform public.tnclr03_set_jwt(c.host_id);

  -- sessionId courant = contexte (R2 remplace la session et met à jour ctx.session_id).
  select gs.id into v_live_session
  from public.game_sessions gs
  where gs.lobby_id = c.lobby_id;
  if v_live_session is null then
    raise exception 'R8 aucune session pour lobby contexte';
  end if;
  if c.session_id is distinct from v_live_session then
    raise exception
      'R8 ctx.session_id=% ≠ session courante=% — relire contexte après R2',
      c.session_id, v_live_session;
  end if;

  -- Baseline immuable hors trio (capturée une fois avant la boucle).
  select
    coalesce(gs.state, '{}'::jsonb)
      - 'customRosterTopics'
      - 'customRosterTopicsEpoch'
      - 'customRosterTopicsWritable'
  into v_base_preserved
  from public.game_sessions gs
  where gs.lobby_id = c.lobby_id;

  -- Si le state courant est déjà réduit, reseed une baseline riche stable.
  if v_base_preserved = '{}'::jsonb
     or not (v_base_preserved ? 'customTierLists') then
    v_base_preserved := jsonb_build_object(
      'customTierLists', jsonb_build_array(
        jsonb_build_object('id', 'live-preserve', 'name', 'Rank Live Keep')
      ),
      'consumedCustomRosterTopicIds', jsonb_build_array('custom-roster-consumed'),
      'tierNight', jsonb_build_object(
        'series', jsonb_build_object('phase', 'between_rounds', 'queue', '[]'::jsonb)
      ),
      'hotTake', jsonb_build_object('customTakes', '[]'::jsonb),
      'dilemma', jsonb_build_object('customDilemmas', '[]'::jsonb)
    );
  end if;

  for i in 1 .. array_length(v_cases, 1) loop
    v_case := v_cases[i];
    v_target := v_targets[i];

    -- Isolation : reconstruire depuis baseline immuable + cas (clés absentes = absentes).
    update public.game_sessions
    set state = v_base_preserved || v_case
    where lobby_id = c.lobby_id
      and id = c.session_id;

    select state into v_before from public.game_sessions where id = c.session_id;

    -- Préconditions : le JSON brut reflète exactement le cas (pas de contamination).
    if (v_case ? 'customRosterTopics') then
      if not (v_before ? 'customRosterTopics') then
        raise exception 'R8 précond topics absente case %', v_case;
      end if;
      if jsonb_typeof(v_before -> 'customRosterTopics')
         is distinct from jsonb_typeof(v_case -> 'customRosterTopics') then
        raise exception 'R8 précond topics type case % got %',
          v_case, jsonb_typeof(v_before -> 'customRosterTopics');
      end if;
      if (v_before -> 'customRosterTopics') is distinct from (v_case -> 'customRosterTopics') then
        raise exception 'R8 précond topics valeur case %', v_case;
      end if;
    elsif (v_before ? 'customRosterTopics') then
      raise exception 'R8 précond topics doit être absente case %', v_case;
    end if;

    if (v_case ? 'customRosterTopicsEpoch') then
      if not (v_before ? 'customRosterTopicsEpoch') then
        raise exception 'R8 précond epoch absente case %', v_case;
      end if;
      if jsonb_typeof(v_before -> 'customRosterTopicsEpoch')
         is distinct from jsonb_typeof(v_case -> 'customRosterTopicsEpoch') then
        raise exception 'R8 précond epoch type case %', v_case;
      end if;
      if (v_before -> 'customRosterTopicsEpoch') is distinct from (v_case -> 'customRosterTopicsEpoch') then
        raise exception 'R8 précond epoch valeur case %', v_case;
      end if;
    elsif (v_before ? 'customRosterTopicsEpoch') then
      raise exception 'R8 précond epoch doit être absente case %', v_case;
    end if;

    if (v_case ? 'customRosterTopicsWritable') then
      if not (v_before ? 'customRosterTopicsWritable') then
        raise exception 'R8 précond writable absente case %', v_case;
      end if;
      if jsonb_typeof(v_before -> 'customRosterTopicsWritable')
         is distinct from jsonb_typeof(v_case -> 'customRosterTopicsWritable') then
        raise exception 'R8 précond writable type case % got %',
          v_case, jsonb_typeof(v_before -> 'customRosterTopicsWritable');
      end if;
      if (v_before -> 'customRosterTopicsWritable')
         is distinct from (v_case -> 'customRosterTopicsWritable') then
        raise exception 'R8 précond writable valeur case %', v_case;
      end if;
    elsif (v_before ? 'customRosterTopicsWritable') then
      raise exception 'R8 précond writable doit être absente case %', v_case;
    end if;

    -- Cas boucle : non canonique pour la cible (sinon ALREADY_CANONICAL immédiat).
    if public.tiernight_is_custom_roster_clear_canonical(v_before, v_target) then
      raise exception 'R8 fixture déjà canonique pour cible=% case %', v_target, v_case;
    end if;

    v_epoch_before := public.tiernight_parse_custom_roster_epoch(v_before);

    v_res := public.clear_tiernight_custom_roster_topics(c.lobby_id, c.session_id, v_target);
    if v_res ->> 'ok' is distinct from 'true' or (v_res ->> 'applied')::boolean is not true then
      raise exception 'R8 canonisation case % res %', v_case, v_res;
    end if;

    select state into v_after from public.game_sessions where id = c.session_id;
    if v_after is not distinct from v_before then
      raise exception 'R8 state inchangé après canonisation case %', v_case;
    end if;
    perform public.tnclr03_assert_canonical_state(v_after, v_target);

    v_epoch_after := (v_after ->> 'customRosterTopicsEpoch')::int;
    if v_epoch_after is distinct from v_epoch_before + 1 then
      raise exception 'R8 epoch attendu %+1 got % case %', v_epoch_before, v_epoch_after, v_case;
    end if;

    v_preserve_a := v_after
      - 'customRosterTopics'
      - 'customRosterTopicsEpoch'
      - 'customRosterTopicsWritable';
    if v_preserve_a is distinct from v_base_preserved then
      raise exception 'R8 clés hors trio ≠ baseline immuable case %', v_case;
    end if;

    v_res2 := public.clear_tiernight_custom_roster_topics(c.lobby_id, c.session_id, v_target);
    select state into v_after2 from public.game_sessions where id = c.session_id;
    if v_res2 ->> 'code' is distinct from 'ALREADY_CANONICAL' then
      raise exception 'R8 second ALREADY_CANONICAL case % got %', v_case, v_res2;
    end if;
    if (v_res2 ->> 'applied')::boolean is not false then
      raise exception 'R8 second applied';
    end if;
    if v_after2 is distinct from v_after then
      raise exception 'R8 second state muté case %', v_case;
    end if;
    if (v_after2 ->> 'customRosterTopicsEpoch')::int is distinct from v_epoch_after then
      raise exception 'R8 second epoch muté';
    end if;
  end loop;

  -- Déjà canonique (hors boucle) — séparé, pas dans la matrice non-canonique.
  update public.game_sessions
  set state = v_base_preserved || jsonb_build_object(
    'customRosterTopics', '[]'::jsonb,
    'customRosterTopicsWritable', false,
    'customRosterTopicsEpoch', 7
  )
  where id = c.session_id;
  select state into v_before from public.game_sessions where id = c.session_id;
  v_res := public.clear_tiernight_custom_roster_topics(c.lobby_id, c.session_id, false);
  select state into v_after from public.game_sessions where id = c.session_id;
  if v_res ->> 'code' is distinct from 'ALREADY_CANONICAL'
     or (v_res ->> 'applied')::boolean is not false then
    raise exception 'R8 strict no-op: %', v_res;
  end if;
  if v_after is distinct from v_before then
    raise exception 'R8 strict state muté';
  end if;

  -- ----- Borne epoch 2147483647 -----
  update public.game_sessions set state = v_base_preserved || jsonb_build_object(
    'customRosterTopics', '[]'::jsonb,
    'customRosterTopicsWritable', false,
    'customRosterTopicsEpoch', 2147483647
  )
  where id = c.session_id;
  select state into v_before from public.game_sessions where id = c.session_id;
  v_res := public.clear_tiernight_custom_roster_topics(c.lobby_id, c.session_id, false);
  select state into v_after from public.game_sessions where id = c.session_id;
  if v_res ->> 'code' is distinct from 'ALREADY_CANONICAL'
     or (v_res ->> 'applied')::boolean is not false then
    raise exception 'R8 epoch-max canonical: %', v_res;
  end if;
  if v_after is distinct from v_before then
    raise exception 'R8 epoch-max canonical state muté';
  end if;

  update public.game_sessions set state = v_base_preserved || jsonb_build_object(
    'customRosterTopics', jsonb_build_array(jsonb_build_object('id', 'x', 'name', 'Keep')),
    'customRosterTopicsWritable', true,
    'customRosterTopicsEpoch', 2147483647
  )
  where id = c.session_id;
  select state into v_before from public.game_sessions where id = c.session_id;
  v_res := public.clear_tiernight_custom_roster_topics(c.lobby_id, c.session_id, false);
  select state into v_after from public.game_sessions where id = c.session_id;
  if v_res ->> 'code' is distinct from 'CUSTOM_ROSTER_EPOCH_EXHAUSTED'
     or (v_res ->> 'applied')::boolean is not false then
    raise exception 'R8 epoch-max topics: %', v_res;
  end if;
  if v_after is distinct from v_before then
    raise exception 'R8 epoch-max topics state muté';
  end if;
  if jsonb_array_length(v_after -> 'customRosterTopics') is distinct from 1 then
    raise exception 'R8 epoch-max topics cleared';
  end if;

  update public.game_sessions set state = v_base_preserved || jsonb_build_object(
    'customRosterTopics', '[]'::jsonb,
    'customRosterTopicsWritable', true,
    'customRosterTopicsEpoch', 2147483647
  )
  where id = c.session_id;
  select state into v_before from public.game_sessions where id = c.session_id;
  v_res := public.clear_tiernight_custom_roster_topics(c.lobby_id, c.session_id, false);
  select state into v_after from public.game_sessions where id = c.session_id;
  if v_res ->> 'code' is distinct from 'CUSTOM_ROSTER_EPOCH_EXHAUSTED'
     or (v_res ->> 'applied')::boolean is not false then
    raise exception 'R8 epoch-max writable: %', v_res;
  end if;
  if v_after is distinct from v_before then
    raise exception 'R8 epoch-max writable state muté';
  end if;
  if (v_after -> 'customRosterTopicsWritable') is distinct from 'true'::jsonb then
    raise exception 'R8 epoch-max writable modifié';
  end if;
  if (v_after ->> 'customRosterTopicsEpoch')::int is distinct from 2147483647 then
    raise exception 'R8 epoch-max writable epoch modifié';
  end if;

  update public.game_sessions
  set state = v_base_preserved || '{"customRosterTopics":[],"customRosterTopicsWritable":"false","customRosterTopicsEpoch":2147483647}'::jsonb
  where id = c.session_id;
  select state into v_before from public.game_sessions where id = c.session_id;
  v_res := public.clear_tiernight_custom_roster_topics(c.lobby_id, c.session_id, false);
  select state into v_after from public.game_sessions where id = c.session_id;
  if v_res ->> 'code' is distinct from 'CUSTOM_ROSTER_EPOCH_EXHAUSTED'
     or (v_res ->> 'applied')::boolean is not false then
    raise exception 'R8 epoch-max noncanon: %', v_res;
  end if;
  if v_after is distinct from v_before then
    raise exception 'R8 epoch-max noncanon state muté';
  end if;

  update public.game_sessions set state = v_base_preserved || jsonb_build_object(
    'customRosterTopics', jsonb_build_array(jsonb_build_object('id', 'y', 'name', 'Z')),
    'customRosterTopicsWritable', true,
    'customRosterTopicsEpoch', 2147483646
  )
  where id = c.session_id;
  v_res := public.clear_tiernight_custom_roster_topics(c.lobby_id, c.session_id, false);
  if (v_res ->> 'applied')::boolean is not true
     or (v_res ->> 'epoch')::int is distinct from 2147483647 then
    raise exception 'R8 epoch max-1 bump: %', v_res;
  end if;
  select state into v_after from public.game_sessions where id = c.session_id;
  perform public.tnclr03_assert_canonical_state(v_after, false);
  if (v_after ->> 'customRosterTopicsEpoch')::int is distinct from 2147483647 then
    raise exception 'R8 epoch max-1 state epoch';
  end if;

  select state into v_before from public.game_sessions where id = c.session_id;
  v_res2 := public.clear_tiernight_custom_roster_topics(c.lobby_id, c.session_id, false);
  select state into v_after from public.game_sessions where id = c.session_id;
  if v_res2 ->> 'code' is distinct from 'ALREADY_CANONICAL'
     or (v_res2 ->> 'applied')::boolean is not false then
    raise exception 'R8 after max ALREADY_CANONICAL: %', v_res2;
  end if;
  if v_after is distinct from v_before then
    raise exception 'R8 after max state muté';
  end if;

  raise notice 'R8 OK — % cases isolés + no-op + borne epoch (session=%)',
    array_length(v_cases, 1), c.session_id;
end $$;

-- ############################################################################
-- R9) SESSION_ABSENT
-- ############################################################################

do $$
declare
  c public.tnclr03_smoke_ctx%rowtype;
  v_res_f jsonb; v_res_t jsonb; v_old uuid;
begin
  select * into strict c from public.tnclr03_smoke_ctx where id = 1;
  v_old := c.session_id;
  delete from public.game_sessions where lobby_id = c.lobby_id;
  perform public.tnclr03_set_jwt(c.host_id);

  v_res_f := public.clear_tiernight_custom_roster_topics(c.lobby_id, v_old, false);
  if v_res_f ->> 'code' is distinct from 'SESSION_ABSENT' then
    raise exception 'R9a: %', v_res_f;
  end if;
  v_res_t := public.clear_tiernight_custom_roster_topics(c.lobby_id, v_old, true);
  if v_res_t ->> 'code' is distinct from 'SESSION_ABSENT_CANNOT_REOPEN' then
    raise exception 'R9b: %', v_res_t;
  end if;

  insert into public.game_sessions (lobby_id, game_id, screen, host_id, state)
  values (
    c.lobby_id, 'tiernight', 'tiernight-prep', c.host_id,
    jsonb_build_object(
      'customRosterTopics', '[]'::jsonb,
      'customRosterTopicsEpoch', 0,
      'customRosterTopicsWritable', true,
      'hotTake', jsonb_build_object('customTakes', '[]'::jsonb),
      'dilemma', jsonb_build_object('customDilemmas', '[]'::jsonb)
    )
  )
  returning id into v_old;
  update public.tnclr03_smoke_ctx set session_id = v_old where id = 1;
  raise notice 'R9 OK';
end $$;

-- ############################################################################
-- R10) Non-régression HT / Dilemma / TN
-- ############################################################################

do $$
declare
  c public.tnclr03_smoke_ctx%rowtype;
  v_row public.game_sessions;
  v_ht_id text; v_di_id text; v_tn_id text;
begin
  select * into strict c from public.tnclr03_smoke_ctx where id = 1;
  perform public.tnclr03_set_jwt(c.host_id);
  perform public.clear_tiernight_custom_roster_topics(c.lobby_id, c.session_id, true);

  v_row := public.upsert_player_custom_entry(
    c.lobby_id, 'hottake', jsonb_build_object('text', 'HT smoke A'));
  v_ht_id := v_row.state #>> '{hotTake,customTakes,0,id}';
  v_row := public.upsert_player_custom_entry(
    c.lobby_id, 'hottake', jsonb_build_object('id', v_ht_id, 'text', 'HT smoke A2'));
  if v_row.state #>> '{hotTake,customTakes,0,text}' is distinct from 'HT smoke A2' then
    raise exception 'R10 HT';
  end if;

  v_row := public.upsert_player_custom_entry(
    c.lobby_id, 'dilemma', jsonb_build_object('optionA', 'A', 'optionB', 'B'));
  v_di_id := v_row.state #>> '{dilemma,customDilemmas,0,id}';
  v_row := public.upsert_player_custom_entry(
    c.lobby_id, 'dilemma', jsonb_build_object('id', v_di_id, 'optionA', 'A2', 'optionB', 'B2'));
  if v_row.state #>> '{dilemma,customDilemmas,0,optionA}' is distinct from 'A2' then
    raise exception 'R10 Dilemma';
  end if;

  v_row := public.upsert_player_custom_entry(
    c.lobby_id, 'tiernight', jsonb_build_object('name', 'TN smoke'));
  v_tn_id := v_row.state -> 'customRosterTopics' -> 0 ->> 'id';
  if v_row.state -> 'customRosterTopics' -> 0 ->> 'authorUid' is distinct from c.host_id::text then
    raise exception 'R10 authorUid';
  end if;
  v_row := public.upsert_player_custom_entry(
    c.lobby_id, 'tiernight', jsonb_build_object('id', v_tn_id, 'name', 'TN smoke 2'));
  if v_row.state -> 'customRosterTopics' -> 0 ->> 'name' is distinct from 'TN smoke 2' then
    raise exception 'R10 TN update';
  end if;

  perform public.tnclr03_set_jwt(c.guest_id);
  v_row := public.upsert_player_custom_entry(
    c.lobby_id, 'tiernight', jsonb_build_object('id', v_tn_id, 'name', 'Guest hijack'));
  if (v_row.state -> 'customRosterTopics' -> 0 ->> 'name') = 'Guest hijack'
     and (v_row.state -> 'customRosterTopics' -> 0 ->> 'authorUid') = c.host_id::text then
    raise exception 'R10 ownership';
  end if;
  if jsonb_array_length(v_row.state -> 'customRosterTopics') < 2 then
    raise exception 'R10 multi-author';
  end if;
  raise notice 'R10 OK';
end $$;

-- ############################################################################
-- R11) Preserve matrix
-- ############################################################################

do $$
declare
  c public.tnclr03_smoke_ctx%rowtype;
  v_before jsonb; v_after jsonb; v_res jsonb;
begin
  select * into strict c from public.tnclr03_smoke_ctx where id = 1;
  perform public.tnclr03_set_jwt(c.host_id);
  update public.game_sessions
  set state = public.tnclr03_build_state(
    c.host_id, c.guest_id, c.guest_custom_id, c.host_custom_id, 7, 'true'::jsonb
  )
  where lobby_id = c.lobby_id;
  select state into v_before from public.game_sessions where lobby_id = c.lobby_id;
  v_res := public.clear_tiernight_custom_roster_topics(c.lobby_id, c.session_id, false);
  if (v_res ->> 'applied')::boolean is not true then raise exception 'R11: %', v_res; end if;
  select state into v_after from public.game_sessions where lobby_id = c.lobby_id;
  if v_after -> 'customTierLists' is distinct from v_before -> 'customTierLists' then
    raise exception 'R11 Rank Live';
  end if;
  if v_after #>'{tierNight,series}' is distinct from v_before #>'{tierNight,series}' then
    raise exception 'R11 series';
  end if;
  raise notice 'R11 OK';
end $$;

-- ############################################################################
-- R12) Cleanup
-- ############################################################################

do $$
declare
  v_clean jsonb; v_left int;
begin
  v_clean := public.tnclr03_cleanup_fixtures();
  select count(*)::int into v_left from public.lobbies where code like 'TNCLR03%';
  if v_left <> 0 then raise exception 'R12 left %', v_left; end if;

  drop function if exists public.tnclr03_set_jwt(uuid);
  drop function if exists public.tnclr03_user_has_living_membership(uuid);
  drop function if exists public.tnclr03_resolve_actors();
  drop function if exists public.tnclr03_build_state(uuid, uuid, text, text, int, jsonb);
  drop function if exists public.tnclr03_cleanup_fixtures();
  drop function if exists public.tnclr03_spawn_fixture();
  drop function if exists public.tnclr03_assert_rpc_acl(text, text);
  drop function if exists public.tnclr03_assert_helper_owner_only(text);
  drop function if exists public.tnclr03_assert_canonical_state(jsonb, boolean);
  drop table if exists public.tnclr03_smoke_ctx;
  raise notice 'R12 OK %', v_clean;
end $$;
