-- =============================================================================
-- FEATURE-FRIENDS-03 — Runbook STAGING (SQL Editor)
-- Prérequis : coller supabase/feature-friends-03.sql (SUCCESS) AVANT ce fichier.
-- INTERDIT EN PRODUCTION.
--
-- Ne touche PAS aux friendships (pas d’unfriend). Ne dissout aucun lobby.
-- Nettoyage : demandes + cooldowns de la paire de smoke seulement.
--
-- Comment jouer :
--   1) Bloc 0 (catalogue) — toujours, lecture seule.
--   2) Bloc 1 (comportement) — 2 inscrits PAS déjà amis (ou OVERRIDE).
--
-- Un RAISE EXCEPTION = échec : ne pas passer au palier 2 client.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. Catalogue (lecture — OK)
-- ---------------------------------------------------------------------------

select p.proname
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'cancel_friend_request',
    'list_outgoing_friend_requests'
  )
order by 1;
-- ATTENDU : 2 lignes

select p.proname, pg_get_function_identity_arguments(p.oid) as args
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'cancel_friend_request';
-- ATTENDU : args = uuid

-- ---------------------------------------------------------------------------
-- 1. Comportement RPC (JWT simulé)
-- ---------------------------------------------------------------------------

do $$
declare
  v_a uuid;
  v_b uuid;
  v_g uuid;
  v_res jsonb;
  v_msg text;
  v_n int;
  v_missing uuid := '00000000-0000-0000-0000-000000000099';
