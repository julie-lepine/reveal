-- =============================================================================
-- BUG-TIERNIGHT-PREP-GUEST-01 — HARNESS SQL STAGING (exécutable R0–R10)
-- =============================================================================
-- Remplace le runbook commenté (descriptif, NON probant).
-- Migration produit : feature-tiernight-03-prep-guest-contribute.sql (NE PAS
--   modifier ici). D1-bis / finalize / advance / scoring : hors scope.
--
-- Prérequis :
--   1. Migration contribute prep-guest APPLIQUÉE sur staging
--   2. ≥ 2 lignes dans auth.users
--   3. Rôle SQL Editor : postgres / supabase_admin (INSERT fixtures)
--
-- ORDRE D’EXÉCUTION (Supabase SQL Editor) :
--   1) Bloc HELPERS (une fois)
--   2) Bloc R0
--   3) Bloc SPAWN fixture
--   4) Blocs R1 → R9 (chacun autonome : relit tnpg01_smoke_ctx + JWT)
--   5) Bloc R10 cleanup + drop helpers
--
-- Chaque smoke mutationnel est un DO $$ … $$ unique (une tx).
-- set_config(..., true) = local à cette tx.
-- Erreurs métier attendues capturées → Success. No rows returned si OK.
--
-- Fixtures : lobbies.code LIKE 'TNPG01%'. Cleanup relançable.
-- =============================================================================

-- ############################################################################
-- 0. HELPERS
-- ############################################################################

create table if not exists public.tnpg01_smoke_ctx (
  id int primary key default 1 check (id = 1),
  lobby_id uuid,
  host_id uuid,
  guest_id uuid,
  code text,
  guest_custom_id text,
  host_custom_id text,
  scenario text,
  notes text,
  updated_at timestamptz not null default now()
);

create or replace function public.tnpg01_set_jwt(p_uid uuid)
returns uuid
language plpgsql
as $$
begin
  if p_uid is null then
    raise exception 'TNPG01_NO_UID';
  end if;
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_uid::text, 'role', 'authenticated')::text,
    true
  );
  if auth.uid() is distinct from p_uid then
    raise exception 'TNPG01_JWT_FAILED want=% auth.uid()=%', p_uid, auth.uid();
  end if;
  return auth.uid();
end;
$$;

create or replace function public.tnpg01_resolve_actors()
returns table (host_id uuid, guest_id uuid)
language plpgsql
as $$
declare
  v_host uuid;
  v_guest uuid;
begin
  select u.id into v_host
  from auth.users u
  order by u.created_at asc nulls last, u.id asc
  limit 1;

  select u.id into v_guest
  from auth.users u
  where u.id is distinct from v_host
  order by u.created_at asc nulls last, u.id asc
  limit 1;

  if v_host is null or v_guest is null then
    raise exception
      'TNPG01_NEED_TWO_AUTH_USERS: staging doit avoir ≥2 auth.users (host=% guest=%)',
      v_host, v_guest;
  end if;

  host_id := v_host;
  guest_id := v_guest;
  return next;
end;
$$;

create or replace function public.tnpg01_build_prep_state(
  p_host uuid,
  p_guest uuid,
  p_guest_custom text,
  p_host_custom text,
  p_epoch int default 4
)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'tierNightPrep', jsonb_build_object(
      'setupEpoch', p_epoch,
      'ready', '{}'::jsonb,
      'categoryIds', jsonb_build_array('*'),
      'roundCount', 5,
      'poolInvalidateRequestId', null
    ),
    'customRosterTopics', jsonb_build_array(
      jsonb_build_object(
        'id', p_guest_custom,
        'name', 'TNPG01 Guest Theme',
        'custom', true,
        'authorUid', p_guest::text,
        'author', 'TNPG01 Guest'
      ),
      jsonb_build_object(
        'id', p_host_custom,
        'name', 'TNPG01 Host Theme',
        'custom', true,
        'authorUid', p_host::text,
        'author', 'TNPG01 Host'
      )
    )
  );
$$;

create or replace function public.tnpg01_cleanup_fixtures()
returns jsonb
language plpgsql
as $$
declare
  v_lobbies int;
  v_members int;
  v_sessions int;
