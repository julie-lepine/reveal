-- FEATURE-PROFILE-03 — Identité Signature (couleur de pseudo, snapshot salon)
--
-- À coller dans SQL Editor (prod). Idempotent.
-- Le client peut écrire `name_color` ; le trigger l’annule sans profile_pack
-- ou si l’id n’est pas dans la palette. Même logique pour les emojis extra.
-- `lobby_members.signature` / `name_color` sont TOUJOURS recopiés depuis
-- `profiles` (le client ne peut pas se les auto-attribuer en salon).
--
-- Consigner l’exécution dans docs/DEPLOYMENTS_SQL.md.

alter table public.profiles
  add column if not exists name_color text;

comment on column public.profiles.name_color is
  'Id palette Signature (gold, rose, …). Null sans profile_pack.';

alter table public.lobby_members
  add column if not exists name_color text,
  add column if not exists signature boolean not null default false;

comment on column public.lobby_members.name_color is
  'Snapshot profiles.name_color. Écrit par trigger, pas par le client.';
comment on column public.lobby_members.signature is
  'Snapshot profiles.profile_pack. Écrit par trigger, pas par le client.';

create or replace function public.profiles_signature_cosmetics()
returns trigger
language plpgsql
as $$
declare
  v_ver constant text := '03c-persist-v3';
  v_allowed_colors text[] := array['gold','rose','violet','cyan','lime','amber','coral','ice'];
  v_free_hex text[] := array[
    'f09f9880','f09fa4a9','f09fa5b3','f09f8ead','f09f8eae','f09f838f',
    'f09f91a4','f09f8dba','e29abd','e2ad90','f09f8eb2','f09fa68a',
    'f09f90b1','f09f90b6','f09fa681','f09f8d95','f09f8eb8','f09f95b5'
  ];
  v_raw text;
  v_hex text;
  v_pack boolean;
  v_existing boolean;
begin
  v_pack := coalesce(new.profile_pack, false);
  if tg_op = 'UPDATE' then
    v_pack := coalesce(old.profile_pack, new.profile_pack, false);
  elsif new.id is not null then
    select p.profile_pack into v_existing
    from public.profiles p
    where p.id = new.id;
    if found then
      v_pack := coalesce(v_existing, false);
    end if;
  end if;

  if not v_pack then
    new.name_color := null;
  elsif new.name_color is not null and not (new.name_color = any (v_allowed_colors)) then
    new.name_color := null;
  end if;

  v_raw := nullif(trim(coalesce(new.emoji, '')), '');
  if v_raw is not null and octet_length(v_raw) > 32 then
    v_raw := null;
  end if;
  v_hex := lower(replace(encode(convert_to(coalesce(v_raw, ''), 'UTF8'), 'hex'), 'efb88f', ''));

  if v_pack then
    if v_raw is null then
      new.emoji := convert_from(decode('f09f91a4', 'hex'), 'utf8');
    else
      new.emoji := v_raw;
    end if;
    return new;
  end if;

  if v_raw is null or v_hex = '' or not (v_hex = any (v_free_hex)) then
    new.emoji := convert_from(decode('f09f91a4', 'hex'), 'utf8');
  else
    new.emoji := v_raw;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_signature_cosmetics on public.profiles;
create trigger profiles_signature_cosmetics
before insert or update on public.profiles
for each row execute function public.profiles_signature_cosmetics();

create or replace function public.lobby_members_stamp_signature()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_pack boolean;
  v_color text;
begin
  select p.profile_pack, p.name_color
    into v_pack, v_color
  from public.profiles p
  where p.id = new.user_id;

  new.signature := coalesce(v_pack, false);
  new.name_color := case when new.signature then v_color else null end;
  return new;
end;
$$;

drop trigger if exists lobby_members_stamp_signature on public.lobby_members;
create trigger lobby_members_stamp_signature
before insert or update on public.lobby_members
for each row execute function public.lobby_members_stamp_signature();

create or replace function public.profiles_push_signature_to_members()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  update public.lobby_members
  set
    signature = coalesce(new.profile_pack, false),
    name_color = case when coalesce(new.profile_pack, false) then new.name_color else null end
  where user_id = new.id;
  return new;
end;
$$;

drop trigger if exists profiles_push_signature_to_members on public.profiles;
create trigger profiles_push_signature_to_members
after update of profile_pack, name_color on public.profiles
for each row execute function public.profiles_push_signature_to_members();

