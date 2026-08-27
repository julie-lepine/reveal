-- FEATURE-FRIENDS-04 — croisés récents 24 h (« Vous venez de jouer avec »)
--
-- Dépend de FEATURE-FRIENDS-01 (friends_require_caller, friends_auth_kind,
--   friendships) et FEATURE-FRIENDS-03 live-identity (friends_live_*).
-- Idempotent.
--
-- Contrats : js/config/recentPeers.js
--   table lobby_encounters (user_a < user_b, last_shared_at)
--   trigger lobby_members INSERT / BEFORE DELETE (inscrits seulement)
--   RPC list_recent_lobby_peers() — pas le code salon, pas lobby_id
-- Écriture serveur seulement. Pas de Realtime.
--
-- Après apply : supabase/tests/feature-friends-04-runbook.sql
--   INTERDIT EN PRODUCTION (crée un lobby jetable).

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

create table if not exists public.lobby_encounters (
  user_a uuid not null references auth.users (id) on delete cascade,
  user_b uuid not null references auth.users (id) on delete cascade,
  last_shared_at timestamptz not null default now(),
  constraint lobby_encounters_ordered check (user_a < user_b),
  constraint lobby_encounters_pkey primary key (user_a, user_b)
);

create index if not exists lobby_encounters_user_b_idx
  on public.lobby_encounters (user_b);
create index if not exists lobby_encounters_last_shared_idx
  on public.lobby_encounters (last_shared_at);

comment on table public.lobby_encounters is
  'FEATURE-FRIENDS-04 : paire d’inscrits déjà co-membres. last_shared_at = dernier chevauchement. Purge 24 h.';

alter table public.lobby_encounters enable row level security;

revoke all on table public.lobby_encounters from public;
revoke all on table public.lobby_encounters from anon;
revoke all on table public.lobby_encounters from authenticated;

-- ---------------------------------------------------------------------------
-- Helpers internes
-- ---------------------------------------------------------------------------

create or replace function public.friends_record_lobby_encounter(p_a uuid, p_b uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_a is null or p_b is null or p_a = p_b then
    return;
  end if;
  if public.friends_auth_kind(p_a) is distinct from 'registered' then
    return;
  end if;
  if public.friends_auth_kind(p_b) is distinct from 'registered' then
    return;
  end if;

  insert into public.lobby_encounters (user_a, user_b, last_shared_at)
  values (least(p_a, p_b), greatest(p_a, p_b), now())
  on conflict (user_a, user_b) do update
    set last_shared_at = excluded.last_shared_at;
end;
$$;

revoke all on function public.friends_record_lobby_encounter(uuid, uuid) from public;
revoke all on function public.friends_record_lobby_encounter(uuid, uuid) from anon;
revoke all on function public.friends_record_lobby_encounter(uuid, uuid) from authenticated;

create or replace function public.purge_stale_lobby_encounters()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_n integer;
begin
  delete from public.lobby_encounters
  where last_shared_at < now() - interval '24 hours';
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.purge_stale_lobby_encounters() from public;
revoke all on function public.purge_stale_lobby_encounters() from anon;
revoke all on function public.purge_stale_lobby_encounters() from authenticated;

create or replace function public.lobby_encounters_on_member()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid;
  v_lobby uuid;
  v_other uuid;
begin
  if tg_op = 'INSERT' then
    v_uid := new.user_id;
    v_lobby := new.lobby_id;
  else
    v_uid := old.user_id;
    v_lobby := old.lobby_id;
  end if;

  if public.friends_auth_kind(v_uid) is distinct from 'registered' then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  for v_other in
    select m.user_id
    from public.lobby_members m
    where m.lobby_id = v_lobby
      and m.user_id is distinct from v_uid
  loop
    perform public.friends_record_lobby_encounter(v_uid, v_other);
  end loop;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.lobby_encounters_on_member() from public;
revoke all on function public.lobby_encounters_on_member() from anon;
revoke all on function public.lobby_encounters_on_member() from authenticated;

drop trigger if exists lobby_encounters_on_member_ins on public.lobby_members;
create trigger lobby_encounters_on_member_ins
after insert on public.lobby_members
for each row execute function public.lobby_encounters_on_member();

drop trigger if exists lobby_encounters_on_member_del on public.lobby_members;
create trigger lobby_encounters_on_member_del
before delete on public.lobby_members
for each row execute function public.lobby_encounters_on_member();

-- ---------------------------------------------------------------------------
-- RPC
-- ---------------------------------------------------------------------------

drop function if exists public.list_recent_lobby_peers();

create or replace function public.list_recent_lobby_peers()
returns table (
  user_id uuid,
  display_name text,
  emoji text
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid;
begin
  v_uid := public.friends_require_caller();
  perform public.purge_stale_lobby_encounters();

  return query
  select
    other.id,
    public.friends_live_display_name(other.id),
    public.friends_live_emoji(other.id)
  from (
    select case
      when e.user_a = v_uid then e.user_b
      else e.user_a
    end as id,
    e.last_shared_at
    from public.lobby_encounters e
    where (e.user_a = v_uid or e.user_b = v_uid)
      and e.last_shared_at >= now() - interval '24 hours'
  ) other
  where public.friends_auth_kind(other.id) = 'registered'
    and not exists (
      select 1
      from public.friendships f
      where f.user_a = least(v_uid, other.id)
        and f.user_b = greatest(v_uid, other.id)
    )
    and not exists (
      select 1
      from public.lobby_members me
      join public.lobby_members peer
        on peer.lobby_id = me.lobby_id
       and peer.user_id = other.id
      where me.user_id = v_uid
    )
  order by other.last_shared_at desc, public.friends_live_display_name(other.id);
end;
$$;

revoke all on function public.list_recent_lobby_peers() from public;
revoke all on function public.list_recent_lobby_peers() from anon;
grant execute on function public.list_recent_lobby_peers() to authenticated;

comment on function public.list_recent_lobby_peers() is
  'FEATURE-FRIENDS-04 : inscrits déjà croisés, 24 h, hors lobby commun, hors amis. Pas le code salon.';

notify pgrst, 'reload schema';
