-- FEATURE-FRIENDS-01 — graphe d’amis (tables + RLS + RPC)
--
-- STAGING d’abord. Ne PAS appliquer en production avant Palier 9 (QA client)
-- et Palier 10 (docs/FRIENDS.md).
-- Idempotent (create if not exists / create or replace / drop policy if exists).
--
-- Contrats : js/config/friends.js
--   send_friend_request / decline_friend_request / accept_friend_request /
--   unfriend / get_lobby_friend_overlay / list_my_friends /
--   list_incoming_friend_requests
-- Erreurs métier (exception.message) : friends_cooldown, friends_guest,
--   friends_self, friends_not_found, friends_already
--
-- Dépendances : schema.sql (profiles, lobbies, lobby_members, is_lobby_member,
--   auth.users). Les invités Supabase sont rôle `authenticated` + is_anonymous :
--   le GRANT authenticated ne suffit pas — chaque RPC vérifie is_anonymous.
--
-- Realtime : ce fichier tente d’ajouter friend_requests + friendships à
--   supabase_realtime. Vérifier : SQL Editor (pg_publication_tables) ou
--   Dashboard → Database → Publications → supabase_realtime.
--   Pas Database → Replication (c’est pour les destinations externes).
--   friend_request_cooldowns : PAS de realtime.
--
-- Après apply : supabase/tests/feature-friends-01-runbook.sql (catalogue + RLS
--   + smoke JWT). Consigner dans docs/DEPLOYMENTS_SQL.md.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.friend_requests (
  id uuid primary key default gen_random_uuid(),
  from_user_id uuid not null references auth.users (id) on delete cascade,
  to_user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint friend_requests_not_self check (from_user_id <> to_user_id),
  constraint friend_requests_pair_unique unique (from_user_id, to_user_id)
);

create index if not exists friend_requests_to_idx
  on public.friend_requests (to_user_id);
create index if not exists friend_requests_from_idx
  on public.friend_requests (from_user_id);

comment on table public.friend_requests is
  'FEATURE-FRIENDS-01 : demande pending. Refus = DELETE, pas de statut declined.';

create table if not exists public.friendships (
  user_a uuid not null references auth.users (id) on delete cascade,
  user_b uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint friendships_ordered check (user_a < user_b),
  constraint friendships_pkey primary key (user_a, user_b)
);

create index if not exists friendships_user_b_idx
  on public.friendships (user_b);

comment on table public.friendships is
  'FEATURE-FRIENDS-01 : paire ordonnée user_a < user_b.';

create table if not exists public.friend_request_cooldowns (
  from_user_id uuid not null references auth.users (id) on delete cascade,
  to_user_id uuid not null references auth.users (id) on delete cascade,
  until timestamptz not null,
  constraint friend_request_cooldowns_pkey primary key (from_user_id, to_user_id),
  constraint friend_request_cooldowns_not_self check (from_user_id <> to_user_id)
);

comment on table public.friend_request_cooldowns is
  'FEATURE-FRIENDS-01 : 60 s après refus. Invisible client. Pas de Realtime.';

alter table public.friend_requests replica identity full;
alter table public.friendships replica identity full;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.friend_requests enable row level security;
alter table public.friendships enable row level security;
alter table public.friend_request_cooldowns enable row level security;

drop policy if exists friend_requests_select_self on public.friend_requests;
create policy friend_requests_select_self on public.friend_requests
for select using (
  from_user_id = auth.uid() or to_user_id = auth.uid()
);

drop policy if exists friendships_select_self on public.friendships;
create policy friendships_select_self on public.friendships
for select using (
  user_a = auth.uid() or user_b = auth.uid()
);

-- Pas de policy INSERT/UPDATE/DELETE (RPC only).
-- cooldowns : RLS on, zéro policy → le client ne lit / n’écrit rien.

revoke all on table public.friend_requests from public;
revoke all on table public.friend_requests from anon;
revoke all on table public.friendships from public;
revoke all on table public.friendships from anon;
revoke all on table public.friend_request_cooldowns from public;
revoke all on table public.friend_request_cooldowns from anon;
revoke all on table public.friend_request_cooldowns from authenticated;

