-- REVEAL — ARCH-03 hotfix : is_acting_host sans min(uuid)
-- Cause : PostgreSQL n'a pas d'agrégat min(uuid) → erreur 42883
-- Correctif : ORDER BY user_id::text ASC LIMIT 1
--
-- Réexécutable. Ne touche PAS aux policies game_sessions ni aux autres RPC.
-- À exécuter dans le SQL Editor Supabase après constat du bug en QA.

create or replace function public.is_acting_host(p_lobby_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
stable
as $$
declare
  v_uid uuid := auth.uid();
  v_host_id uuid;
  v_host_present boolean;
  v_elected uuid;
  v_stale interval := interval '120 seconds';
begin
  if v_uid is null then
    return false;
  end if;

  if not public.is_lobby_member(p_lobby_id) then
    return false;
  end if;

  select host_id into v_host_id
  from public.lobbies
  where id = p_lobby_id;

  if v_host_id is null then
    return false;
  end if;

  -- Hôte réel présent ? (last_seen_at IS NULL = présent, legacy)
  select exists (
    select 1
    from public.lobby_members m
    where m.lobby_id = p_lobby_id
      and m.user_id = v_host_id
      and (
        m.last_seen_at is null
        or m.last_seen_at >= (now() - v_stale)
      )
  ) into v_host_present;

  if v_host_present then
    return v_uid = v_host_id;
  end if;

  -- Hôte absent : élection déterministe compatible UUID
  select lm.user_id
  into v_elected
  from public.lobby_members lm
  where lm.lobby_id = p_lobby_id
    and lm.user_id is not null
    and (
      lm.last_seen_at is null
      or lm.last_seen_at >= (now() - v_stale)
    )
  order by lm.user_id::text asc
  limit 1;

  return v_elected is not null and v_uid = v_elected;
end;
$$;

revoke all on function public.is_acting_host(uuid) from public;
grant execute on function public.is_acting_host(uuid) to authenticated;
