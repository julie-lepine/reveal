-- =============================================================================
-- AUDIT amis et invitations n°1 — délai qui s'allonge après chaque refus
-- =============================================================================
-- Problème : refuser une demande d'ami ne bloquait la même personne que 60 s.
-- Elle pouvait redemander chaque minute, et la fenêtre « X veut t'ajouter »
-- revenait à chaque fois.
--
-- Correctif (décision utilisatrice 2026-11-23, pas de bouton « Bloquer ») :
--   1er refus → 1 jour avant une nouvelle demande de cette personne
--   2e refus  → 7 jours
--   3e refus  → plus jamais (until = 'infinity')
-- Le délai reste silencieux pour celui qui demande (le bouton reste « + Ami »,
-- comme avant : js/core/friendsLogic.js isSilentFriendRpcCode).
--
--  1. friend_request_cooldowns.decline_count : nombre de refus de cette personne.
--  2. decline_friend_request : incrémente le compteur et calcule le délai.
--  3. send_friend_request : ne purge plus les délais expirés (on perdait le
--     compteur) ; le reste est inchangé.
-- Le compteur est remis à zéro quand les deux deviennent amis (accept ou demande
-- dans les deux sens : lignes supprimées, inchangé). Celui qui a refusé peut
-- toujours envoyer lui-même une demande (le délai ne vaut que dans un sens).
-- Une ligne existante (ancien délai de 60 s) compte comme 1 refus.
-- Rejouable : ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE (mêmes signatures,
-- mêmes droits).
-- Base : prod du 2026-11-23 (md5 decline 6ff57c3a…, send 1b03d1b4…).
-- =============================================================================

-- 1. Compteur de refus ----------------------------------------------------------
alter table public.friend_request_cooldowns
  add column if not exists decline_count integer not null default 1;

-- 2. Refus : délai qui s'allonge ------------------------------------------------
create or replace function public.decline_friend_request(p_from uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid;
  v_deleted int;
  v_count int;
  v_until timestamptz;
begin
  v_uid := public.friends_require_caller();

  if p_from is null or p_from = v_uid then
    raise exception 'friends_self';
  end if;

  delete from public.friend_requests
  where from_user_id = p_from
    and to_user_id = v_uid;
  get diagnostics v_deleted = row_count;

  if v_deleted = 0 then
    return jsonb_build_object('result', 'gone');
  end if;

  select coalesce(c.decline_count, 0) + 1
    into v_count
  from public.friend_request_cooldowns c
  where c.from_user_id = p_from
    and c.to_user_id = v_uid;
  v_count := coalesce(v_count, 1);

  v_until := case
    when v_count <= 1 then now() + interval '1 day'
    when v_count = 2 then now() + interval '7 days'
    else 'infinity'::timestamptz
  end;

  insert into public.friend_request_cooldowns (from_user_id, to_user_id, until, decline_count)
  values (p_from, v_uid, v_until, v_count)
  on conflict (from_user_id, to_user_id) do update
    set until = excluded.until,
        decline_count = excluded.decline_count;

  return jsonb_build_object('result', 'declined');
end;
$$;

-- 3. Demande : ne plus effacer les délais expirés (ils gardent le compteur) ------
create or replace function public.send_friend_request(p_to uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_from uuid;
  v_to_kind text;
  v_until timestamptz;
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

  -- (Avant : « delete … where until < now() » — supprimé, sinon le compteur de
  -- refus disparaissait dès la fin du premier délai.)

  if exists (
    select 1
    from public.friendships f
    where f.user_a = least(v_from, p_to)
      and f.user_b = greatest(v_from, p_to)
  ) then
    raise exception 'friends_already';
  end if;

  -- Demande inverse → double consentement : auto-accept
  if exists (
    select 1
    from public.friend_requests r
    where r.from_user_id = p_to
      and r.to_user_id = v_from
  ) then
    perform public.friends_insert_friendship(v_from, p_to);
    perform public.friends_clear_pair_requests(v_from, p_to);
    delete from public.friend_request_cooldowns
    where (from_user_id = v_from and to_user_id = p_to)
       or (from_user_id = p_to and to_user_id = v_from);
    return jsonb_build_object('result', 'friends');
  end if;

  select c.until
    into v_until
  from public.friend_request_cooldowns c
  where c.from_user_id = v_from
    and c.to_user_id = p_to;

  if v_until is not null and v_until > now() then
    raise exception 'friends_cooldown';
  end if;

  if exists (
    select 1
    from public.friend_requests r
    where r.from_user_id = v_from
      and r.to_user_id = p_to
  ) then
    return jsonb_build_object('result', 'pending');
  end if;

  insert into public.friend_requests (from_user_id, to_user_id)
  values (v_from, p_to);

  return jsonb_build_object('result', 'pending');
end;
$$;

notify pgrst, 'reload schema';
