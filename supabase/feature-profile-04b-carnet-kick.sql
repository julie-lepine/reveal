-- FEATURE-PROFILE-04b — C-KICK : carnet Signature après un kick
--
-- Ticket : `archive_signature_evening` exige encore `is_lobby_member`.
-- Le kick DELETE la membership d’abord ; le kické apprend ça trop tard.
-- Un simple appel client dans handleKickedFromLobby échouerait
-- (`signature_not_member`).
--
-- Preuve : `kick_lobby_member` (definer) écrit une ligne allow
-- (uid kické + lobby) AVANT le DELETE. L’archive l’accepte 30 min,
-- uniquement pour ce uid (pas un salon au hasard).
--
-- Prérequis : FEATURE-PROFILE-04 + kick_lobby_member.
-- Ne PAS réexécuter feature-profile-04-carnet.sql ni kick-lobby-member.sql.
--
-- À coller dans SQL Editor (staging puis prod). Idempotent.
-- Consigner dans docs/DEPLOYMENTS_SQL.md.

create table if not exists public.signature_carnet_kick_allow (
  user_id uuid not null references auth.users (id) on delete cascade,
  lobby_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (user_id, lobby_id)
);

comment on table public.signature_carnet_kick_allow is
  'FEATURE-PROFILE-04b / C-KICK : jeton d’archive 30 min après un kick. Pas de GRANT client.';

alter table public.signature_carnet_kick_allow enable row level security;

revoke all on table public.signature_carnet_kick_allow from public;
revoke all on table public.signature_carnet_kick_allow from anon;
revoke all on table public.signature_carnet_kick_allow from authenticated;

create or replace function public.kick_lobby_member(
  p_lobby_id uuid,
  p_target_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_host_id uuid;
  v_status text;
  v_game_id text;
begin
  select host_id, status, game_id
    into v_host_id, v_status, v_game_id
  from public.lobbies
  where id = p_lobby_id;

  if v_host_id is null then
    raise exception 'Lobby introuvable.';
  end if;

  if auth.uid() is distinct from v_host_id then
    raise exception 'Seul l''hôte peut retirer un joueur.';
  end if;

  if p_target_user_id is null then
    raise exception 'Joueur invalide.';
  end if;

  if p_target_user_id = v_host_id then
    raise exception 'Tu ne peux pas te retirer toi-même (quitte le lobby ou transfère l''hôte).';
  end if;

  if not (
    coalesce(v_status, 'waiting') = 'waiting'
    or v_game_id is null
    or v_game_id = 'menu'
  ) then
    raise exception 'Tu ne peux retirer un joueur qu''au lobby ou entre deux jeux.';
  end if;

  if not exists (
    select 1 from public.lobby_members
    where lobby_id = p_lobby_id and user_id = p_target_user_id
  ) then
    raise exception 'Ce joueur n''est plus dans le lobby.';
  end if;

  if exists (
    select 1
    from public.profiles p
    where p.id = p_target_user_id
      and p.profile_pack is true
  ) then
    insert into public.signature_carnet_kick_allow (user_id, lobby_id)
    values (p_target_user_id, p_lobby_id)
    on conflict (user_id, lobby_id) do update
      set created_at = excluded.created_at;
  end if;

  delete from public.lobby_members
  where lobby_id = p_lobby_id
    and user_id = p_target_user_id;
end;
$$;

revoke all on function public.kick_lobby_member(uuid, uuid) from public;
revoke all on function public.kick_lobby_member(uuid, uuid) from anon;
grant execute on function public.kick_lobby_member(uuid, uuid) to authenticated;

comment on function public.kick_lobby_member(uuid, uuid) is
  'Hôte retire un membre (waiting / menu). FEATURE-PROFILE-04b : jeton carnet si Signature, puis DELETE.';

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
  v_kick_allow boolean := false;
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

  select exists (
    select 1
    from public.signature_carnet_kick_allow a
    where a.user_id = v_uid
      and a.lobby_id = p_lobby_id
      and a.created_at > now() - interval '30 minutes'
  ) into v_kick_allow;

  if not public.is_lobby_member(p_lobby_id) and not v_kick_allow then
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

  delete from public.signature_carnet_kick_allow
  where user_id = v_uid
    and lobby_id = p_lobby_id;

  perform public.signature_trim_carnet(v_uid);
  return v_id;
end;
$$;

revoke all on function public.archive_signature_evening(uuid, integer, integer, text[], uuid[]) from public;
revoke all on function public.archive_signature_evening(uuid, integer, integer, text[], uuid[]) from anon;
grant execute on function public.archive_signature_evening(uuid, integer, integer, text[], uuid[]) to authenticated;

comment on function public.archive_signature_evening(uuid, integer, integer, text[], uuid[]) is
  'FEATURE-PROFILE-04 / 04b : archive carnet. Membre vivant, ou jeton kick 30 min.';

notify pgrst, 'reload schema';
