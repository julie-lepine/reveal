-- FEATURE-PROFILE-04 — Carnet Signature (20 soirées + stats)
--
-- À coller dans SQL Editor (prod) après feature-profile-03-identity.sql.
-- Idempotent.
--
-- Une ligne par (compte, lobby). Pas de code salon exposé au client.
-- Les prénoms d’amis sont résolus à la lecture (amis encore amis).
-- Le client n’écrit pas la table (RPC security definer).
--
-- Consigner l’exécution dans docs/DEPLOYMENTS_SQL.md.

create table if not exists public.signature_evenings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  lobby_id uuid not null,
  ended_at timestamptz not null default now(),
  rank integer not null,
  score integer not null default 0,
  games text[] not null default '{}',
  peer_user_ids uuid[] not null default '{}',
  constraint signature_evenings_rank_chk check (rank >= 1 and rank <= 16),
  constraint signature_evenings_games_chk check (coalesce(cardinality(games), 0) <= 24),
  constraint signature_evenings_peers_chk check (coalesce(cardinality(peer_user_ids), 0) <= 16),
  constraint signature_evenings_user_lobby unique (user_id, lobby_id)
);

create index if not exists signature_evenings_user_ended_idx
  on public.signature_evenings (user_id, ended_at desc);

comment on table public.signature_evenings is
  'FEATURE-PROFILE-04 : archives Signature (max 20 / compte). lobby_id interne, jamais renvoyé.';

alter table public.signature_evenings enable row level security;

-- Pas de SELECT client : lobby_id / peer_user_ids restent internes (RPC only).
drop policy if exists signature_evenings_select_own on public.signature_evenings;

revoke all on table public.signature_evenings from public;
revoke all on table public.signature_evenings from anon;
revoke all on table public.signature_evenings from authenticated;

create or replace function public.signature_carnet_allowed_games()
returns text[]
language sql
immutable
as $$
  select array[
    'hottake','speedvote','trivia','truthmeter','consensus','dilemma',
    'guesslie','tiernight','clutch','drawit','wronganswer','traitre'
  ];
$$;

revoke all on function public.signature_carnet_allowed_games() from public;
revoke all on function public.signature_carnet_allowed_games() from anon;
revoke all on function public.signature_carnet_allowed_games() from authenticated;

create or replace function public.signature_trim_carnet(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  delete from public.signature_evenings e
  where e.user_id = p_user_id
    and e.id not in (
      select x.id
      from public.signature_evenings x
      where x.user_id = p_user_id
      order by x.ended_at desc, x.id desc
      limit 20
    );
end;
$$;

revoke all on function public.signature_trim_carnet(uuid) from public;
revoke all on function public.signature_trim_carnet(uuid) from anon;
revoke all on function public.signature_trim_carnet(uuid) from authenticated;

drop function if exists public.archive_signature_evening(uuid, integer, integer, text[]);

create or replace function public.archive_signature_evening(
  p_lobby_id uuid,
  p_rank integer,
  p_score integer,
  p_games text[],
  p_peer_user_ids uuid[] default '{}'
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid;
  v_id uuid;
  v_games text[];
  v_peers uuid[];
  v_allowed text[] := public.signature_carnet_allowed_games();
begin
  v_uid := public.friends_require_caller();

  if not exists (
    select 1 from public.profiles p
    where p.id = v_uid and p.profile_pack is true
  ) then
    raise exception 'signature_locked';
  end if;

  if p_lobby_id is null then
    raise exception 'signature_not_member';
  end if;

  if not public.is_lobby_member(p_lobby_id) then
    raise exception 'signature_not_member';
  end if;

  if p_rank is null or p_rank < 1 or p_rank > 16 then
    raise exception 'signature_empty';
  end if;

  select coalesce(array_agg(g order by ordinality), '{}')
  into v_games
  from (
    select distinct g, min(ordinality) as ordinality
    from unnest(coalesce(p_games, '{}')) with ordinality as t(g, ordinality)
    where g = any (v_allowed)
    group by g
    order by min(ordinality)
    limit 24
  ) s;

  select coalesce(array_agg(uid), '{}')
  into v_peers
  from (
    select uid
    from (
      select lm.user_id as uid
      from public.lobby_members lm
      join auth.users u on u.id = lm.user_id
      where lm.lobby_id = p_lobby_id
        and lm.user_id <> v_uid
        and coalesce(u.is_anonymous, false) = false
      union
      select u.id
      from unnest(coalesce(p_peer_user_ids, '{}')) as peer
      join auth.users u on u.id = peer
      where peer <> v_uid
        and coalesce(u.is_anonymous, false) = false
    ) merged
    limit 16
  ) s(uid);

  insert into public.signature_evenings (
    user_id, lobby_id, ended_at, rank, score, games, peer_user_ids
  ) values (
    v_uid,
    p_lobby_id,
    now(),
    p_rank,
    coalesce(p_score, 0),
    v_games,
    coalesce(v_peers, '{}')
  )
  on conflict (user_id, lobby_id) do update
    set ended_at = excluded.ended_at,
        rank = excluded.rank,
        score = excluded.score,
        games = excluded.games,
        peer_user_ids = excluded.peer_user_ids
  returning id into v_id;

  perform public.signature_trim_carnet(v_uid);
  return v_id;
end;
$$;

revoke all on function public.archive_signature_evening(uuid, integer, integer, text[]) from public;
revoke all on function public.archive_signature_evening(uuid, integer, integer, text[]) from anon;
revoke all on function public.archive_signature_evening(uuid, integer, integer, text[]) from authenticated;
revoke all on function public.archive_signature_evening(uuid, integer, integer, text[], uuid[]) from public;
revoke all on function public.archive_signature_evening(uuid, integer, integer, text[], uuid[]) from anon;
grant execute on function public.archive_signature_evening(uuid, integer, integer, text[], uuid[]) to authenticated;

drop function if exists public.list_signature_carnet();

create function public.list_signature_carnet()
returns table (
  ended_at timestamptz,
  rank integer,
  score integer,
  games text[],
  friend_names text[]
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

  if not exists (
    select 1 from public.profiles p
    where p.id = v_uid and p.profile_pack is true
  ) then
    raise exception 'signature_locked';
  end if;

  return query
  select
    e.ended_at,
    e.rank,
    e.score,
    e.games,
    coalesce((
      select array_agg(public.friends_live_display_name(t.peer) order by public.friends_live_display_name(t.peer))
      from unnest(e.peer_user_ids) as t(peer)
      where exists (
        select 1 from public.friendships f
        where (f.user_a = v_uid and f.user_b = t.peer)
           or (f.user_b = v_uid and f.user_a = t.peer)
      )
    ), '{}'::text[]) as friend_names
  from public.signature_evenings e
  where e.user_id = v_uid
  order by e.ended_at desc, e.id desc
  limit 20;
end;
$$;

revoke all on function public.list_signature_carnet() from public;
revoke all on function public.list_signature_carnet() from anon;
grant execute on function public.list_signature_carnet() to authenticated;

notify pgrst, 'reload schema';
