-- FEATURE-FRIENDS-03 — annuler une demande d’ami envoyée
--
-- Dépend de FEATURE-FRIENDS-01 (friend_requests, friends_require_caller,
--   friends_auth_kind, friends_lock_pair). Pas de nouvelle table.
-- Idempotent (drop if exists / create or replace).
--
-- Contrats : js/config/friends.js (FRIEND_RPC_F03)
--   cancel_friend_request(p_to uuid) — émetteur DELETE sa ligne
--   list_outgoing_friend_requests() — profils live, pas de snapshot
-- Erreurs : friends_guest, friends_self, friends_not_found
--   No-op (rien à annuler) : jsonb result = gone, PAS d’exception
-- Pas de cooldown (contraire de decline_friend_request).
--
-- Realtime : inchangé (friend_requests déjà dans supabase_realtime).
--
-- Après apply : supabase/tests/feature-friends-03-runbook.sql
--   INTERDIT EN PRODUCTION (mute des demandes entre comptes de test).

-- ---------------------------------------------------------------------------
-- RPC
-- ---------------------------------------------------------------------------

drop function if exists public.cancel_friend_request(uuid);
drop function if exists public.list_outgoing_friend_requests();

create or replace function public.cancel_friend_request(p_to uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_from uuid;
  v_to_kind text;
  v_deleted int;
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

  perform public.friends_lock_pair(v_from, p_to);

  delete from public.friend_requests
  where from_user_id = v_from
    and to_user_id = p_to;
  get diagnostics v_deleted = row_count;

  if v_deleted = 0 then
    return jsonb_build_object('result', 'gone');
  end if;

  -- Pas d’INSERT friend_request_cooldowns : Annuler ≠ refus.
  return jsonb_build_object('result', 'cancelled');
end;
$$;

revoke all on function public.cancel_friend_request(uuid) from public;
revoke all on function public.cancel_friend_request(uuid) from anon;
grant execute on function public.cancel_friend_request(uuid) to authenticated;

comment on function public.cancel_friend_request(uuid) is
  'FEATURE-FRIENDS-03 : émetteur retire sa demande. Pas de cooldown. No-op = gone.';

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
    coalesce(p.display_name, 'Joueur'),
    coalesce(p.emoji, '👤'),
    r.created_at
  from public.friend_requests r
  left join public.profiles p on p.id = r.to_user_id
  where r.from_user_id = v_uid
  order by r.created_at;
end;
$$;

revoke all on function public.list_outgoing_friend_requests() from public;
revoke all on function public.list_outgoing_friend_requests() from anon;
grant execute on function public.list_outgoing_friend_requests() to authenticated;

comment on function public.list_outgoing_friend_requests() is
  'FEATURE-FRIENDS-03 : demandes envoyées, pseudo / emoji relus depuis profiles.';
