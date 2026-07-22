-- REVEAL — l'hôte retire un membre du lobby (SQL Editor → Run)
-- Après schema.sql (+ transfer-lobby-host.sql recommandé)
-- Autorisé en lobby d'attente ou entre deux jeux (game_id null / 'menu').

create or replace function public.kick_lobby_member(
  p_lobby_id uuid,
  p_target_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
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

  -- Lobby d'attente ou hub entre deux jeux uniquement (pas mid-manche).
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

  delete from public.lobby_members
  where lobby_id = p_lobby_id
    and user_id = p_target_user_id;
end;
$$;

revoke all on function public.kick_lobby_member(uuid, uuid) from public;
grant execute on function public.kick_lobby_member(uuid, uuid) to authenticated;