begin
  delete from public.game_sessions gs
  using public.lobbies l
  where gs.lobby_id = l.id and l.code like 'TNPG01%';
  get diagnostics v_sessions = row_count;

  delete from public.lobby_members lm
  using public.lobbies l
  where lm.lobby_id = l.id and l.code like 'TNPG01%';
  get diagnostics v_members = row_count;

  delete from public.lobbies where code like 'TNPG01%';
  get diagnostics v_lobbies = row_count;

  delete from public.tnpg01_smoke_ctx;

  return jsonb_build_object(
    'lobbies', v_lobbies,
    'members', v_members,
    'sessions', v_sessions
  );
end;
$$;

create or replace function public.tnpg01_spawn_prep_fixture(p_scenario text default 'prep')
returns jsonb
language plpgsql
as $$
declare
  v_host uuid;
  v_guest uuid;
  v_lobby uuid := gen_random_uuid();
  v_code text := 'TNPG01' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);
  v_guest_custom text := 'custom-roster-tnpg01-guest';
  v_host_custom text := 'custom-roster-tnpg01-host';
  v_state jsonb;
begin
  select a.host_id, a.guest_id into v_host, v_guest
  from public.tnpg01_resolve_actors() a;

  perform public.tnpg01_cleanup_fixtures();

  insert into public.lobbies (id, code, host_id, status, game_id)
  values (v_lobby, v_code, v_host, 'playing', 'tiernight');

  insert into public.lobby_members (lobby_id, user_id, display_name, emoji, color, is_host, ready)
  values
    (v_lobby, v_host, 'TNPG01 Host', '👑', '#F59E0B', true, true),
    (v_lobby, v_guest, 'TNPG01 Guest', '🙂', '#60A5FA', false, true);

  v_state := public.tnpg01_build_prep_state(
    v_host, v_guest, v_guest_custom, v_host_custom, 4
  );

  insert into public.game_sessions (lobby_id, game_id, screen, host_id, state)
  values (v_lobby, 'tiernight', 'tiernight-prep', v_host, v_state);

  insert into public.tnpg01_smoke_ctx as c (
    id, lobby_id, host_id, guest_id, code,
    guest_custom_id, host_custom_id, scenario, notes, updated_at
  ) values (
    1, v_lobby, v_host, v_guest, v_code,
    v_guest_custom, v_host_custom, p_scenario,
    'epoch=4 screen=tiernight-prep', now()
  )
  on conflict (id) do update set
    lobby_id = excluded.lobby_id,
    host_id = excluded.host_id,
    guest_id = excluded.guest_id,
    code = excluded.code,
    guest_custom_id = excluded.guest_custom_id,
    host_custom_id = excluded.host_custom_id,
    scenario = excluded.scenario,
    notes = excluded.notes,
    updated_at = now();

  return jsonb_build_object(
    'ok', true,
    'lobby_id', v_lobby,
    'code', v_code,
    'host_id', v_host,
    'guest_id', v_guest,
    'guest_custom_id', v_guest_custom,
    'host_custom_id', v_host_custom
  );
end;
$$;

create or replace function public.tnpg01_session_state(p_lobby uuid)
returns jsonb
language sql
stable
as $$
  select state from public.game_sessions where lobby_id = p_lobby;
$$;

comment on function public.tnpg01_spawn_prep_fixture is
  'SMOKE ONLY BUG-TIERNIGHT-PREP-GUEST-01 — drop via R10';

-- ############################################################################
-- R0) Signature / SECURITY DEFINER / search_path / ACL
-- ############################################################################

do $$
declare
  v_definer boolean;
  v_config text[];
  v_auth boolean;
  v_anon boolean;
  v_public boolean;
  v_args text;
