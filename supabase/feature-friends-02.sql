-- FEATURE-FRIENDS-02 — invitations de lobby (table + RLS + RPC)
--
-- Dépend de FEATURE-FRIENDS-01 (friends_require_caller, friendships).
-- Idempotent (create if not exists / create or replace / drop policy if exists).
--
-- Contrats : js/config/lobbyInvites.js
--   send_lobby_invite(p_to) / decline_lobby_invite(p_id) /
--   accept_lobby_invite(p_id) / list_incoming_lobby_invites()
-- Erreurs métier : friends_guest, friends_self, friends_not_found,
--   lobby_invite_not_friends, lobby_invite_no_lobby, lobby_invite_already_in,
--   lobby_invite_full, lobby_invite_closed, lobby_invite_busy, lobby_invite_gone
--
-- Join SANS le code 6 lettres : accept insert lobby_members. La table
--   n’a pas de colonne code. list_incoming non plus.
-- Unique (lobby_id, to_user_id) = pas deux pending vers le même ami / même
--   salon. L’émetteur peut inviter N amis (plafond 8 au Rejoindre).
-- accept ne quitte JAMAIS un autre lobby (busy → le client confirme).
--
-- Realtime : tente d’ajouter lobby_invites à supabase_realtime.
--   Dashboard → Database → Publications → supabase_realtime
--   (pas Database → Replication).
--
-- Après apply : supabase/tests/feature-friends-02-runbook.sql
--   Consigner dans docs/DEPLOYMENTS_SQL.md.

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

create table if not exists public.lobby_invites (
  id uuid primary key default gen_random_uuid(),
  lobby_id uuid not null references public.lobbies (id) on delete cascade,
  from_user_id uuid not null references auth.users (id) on delete cascade,
  to_user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint lobby_invites_not_self check (from_user_id <> to_user_id),
  constraint lobby_invites_lobby_to_unique unique (lobby_id, to_user_id)
);

create index if not exists lobby_invites_to_idx
  on public.lobby_invites (to_user_id);
create index if not exists lobby_invites_from_idx
  on public.lobby_invites (from_user_id);
create index if not exists lobby_invites_lobby_idx
  on public.lobby_invites (lobby_id);

comment on table public.lobby_invites is
  'FEATURE-FRIENDS-02 : invitation pending. Refus / accept = DELETE. CASCADE lobby.';

alter table public.lobby_invites replica identity full;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.lobby_invites enable row level security;

drop policy if exists lobby_invites_select_self on public.lobby_invites;
create policy lobby_invites_select_self on public.lobby_invites
for select using (
  from_user_id = auth.uid() or to_user_id = auth.uid()
);

-- Pas de policy INSERT/UPDATE/DELETE (RPC only).

revoke all on table public.lobby_invites from public;
revoke all on table public.lobby_invites from anon;
grant select on table public.lobby_invites to authenticated;

-- ---------------------------------------------------------------------------
-- RPC
-- ---------------------------------------------------------------------------

drop function if exists public.send_lobby_invite(uuid);
drop function if exists public.decline_lobby_invite(uuid);
drop function if exists public.accept_lobby_invite(uuid);
drop function if exists public.list_incoming_lobby_invites();

