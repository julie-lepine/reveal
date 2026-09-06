-- FEATURE-HOST-02 — Cap d’invitation ami = cap du salon (8 / 14)
--
-- Ticket H-INVITE : `accept_lobby_invite` (FEATURE-FRIENDS-02, déjà en prod)
-- refusait à 8 membres. Le join par code lit déjà `profiles.host_pack` de
-- l’hôte du salon. L’acceptation d’invite doit suivre la même règle.
--
-- Prérequis : FEATURE-HOST-01 (`profiles.host_pack`) + FEATURE-FRIENDS-02.
-- Ne PAS réexécuter feature-friends-02.sql.
-- `send_lobby_invite` reste sans check de count (plafond = Rejoindre).
--
-- À coller dans SQL Editor (staging puis prod). Idempotent.
-- Consigner dans docs/DEPLOYMENTS_SQL.md.

create or replace function public.lobby_max_players(p_lobby_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_host_pack boolean;
begin
  if p_lobby_id is null then
    return 8;
  end if;

  select coalesce(p.host_pack, false)
    into v_host_pack
  from public.lobbies l
  left join public.profiles p on p.id = l.host_id
  where l.id = p_lobby_id;

  if not found then
    return 8;
  end if;

  if v_host_pack then
    return 14;
  end if;
  return 8;
end;
$$;

revoke all on function public.lobby_max_players(uuid) from public;
revoke all on function public.lobby_max_players(uuid) from anon;
revoke all on function public.lobby_max_players(uuid) from authenticated;

comment on function public.lobby_max_players(uuid) is
  'FEATURE-HOST-02 : 14 si l’hôte du salon a host_pack, sinon 8. Interne (pas d’RPC client).';

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

  if public.get_lobby_member_count(v_lobby_id) >= public.lobby_max_players(v_lobby_id) then
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

  for v_i in 0..20 loop
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
  'FEATURE-FRIENDS-02 / HOST-02 : join sans code. Cap 8 ou 14 selon host_pack de l’hôte. busy si autre membership. Jamais auto-leave.';