begin
  select p.prosecdef, p.proconfig,
         pg_get_function_identity_arguments(p.oid)
  into v_definer, v_config, v_args
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'contribute_game_session_player'
  limit 1;

  if v_args is distinct from 'p_lobby_id uuid, p_game text, p_kind text, p_value jsonb' then
    raise exception 'R0 signature diverge: %', v_args;
  end if;
  if v_definer is not true then
    raise exception 'R0 SECURITY DEFINER attendu';
  end if;
  if v_config is null
     or not exists (
       select 1 from unnest(v_config) c
       where c ilike 'search_path=%pg_catalog%public%'
          or c ilike 'search_path=pg_catalog, public'
     )
  then
    -- Accepte aussi search_path TO 'pg_catalog, public'
    if v_config is null
       or not exists (
         select 1 from unnest(coalesce(v_config, array[]::text[])) c
         where c ilike '%pg_catalog%' and c ilike '%public%'
       )
    then
      raise exception 'R0 search_path attendu pg_catalog, public ; got %', v_config;
    end if;
  end if;

  v_auth := has_function_privilege(
    'authenticated',
    'public.contribute_game_session_player(uuid,text,text,jsonb)',
    'EXECUTE'
  );
  v_anon := has_function_privilege(
    'anon',
    'public.contribute_game_session_player(uuid,text,text,jsonb)',
    'EXECUTE'
  );
  v_public := has_function_privilege(
    'public',
    'public.contribute_game_session_player(uuid,text,text,jsonb)',
    'EXECUTE'
  );

  if v_auth is not true then
    raise exception 'R0 authenticated EXECUTE attendu';
  end if;
  if v_anon is not false then
    raise exception 'R0 anon ne doit PAS avoir EXECUTE';
  end if;
  if v_public is not false then
    raise exception 'R0 public ne doit PAS avoir EXECUTE';
  end if;

  raise notice 'R0 OK — signature, DEFINER, search_path, ACL';
end $$;

-- ############################################################################
-- SPAWN fixture canonique (avant R1–R9)
-- ############################################################################

select public.tnpg01_spawn_prep_fixture('canonical') as spawn;

-- ############################################################################
-- R1) Ready epoch courant accepté
-- ############################################################################

do $$
declare
  c public.tnpg01_smoke_ctx%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_prep jsonb;
  v_ready jsonb;
begin
  select * into strict c from public.tnpg01_smoke_ctx where id = 1;
  perform public.tnpg01_set_jwt(c.guest_id);
  if auth.uid() is distinct from c.guest_id then
    raise exception 'R1 auth.uid() != guest';
  end if;

  v_before := public.tnpg01_session_state(c.lobby_id);

  perform public.contribute_game_session_player(
    c.lobby_id,
    'tiernight',
    'ready',
    jsonb_build_object('ready', true, 'expectedSetupEpoch', 4)
  );

  v_after := public.tnpg01_session_state(c.lobby_id);
  v_prep := v_after -> 'tierNightPrep';
  v_ready := coalesce(v_prep -> 'ready', '{}'::jsonb);

  if (v_ready ->> c.guest_id::text) is distinct from 'true' then
    raise exception 'R1 ready[guest] != true : %', v_ready;
  end if;
  if v_ready ? c.host_id::text then
    raise exception 'R1 ready ne doit pas contenir host_uid';
  end if;
  if (v_prep ->> 'setupEpoch')::int is distinct from 4 then
    raise exception 'R1 setupEpoch muté';
  end if;
  if v_prep -> 'categoryIds' is distinct from (v_before -> 'tierNightPrep' -> 'categoryIds') then
    raise exception 'R1 categoryIds muté';
  end if;
  if (v_prep ->> 'roundCount')::int is distinct from 5 then
    raise exception 'R1 roundCount muté';
  end if;
  if v_after -> 'customRosterTopics' is distinct from (v_before -> 'customRosterTopics') then
    raise exception 'R1 customRosterTopics muté';
  end if;
  -- Seule clé ready sous prep doit différer
  if (v_before - 'tierNightPrep') is distinct from (v_after - 'tierNightPrep') then
    raise exception 'R1 branche hors tierNightPrep mutée';
  end if;

  raise notice 'R1 OK — ready guest epoch 4';
end $$;

-- ############################################################################
-- R2) Ready stale → Ready obsolète ; state inchangé
-- ############################################################################

do $$
declare
  c public.tnpg01_smoke_ctx%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_caught boolean := false;
  v_msg text;
begin
  select * into strict c from public.tnpg01_smoke_ctx where id = 1;
  perform public.tnpg01_set_jwt(c.guest_id);
  v_before := public.tnpg01_session_state(c.lobby_id);

  begin
    perform public.contribute_game_session_player(
      c.lobby_id,
      'tiernight',
      'ready',
      jsonb_build_object('ready', true, 'expectedSetupEpoch', 3)
    );
  exception when others then
    v_caught := true;
    v_msg := SQLERRM;
    if v_msg not like 'Ready obsolète%' then
      raise exception 'R2 exception inattendue: %', v_msg;
    end if;
  end;

  if not v_caught then
    raise exception 'R2 aurait dû lever Ready obsolète';
  end if;

  v_after := public.tnpg01_session_state(c.lobby_id);
  if v_after is distinct from v_before then
    raise exception 'R2 state muté malgré rejet stale';
  end if;

  raise notice 'R2 OK — stale refusé, state intact';
