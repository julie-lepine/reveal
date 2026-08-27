-- =============================================================================
-- FEATURE-FRIENDS-01 — Runbook STAGING (SQL Editor)
-- Prérequis : coller supabase/feature-friends-01.sql (SUCCESS) AVANT ce fichier.
-- INTERDIT EN PRODUCTION.
--
-- Comment jouer :
--   1) Bloc 0 (catalogue) — toujours, lecture seule.
--   2) Bloc 1 (RLS) — toujours. ATTENDU : insert client impossible.
--   3) Bloc 2 (comportement) — les 2 plus anciens inscrits, ou OVERRIDE dans le DO.
--      Nettoie ses propres lignes friend_* en fin de bloc. Ne touche pas aux lobbies.
--   4) Bloc 3 (overlay) — optionnel : un lobby_id où USER_A est membre.
--
-- Si un NOTICE « skip » apparaît (pas d’invité en base), ce n’est pas un échec.
-- Un RAISE EXCEPTION = échec : ne pas passer au palier 2.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. Catalogue (lecture — OK)
-- ---------------------------------------------------------------------------

select
  to_regclass('public.friend_requests') as friend_requests,
  to_regclass('public.friendships') as friendships,
  to_regclass('public.friend_request_cooldowns') as cooldowns;
-- ATTENDU : trois noms non null

select p.proname
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'send_friend_request',
    'decline_friend_request',
    'accept_friend_request',
    'unfriend',
    'get_lobby_friend_overlay',
    'list_my_friends',
    'list_incoming_friend_requests'
  )
order by 1;
-- ATTENDU : 7 lignes

select c.relname, c.relreplident
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('friend_requests', 'friendships');
-- ATTENDU : relreplident = 'f' (FULL) pour les deux

select tablename
from pg_publication_tables
where pubname = 'supabase_realtime'
  and tablename in ('friend_requests', 'friendships', 'friend_request_cooldowns')
order by 1;
-- ATTENDU : friend_requests + friendships. PAS cooldowns.
-- Si 0 ligne : Database → Publications → supabase_realtime (pas Database → Replication).

select pol.polname, c.relname, pol.polcmd
from pg_policy pol
join pg_class c on c.oid = pol.polrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('friend_requests', 'friendships', 'friend_request_cooldowns')
order by 2, 1;
-- ATTENDU : SELECT (polcmd = 'r') sur requests + friendships.
--           0 policy sur friend_request_cooldowns.

-- ---------------------------------------------------------------------------
-- 1. RLS : le rôle authenticated ne peut pas INSERT (SQL Editor = postgres
--    bypasse RLS, d’où SET ROLE).
-- ---------------------------------------------------------------------------

do $$
declare
  v_err text;
  v_a uuid;
  v_b uuid;
begin
  select u.id into v_a
  from auth.users u
  where coalesce(u.is_anonymous, false) = false
  order by u.created_at
  limit 1;

  select u.id into v_b
  from auth.users u
  where coalesce(u.is_anonymous, false) = false
    and u.id is distinct from v_a
  order by u.created_at
  limit 1;

  if v_a is null or v_b is null then
    raise notice 'FRIENDS01_RLS_SKIP — il faut 2 comptes inscrits dans auth.users';
    return;
  end if;

  perform set_config('request.jwt.claim.sub', v_a::text, true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_a::text, 'role', 'authenticated')::text,
    true
  );

  begin
    execute 'set local role authenticated';
  exception
    when others then
      raise exception 'FRIENDS01_SET_ROLE_FAIL %', sqlerrm;
  end;

  begin
    insert into public.friend_requests (from_user_id, to_user_id)
    values (v_a, v_b);
    execute 'reset role';
    raise exception 'FRIENDS01_RLS_FAIL — INSERT friend_requests n’aurait pas dû passer';
  exception
    when insufficient_privilege then
      execute 'reset role';
      raise notice 'FRIENDS01_RLS_OK — INSERT requests refusé';
    when others then
      v_err := sqlerrm;
      execute 'reset role';
      if v_err like '%FRIENDS01_RLS_FAIL%' then
        raise;
      end if;
      raise notice 'FRIENDS01_RLS_OK — INSERT requests bloqué (%)', v_err;
  end;
end $$;

do $$
declare
  v_err text;
  v_a uuid;
  v_b uuid;