-- Amis : helpers internes + listes (colonnes extra en fin de RETURNS TABLE)
create or replace function public.friends_live_name_color(p_uid uuid)
returns text
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select case
    when coalesce(p.profile_pack, false) then p.name_color
    else null
  end
  from public.profiles p
  where p.id = p_uid;
$$;

create or replace function public.friends_live_signature(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select coalesce(
    (select p.profile_pack from public.profiles p where p.id = p_uid),
    false
  );
$$;

revoke all on function public.friends_live_name_color(uuid) from public;
revoke all on function public.friends_live_name_color(uuid) from anon;
revoke all on function public.friends_live_name_color(uuid) from authenticated;
revoke all on function public.friends_live_signature(uuid) from public;
revoke all on function public.friends_live_signature(uuid) from anon;
revoke all on function public.friends_live_signature(uuid) from authenticated;

drop function if exists public.list_my_friends();
create function public.list_my_friends()
returns table (
  user_id uuid,
  display_name text,
  emoji text,
  name_color text,
  signature boolean
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
    public.friends_live_display_name(other.id),
    public.friends_live_emoji(other.id),
    public.friends_live_name_color(other.id),
    public.friends_live_signature(other.id)
  from (
    select case
      when f.user_a = v_uid then f.user_b
      else f.user_a
    end as id
    from public.friendships f
    where f.user_a = v_uid or f.user_b = v_uid
  ) other
  order by public.friends_live_display_name(other.id);
end;
$$;

revoke all on function public.list_my_friends() from public;
revoke all on function public.list_my_friends() from anon;
grant execute on function public.list_my_friends() to authenticated;

drop function if exists public.list_incoming_friend_requests();
create function public.list_incoming_friend_requests()
returns table (
  id uuid,
  from_user_id uuid,
  display_name text,
  emoji text,
  created_at timestamptz,
  name_color text,
  signature boolean
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
    public.friends_live_display_name(r.from_user_id),
    public.friends_live_emoji(r.from_user_id),
    r.created_at,
    public.friends_live_name_color(r.from_user_id),
    public.friends_live_signature(r.from_user_id)
  from public.friend_requests r
  where r.to_user_id = v_uid
  order by r.created_at;
end;
$$;

revoke all on function public.list_incoming_friend_requests() from public;
revoke all on function public.list_incoming_friend_requests() from anon;
grant execute on function public.list_incoming_friend_requests() to authenticated;

drop function if exists public.list_outgoing_friend_requests();
create function public.list_outgoing_friend_requests()
returns table (
  id uuid,
  to_user_id uuid,
  display_name text,
  emoji text,
  created_at timestamptz,
  name_color text,
  signature boolean
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
    r.to_user_id,
    public.friends_live_display_name(r.to_user_id),
    public.friends_live_emoji(r.to_user_id),
    r.created_at,
    public.friends_live_name_color(r.to_user_id),
    public.friends_live_signature(r.to_user_id)
  from public.friend_requests r
  where r.from_user_id = v_uid
  order by r.created_at;
end;
$$;

revoke all on function public.list_outgoing_friend_requests() from public;
revoke all on function public.list_outgoing_friend_requests() from anon;
grant execute on function public.list_outgoing_friend_requests() to authenticated;

drop function if exists public.list_incoming_lobby_invites();
create function public.list_incoming_lobby_invites()
returns table (
  id uuid,
  lobby_id uuid,
  from_user_id uuid,
  display_name text,
  emoji text,
  created_at timestamptz,
  name_color text,
  signature boolean
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
    i.id,
    i.lobby_id,
    i.from_user_id,
    public.friends_live_display_name(i.from_user_id),
    public.friends_live_emoji(i.from_user_id),
    i.created_at,
    public.friends_live_name_color(i.from_user_id),
    public.friends_live_signature(i.from_user_id)
  from public.lobby_invites i
  where i.to_user_id = v_uid
  order by i.created_at;
end;
$$;

revoke all on function public.list_incoming_lobby_invites() from public;
revoke all on function public.list_incoming_lobby_invites() from anon;
grant execute on function public.list_incoming_lobby_invites() to authenticated;

drop function if exists public.list_recent_lobby_peers();
create function public.list_recent_lobby_peers()
returns table (
  user_id uuid,
  display_name text,
  emoji text,
  name_color text,
  signature boolean
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
    public.friends_live_emoji(other.id),
    public.friends_live_name_color(other.id),
    public.friends_live_signature(other.id)
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

notify pgrst, 'reload schema';
