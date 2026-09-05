-- FEATURE-PROFILE-05 — Avatar photo Signature (remplace l’emoji partout)
--
-- À coller dans SQL Editor (prod). Idempotent.
-- Le client peut écrire `profiles.avatar_path` / `avatar_rev` ; le trigger
-- n’accepte que `{user_id}/avatar.jpg` et uniquement avec `profile_pack`.
-- `lobby_members.avatar_*` sont TOUJOURS recopiés depuis `profiles`
-- (le client ne peut pas se les auto-attribuer en salon).
-- Bucket Storage `avatars` : lecture publique, écriture = son dossier.
--
-- Consigner l’exécution dans docs/DEPLOYMENTS_SQL.md.

alter table public.profiles
  add column if not exists avatar_path text,
  add column if not exists avatar_rev integer not null default 0;

comment on column public.profiles.avatar_path is
  'Chemin Storage avatars : {user_id}/avatar.jpg. Null sans profile_pack.';
comment on column public.profiles.avatar_rev is
  'Cache-bust public URL (?v=). 0 si pas de photo.';

alter table public.lobby_members
  add column if not exists avatar_path text,
  add column if not exists avatar_rev integer not null default 0;

comment on column public.lobby_members.avatar_path is
  'Snapshot profiles.avatar_path. Écrit par trigger, pas par le client.';
comment on column public.lobby_members.avatar_rev is
  'Snapshot profiles.avatar_rev. Écrit par trigger, pas par le client.';

create or replace function public.profiles_signature_avatar()
returns trigger
language plpgsql
as $$
declare
  v_pack boolean;
  v_existing boolean;
  v_expected text;
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

  new.avatar_path := nullif(trim(coalesce(new.avatar_path, '')), '');
  v_expected := new.id::text || '/avatar.jpg';

  if not v_pack then
    new.avatar_path := null;
    new.avatar_rev := 0;
  elsif new.avatar_path is not null then
    if new.avatar_path is distinct from v_expected then
      new.avatar_path := null;
      new.avatar_rev := 0;
    elsif coalesce(new.avatar_rev, 0) < 1 then
      new.avatar_rev := 1;
    end if;
  else
    new.avatar_rev := 0;
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_signature_avatar on public.profiles;
create trigger profiles_signature_avatar
before insert or update on public.profiles
for each row execute function public.profiles_signature_avatar();

create or replace function public.lobby_members_stamp_signature()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_pack boolean;
  v_color text;
  v_path text;
  v_rev integer;
begin
  select p.profile_pack, p.name_color, p.avatar_path, p.avatar_rev
    into v_pack, v_color, v_path, v_rev
  from public.profiles p
  where p.id = new.user_id;

  new.signature := coalesce(v_pack, false);
  new.name_color := case when new.signature then v_color else null end;
  new.avatar_path := case when new.signature then v_path else null end;
  new.avatar_rev := case when new.signature then coalesce(v_rev, 0) else 0 end;
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
    name_color = case when coalesce(new.profile_pack, false) then new.name_color else null end,
    avatar_path = case when coalesce(new.profile_pack, false) then new.avatar_path else null end,
    avatar_rev = case when coalesce(new.profile_pack, false) then coalesce(new.avatar_rev, 0) else 0 end
  where user_id = new.id;
  return new;
end;
$$;

drop trigger if exists profiles_push_signature_to_members on public.profiles;
create trigger profiles_push_signature_to_members
after update of profile_pack, name_color, avatar_path, avatar_rev on public.profiles
for each row execute function public.profiles_push_signature_to_members();

create or replace function public.friends_live_avatar_path(p_uid uuid)
returns text
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select case
    when coalesce(p.profile_pack, false) then p.avatar_path
    else null
  end
  from public.profiles p
  where p.id = p_uid;
$$;

create or replace function public.friends_live_avatar_rev(p_uid uuid)
returns integer
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select case
    when coalesce(p.profile_pack, false) then coalesce(p.avatar_rev, 0)
    else 0
  end
  from public.profiles p
  where p.id = p_uid;
$$;

revoke all on function public.friends_live_avatar_path(uuid) from public;
revoke all on function public.friends_live_avatar_path(uuid) from anon;
revoke all on function public.friends_live_avatar_path(uuid) from authenticated;
revoke all on function public.friends_live_avatar_rev(uuid) from public;
revoke all on function public.friends_live_avatar_rev(uuid) from anon;
revoke all on function public.friends_live_avatar_rev(uuid) from authenticated;

drop function if exists public.list_my_friends();
create function public.list_my_friends()
returns table (
  user_id uuid,
  display_name text,
  emoji text,
  name_color text,
  signature boolean,
  avatar_path text,
  avatar_rev integer
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
    public.friends_live_signature(other.id),
    public.friends_live_avatar_path(other.id),
    public.friends_live_avatar_rev(other.id)
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
  signature boolean,
  avatar_path text,
  avatar_rev integer
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
    public.friends_live_signature(r.from_user_id),
    public.friends_live_avatar_path(r.from_user_id),
    public.friends_live_avatar_rev(r.from_user_id)
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
  signature boolean,
  avatar_path text,
  avatar_rev integer
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
    public.friends_live_signature(r.to_user_id),
    public.friends_live_avatar_path(r.to_user_id),
    public.friends_live_avatar_rev(r.to_user_id)
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
  signature boolean,
  avatar_path text,
  avatar_rev integer
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
    public.friends_live_signature(i.from_user_id),
    public.friends_live_avatar_path(i.from_user_id),
    public.friends_live_avatar_rev(i.from_user_id)
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
  signature boolean,
  avatar_path text,
  avatar_rev integer
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
    public.friends_live_signature(other.id),
    public.friends_live_avatar_path(other.id),
    public.friends_live_avatar_rev(other.id)
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

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  524288,
  array['image/jpeg']::text[]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "avatars public read" on storage.objects;
create policy "avatars public read"
on storage.objects
for select
using (bucket_id = 'avatars');

drop policy if exists "avatars owner insert" on storage.objects;
create policy "avatars owner insert"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'avatars'
  and name = auth.uid()::text || '/avatar.jpg'
);

drop policy if exists "avatars owner update" on storage.objects;
create policy "avatars owner update"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'avatars'
  and name = auth.uid()::text || '/avatar.jpg'
)
with check (
  bucket_id = 'avatars'
  and name = auth.uid()::text || '/avatar.jpg'
);

drop policy if exists "avatars owner delete" on storage.objects;
create policy "avatars owner delete"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'avatars'
  and name = auth.uid()::text || '/avatar.jpg'
);

notify pgrst, 'reload schema';