begin
  select u.id into v_a
  from auth.users u
  where coalesce(u.is_anonymous, false) = false
  order by u.created_at
  limit 1;

  select u.id into v_b
  from auth.users u
  where coalesce(u.is_anonymous, false) = false
    and u.id is distinct from v_a
  order by u.created_at
  limit 1;

  if v_a is null or v_b is null then
    return;
  end if;

  perform set_config('request.jwt.claim.sub', v_a::text, true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_a::text, 'role', 'authenticated')::text,
    true
  );

  begin
    execute 'set local role authenticated';
  exception
    when others then
      raise exception 'FRIENDS01_SET_ROLE_FAIL %', sqlerrm;
  end;

  begin
    insert into public.friendships (user_a, user_b)
    values (least(v_a, v_b), greatest(v_a, v_b));
    execute 'reset role';
    raise exception 'FRIENDS01_RLS_FAIL — INSERT friendships n’aurait pas dû passer';
  exception
    when insufficient_privilege then
      execute 'reset role';
      raise notice 'FRIENDS01_RLS_OK — INSERT friendships refusé';
    when others then
      v_err := sqlerrm;
      execute 'reset role';
      if v_err like '%FRIENDS01_RLS_FAIL%' then
        raise;
      end if;
      raise notice 'FRIENDS01_RLS_OK — INSERT friendships bloqué (%)', v_err;
  end;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Comportement RPC (JWT simulé)
-- Nettoyage : uniquement la paire v_a / v_b.
-- ---------------------------------------------------------------------------

do $$
declare
  v_a uuid;
  v_b uuid;
  v_g uuid;
  v_res jsonb;
  v_msg text;
  v_n int;