end $$;

-- ############################################################################
-- R3) Booléen nu refusé ; state inchangé
-- ############################################################################

do $$
declare
  c public.tnpg01_smoke_ctx%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_caught boolean := false;
  v_msg text;
begin
  select * into strict c from public.tnpg01_smoke_ctx where id = 1;
  perform public.tnpg01_set_jwt(c.guest_id);
  v_before := public.tnpg01_session_state(c.lobby_id);

  begin
    perform public.contribute_game_session_player(
      c.lobby_id, 'tiernight', 'ready', 'true'::jsonb
    );
  exception when others then
    v_caught := true;
    v_msg := SQLERRM;
    if v_msg not like 'Ready TierNight: objet {ready, expectedSetupEpoch}%' then
      raise exception 'R3 exception inattendue: %', v_msg;
    end if;
  end;

  if not v_caught then
    raise exception 'R3 aurait dû refuser le booléen nu';
  end if;

  v_after := public.tnpg01_session_state(c.lobby_id);
  if v_after is distinct from v_before then
    raise exception 'R3 state muté';
  end if;

  raise notice 'R3 OK — booléen nu refusé';
end $$;

-- ############################################################################
-- R4) UID non forgeable (champs parasites ignorés ; seule clé auth.uid)
-- ############################################################################

do $$
declare
  c public.tnpg01_smoke_ctx%rowtype;
  v_ready jsonb;
  v_keys text[];
begin
  select * into strict c from public.tnpg01_smoke_ctx where id = 1;
  perform public.tnpg01_set_jwt(c.guest_id);

  -- Payload avec champs parasites (uid / forged) — le SQL lit uniquement ready + epoch
  perform public.contribute_game_session_player(
    c.lobby_id,
    'tiernight',
    'ready',
    jsonb_build_object(
      'ready', true,
      'expectedSetupEpoch', 4,
      'uid', c.host_id::text,
      'forgedReady', jsonb_build_object(c.host_id::text, true)
    )
  );

  v_ready := public.tnpg01_session_state(c.lobby_id) -> 'tierNightPrep' -> 'ready';
  select array_agg(k order by k) into v_keys
  from jsonb_object_keys(v_ready) k;

  if not (v_ready ? c.guest_id::text) then
    raise exception 'R4 ready[guest] absent';
  end if;
  if v_ready ? c.host_id::text then
    raise exception 'R4 ready[host] présent — UID forgeable ? %', v_ready;
  end if;
  if coalesce(array_length(v_keys, 1), 0) <> 1 then
    raise exception 'R4 ready doit avoir exactement 1 clé (guest), got %', v_keys;
  end if;

  raise notice 'R4 OK — écriture sous auth.uid() uniquement (parasites ignorés)';
end $$;

-- ############################################################################
-- R5) game_id incompatible
-- ############################################################################

do $$
declare
  c public.tnpg01_smoke_ctx%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_caught boolean := false;
  v_msg text;
begin
  select * into strict c from public.tnpg01_smoke_ctx where id = 1;
  perform public.tnpg01_set_jwt(c.guest_id);

  update public.game_sessions
  set game_id = 'hottake'
  where lobby_id = c.lobby_id;
  -- screen reste tiernight-prep

  v_before := public.tnpg01_session_state(c.lobby_id);

  begin
    perform public.contribute_game_session_player(
      c.lobby_id,
      'tiernight',
      'ready',
      jsonb_build_object('ready', true, 'expectedSetupEpoch', 4)
    );
  exception when others then
    v_caught := true;
    v_msg := SQLERRM;
    if v_msg not like 'Jeu de session incompatible pour TierNight prep%' then
      raise exception 'R5 exception inattendue: %', v_msg;
    end if;
  end;

  if not v_caught then
    raise exception 'R5 aurait dû refuser game_id hottake';
  end if;

  v_after := public.tnpg01_session_state(c.lobby_id);
  if v_after is distinct from v_before then
    raise exception 'R5 state muté';
  end if;

  update public.game_sessions
  set game_id = 'tiernight', screen = 'tiernight-prep'
  where lobby_id = c.lobby_id;

  raise notice 'R5 OK — game_id incompatible refusé';
