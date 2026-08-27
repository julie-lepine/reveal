-- FEATURE-FRIENDS — identité live (pseudo / emoji) sur les listes d’amis
--
-- Idempotent. Pas de nouvelle table. Realtime inchangé.
--
-- Problème : Tes amis / demandes / invitations relisaient uniquement
-- `profiles`. Une ligne absente, vide, ou restée sur le fallback
-- « Joueur » / 👤 affichait le placeholder, alors que le pseudo choisi
-- à l’inscription est dans `auth.users.raw_user_meta_data.display_name`
-- et le nom/emoji de soirée dans `lobby_members`.
--
-- Ce fichier :
--   1. helpers friends_live_display_name / friends_live_emoji
--   2. relit les 4 RPC de liste
--   3. soigne les profils placeholder (UPDATE, pas d’overwrite d’un vrai pseudo)
--   4. handle_new_user : ignore un local-part email d’1 caractère (CHECK >= 2)
--
-- À coller dans le SQL Editor du projet live. Dire quand c’est Run.

-- ---------------------------------------------------------------------------
-- Helpers (internes : pas de GRANT authenticated)
-- ---------------------------------------------------------------------------

create or replace function public.friends_live_display_name(p_uid uuid)
returns text
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select coalesce(
    case
      when nullif(trim(p.display_name), '') is distinct from 'Joueur'
       and char_length(trim(p.display_name)) >= 2
      then trim(p.display_name)
    end,
    case
      when char_length(trim(coalesce(u.raw_user_meta_data->>'display_name', ''))) >= 2
      then trim(u.raw_user_meta_data->>'display_name')
    end,
    (
      select trim(m.display_name)
      from public.lobby_members m
      where m.user_id = p_uid
        and char_length(trim(m.display_name)) >= 2
        and trim(m.display_name) is distinct from 'Joueur'
      order by m.last_seen_at desc nulls last
      limit 1
    ),
    case
      when char_length(trim(p.display_name)) >= 2 then trim(p.display_name)
    end,
    'Joueur'
  )
  from (select p_uid as id) seed
  left join public.profiles p on p.id = p_uid
  left join auth.users u on u.id = p_uid;
$$;

revoke all on function public.friends_live_display_name(uuid) from public;
revoke all on function public.friends_live_display_name(uuid) from anon;
revoke all on function public.friends_live_display_name(uuid) from authenticated;

comment on function public.friends_live_display_name(uuid) is
  'Pseudo amis : profiles, sinon metadata d’inscription, sinon dernier lobby_members.';

create or replace function public.friends_live_emoji(p_uid uuid)
returns text
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select coalesce(
    case
      when nullif(trim(p.emoji), '') is distinct from '👤'
      then nullif(trim(p.emoji), '')
    end,
    nullif(trim(u.raw_user_meta_data->>'emoji'), ''),
    (
      select nullif(trim(m.emoji), '')
      from public.lobby_members m
      where m.user_id = p_uid
        and nullif(trim(m.emoji), '') is not null
        and nullif(trim(m.emoji), '') is distinct from '👤'
      order by m.last_seen_at desc nulls last
      limit 1
    ),
    nullif(trim(p.emoji), ''),
    '👤'
  )
  from (select p_uid as id) seed
  left join public.profiles p on p.id = p_uid
  left join auth.users u on u.id = p_uid;
$$;

revoke all on function public.friends_live_emoji(uuid) from public;
revoke all on function public.friends_live_emoji(uuid) from anon;
revoke all on function public.friends_live_emoji(uuid) from authenticated;

comment on function public.friends_live_emoji(uuid) is
  'Emoji amis : profiles, sinon metadata, sinon dernier lobby_members.';

-- ---------------------------------------------------------------------------
-- RPC de liste (mêmes signatures)
-- ---------------------------------------------------------------------------

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
    public.friends_live_display_name(other.id),
    public.friends_live_emoji(other.id)
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
    public.friends_live_display_name(r.from_user_id),
    public.friends_live_emoji(r.from_user_id),
    r.created_at
  from public.friend_requests r
  where r.to_user_id = v_uid
  order by r.created_at;
end;
$$;

revoke all on function public.list_incoming_friend_requests() from public;
revoke all on function public.list_incoming_friend_requests() from anon;
grant execute on function public.list_incoming_friend_requests() to authenticated;

create or replace function public.list_outgoing_friend_requests()
returns table (
  id uuid,
  to_user_id uuid,
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
    r.to_user_id,
    public.friends_live_display_name(r.to_user_id),
    public.friends_live_emoji(r.to_user_id),
    r.created_at
  from public.friend_requests r
  where r.from_user_id = v_uid
  order by r.created_at;
end;
$$;

revoke all on function public.list_outgoing_friend_requests() from public;
revoke all on function public.list_outgoing_friend_requests() from anon;
grant execute on function public.list_outgoing_friend_requests() to authenticated;

create or replace function public.list_incoming_lobby_invites()
returns table (
  id uuid,
  lobby_id uuid,
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
    i.id,
    i.lobby_id,
    i.from_user_id,
    public.friends_live_display_name(i.from_user_id),
    public.friends_live_emoji(i.from_user_id),
    i.created_at
  from public.lobby_invites i
  where i.to_user_id = v_uid
  order by i.created_at;
end;
$$;

revoke all on function public.list_incoming_lobby_invites() from public;
revoke all on function public.list_incoming_lobby_invites() from anon;
grant execute on function public.list_incoming_lobby_invites() to authenticated;

-- ---------------------------------------------------------------------------
-- Soin des profils déjà coincés sur le fallback
-- ---------------------------------------------------------------------------

update public.profiles p
set
  display_name = public.friends_live_display_name(p.id),
  emoji = public.friends_live_emoji(p.id)
where
  coalesce(nullif(trim(p.display_name), ''), 'Joueur') = 'Joueur'
  or coalesce(nullif(trim(p.emoji), ''), '👤') = '👤';

insert into public.profiles (id, display_name, emoji)
select
  u.id,
  public.friends_live_display_name(u.id),
  public.friends_live_emoji(u.id)
from auth.users u
where coalesce(u.is_anonymous, false) = false
  and not exists (select 1 from public.profiles p where p.id = u.id)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Inscription : ne pas faire échouer le trigger sur un local-part d’1 caractère
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email_local text;
  v_name text;
begin
  v_email_local := nullif(split_part(coalesce(new.email, ''), '@', 1), '');
  if v_email_local is not null and char_length(v_email_local) < 2 then
    v_email_local := null;
  end if;

  v_name := coalesce(
    nullif(trim(new.raw_user_meta_data->>'display_name'), ''),
    v_email_local,
    'Joueur'
  );

  insert into public.profiles (id, display_name, emoji)
  values (
    new.id,
    v_name,
    coalesce(nullif(trim(new.raw_user_meta_data->>'emoji'), ''), '👤')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