begin
  -- OVERRIDE (optionnel) :
  -- v_a := '00000000-0000-0000-0000-000000000000';
  -- v_b := '00000000-0000-0000-0000-000000000001';

  if v_a is null then
    select u.id into v_a
    from auth.users u
    where coalesce(u.is_anonymous, false) = false
    order by u.created_at
    limit 1;
  end if;
  if v_b is null then
    select u.id into v_b
    from auth.users u
    where coalesce(u.is_anonymous, false) = false
      and u.id is distinct from v_a
    order by u.created_at
    limit 1;
  end if;

  if v_a is null or v_b is null then
    raise exception 'FRIENDS01_NEED_TWO_REGISTERED — crée 2 comptes email sur staging';
  end if;

  select u.id into v_g
  from auth.users u
  where coalesce(u.is_anonymous, false) = true
  order by u.created_at
  limit 1;

  delete from public.friend_requests
  where (from_user_id = v_a and to_user_id = v_b)
     or (from_user_id = v_b and to_user_id = v_a);
  delete from public.friendships
  where user_a = least(v_a, v_b) and user_b = greatest(v_a, v_b);
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
    perform public.send_friend_request(v_a);
    raise exception 'FRIENDS01_SELF_FAIL';
  exception
    when others then
      v_msg := sqlerrm;
      if v_msg not like '%friends_self%' then
        raise exception 'FRIENDS01_SELF_WANT_friends_self got %', v_msg;
      end if;
  end;

  if v_g is not null then
    begin
      perform public.send_friend_request(v_g);
      raise exception 'FRIENDS01_GUEST_FAIL';
    exception
      when others then
        v_msg := sqlerrm;
        if v_msg not like '%friends_guest%' then
          raise exception 'FRIENDS01_GUEST_WANT_friends_guest got %', v_msg;
        end if;
    end;
  else
    raise notice 'FRIENDS01_GUEST_SKIP — pas d’user is_anonymous';
  end if;

  v_res := public.send_friend_request(v_b);
  if v_res->>'result' is distinct from 'pending' then
    raise exception 'FRIENDS01_SEND_PENDING got %', v_res;
  end if;
  v_res := public.send_friend_request(v_b);
  if v_res->>'result' is distinct from 'pending' then
    raise exception 'FRIENDS01_SEND_IDEMPOTENT got %', v_res;
  end if;

  select count(*) into v_n
  from public.friend_requests
  where from_user_id = v_a and to_user_id = v_b;
  if v_n <> 1 then
    raise exception 'FRIENDS01_SEND_COUNT %', v_n;
  end if;

  perform set_config('request.jwt.claim.sub', v_b::text, true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_b::text, 'role', 'authenticated')::text,
    true
  );
  v_res := public.decline_friend_request(v_a);
  if v_res->>'result' is distinct from 'declined' then
    raise exception 'FRIENDS01_DECLINE got %', v_res;
  end if;
  if exists (
    select 1 from public.friend_requests
    where from_user_id = v_a and to_user_id = v_b
  ) then
    raise exception 'FRIENDS01_DECLINE_ROW_LEFT';
  end if;

  perform set_config('request.jwt.claim.sub', v_a::text, true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_a::text, 'role', 'authenticated')::text,
    true
  );
  begin
    perform public.send_friend_request(v_b);
    raise exception 'FRIENDS01_COOLDOWN_FAIL';
  exception
    when others then
      v_msg := sqlerrm;
      if v_msg not like '%friends_cooldown%' then
        raise exception 'FRIENDS01_COOLDOWN_WANT_friends_cooldown got %', v_msg;
      end if;
  end;

  delete from public.friend_request_cooldowns
  where from_user_id = v_a and to_user_id = v_b;

  v_res := public.send_friend_request(v_b);
  if v_res->>'result' is distinct from 'pending' then
    raise exception 'FRIENDS01_RESEND got %', v_res;
  end if;

  perform set_config('request.jwt.claim.sub', v_b::text, true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_b::text, 'role', 'authenticated')::text,
    true
  );
  v_res := public.accept_friend_request(v_a);
  if v_res->>'result' is distinct from 'friends' then
    raise exception 'FRIENDS01_ACCEPT got %', v_res;
  end if;
  if not exists (
    select 1 from public.friendships
    where user_a = least(v_a, v_b) and user_b = greatest(v_a, v_b)
  ) then
    raise exception 'FRIENDS01_FRIENDSHIP_MISSING';
  end if;

  perform set_config('request.jwt.claim.sub', v_a::text, true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_a::text, 'role', 'authenticated')::text,
    true
  );
  begin
    perform public.send_friend_request(v_b);
    raise exception 'FRIENDS01_ALREADY_FAIL';
  exception
    when others then
      v_msg := sqlerrm;
      if v_msg not like '%friends_already%' then
        raise exception 'FRIENDS01_ALREADY_WANT_friends_already got %', v_msg;
      end if;
  end;

  select count(*) into v_n from public.list_my_friends();
  if v_n < 1 then
    raise exception 'FRIENDS01_LIST_FRIENDS empty';
  end if;

  v_res := public.unfriend(v_b);
  if v_res->>'result' is distinct from 'ok' then
    raise exception 'FRIENDS01_UNFRIEND got %', v_res;
  end if;

  perform public.send_friend_request(v_b);
  perform set_config('request.jwt.claim.sub', v_b::text, true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_b::text, 'role', 'authenticated')::text,
    true
  );
  v_res := public.send_friend_request(v_a);
  if v_res->>'result' is distinct from 'friends' then
    raise exception 'FRIENDS01_MUTUAL got %', v_res;
  end if;

  delete from public.friend_requests
  where (from_user_id = v_a and to_user_id = v_b)
     or (from_user_id = v_b and to_user_id = v_a);
  delete from public.friendships
  where user_a = least(v_a, v_b) and user_b = greatest(v_a, v_b);
  delete from public.friend_request_cooldowns
  where (from_user_id = v_a and to_user_id = v_b)
     or (from_user_id = v_b and to_user_id = v_a);

  raise notice 'FRIENDS01_BEHAVIOR_OK a=% b=%', v_a, v_b;
end $$;

-- Visible dans l’onglet Results (les NOTICE du SQL Editor sont faciles à rater).
-- Si ce SELECT s’affiche, les blocs RLS + comportement ont réussi (sinon le script
-- se serait arrêté sur un RAISE EXCEPTION).
select 'FRIENDS01_RUNBOOK_OK' as status;

-- ---------------------------------------------------------------------------
-- 3. Overlay (optionnel)
-- ---------------------------------------------------------------------------
-- select set_config('request.jwt.claim.sub', '<USER_A>'::text, true);
-- select set_config(
--   'request.jwt.claims',
--   json_build_object('sub', '<USER_A>', 'role', 'authenticated')::text,
--   true
-- );
-- select public.get_lobby_friend_overlay('<LOBBY_ID>'::uuid);
-- ATTENDU : jsonb array, pas d’entrée self, status dans
--   guest | none | pending_out | pending_in | friends
