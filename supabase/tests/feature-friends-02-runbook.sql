-- =============================================================================
-- FEATURE-FRIENDS-02 — Runbook STAGING (SQL Editor)
-- Prérequis : coller supabase/feature-friends-02.sql (SUCCESS) AVANT ce fichier.
-- INTERDIT EN PRODUCTION.
--
-- Ne crée / ne dissout AUCUN lobby. Ne touche PAS aux friendships.
-- Nettoyage : invitations entre les 2 comptes de smoke seulement.
--
-- Comment jouer :
--   1) Bloc 0 (catalogue) — toujours, lecture seule.
--   2) Bloc 1 (RLS) — toujours. ATTENDU : insert client impossible.
--   3) Bloc 2 (comportement) — JWT simulé : self, gone, no_lobby ou pending.
--
-- Un RAISE EXCEPTION = échec : ne pas passer au palier 2 client.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. Catalogue (lecture — OK)
-- ---------------------------------------------------------------------------

select to_regclass('public.lobby_invites') as lobby_invites;
-- ATTENDU : non null

select p.proname
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'send_lobby_invite',
    'decline_lobby_invite',
    'accept_lobby_invite',
    'list_incoming_lobby_invites'
  )
order by 1;
-- ATTENDU : 4 lignes

select c.relname, c.relreplident
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname = 'lobby_invites';
-- ATTENDU : relreplident = 'f' (FULL)

select tablename
from pg_publication_tables
where pubname = 'supabase_realtime'
  and tablename = 'lobby_invites';
-- ATTENDU : 1 ligne. Si 0 : Database → Publications → supabase_realtime.

select pol.polname, pol.polcmd
from pg_policy pol
join pg_class c on c.oid = pol.polrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname = 'lobby_invites';
-- ATTENDU : SELECT seulement (polcmd = 'r')

-- ---------------------------------------------------------------------------
-- 1. RLS : INSERT client impossible
-- ---------------------------------------------------------------------------

do $$
declare
  v_err text;
  v_a uuid;
  v_b uuid;
  v_lobby uuid;
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

  select l.id into v_lobby
  from public.lobbies l
  order by l.created_at
  limit 1;

  if v_a is null or v_b is null or v_lobby is null then
    raise notice 'FRIENDS02_RLS_SKIP — 2 inscrits + 1 lobby requis pour le test INSERT';
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
      raise exception 'FRIENDS02_SET_ROLE_FAIL %', sqlerrm;
  end;

  begin
    insert into public.lobby_invites (lobby_id, from_user_id, to_user_id)
    values (v_lobby, v_a, v_b);
    execute 'reset role';
    raise exception 'FRIENDS02_RLS_FAIL — INSERT lobby_invites n’aurait pas dû passer';
  exception
    when insufficient_privilege then
      execute 'reset role';
      raise notice 'FRIENDS02_RLS_OK — INSERT refusé';
    when others then
      v_err := sqlerrm;
      execute 'reset role';
      if v_err like '%FRIENDS02_RLS_FAIL%' then
        raise;
      end if;
      raise notice 'FRIENDS02_RLS_OK — INSERT bloqué (%)', v_err;
  end;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Comportement RPC (JWT simulé)
-- ---------------------------------------------------------------------------

do $$
declare
  v_a uuid;
  v_b uuid;
  v_g uuid;
  v_res jsonb;
  v_msg text;
  v_in_lobby boolean;
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
    raise exception 'FRIENDS02_NEED_TWO_REGISTERED — crée 2 comptes email';
  end if;

  select u.id into v_g
  from auth.users u
  where coalesce(u.is_anonymous, false) = true
  order by u.created_at
  limit 1;

  delete from public.lobby_invites
  where (from_user_id = v_a and to_user_id = v_b)
     or (from_user_id = v_b and to_user_id = v_a);

  perform set_config('request.jwt.claim.sub', v_a::text, true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_a::text, 'role', 'authenticated')::text,
    true
  );

  begin
    perform public.send_lobby_invite(v_a);
    raise exception 'FRIENDS02_SELF_FAIL';
  exception
    when others then
      v_msg := sqlerrm;
      if v_msg not like '%friends_self%' then
        raise exception 'FRIENDS02_SELF_WANT_friends_self got %', v_msg;
      end if;
  end;

  if v_g is not null then
    begin
      perform public.send_lobby_invite(v_g);
      raise exception 'FRIENDS02_GUEST_FAIL';
    exception
      when others then
        v_msg := sqlerrm;
        if v_msg not like '%friends_guest%' then
          raise exception 'FRIENDS02_GUEST_WANT_friends_guest got %', v_msg;
        end if;
    end;
  else
    raise notice 'FRIENDS02_GUEST_SKIP — pas d’user is_anonymous';
  end if;

  v_res := public.decline_lobby_invite('00000000-0000-0000-0000-000000000001');
  if v_res->>'result' is distinct from 'gone' then
    raise exception 'FRIENDS02_DECLINE_GONE got %', v_res;
  end if;

  begin
    perform public.accept_lobby_invite('00000000-0000-0000-0000-000000000001');
    raise exception 'FRIENDS02_ACCEPT_GONE_FAIL';
  exception
    when others then
      v_msg := sqlerrm;
      if v_msg like '%FRIENDS02_ACCEPT_GONE_FAIL%' then
        raise;
      end if;
      if v_msg not like '%lobby_invite_gone%' then
        raise exception 'FRIENDS02_ACCEPT_WANT_gone got %', v_msg;
      end if;
  end;

  select exists (
    select 1 from public.lobby_members m where m.user_id = v_a
  ) into v_in_lobby;

  begin
    v_res := public.send_lobby_invite(v_b);
    if not v_in_lobby then
      raise exception 'FRIENDS02_SEND_WANT_no_lobby got %', v_res;
    end if;
    if v_res->>'result' is distinct from 'pending' then
      raise exception 'FRIENDS02_SEND_PENDING got %', v_res;
    end if;
    v_res := public.send_lobby_invite(v_b);
    if v_res->>'result' is distinct from 'pending' then
      raise exception 'FRIENDS02_SEND_IDEMPOTENT got %', v_res;
    end if;
    raise notice 'FRIENDS02_SEND_OK pending a→b';
  exception
    when others then
      v_msg := sqlerrm;
      if v_msg like '%FRIENDS02_%' then
        raise;
      end if;
      if not v_in_lobby and v_msg like '%lobby_invite_no_lobby%' then
        raise notice 'FRIENDS02_NO_LOBBY_OK';
      elsif v_in_lobby and v_msg like '%lobby_invite_not_friends%' then
        raise notice 'FRIENDS02_NOT_FRIENDS_OK (A en lobby, A/B pas amis — normal)';
      elsif v_in_lobby and v_msg like '%lobby_invite_already_in%' then
        raise notice 'FRIENDS02_ALREADY_IN_OK (B déjà dans le lobby de A)';
      else
        raise exception 'FRIENDS02_SEND_UNEXPECTED %', v_msg;
      end if;
  end;

  delete from public.lobby_invites
  where (from_user_id = v_a and to_user_id = v_b)
     or (from_user_id = v_b and to_user_id = v_a);

  raise notice 'FRIENDS02_BEHAVIOR_OK a=% b=%', v_a, v_b;
end $$;

select 'FRIENDS02_RUNBOOK_OK' as status;
