-- =============================================================================
-- FEATURE-FRIENDS-04 — Runbook STAGING (SQL Editor)
-- Prérequis : coller supabase/feature-friends-04.sql (SUCCESS) AVANT ce fichier.
-- INTERDIT EN PRODUCTION.
--
-- Crée un lobby jetable (2 inscrits hors salon, sans encounter préalable).
-- Ne touche PAS aux friendships. Dissout uniquement ce lobby de smoke.
--
-- Comment jouer :
--   1) Bloc 0 (catalogue) — toujours, lecture seule.
--   2) Bloc 1 (comportement) — OVERRIDE possible.
--
-- Un RAISE EXCEPTION = échec : ne pas passer au palier 2 client.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. Catalogue (lecture — OK)
-- ---------------------------------------------------------------------------

select to_regclass('public.lobby_encounters') as lobby_encounters;
-- ATTENDU : public.lobby_encounters

select p.proname
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'list_recent_lobby_peers',
    'friends_record_lobby_encounter',
    'purge_stale_lobby_encounters',
    'lobby_encounters_on_member'
  )
order by 1;
-- ATTENDU : 4 lignes

select tg.tgname
from pg_trigger tg
join pg_class c on c.oid = tg.tgrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname = 'lobby_members'
  and not tg.tgisinternal
  and tg.tgname like 'lobby_encounters_on_member%'
order by 1;
-- ATTENDU : ins + del

select tablename
from pg_publication_tables
where pubname = 'supabase_realtime'
  and tablename = 'lobby_encounters';
-- ATTENDU : 0 ligne

-- ---------------------------------------------------------------------------
-- 1. Comportement (JWT simulé) — lobby jetable
-- ---------------------------------------------------------------------------

do $$
declare
  v_a uuid;
  v_b uuid;
  v_g uuid;
  v_lobby uuid;
  v_code text;
  v_n int;
  v_seen int;
  v_msg text;
begin
  -- OVERRIDE (optionnel) — 2 inscrits PAS en salon, PAS déjà croisés, PAS amis :
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
      and not exists (select 1 from public.lobby_members m where m.user_id = a.id)
      and not exists (select 1 from public.lobby_members m where m.user_id = b.id)
      and not exists (
        select 1 from public.friendships f
        where f.user_a = least(a.id, b.id) and f.user_b = greatest(a.id, b.id)
      )
      and not exists (
        select 1 from public.lobby_encounters e
        where e.user_a = least(a.id, b.id) and e.user_b = greatest(a.id, b.id)
      )
    order by a.created_at, b.created_at
    limit 1;
  end if;

  if v_a is null or v_b is null then
    raise exception 'FRIENDS04_NEED_FREE_PAIR — 2 inscrits hors salon, pas amis, pas d’encounter';
  end if;

  select u.id into v_g
  from auth.users u
  where coalesce(u.is_anonymous, false) = true
  order by u.created_at
  limit 1;

  v_code := 'F04' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 3);

  insert into public.lobbies (code, host_id, status)
  values (v_code, v_a, 'waiting')
  returning id into v_lobby;

  insert into public.lobby_members (
    lobby_id, user_id, display_name, emoji, color, is_host
  ) values
    (v_lobby, v_a, 'F04A', '🦊', '#60A5FA', true),
    (v_lobby, v_b, 'F04B', '🎲', '#F472B6', false);

  select count(*) into v_n
  from public.lobby_encounters e
  where e.user_a = least(v_a, v_b) and e.user_b = greatest(v_a, v_b);
  if v_n <> 1 then
    raise exception 'FRIENDS04_INSERT_NO_ROW count=%', v_n;
  end if;

  perform set_config('request.jwt.claim.sub', v_a::text, true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_a::text, 'role', 'authenticated')::text,
    true
  );

  select count(*) into v_seen from public.list_recent_lobby_peers();
  if v_seen <> 0 then
    raise exception 'FRIENDS04_STILL_TOGETHER got %', v_seen;
  end if;

  delete from public.lobby_members
  where lobby_id = v_lobby and user_id = v_b;

  select count(*) into v_seen
  from public.list_recent_lobby_peers() p
  where p.user_id = v_b;
  if v_seen <> 1 then
    raise exception 'FRIENDS04_AFTER_LEAVE got %', v_seen;
  end if;

  if v_g is not null
     and not exists (select 1 from public.lobby_members m where m.user_id = v_g)
  then
    insert into public.lobby_members (
      lobby_id, user_id, display_name, emoji, color, is_host
    ) values (v_lobby, v_g, 'F04G', '🎭', '#A3A3A3', false);

    select count(*) into v_n
    from public.lobby_encounters e
    where (e.user_a = least(v_a, v_g) and e.user_b = greatest(v_a, v_g));
    if v_n <> 0 then
      raise exception 'FRIENDS04_GUEST_RECORDED';
    end if;

    delete from public.lobby_members
    where lobby_id = v_lobby and user_id = v_g;
  else
    raise notice 'FRIENDS04_GUEST_SKIP — pas d’invité libre';
  end if;

  if v_g is not null then
    perform set_config('request.jwt.claim.sub', v_g::text, true);
    perform set_config(
      'request.jwt.claims',
      json_build_object('sub', v_g::text, 'role', 'authenticated')::text,
      true
    );
    begin
      perform public.list_recent_lobby_peers();
      raise exception 'FRIENDS04_GUEST_CALLER_FAIL';
    exception
      when others then
        v_msg := sqlerrm;
        if v_msg not like '%friends_guest%' then
          raise exception 'FRIENDS04_GUEST_CALLER_WANT_friends_guest got %', v_msg;
        end if;
    end;
  end if;

  delete from public.lobby_members where lobby_id = v_lobby;
  delete from public.lobbies where id = v_lobby;
  delete from public.lobby_encounters
  where user_a = least(v_a, v_b) and user_b = greatest(v_a, v_b);

  raise notice 'FRIENDS04_BEHAVIOR_OK';
  raise notice 'FRIENDS04_RUNBOOK_OK';
end;
$$;