begin
  -- OVERRIDE (optionnel) — deux inscrits qui ne sont PAS amis :
  -- v_a := '00000000-0000-0000-0000-000000000000';
  -- v_b := '00000000-0000-0000-0000-000000000001';

  if v_a is null then
    select a.id, b.id
      into v_a, v_b
    from auth.users a
    join auth.users b
      on b.id is distinct from a.id
     and coalesce(b.is_anonymous, false) = false
    where coalesce(a.is_anonymous, false) = false
      and not exists (
        select 1
        from public.friendships f
        where f.user_a = least(a.id, b.id)
          and f.user_b = greatest(a.id, b.id)
      )
    order by a.created_at, b.created_at
    limit 1;
  end if;

  if v_a is null or v_b is null then
    raise exception 'FRIENDS03_NEED_NON_FRIEND_PAIR — 2 inscrits pas amis, ou OVERRIDE';
  end if;

  if exists (
    select 1
    from public.friendships f
    where f.user_a = least(v_a, v_b)
      and f.user_b = greatest(v_a, v_b)
  ) then
    raise exception 'FRIENDS03_PAIR_IS_FRIENDS — choisis 2 comptes pas amis (OVERRIDE)';
  end if;

  select u.id into v_g
  from auth.users u
  where coalesce(u.is_anonymous, false) = true
  order by u.created_at
  limit 1;

  delete from public.friend_requests
  where (from_user_id = v_a and to_user_id = v_b)
     or (from_user_id = v_b and to_user_id = v_a);
  delete from public.friend_request_cooldowns
  where (from_user_id = v_a and to_user_id = v_b)
     or (from_user_id = v_b and to_user_id = v_a);

  perform set_config('request.jwt.claim.sub', v_a::text, true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_a::text, 'role', 'authenticated')::text,
    true
  );

  begin
    perform public.cancel_friend_request(v_a);
    raise exception 'FRIENDS03_SELF_FAIL';
  exception
    when others then
      v_msg := sqlerrm;
      if v_msg not like '%friends_self%' then
        raise exception 'FRIENDS03_SELF_WANT_friends_self got %', v_msg;
      end if;
  end;

  if exists (select 1 from auth.users u where u.id = v_missing) then
    v_missing := gen_random_uuid();
  end if;
  begin
    perform public.cancel_friend_request(v_missing);
    raise exception 'FRIENDS03_NOT_FOUND_FAIL';
  exception
    when others then
      v_msg := sqlerrm;
      if v_msg not like '%friends_not_found%' then
        raise exception 'FRIENDS03_NOT_FOUND_WANT_friends_not_found got %', v_msg;
      end if;
  end;

  if v_g is not null then
    begin
      perform public.cancel_friend_request(v_g);
      raise exception 'FRIENDS03_GUEST_FAIL';
    exception
      when others then
        v_msg := sqlerrm;
        if v_msg not like '%friends_guest%' then
          raise exception 'FRIENDS03_GUEST_WANT_friends_guest got %', v_msg;
        end if;
    end;
  else
    raise notice 'FRIENDS03_GUEST_SKIP — pas d’user is_anonymous';
  end if;

  v_res := public.cancel_friend_request(v_b);
  if v_res->>'result' is distinct from 'gone' then
    raise exception 'FRIENDS03_GONE got %', v_res;
  end if;

  v_res := public.send_friend_request(v_b);
  if v_res->>'result' is distinct from 'pending' then
    raise exception 'FRIENDS03_SEND got %', v_res;
  end if;

  select count(*) into v_n from public.list_outgoing_friend_requests()
  where to_user_id = v_b;
  if v_n <> 1 then
    raise exception 'FRIENDS03_LIST_OUT %', v_n;
  end if;

  -- Destinataire : cancel(p_to émetteur) n’efface pas la demande reçue
  perform set_config('request.jwt.claim.sub', v_b::text, true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_b::text, 'role', 'authenticated')::text,
    true
  );
  v_res := public.cancel_friend_request(v_a);
  if v_res->>'result' is distinct from 'gone' then
    raise exception 'FRIENDS03_RECIPIENT_CANCEL got %', v_res;
  end if;
  if not exists (
    select 1 from public.friend_requests
    where from_user_id = v_a and to_user_id = v_b
  ) then
    raise exception 'FRIENDS03_RECIPIENT_WIPED_ROW';
  end if;

  perform set_config('request.jwt.claim.sub', v_a::text, true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_a::text, 'role', 'authenticated')::text,
    true
  );
  v_res := public.cancel_friend_request(v_b);
  if v_res->>'result' is distinct from 'cancelled' then
    raise exception 'FRIENDS03_CANCEL got %', v_res;
  end if;
  if exists (
    select 1 from public.friend_requests
    where from_user_id = v_a and to_user_id = v_b
  ) then
    raise exception 'FRIENDS03_CANCEL_ROW_LEFT';
  end if;
  if exists (
    select 1 from public.friend_request_cooldowns
    where from_user_id = v_a and to_user_id = v_b
  ) then
    raise exception 'FRIENDS03_CANCEL_WROTE_COOLDOWN';
  end if;

  select count(*) into v_n from public.list_outgoing_friend_requests()
  where to_user_id = v_b;
  if v_n <> 0 then
    raise exception 'FRIENDS03_LIST_AFTER_CANCEL %', v_n;
  end if;

  -- Renvoi immédiat (pas de cooldown)
  v_res := public.send_friend_request(v_b);
  if v_res->>'result' is distinct from 'pending' then
    raise exception 'FRIENDS03_RESEND got %', v_res;
  end if;

  v_res := public.cancel_friend_request(v_b);
  if v_res->>'result' is distinct from 'cancelled' then
    raise exception 'FRIENDS03_CANCEL2 got %', v_res;
  end if;

  delete from public.friend_requests
  where (from_user_id = v_a and to_user_id = v_b)
     or (from_user_id = v_b and to_user_id = v_a);
  delete from public.friend_request_cooldowns
  where (from_user_id = v_a and to_user_id = v_b)
     or (from_user_id = v_b and to_user_id = v_a);

  raise notice 'FRIENDS03_BEHAVIOR_OK a=% b=%', v_a, v_b;
end $$;

select 'FRIENDS03_RUNBOOK_OK' as status;
