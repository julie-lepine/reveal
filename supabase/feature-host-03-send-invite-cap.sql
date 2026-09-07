-- FEATURE-HOST-03 — H-INVITE-FULL : ne plus envoyer d’invite à salon plein
--
-- Ticket : à 8/8 ou 14/14, `send_lobby_invite` partait quand même. L’ami
-- recevait une invitation morte (refus seulement à l’acceptation).
--
-- Prérequis : FEATURE-HOST-02 (`lobby_max_players` + `accept_lobby_invite`).
-- Ne PAS réexécuter feature-friends-02.sql ni feature-host-02-invite-cap.sql.
--
-- Overbooking des places *restantes* inchangé (13/14 → N invites OK).
-- Après transfert d’hôte Maître → non-Maître, un salon à 10 a cap 8 :
-- un *nouvel* envoi est refusé ici. Une invite déjà pending n’est pas
-- purgée (ticket H-INVITE-TRANSFER : l’accept relit le cap du nouvel hôte).
--
-- À coller dans SQL Editor (staging puis prod). Idempotent.
-- Consigner dans docs/DEPLOYMENTS_SQL.md.

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

  if public.get_lobby_member_count(v_lobby_id) >= public.lobby_max_players(v_lobby_id) then
    raise exception 'lobby_invite_full';
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
  'FEATURE-HOST-03 : inscrit en lobby → ami hors salle. Refuse si count >= cap (8/14, pack de l’hôte). Places restantes : N invites OK.';