create or replace function public.send_lobby_invite(p_to uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_from uuid;
  v_to_kind text;
  v_lobby_id uuid;
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

  select m.lobby_id
    into v_lobby_id
  from public.lobby_members m
  where m.user_id = v_from
  limit 1;

  if v_lobby_id is null then
    raise exception 'lobby_invite_no_lobby';
  end if;

  if exists (
    select 1
    from public.lobby_members m
    where m.lobby_id = v_lobby_id
      and m.user_id = p_to
  ) then
    raise exception 'lobby_invite_already_in';
  end if;

  if not exists (
    select 1
    from public.friendships f
    where f.user_a = least(v_from, p_to)
      and f.user_b = greatest(v_from, p_to)
  ) then
    raise exception 'lobby_invite_not_friends';
  end if;

  insert into public.lobby_invites (lobby_id, from_user_id, to_user_id)
  values (v_lobby_id, v_from, p_to)
  on conflict on constraint lobby_invites_lobby_to_unique do nothing;

  return jsonb_build_object('result', 'pending');
end;
$$;

revoke all on function public.send_lobby_invite(uuid) from public;
revoke all on function public.send_lobby_invite(uuid) from anon;
grant execute on function public.send_lobby_invite(uuid) to authenticated;

comment on function public.send_lobby_invite(uuid) is
  'FEATURE-FRIENDS-02 : inscrit en lobby → ami inscrit hors salle. N invitations OK.';

create or replace function public.decline_lobby_invite(p_id uuid)
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

  if p_id is null then
    raise exception 'lobby_invite_gone';
  end if;

  delete from public.lobby_invites
  where id = p_id
    and to_user_id = v_uid;
  get diagnostics v_deleted = row_count;

  if v_deleted = 0 then
    return jsonb_build_object('result', 'gone');
  end if;

  return jsonb_build_object('result', 'declined');
end;
$$;

revoke all on function public.decline_lobby_invite(uuid) from public;
revoke all on function public.decline_lobby_invite(uuid) from anon;
grant execute on function public.decline_lobby_invite(uuid) to authenticated;

create or replace function public.accept_lobby_invite(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid;
  v_lobby_id uuid;
  v_name text;
  v_emoji text;
  v_try text;
  v_i int;
  v_inserted boolean := false;
begin
  v_uid := public.friends_require_caller();

  if p_id is null then
    raise exception 'lobby_invite_gone';
  end if;

  select i.lobby_id
    into v_lobby_id
  from public.lobby_invites i
  where i.id = p_id
    and i.to_user_id = v_uid;

  if v_lobby_id is null then
    raise exception 'lobby_invite_gone';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_lobby_id::text, 0));

  if not exists (
    select 1
    from public.lobbies l
    where l.id = v_lobby_id
      and coalesce(l.last_activity_at, l.updated_at, l.created_at)
        > now() - interval '24 hours'
  ) then
    delete from public.lobby_invites where id = p_id;
    raise exception 'lobby_invite_closed';
  end if;

  if exists (
    select 1
    from public.lobby_members m
    where m.lobby_id = v_lobby_id
      and m.user_id = v_uid
  ) then
    delete from public.lobby_invites where id = p_id;
    return jsonb_build_object('result', 'already_in', 'lobby_id', v_lobby_id);
  end if;

  if exists (
    select 1
    from public.lobby_members m
    where m.user_id = v_uid
  ) then
    raise exception 'lobby_invite_busy';
  end if;

  if public.get_lobby_member_count(v_lobby_id) >= 8 then
    raise exception 'lobby_invite_full';
  end if;

  select
    coalesce(nullif(trim(p.display_name), ''), 'Joueur'),
    coalesce(nullif(trim(p.emoji), ''), '👤')
    into v_name, v_emoji
  from public.profiles p
  where p.id = v_uid;

  v_name := coalesce(v_name, 'Joueur');
  v_emoji := coalesce(v_emoji, '👤');

  for v_i in 0..12 loop
    if v_i = 0 then
      v_try := v_name;
    else
      v_try := v_name || ' ' || v_i::text;
    end if;

    begin
      insert into public.lobby_members (
        lobby_id, user_id, display_name, emoji, color, is_host, ready
      ) values (
        v_lobby_id, v_uid, v_try, v_emoji, '#60A5FA', false, false
      );
      v_inserted := true;
      exit;
    exception
      when unique_violation then
        if position('lobby_members_one_living_per_user' in sqlerrm) > 0 then
          raise exception 'lobby_invite_busy';
        end if;
        if position('lobby_members_unique_name' in sqlerrm) > 0 then
          continue;
        end if;
        delete from public.lobby_invites where id = p_id;
        return jsonb_build_object('result', 'already_in', 'lobby_id', v_lobby_id);
    end;
  end loop;

  if not v_inserted then
    raise exception 'lobby_invite_full';
  end if;

  delete from public.lobby_invites where id = p_id;

  return jsonb_build_object('result', 'joined', 'lobby_id', v_lobby_id);
end;
$$;

revoke all on function public.accept_lobby_invite(uuid) from public;
revoke all on function public.accept_lobby_invite(uuid) from anon;
grant execute on function public.accept_lobby_invite(uuid) to authenticated;

comment on function public.accept_lobby_invite(uuid) is
  'FEATURE-FRIENDS-02 : join sans code. busy si autre membership. Jamais auto-leave.';

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
    coalesce(p.display_name, 'Joueur'),
    coalesce(p.emoji, '👤'),
    i.created_at
  from public.lobby_invites i
  left join public.profiles p on p.id = i.from_user_id
  where i.to_user_id = v_uid
  order by i.created_at;
end;
$$;

revoke all on function public.list_incoming_lobby_invites() from public;
revoke all on function public.list_incoming_lobby_invites() from anon;
grant execute on function public.list_incoming_lobby_invites() to authenticated;

comment on function public.list_incoming_lobby_invites() is
  'FEATURE-FRIENDS-02 : incoming only. Pas le code salon.';

-- ---------------------------------------------------------------------------
-- Realtime publication (no-op si déjà présent / publication absente)
-- ---------------------------------------------------------------------------

do $$
begin
  alter publication supabase_realtime add table public.lobby_invites;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
