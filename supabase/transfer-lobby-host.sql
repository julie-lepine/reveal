-- REVEAL — transfert volontaire du rôle d'hôte (SQL Editor → Run)
-- Après schema.sql + game-sessions.sql

create or replace function public.transfer_lobby_host(
  p_lobby_id uuid,
  p_new_host_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_host_id uuid;
begin
  select host_id into v_old_host_id
  from public.lobbies
  where id = p_lobby_id;

  if v_old_host_id is null then
    raise exception 'Lobby introuvable.';
  end if;

  if auth.uid() is distinct from v_old_host_id then
    raise exception 'Seul l''hôte peut transférer le rôle.';
  end if;

  if p_new_host_user_id = v_old_host_id then
    raise exception 'Tu es déjà l''hôte.';
  end if;

  if not exists (
    select 1 from public.lobby_members
    where lobby_id = p_lobby_id and user_id = p_new_host_user_id
  ) then
    raise exception 'Ce joueur n''est pas dans le lobby.';
  end if;

  update public.lobbies
  set host_id = p_new_host_user_id
  where id = p_lobby_id;

  update public.lobby_members
  set is_host = false, color = '#60A5FA'
  where lobby_id = p_lobby_id and user_id = v_old_host_id;

  update public.lobby_members
  set is_host = true, color = '#A78BFA'
  where lobby_id = p_lobby_id and user_id = p_new_host_user_id;

  update public.game_sessions
  set host_id = p_new_host_user_id
  where lobby_id = p_lobby_id;
end;
$$;

revoke all on function public.transfer_lobby_host(uuid, uuid) from public;
grant execute on function public.transfer_lobby_host(uuid, uuid) to authenticated;
