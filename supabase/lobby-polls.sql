-- REVEAL — Vague 1 : sondages « prochain jeu » (tables + RLS + RPC)
-- Dépendances : schema.sql (lobbies, lobby_members, is_lobby_member),
--               game-sessions.sql, game-sessions-i08-arch03.sql (is_lobby_host, is_acting_host).
-- Réexécutable (create or replace / drop policy if exists).
--
-- Auth : les invités anonymes Supabase utilisent le rôle `authenticated` (comme les autres RPC).
--
-- Realtime (dashboard) : activer la réplication pour lobby_polls et lobby_poll_votes
--   (ou décommenter le bloc publication en bas si la publication supabase_realtime existe).
--
-- LIMITE V1 — course création / lancement :
--   create_lobby_poll verrouille lobbies puis lit game_sessions, mais les chemins
--   client de lancement (upsert/patch session) ne prennent pas forcément le même
--   verrou. Pas de sérialisation absolue. Si le launch est déjà visible → création
--   refusée. Si la création gagne → poll open jusqu'au close post-launch (hook client
--   ultérieur, par poll_id). Aucune erreur poll ne doit bloquer un lancement.
--   Atomicité launch+close = RPC de lancement commune, hors scope V1.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.lobby_polls (
  id uuid primary key default gen_random_uuid(),
  lobby_id uuid not null references public.lobbies (id) on delete cascade,
  created_by uuid references auth.users (id) on delete set null,
  status text not null default 'open' check (status in ('open', 'closed')),
  options jsonb not null,
  closed_reason text check (
    closed_reason is null or closed_reason in ('launch', 'explicit')
  ),
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  constraint lobby_polls_status_closed_coherence check (
    (
      status = 'open'
      and closed_at is null
      and closed_reason is null
    )
    or (
      status = 'closed'
      and closed_at is not null
      and closed_reason in ('launch', 'explicit')
    )
  )
);

create unique index if not exists lobby_polls_one_open_per_lobby
  on public.lobby_polls (lobby_id)
  where status = 'open';

create index if not exists lobby_polls_lobby_idx on public.lobby_polls (lobby_id);
create index if not exists lobby_polls_lobby_status_idx
  on public.lobby_polls (lobby_id, status);

