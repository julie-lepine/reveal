-- FEATURE-PROFILE-04c — C-DISSOLVE : carnet Signature après fermeture du salon
--
-- Ticket : l’hôte archive avant DELETE ; les autres membres apprennent
-- la fermeture trop tard (`resolveLobbyClosureAndExit`). CASCADE a déjà
-- retiré la membership → `archive_signature_evening` lève
-- `signature_not_member` (pas de jeton).
--
-- Preuve : `dissolve_lobby_atomically` (definer) écrit un jeton
-- `signature_carnet_kick_allow` (uid + lobby) pour chaque membre Signature
-- VIVANT, AVANT le DELETE lobby. L’archive 04b l’accepte 30 min.
--
-- Prérequis : FEATURE-PROFILE-04b (table + archive).
-- Ne PAS réexécuter feature-profile-04-carnet.sql, 04b, ni
-- lobby-closures-xx-e.sql (recréerait dissolve sans jetons).
-- Hors scope : C-HOME · purge `inactive_expired`.
--
-- À coller dans SQL Editor (staging puis prod). Idempotent.
-- Consigner dans docs/DEPLOYMENTS_SQL.md.

create or replace function public.dissolve_lobby_atomically(p_lobby_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_uid uuid;
  v_host_id uuid;
  v_deleted_id uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then
    return jsonb_build_object(
      'status', 'UNAUTHENTICATED',
      'lobby_id', p_lobby_id
    );
  end if;

  if p_lobby_id is null then
    return jsonb_build_object(
      'status', 'ALREADY_GONE',
      'lobby_id', null
    );
  end if;

  select l.host_id into v_host_id
  from public.lobbies as l
  where l.id = p_lobby_id
  for update;

  if not found then
    return jsonb_build_object(
      'status', 'ALREADY_GONE',
      'lobby_id', p_lobby_id
    );
  end if;

  if v_host_id is distinct from v_uid then
    return jsonb_build_object(
      'status', 'NOT_ALLOWED',
      'lobby_id', p_lobby_id
    );
  end if;

  -- FEATURE-PROFILE-04c : jetons carnet avant CASCADE membership.
  insert into public.signature_carnet_kick_allow (user_id, lobby_id)
  select lm.user_id, p_lobby_id
  from public.lobby_members lm
  join public.profiles p on p.id = lm.user_id
  where lm.lobby_id = p_lobby_id
    and p.profile_pack is true
  on conflict (user_id, lobby_id) do update
    set created_at = excluded.created_at;

  delete from public.lobbies as l
  where l.id = p_lobby_id
    and l.host_id = v_uid
  returning l.id into v_deleted_id;

  if v_deleted_id is null then
    return jsonb_build_object(
      'status', 'ALREADY_GONE',
      'lobby_id', p_lobby_id
    );
  end if;

  insert into public.lobby_closures (lobby_id, reason, closed_at, closed_by_uid)
  values (v_deleted_id, 'host_closed', now(), v_uid)
  on conflict (lobby_id) do nothing;

  return jsonb_build_object(
    'status', 'DISSOLVED',
    'lobby_id', v_deleted_id
  );
end;
$function$;

revoke all on function public.dissolve_lobby_atomically(uuid) from public;
revoke all on function public.dissolve_lobby_atomically(uuid) from anon;
grant execute on function public.dissolve_lobby_atomically(uuid) to authenticated;
grant execute on function public.dissolve_lobby_atomically(uuid) to service_role;

comment on function public.dissolve_lobby_atomically(uuid) is
  'E5 + XX-E + FEATURE-PROFILE-04c : dissolve hôte + jetons carnet Signature avant DELETE.';

notify pgrst, 'reload schema';
