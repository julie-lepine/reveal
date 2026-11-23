-- =============================================================================
-- AUDIT amis et invitations n°2 — vérifier une invitation AVANT de quitter son salon
-- =============================================================================
-- Problème : « Quitter et rejoindre » quittait d'abord le salon actuel, puis
-- essayait l'invitation. Si elle n'était plus bonne (salon plein, fermé,
-- invitation retirée), le joueur se retrouvait sans salon ; s'il était l'hôte,
-- son salon passait à quelqu'un d'autre (ou se fermait) pour rien.
--
-- Correctif : check_lobby_invite(p_id) — lecture seule, mêmes contrôles que
-- accept_lobby_invite (sauf « déjà dans un autre salon », justement le cas) :
--   invitation à moi introuvable        → exception lobby_invite_gone
--   salon inactif depuis plus de 24 h   → exception lobby_invite_closed
--   déjà membre de ce salon             → {result: 'already_in', lobby_id}
--   invitant plus dans le salon         → exception lobby_invite_gone
--   salon complet                       → exception lobby_invite_full
--   sinon                               → {result: 'ok', lobby_id}
-- Ne supprime rien et n'inscrit personne. L'appli l'appelle avant leaveLobby
-- (js/core/lobbyInviteJoin.js). accept_lobby_invite reste l'autorité finale.
-- Rejouable : CREATE OR REPLACE.
-- =============================================================================

create or replace function public.check_lobby_invite(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid;
  v_lobby_id uuid;
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

  if not exists (
    select 1
    from public.lobbies l
    where l.id = v_lobby_id
      and coalesce(l.last_activity_at, l.updated_at, l.created_at)
        > now() - interval '24 hours'
  ) then
    raise exception 'lobby_invite_closed';
  end if;

  if exists (
    select 1
    from public.lobby_members m
    where m.lobby_id = v_lobby_id
      and m.user_id = v_uid
  ) then
    return jsonb_build_object('result', 'already_in', 'lobby_id', v_lobby_id);
  end if;

  -- Même règle que accept_lobby_invite après fix-friends-invites-cleanup.sql (n°3) :
  -- l'invitant doit encore être dans la soirée.
  if not exists (
    select 1
    from public.lobby_invites i
    join public.lobby_members m
      on m.lobby_id = i.lobby_id
     and m.user_id = i.from_user_id
    where i.id = p_id
  ) then
    raise exception 'lobby_invite_gone';
  end if;

  if public.get_lobby_member_count(v_lobby_id) >= public.lobby_max_players(v_lobby_id) then
    raise exception 'lobby_invite_full';
  end if;

  return jsonb_build_object('result', 'ok', 'lobby_id', v_lobby_id);
end;
$$;

revoke all on function public.check_lobby_invite(uuid) from public;
revoke all on function public.check_lobby_invite(uuid) from anon;
grant execute on function public.check_lobby_invite(uuid) to authenticated;

notify pgrst, 'reload schema';