create table if not exists public.lobby_poll_votes (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references public.lobby_polls (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  game_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lobby_poll_votes_poll_user_unique unique (poll_id, user_id)
);

create index if not exists lobby_poll_votes_poll_idx on public.lobby_poll_votes (poll_id);

drop trigger if exists lobby_poll_votes_updated_at on public.lobby_poll_votes;
create trigger lobby_poll_votes_updated_at
before update on public.lobby_poll_votes
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS — lecture membres uniquement ; écritures via RPC SECURITY DEFINER
-- ---------------------------------------------------------------------------

alter table public.lobby_polls enable row level security;
alter table public.lobby_poll_votes enable row level security;

drop policy if exists "lobby_polls_select_member" on public.lobby_polls;
create policy "lobby_polls_select_member" on public.lobby_polls
for select using (public.is_lobby_member(lobby_id));

drop policy if exists "lobby_poll_votes_select_member" on public.lobby_poll_votes;
create policy "lobby_poll_votes_select_member" on public.lobby_poll_votes
for select using (
  exists (
    select 1
    from public.lobby_polls p
    where p.id = poll_id
      and public.is_lobby_member(p.lobby_id)
  )
);

-- Pas de INSERT/UPDATE/DELETE client (RPC only).

revoke all on table public.lobby_polls from public;
revoke all on table public.lobby_poll_votes from public;
grant select on table public.lobby_polls to authenticated;
grant select on table public.lobby_poll_votes to authenticated;

-- ---------------------------------------------------------------------------
-- Allowlist catalogue (IDs = data/games.js GAMES_AVAILABLE[].id)
-- Marqueur test drift : -- REVEAL_POLL_GAME_ALLOWLIST_BEGIN / END
-- ---------------------------------------------------------------------------

create or replace function public.reveal_poll_allowed_game_ids()
returns text[]
language sql
immutable
set search_path = pg_catalog, public
as $$
  -- REVEAL_POLL_GAME_ALLOWLIST_BEGIN
  select array[
    'traitre-prep',
    'playlistguess-prep',
    'consensus-prep',
    'hottake-prep',
    'guesslie',
    'speedvote-prep',
    'clutch-prep',
    'wronganswer-prep',
    'dilemma-prep',
    'truthmeter-prep',
    'tiernight-select',
    'trivia-prep'
  ]::text[];
  -- REVEAL_POLL_GAME_ALLOWLIST_END
$$;

revoke all on function public.reveal_poll_allowed_game_ids() from public;
grant execute on function public.reveal_poll_allowed_game_ids() to authenticated;

-- ---------------------------------------------------------------------------
-- Phase distante (helper — appelé DANS create_lobby_poll sous verrou lobbies)
-- ---------------------------------------------------------------------------

create or replace function public.can_create_lobby_poll_phase(p_lobby_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_lobby_game_id text;
  v_session_game_id text;
  v_session_screen text;
begin
  select l.game_id
  into v_lobby_game_id
  from public.lobbies l
  where l.id = p_lobby_id;

  if not found then
    return false;
  end if;

  select gs.game_id, gs.screen
  into v_session_game_id, v_session_screen
  from public.game_sessions gs
  where gs.lobby_id = p_lobby_id;

  if not found then
    return v_lobby_game_id is null or v_lobby_game_id = 'menu';
  end if;

  return v_session_game_id = 'menu'
    and v_session_screen in ('results', 'leaderboard', 'game-select');
end;
$$;

revoke all on function public.can_create_lobby_poll_phase(uuid) from public;
revoke all on function public.can_create_lobby_poll_phase(uuid) from anon;
revoke all on function public.can_create_lobby_poll_phase(uuid) from authenticated;
-- Helper interne : pas d'EXECUTE client (évite un faux « pré-check » hors transaction).

-- ---------------------------------------------------------------------------
-- Validation options JSON
-- ---------------------------------------------------------------------------

create or replace function public.validate_lobby_poll_options(p_options jsonb)
returns void
language plpgsql
immutable
set search_path = pg_catalog, public
as $$
declare
  v_len int;
  v_opt jsonb;
  v_keys text[];
  v_game_id text;
  v_title text;
  v_emoji text;
  v_seen text[] := array[]::text[];
  v_allowed text[] := public.reveal_poll_allowed_game_ids();
  v_i int;
begin
  if p_options is null or jsonb_typeof(p_options) <> 'array' then
    raise exception 'poll_options_invalid';
  end if;

  v_len := jsonb_array_length(p_options);
  if v_len < 2 then
    raise exception 'poll_options_too_few';
  end if;
  if v_len > 20 then
    raise exception 'poll_options_too_many';
  end if;

  -- Plafond taille totale (~8 KiB)
  if octet_length(p_options::text) > 8192 then
    raise exception 'poll_options_too_large';
  end if;

  for v_i in 0 .. v_len - 1 loop
    v_opt := p_options -> v_i;
    if v_opt is null or jsonb_typeof(v_opt) <> 'object' then
      raise exception 'poll_options_invalid';
    end if;

    select array_agg(k order by k)
    into v_keys
    from jsonb_object_keys(v_opt) as k;

    if v_keys is distinct from array['emoji', 'gameId', 'title']::text[] then
      raise exception 'poll_options_invalid_keys';
    end if;

    if jsonb_typeof(v_opt -> 'gameId') <> 'string'
      or jsonb_typeof(v_opt -> 'title') <> 'string'
      or jsonb_typeof(v_opt -> 'emoji') <> 'string'
    then
      raise exception 'poll_options_invalid_types';
    end if;

    v_game_id := v_opt ->> 'gameId';
    v_title := v_opt ->> 'title';
    v_emoji := v_opt ->> 'emoji';

    if v_game_id is null or length(trim(v_game_id)) = 0
      or v_title is null or length(trim(v_title)) = 0
      or v_emoji is null or length(trim(v_emoji)) = 0
    then
      raise exception 'poll_options_empty_field';
    end if;

    if char_length(v_game_id) > 64
      or char_length(v_title) > 80
      or char_length(v_emoji) > 16
    then
      raise exception 'poll_options_field_too_long';
    end if;

    if v_game_id !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
      raise exception 'poll_options_invalid_game_id';
    end if;

    if v_game_id = any (v_seen) then
      raise exception 'poll_options_duplicate_game_id';
    end if;
    v_seen := array_append(v_seen, v_game_id);

    if not (v_game_id = any (v_allowed)) then
      raise exception 'poll_options_game_id_not_allowed';
    end if;
  end loop;
end;
$$;

revoke all on function public.validate_lobby_poll_options(jsonb) from public;
revoke all on function public.validate_lobby_poll_options(jsonb) from anon;
revoke all on function public.validate_lobby_poll_options(jsonb) from authenticated;

-- ---------------------------------------------------------------------------
-- create_lobby_poll
-- ---------------------------------------------------------------------------

create or replace function public.create_lobby_poll(
  p_lobby_id uuid,
  p_options jsonb
)
returns public.lobby_polls
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_lobby_id uuid;
  v_row public.lobby_polls;
begin
  if v_uid is null then
    raise exception 'Authentification requise.';
  end if;

  -- 1) Verrou lobby (filet concurrent create ; pas de sérialisation absolue vs launch client)
  select l.id
  into v_lobby_id
  from public.lobbies l
  where l.id = p_lobby_id
  for update;

  if v_lobby_id is null then
    raise exception 'Lobby introuvable.';
  end if;

  -- 2) Membership
  if not public.is_lobby_member(p_lobby_id) then
    raise exception 'Tu n''es pas membre de ce lobby.';
  end if;

  -- 3–4) Phase distante (relecture sous verrou lobbies)
  if not public.can_create_lobby_poll_phase(p_lobby_id) then
    raise exception 'poll_creation_not_allowed_in_current_phase';
  end if;

  -- Options
  perform public.validate_lobby_poll_options(p_options);

  -- 5) Insert (index unique partiel = arbitre double open)
  begin
    insert into public.lobby_polls (lobby_id, created_by, status, options)
    values (p_lobby_id, v_uid, 'open', p_options)
    returning * into v_row;
  exception
    when unique_violation then
      raise exception 'poll_already_open';
  end;

  return v_row;
