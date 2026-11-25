-- Audit carnet et cosmétiques (tmp/audit-carnet-cosmetiques.md) n°2.
--
-- Avant : les jetons d'archive carnet (signature_carnet_kick_allow, valables 30 min)
-- n'étaient effacés que si la personne archivait ensuite. 46 jetons expirés en prod
-- le 2026-11-25, le plus ancien du 2026-09-07. À chaque fermeture de salon, l'hôte
-- Signature recevait aussi un jeton inutile (il archive avant la fermeture).
--
-- Après (dissolve_lobby_atomically, reprise de FEATURE-PROFILE-04c) :
--   - jetons de plus de 30 min effacés à chaque fermeture de salon (ceux des
--     retraits comme ceux des fermetures) ;
--   - pas de jeton pour l'hôte qui ferme ;
--   - nettoyage unique des jetons déjà expirés.
-- archive_signature_evening et kick_lobby_member ne changent pas.
--
-- Idempotent. Consigner dans docs/DEPLOYMENTS_SQL.md (fiche 58).

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

  -- Audit carnet n°2 : jetons expirés (30 min) effacés.
  delete from public.signature_carnet_kick_allow as a
  where a.created_at < now() - interval '30 minutes';

  -- FEATURE-PROFILE-04c : jetons carnet avant CASCADE membership.
  -- Audit carnet n°2 : pas pour l'hôte, qui archive avant de fermer.
  insert into public.signature_carnet_kick_allow (user_id, lobby_id)
  select lm.user_id, p_lobby_id
  from public.lobby_members lm
  join public.profiles p on p.id = lm.user_id
  where lm.lobby_id = p_lobby_id
    and lm.user_id <> v_uid
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
  'E5 + XX-E + FEATURE-PROFILE-04c + audit carnet n°2 : dissolve hôte, jetons carnet '
  'Signature (sauf hôte) avant DELETE, jetons expirés effacés.';

delete from public.signature_carnet_kick_allow
where created_at < now() - interval '30 minutes';

notify pgrst, 'reload schema';

-- Contrôles après application :
-- select count(*) from public.signature_carnet_kick_allow where created_at < now() - interval '30 minutes'; -- 0
-- select pg_get_functiondef('public.dissolve_lobby_atomically(uuid)'::regprocedure) like '%lm.user_id <> v_uid%';