end $$;

-- ############################################################################
-- R6) Écrans incompatibles (hottake-prep, trivia-prep)
-- ############################################################################

do $$
declare
  c public.tnpg01_smoke_ctx%rowtype;
  v_screen text;
  v_before jsonb;
  v_after jsonb;
  v_caught boolean;
  v_msg text;
begin
  select * into strict c from public.tnpg01_smoke_ctx where id = 1;
  perform public.tnpg01_set_jwt(c.guest_id);

  foreach v_screen in array array['hottake-prep', 'trivia-prep']
  loop
    update public.game_sessions
    set game_id = 'tiernight', screen = v_screen
    where lobby_id = c.lobby_id;

    v_before := public.tnpg01_session_state(c.lobby_id);
    v_caught := false;

    begin
      perform public.contribute_game_session_player(
        c.lobby_id,
        'tiernight',
        'ready',
        jsonb_build_object('ready', true, 'expectedSetupEpoch', 4)
      );
    exception when others then
      v_caught := true;
      v_msg := SQLERRM;
      if v_msg not like 'Contribution TierNight prep uniquement sur tiernight-prep%' then
        raise exception 'R6 (%) exception inattendue: %', v_screen, v_msg;
      end if;
    end;

    if not v_caught then
      raise exception 'R6 (%) aurait dû être refusé', v_screen;
    end if;

    v_after := public.tnpg01_session_state(c.lobby_id);
    if v_after is distinct from v_before then
      raise exception 'R6 (%) state muté', v_screen;
    end if;
  end loop;

  update public.game_sessions
  set game_id = 'tiernight', screen = 'tiernight-prep'
  where lobby_id = c.lobby_id;

  raise notice 'R6 OK — hottake-prep et trivia-prep refusés';
end $$;

-- ############################################################################
-- R7) pool_invalidate_request custom possédé
-- ############################################################################

do $$
declare
  c public.tnpg01_smoke_ctx%rowtype;
  v_s0 jsonb;
  v_after jsonb;
  v_prep0 jsonb;
  v_prep jsonb;
begin
  select * into strict c from public.tnpg01_smoke_ctx where id = 1;
  perform public.tnpg01_set_jwt(c.guest_id);

  -- Garantir custom guest présent
  if not exists (
    select 1
    from jsonb_array_elements(
      coalesce(public.tnpg01_session_state(c.lobby_id) -> 'customRosterTopics', '[]'::jsonb)
    ) e
    where e->>'id' = c.guest_custom_id
      and e->>'authorUid' = c.guest_id::text
  ) then
    raise exception 'R7 prérequis custom guest absent';
  end if;

  v_s0 := public.tnpg01_session_state(c.lobby_id);
  v_prep0 := v_s0 -> 'tierNightPrep';

  perform public.contribute_game_session_player(
    c.lobby_id,
    'tiernight',
    'pool_invalidate_request',
    jsonb_build_object(
      'requestId', 'inv-guest-1',
      'customEntryId', c.guest_custom_id
    )
  );

  v_after := public.tnpg01_session_state(c.lobby_id);
  v_prep := v_after -> 'tierNightPrep';

  if (v_prep ->> 'poolInvalidateRequestId') is distinct from 'inv-guest-1' then
    raise exception 'R7 poolInvalidateRequestId attendu inv-guest-1, got %',
      v_prep -> 'poolInvalidateRequestId';
  end if;
  if jsonb_typeof(v_prep -> 'poolInvalidateRequestId') is distinct from 'string' then
    raise exception 'R7 doit persister une string, pas un objet';
  end if;
  if v_prep ? 'customEntryId' or v_prep ? 'requestId' then
    raise exception 'R7 ne doit pas stocker customEntryId/requestId sous prep';
  end if;
  if v_prep -> 'categoryIds' is distinct from (v_prep0 -> 'categoryIds') then
    raise exception 'R7 categoryIds muté';
  end if;
  if (v_prep ->> 'roundCount') is distinct from (v_prep0 ->> 'roundCount') then
    raise exception 'R7 roundCount muté';
  end if;
  if v_prep -> 'ready' is distinct from (v_prep0 -> 'ready') then
    raise exception 'R7 ready muté';
  end if;
  if (v_prep ->> 'setupEpoch') is distinct from (v_prep0 ->> 'setupEpoch') then
    raise exception 'R7 setupEpoch muté';
  end if;
  if v_after -> 'customRosterTopics' is distinct from (v_s0 -> 'customRosterTopics') then
    raise exception 'R7 customRosterTopics muté';
  end if;
  if (v_s0 - 'tierNightPrep') is distinct from (v_after - 'tierNightPrep') then
    raise exception 'R7 branche hors tierNightPrep mutée';
  end if;

  raise notice 'R7 OK — invalidate custom possédé, seuls requestId string persisté';