end;
$$;

revoke all on function public.create_lobby_poll(uuid, jsonb) from public;
revoke all on function public.create_lobby_poll(uuid, jsonb) from anon;
grant execute on function public.create_lobby_poll(uuid, jsonb) to authenticated;

comment on function public.create_lobby_poll(uuid, jsonb) is
  'Vague 1 : crée un sondage open si phase hub/entre-jeux ; refuse sinon (poll_creation_not_allowed_in_current_phase).';

-- ---------------------------------------------------------------------------
-- cast_lobby_poll_vote
-- ---------------------------------------------------------------------------

create or replace function public.cast_lobby_poll_vote(
  p_poll_id uuid,
  p_game_id text
)
returns public.lobby_poll_votes
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_lobby_id uuid;
  v_status text;
  v_options jsonb;
  v_ok boolean;
  v_row public.lobby_poll_votes;
begin
  if v_uid is null then
    raise exception 'Authentification requise.';
  end if;

  if p_game_id is null or length(trim(p_game_id)) = 0 then
    raise exception 'poll_vote_invalid_game_id';
  end if;

  select p.lobby_id, p.status, p.options
  into v_lobby_id, v_status, v_options
  from public.lobby_polls p
  where p.id = p_poll_id
  for update;

  if v_lobby_id is null then
    raise exception 'poll_not_found';
  end if;

  if not public.is_lobby_member(v_lobby_id) then
    raise exception 'Tu n''es pas membre de ce lobby.';
  end if;

  if v_status is distinct from 'open' then
    raise exception 'poll_not_open';
  end if;

  select exists (
    select 1
    from jsonb_array_elements(v_options) as opt
    where opt ->> 'gameId' = p_game_id
  )
  into v_ok;

  if not coalesce(v_ok, false) then
    raise exception 'poll_vote_game_id_not_in_options';
  end if;

  insert into public.lobby_poll_votes (poll_id, user_id, game_id)
  values (p_poll_id, v_uid, p_game_id)
  on conflict (poll_id, user_id) do update
    set game_id = excluded.game_id,
        updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.cast_lobby_poll_vote(uuid, text) from public;