grant select on table public.friend_requests to authenticated;
grant select on table public.friendships to authenticated;

-- ---------------------------------------------------------------------------
-- Helpers internes (REVOKE client)
-- ---------------------------------------------------------------------------

create or replace function public.friends_auth_kind(p_uid uuid)
returns text
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select case
    when p_uid is null then 'missing'
    when not exists (select 1 from auth.users u where u.id = p_uid) then 'missing'
    when coalesce(
      (select u.is_anonymous from auth.users u where u.id = p_uid),
      true
    ) then 'guest'
    else 'registered'
  end;
$$;

revoke all on function public.friends_auth_kind(uuid) from public;
revoke all on function public.friends_auth_kind(uuid) from anon;
revoke all on function public.friends_auth_kind(uuid) from authenticated;

create or replace function public.friends_require_caller()
returns uuid
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Authentification requise.';
  end if;
  if public.friends_auth_kind(v_uid) is distinct from 'registered' then
    raise exception 'friends_guest';
  end if;
  return v_uid;
end;
$$;

revoke all on function public.friends_require_caller() from public;
revoke all on function public.friends_require_caller() from anon;
revoke all on function public.friends_require_caller() from authenticated;

create or replace function public.friends_lock_pair(p_a uuid, p_b uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  -- pg_advisory_xact_lock(bigint, bigint) n'existe pas : seulement (bigint) ou (int, int).
  -- Une clé (paire ordonnée) comme create_lobby_atomically.
  perform pg_advisory_xact_lock(
    hashtextextended(least(p_a, p_b)::text || ':' || greatest(p_a, p_b)::text, 0)
  );
end;
$$;

revoke all on function public.friends_lock_pair(uuid, uuid) from public;
revoke all on function public.friends_lock_pair(uuid, uuid) from anon;
revoke all on function public.friends_lock_pair(uuid, uuid) from authenticated;

create or replace function public.friends_insert_friendship(p_a uuid, p_b uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  insert into public.friendships (user_a, user_b)
  values (least(p_a, p_b), greatest(p_a, p_b))
  on conflict do nothing;
end;
$$;

revoke all on function public.friends_insert_friendship(uuid, uuid) from public;
revoke all on function public.friends_insert_friendship(uuid, uuid) from anon;
revoke all on function public.friends_insert_friendship(uuid, uuid) from authenticated;

create or replace function public.friends_clear_pair_requests(p_a uuid, p_b uuid)
returns void
language sql
security definer
set search_path = pg_catalog, public
as $$
  delete from public.friend_requests
  where (from_user_id = p_a and to_user_id = p_b)
     or (from_user_id = p_b and to_user_id = p_a);
$$;

revoke all on function public.friends_clear_pair_requests(uuid, uuid) from public;
revoke all on function public.friends_clear_pair_requests(uuid, uuid) from anon;
revoke all on function public.friends_clear_pair_requests(uuid, uuid) from authenticated;

-- ---------------------------------------------------------------------------
-- RPC publiques
-- ---------------------------------------------------------------------------

drop function if exists public.send_friend_request(uuid);
drop function if exists public.decline_friend_request(uuid);
drop function if exists public.accept_friend_request(uuid);
drop function if exists public.unfriend(uuid);
drop function if exists public.get_lobby_friend_overlay(uuid);
drop function if exists public.list_my_friends();
drop function if exists public.list_incoming_friend_requests();

create or replace function public.send_friend_request(p_to uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_from uuid;
  v_to_kind text;
  v_until timestamptz;
begin
  v_from := public.friends_require_caller();

  if p_to is null or p_to = v_from then
    raise exception 'friends_self';
  end if;

  v_to_kind := public.friends_auth_kind(p_to);
  if v_to_kind = 'missing' then
    raise exception 'friends_not_found';
  end if;
  if v_to_kind = 'guest' then
    raise exception 'friends_guest';
  end if;

  perform public.friends_lock_pair(v_from, p_to);

  delete from public.friend_request_cooldowns where until < now();

  if exists (
    select 1
    from public.friendships f
    where f.user_a = least(v_from, p_to)
      and f.user_b = greatest(v_from, p_to)
  ) then
    raise exception 'friends_already';
  end if;

  -- Demande inverse → double consentement : auto-accept
  if exists (
    select 1
    from public.friend_requests r
    where r.from_user_id = p_to
      and r.to_user_id = v_from
  ) then
    perform public.friends_insert_friendship(v_from, p_to);
    perform public.friends_clear_pair_requests(v_from, p_to);
    delete from public.friend_request_cooldowns
    where (from_user_id = v_from and to_user_id = p_to)
       or (from_user_id = p_to and to_user_id = v_from);
    return jsonb_build_object('result', 'friends');
  end if;

  select c.until
    into v_until
  from public.friend_request_cooldowns c
  where c.from_user_id = v_from
    and c.to_user_id = p_to;

  if v_until is not null and v_until > now() then
    raise exception 'friends_cooldown';
  end if;

  if exists (
    select 1
    from public.friend_requests r
    where r.from_user_id = v_from
      and r.to_user_id = p_to
  ) then
    return jsonb_build_object('result', 'pending');
  end if;

  insert into public.friend_requests (from_user_id, to_user_id)
  values (v_from, p_to);

  return jsonb_build_object('result', 'pending');
end;
$$;

revoke all on function public.send_friend_request(uuid) from public;
revoke all on function public.send_friend_request(uuid) from anon;
grant execute on function public.send_friend_request(uuid) to authenticated;

comment on function public.send_friend_request(uuid) is
  'FEATURE-FRIENDS-01 : inscrit → inscrit. Inverse pending = auto-accept. Cooldown 60 s après refus.';

create or replace function public.decline_friend_request(p_from uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid;
  v_deleted int;
begin
  v_uid := public.friends_require_caller();

  if p_from is null or p_from = v_uid then
    raise exception 'friends_self';
  end if;

  delete from public.friend_requests
  where from_user_id = p_from
    and to_user_id = v_uid;
  get diagnostics v_deleted = row_count;

  if v_deleted = 0 then
    return jsonb_build_object('result', 'gone');
  end if;

  insert into public.friend_request_cooldowns (from_user_id, to_user_id, until)
  values (p_from, v_uid, now() + interval '60 seconds')
  on conflict (from_user_id, to_user_id) do update
    set until = excluded.until;

  return jsonb_build_object('result', 'declined');
end;
$$;

revoke all on function public.decline_friend_request(uuid) from public;
revoke all on function public.decline_friend_request(uuid) from anon;
grant execute on function public.decline_friend_request(uuid) to authenticated;

comment on function public.decline_friend_request(uuid) is
  'FEATURE-FRIENDS-01 : destinataire supprime la demande + cooldown 60 s pour l’émetteur. Silencieux.';

create or replace function public.accept_friend_request(p_from uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid;
begin
  v_uid := public.friends_require_caller();

  if p_from is null or p_from = v_uid then
    raise exception 'friends_self';
  end if;

  if public.friends_auth_kind(p_from) is distinct from 'registered' then
    raise exception 'friends_guest';
  end if;

  perform public.friends_lock_pair(v_uid, p_from);

  if not exists (
    select 1
    from public.friend_requests r
    where r.from_user_id = p_from
      and r.to_user_id = v_uid
  ) then
    raise exception 'friends_not_found';
  end if;

  perform public.friends_insert_friendship(v_uid, p_from);
  perform public.friends_clear_pair_requests(v_uid, p_from);
  delete from public.friend_request_cooldowns
  where (from_user_id = v_uid and to_user_id = p_from)
     or (from_user_id = p_from and to_user_id = v_uid);

  return jsonb_build_object('result', 'friends');
end;
$$;

revoke all on function public.accept_friend_request(uuid) from public;
revoke all on function public.accept_friend_request(uuid) from anon;
grant execute on function public.accept_friend_request(uuid) to authenticated;

create or replace function public.unfriend(p_other uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid;
begin
  v_uid := public.friends_require_caller();

  if p_other is null or p_other = v_uid then
    raise exception 'friends_self';
  end if;

  delete from public.friendships
  where user_a = least(v_uid, p_other)
    and user_b = greatest(v_uid, p_other);

  return jsonb_build_object('result', 'ok');
end;
$$;

revoke all on function public.unfriend(uuid) from public;
revoke all on function public.unfriend(uuid) from anon;
grant execute on function public.unfriend(uuid) to authenticated;

create or replace function public.get_lobby_friend_overlay(p_lobby_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid;
begin
  v_uid := public.friends_require_caller();

  if p_lobby_id is null then
    raise exception 'friends_not_found';
  end if;

  if not public.is_lobby_member(p_lobby_id) then
    raise exception 'friends_not_found';
  end if;

  return coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'user_id', m.user_id,
          'status',
          case
            when public.friends_auth_kind(m.user_id) is distinct from 'registered'
              then 'guest'
            when exists (
              select 1
              from public.friendships f
              where f.user_a = least(v_uid, m.user_id)
                and f.user_b = greatest(v_uid, m.user_id)
            ) then 'friends'
            when exists (
              select 1
              from public.friend_requests r
              where r.from_user_id = v_uid
                and r.to_user_id = m.user_id
            ) then 'pending_out'
            when exists (
              select 1
              from public.friend_requests r
              where r.from_user_id = m.user_id
                and r.to_user_id = v_uid
            ) then 'pending_in'
            else 'none'
          end
        )
        order by m.joined_at
      )
      from public.lobby_members m
      where m.lobby_id = p_lobby_id
        and m.user_id is distinct from v_uid
    ),
    '[]'::jsonb
  );
end;
$$;

revoke all on function public.get_lobby_friend_overlay(uuid) from public;
revoke all on function public.get_lobby_friend_overlay(uuid) from anon;
grant execute on function public.get_lobby_friend_overlay(uuid) to authenticated;

comment on function public.get_lobby_friend_overlay(uuid) is
  'FEATURE-FRIENDS-01 : statuts guest|none|pending_out|pending_in|friends pour les autres membres. Pas d’annuaire global.';

create or replace function public.list_my_friends()
returns table (
  user_id uuid,
  display_name text,
  emoji text
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid;
begin
  v_uid := public.friends_require_caller();

  return query
  select
    other.id,
    coalesce(p.display_name, 'Joueur'),
    coalesce(p.emoji, '👤')
  from (
    select case
      when f.user_a = v_uid then f.user_b
      else f.user_a
    end as id
    from public.friendships f
    where f.user_a = v_uid or f.user_b = v_uid
  ) other
  left join public.profiles p on p.id = other.id
  order by coalesce(p.display_name, 'Joueur');
end;
$$;

revoke all on function public.list_my_friends() from public;
revoke all on function public.list_my_friends() from anon;
grant execute on function public.list_my_friends() to authenticated;

create or replace function public.list_incoming_friend_requests()
returns table (
  id uuid,
  from_user_id uuid,
  display_name text,
  emoji text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid;
begin
  v_uid := public.friends_require_caller();

  return query
  select
    r.id,
    r.from_user_id,
    coalesce(p.display_name, 'Joueur'),
    coalesce(p.emoji, '👤'),
    r.created_at
  from public.friend_requests r
  left join public.profiles p on p.id = r.from_user_id
  where r.to_user_id = v_uid
  order by r.created_at;
end;
$$;

revoke all on function public.list_incoming_friend_requests() from public;
revoke all on function public.list_incoming_friend_requests() from anon;
grant execute on function public.list_incoming_friend_requests() to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime publication (no-op si déjà présent / publication absente)
-- ---------------------------------------------------------------------------

do $$
begin
  alter publication supabase_realtime add table public.friend_requests;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.friendships;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