end $$;

-- ############################################################################
-- R8) Ownership — custom inexistant + custom hôte
-- ############################################################################

do $$
declare
  c public.tnpg01_smoke_ctx%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_caught boolean;
  v_msg text;
begin
  select * into strict c from public.tnpg01_smoke_ctx where id = 1;
  perform public.tnpg01_set_jwt(c.guest_id);

  -- R8a custom inexistant
  v_before := public.tnpg01_session_state(c.lobby_id);
  v_caught := false;
  begin
    perform public.contribute_game_session_player(
      c.lobby_id,
      'tiernight',
      'pool_invalidate_request',
      jsonb_build_object(
        'requestId', 'inv-missing',
        'customEntryId', 'custom-roster-tnpg01-missing'
      )
    );
  exception when others then
    v_caught := true;
    v_msg := SQLERRM;
    if v_msg is distinct from 'pool_invalidate_request: custom inexistant ou non possédé.' then
      raise exception 'R8a message inattendu: %', v_msg;
    end if;
  end;
  if not v_caught then
    raise exception 'R8a aurait dû échouer';
  end if;
  v_after := public.tnpg01_session_state(c.lobby_id);
  if v_after is distinct from v_before then
    raise exception 'R8a state muté';
  end if;

  -- R8b custom de l’hôte, JWT = invité
  v_before := public.tnpg01_session_state(c.lobby_id);
  v_caught := false;
  begin
    perform public.contribute_game_session_player(
      c.lobby_id,
      'tiernight',
      'pool_invalidate_request',
      jsonb_build_object(
        'requestId', 'inv-host-owned',
        'customEntryId', c.host_custom_id
      )
    );
  exception when others then
    v_caught := true;
    v_msg := SQLERRM;
    if v_msg is distinct from 'pool_invalidate_request: custom inexistant ou non possédé.' then
      raise exception 'R8b message inattendu: %', v_msg;
    end if;
  end;
  if not v_caught then
    raise exception 'R8b aurait dû échouer (ownership)';
  end if;
  v_after := public.tnpg01_session_state(c.lobby_id);
  if v_after is distinct from v_before then
    raise exception 'R8b state muté';
  end if;

  -- R8c string seule
  v_before := public.tnpg01_session_state(c.lobby_id);
  v_caught := false;
  begin
    perform public.contribute_game_session_player(
      c.lobby_id,
      'tiernight',
      'pool_invalidate_request',
      to_jsonb('inv-string-only'::text)
    );
  exception when others then
    v_caught := true;
    v_msg := SQLERRM;
    if v_msg not like 'pool_invalidate_request: objet {requestId, customEntryId}%' then
      raise exception 'R8c exception inattendue: %', v_msg;
    end if;
  end;
  if not v_caught then
    raise exception 'R8c aurait dû refuser string seule';
  end if;
  v_after := public.tnpg01_session_state(c.lobby_id);
  if v_after is distinct from v_before then
    raise exception 'R8c state muté';
  end if;

  raise notice 'R8 OK — missing / host-owned / string seule refusés';
end $$;

-- ############################################################################
-- R9) Non-régression kinds historiques (fixtures minimales sur même lobby)
-- ############################################################################

do $$
declare
  c public.tnpg01_smoke_ctx%rowtype;
  v_state jsonb;
  v_uid text;