revoke all on function public.cast_lobby_poll_vote(uuid, text) from anon;
grant execute on function public.cast_lobby_poll_vote(uuid, text) to authenticated;

comment on function public.cast_lobby_poll_vote(uuid, text) is
  'Vague 1 : upsert vote (changement autorisé) ; ne ferme jamais le sondage.';

-- ---------------------------------------------------------------------------
-- close_lobby_poll (ciblé par poll_id — un seul contrat, pas de variante lobby_id)
-- ---------------------------------------------------------------------------

create or replace function public.close_lobby_poll(
  p_poll_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_lobby_id uuid;
  v_poll public.lobby_polls;
begin
  if v_uid is null then
    raise exception 'Authentification requise.';
  end if;

  if p_poll_id is null then
    return jsonb_build_object(
      'outcome', 'poll_not_found',
      'poll_id', null
    );
  end if;

  if p_reason is null or p_reason not in ('launch', 'explicit') then
    raise exception 'poll_close_invalid_reason';
  end if;

  -- Poll ciblé (verrou ligne)
  select *
  into v_poll
  from public.lobby_polls p
  where p.id = p_poll_id
  for update;

  if not found then
    return jsonb_build_object(
      'outcome', 'poll_not_found',
      'poll_id', p_poll_id
    );
  end if;

  v_lobby_id := v_poll.lobby_id;

  -- Verrou lobby (membership / host stables pendant la clôture)
  perform 1 from public.lobbies l where l.id = v_lobby_id for update;

  if not public.is_lobby_member(v_lobby_id) then
    raise exception 'Tu n''es pas membre de ce lobby.';
  end if;

  if not (public.is_lobby_host(v_lobby_id) or public.is_acting_host(v_lobby_id)) then
    raise exception 'Clôture réservée à l''hôte ou à l''acting host.';
  end if;

  -- Idempotent : ce poll précis déjà fermé
  if v_poll.status = 'closed' then
    return jsonb_build_object(
      'outcome', 'already_closed',
      'poll_id', v_poll.id,
      'status', v_poll.status,
      'closed_reason', v_poll.closed_reason,
      'closed_at', v_poll.closed_at
    );
  end if;

  update public.lobby_polls
  set status = 'closed',
      closed_reason = p_reason,
      closed_at = now()
  where id = v_poll.id
    and status = 'open'
  returning * into v_poll;

  if not found then
    -- Course rare : fermé entre le SELECT et l'UPDATE
    select * into v_poll from public.lobby_polls where id = p_poll_id;
    return jsonb_build_object(
      'outcome', 'already_closed',
      'poll_id', p_poll_id,
      'status', v_poll.status,
      'closed_reason', v_poll.closed_reason,
      'closed_at', v_poll.closed_at
    );
  end if;

  return jsonb_build_object(
    'outcome', 'closed',
    'poll_id', v_poll.id,
    'status', v_poll.status,
    'closed_reason', v_poll.closed_reason,
    'closed_at', v_poll.closed_at
  );
end;
$$;

revoke all on function public.close_lobby_poll(uuid, text) from public;
revoke all on function public.close_lobby_poll(uuid, text) from anon;
grant execute on function public.close_lobby_poll(uuid, text) to authenticated;

comment on function public.close_lobby_poll(uuid, text) is
  'Vague 1 : ferme le sondage ciblé par poll_id (launch|explicit). Idempotent. Pas de close aveugle par lobby_id.';

-- ---------------------------------------------------------------------------
-- Realtime (optionnel si la publication existe déjà)
-- ---------------------------------------------------------------------------
-- Dashboard : Database → Replication → activer lobby_polls + lobby_poll_votes.
-- Ou décommenter :
--
-- do $$
-- begin
--   alter publication supabase_realtime add table public.lobby_polls;
-- exception
--   when duplicate_object then null;
--   when undefined_object then null;
-- end $$;
--
-- do $$
-- begin
--   alter publication supabase_realtime add table public.lobby_poll_votes;
-- exception
--   when duplicate_object then null;
--   when undefined_object then null;
-- end $$;