begin
  select * into strict c from public.tnpg01_smoke_ctx where id = 1;
  perform public.tnpg01_set_jwt(c.guest_id);
  v_uid := c.guest_id::text;

  -- 9.1 ready générique Hot Take (booléen)
  update public.game_sessions
  set game_id = 'hottake',
      screen = 'hottake-prep',
      state = jsonb_build_object(
        'hotTake', jsonb_build_object('phase', null, 'ready', '{}'::jsonb)
      )
  where lobby_id = c.lobby_id;

  perform public.contribute_game_session_player(
    c.lobby_id, 'hottake', 'ready', 'true'::jsonb
  );
  v_state := public.tnpg01_session_state(c.lobby_id);
  if (v_state #>> array['hotTake', 'ready', v_uid]) is distinct from 'true' then
    raise exception 'R9 ready hottake path fail: %', v_state -> 'hotTake' -> 'ready';
  end if;

  -- 9.2 vote Hot Take
  update public.game_sessions
  set game_id = 'hottake',
      screen = 'hottake',
      state = jsonb_build_object(
        'hotTake', jsonb_build_object('phase', 'voting', 'votes', '{}'::jsonb)
      )
  where lobby_id = c.lobby_id;

  perform public.contribute_game_session_player(
    c.lobby_id, 'hottake', 'vote', to_jsonb('agree'::text)
  );
  v_state := public.tnpg01_session_state(c.lobby_id);
  if (v_state #>> array['hotTake', 'votes', v_uid]) is distinct from 'agree' then
    raise exception 'R9 vote path fail';
  end if;

  -- 9.3 answer Trivia
  update public.game_sessions
  set game_id = 'trivia',
      screen = 'trivia',
      state = jsonb_build_object(
        'trivia', jsonb_build_object(
          'phase', 'answering',
          'answers', '{}'::jsonb
        )
      )
  where lobby_id = c.lobby_id;

  perform public.contribute_game_session_player(
    c.lobby_id,
    'trivia',
    'answer',
    jsonb_build_object('answerIndex', 1, 'answeredAt', 1)
  );
  v_state := public.tnpg01_session_state(c.lobby_id);
  if (v_state -> 'trivia' -> 'answers' -> v_uid) is null then
    raise exception 'R9 answer path fail';
  end if;

  -- 9.4 tap Clutch
  update public.game_sessions
  set game_id = 'clutch',
      screen = 'clutch',
      state = jsonb_build_object(
        'clutch', jsonb_build_object('phase', 'active', 'taps', '{}'::jsonb)
      )
  where lobby_id = c.lobby_id;

  perform public.contribute_game_session_player(
    c.lobby_id, 'clutch', 'tap', jsonb_build_object('ms', 42)
  );
  v_state := public.tnpg01_session_state(c.lobby_id);
  if (v_state -> 'clutch' -> 'taps' -> v_uid) is null then
    raise exception 'R9 tap path fail';
  end if;

  -- 9.5 deal_ack Traître
  update public.game_sessions
  set game_id = 'traitre',
      screen = 'traitre',
      state = jsonb_build_object(
        'traitre', jsonb_build_object('phase', 'deal', 'dealAcks', '{}'::jsonb)
      )
  where lobby_id = c.lobby_id;

  perform public.contribute_game_session_player(
    c.lobby_id, 'traitre', 'deal_ack', 'true'::jsonb
  );
  v_state := public.tnpg01_session_state(c.lobby_id);
  if (v_state #>> array['traitre', 'dealAcks', v_uid]) is distinct from 'true' then
    raise exception 'R9 deal_ack path fail';
  end if;

  -- 9.6 submission GuessLie
  update public.game_sessions
  set game_id = 'guesslie',
      screen = 'guesslie-menu',
      state = jsonb_build_object(
        'guessLie', jsonb_build_object('submissions', '{}'::jsonb)
      )
  where lobby_id = c.lobby_id;

  perform public.contribute_game_session_player(
    c.lobby_id,
    'guesslie',
    'submission',
    jsonb_build_object('truths', jsonb_build_array('a', 'b'), 'lie', 'c')
  );
  v_state := public.tnpg01_session_state(c.lobby_id);
  if (v_state -> 'guessLie' -> 'submissions' -> v_uid) is null then
    raise exception 'R9 submission path fail';
  end if;

  -- 9.7 placement TierNight classic
  update public.game_sessions
  set game_id = 'tiernight',
      screen = 'tiernight',
      state = jsonb_build_object(
        'tierNight', jsonb_build_object(
          'placements', '{}'::jsonb,
          'finished', '{}'::jsonb
        )
      )
  where lobby_id = c.lobby_id;

  perform public.contribute_game_session_player(
    c.lobby_id,
    'tiernight',
    'placement',
    jsonb_build_object('S', jsonb_build_array('x'), 'A', '[]'::jsonb)
  );
  v_state := public.tnpg01_session_state(c.lobby_id);
  if (v_state -> 'tierNight' -> 'placements' -> v_uid) is null then
    raise exception 'R9 placement path fail';
  end if;

  -- 9.8 finished TierNight classic
  perform public.contribute_game_session_player(
    c.lobby_id, 'tiernight', 'finished', 'true'::jsonb
  );
  v_state := public.tnpg01_session_state(c.lobby_id);
  if (v_state #>> array['tierNight', 'finished', v_uid]) is distinct from 'true' then
    raise exception 'R9 finished path fail';
  end if;

  -- Restaurer fixture prep pour cleanup cohérent (optionnel)
  update public.game_sessions
  set game_id = 'tiernight',
      screen = 'tiernight-prep',
      state = public.tnpg01_build_prep_state(
        c.host_id, c.guest_id, c.guest_custom_id, c.host_custom_id, 4
      )
  where lobby_id = c.lobby_id;

  raise notice 'R9 OK — ready/vote/answer/tap/deal_ack/submission/placement/finished';
end $$;

-- ############################################################################
-- R10) Cleanup + vérifs zéro fixture + drop helpers
-- ############################################################################

select public.tnpg01_cleanup_fixtures() as cleanup_final;

do $$
declare
  v_lobbies int;
  v_sessions int;
  v_members int;
  v_ctx int;
  v_helpers int;
begin
  select count(*) into v_lobbies from public.lobbies where code like 'TNPG01%';
  select count(*) into v_sessions
  from public.game_sessions gs
  join public.lobbies l on l.id = gs.lobby_id
  where l.code like 'TNPG01%';
  select count(*) into v_members
  from public.lobby_members lm
  join public.lobbies l on l.id = lm.lobby_id
  where l.code like 'TNPG01%';
  select count(*) into v_ctx from public.tnpg01_smoke_ctx;

  if v_lobbies <> 0 or v_sessions <> 0 or v_members <> 0 or v_ctx <> 0 then
    raise exception
      'R10 fixtures restantes lobbies=% sessions=% members=% ctx=%',
      v_lobbies, v_sessions, v_members, v_ctx;
  end if;

  raise notice 'R10 fixtures OK — remaining=0';
end $$;

-- Drop helpers (après vérif fixtures)
drop function if exists public.tnpg01_spawn_prep_fixture(text);
drop function if exists public.tnpg01_build_prep_state(uuid, uuid, text, text, int);
drop function if exists public.tnpg01_session_state(uuid);
drop function if exists public.tnpg01_set_jwt(uuid);
drop function if exists public.tnpg01_resolve_actors();
drop function if exists public.tnpg01_cleanup_fixtures();
drop table if exists public.tnpg01_smoke_ctx;

do $$
declare
  v_helpers int;
begin
  select count(*) into v_helpers
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname like 'tnpg01_%';

  if v_helpers <> 0 then
    raise exception 'R10 helpers restants: %', v_helpers;
  end if;

  if to_regclass('public.tnpg01_smoke_ctx') is not null then
    raise exception 'R10 smoke_ctx_exists encore true';
  end if;

  raise notice 'R10 OK — remaining_helpers=0 smoke_ctx_exists=false';
end $$;

-- =============================================================================
-- CLEANUP DE SECOURS (relançable seul si échec intermédiaire)
-- =============================================================================
-- select public.tnpg01_cleanup_fixtures();
-- delete from public.game_sessions gs using public.lobbies l
--   where gs.lobby_id = l.id and l.code like 'TNPG01%';
-- delete from public.lobby_members lm using public.lobbies l
--   where lm.lobby_id = l.id and l.code like 'TNPG01%';
-- delete from public.lobbies where code like 'TNPG01%';
-- drop function if exists public.tnpg01_spawn_prep_fixture(text);
-- drop function if exists public.tnpg01_build_prep_state(uuid, uuid, text, text, int);
-- drop function if exists public.tnpg01_session_state(uuid);
-- drop function if exists public.tnpg01_set_jwt(uuid);
-- drop function if exists public.tnpg01_resolve_actors();
-- drop function if exists public.tnpg01_cleanup_fixtures();
-- drop table if exists public.tnpg01_smoke_ctx;
-- =============================================================================
-- FIN HARNESS — R1–R10 non validés tant que non exécuté sur staging
-- =============================================================================
