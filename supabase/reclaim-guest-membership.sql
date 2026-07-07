-- REVEAL — Reclaim d'une membership invité (session anonyme perdue)
-- À exécuter dans Supabase → SQL Editor après schema.sql (+ game-sessions.sql, traitre-private.sql)
--
-- Phase 0 : fondation serveur uniquement. L'app n'appelle pas encore ces RPC.
--
-- Règles de sécurité :
--   • reclaim autorisé UNIQUEMENT si l'ancien user_id de la row est un utilisateur Supabase anonymous
--   • pas de reclaim sur membership liée à un compte email / OAuth
--   • member_id + code + display_name ne suffisent PAS sans vérification anonymous sur l'ancien propriétaire
--   • idempotent si la row appartient déjà à auth.uid()

-- ---------------------------------------------------------------------------
-- Helper : utilisateur auth anonyme ?
-- ---------------------------------------------------------------------------

create or replace function public.is_auth_user_anonymous(p_user_id uuid)
returns boolean
language sql
security definer
set search_path = public, auth
stable
as $$
  select coalesce(
    (
      select u.is_anonymous
      from auth.users u
      where u.id = p_user_id
    ),
    false
  );
$$;

comment on function public.is_auth_user_anonymous(uuid) is
  'True si p_user_id est un compte Supabase anonymous (is_anonymous).';

revoke all on function public.is_auth_user_anonymous(uuid) from public;
grant execute on function public.is_auth_user_anonymous(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Helper : remplace un uid (clés + valeurs string) dans un document jsonb
-- Utilisé pour game_sessions.state après reclaim (votes / ready indexés par uid).
-- ---------------------------------------------------------------------------

create or replace function public.jsonb_replace_uid(
  p_data jsonb,
  p_old text,
  p_new text
)
returns jsonb
language plpgsql
immutable
as $$
declare
  k text;
  v jsonb;
  out_obj jsonb := '{}'::jsonb;
  new_k text;
  elem jsonb;
  out_arr jsonb := '[]'::jsonb;
  i int;
begin
  if p_data is null or p_old is null or p_new is null or p_old = p_new then
    return p_data;
  end if;

  case jsonb_typeof(p_data)
    when 'string' then
      if p_data #>> '{}' = p_old then
        return to_jsonb(p_new);
      end if;
      return p_data;
    when 'array' then
      for i in 0 .. jsonb_array_length(p_data) - 1 loop
        elem := public.jsonb_replace_uid(p_data -> i, p_old, p_new);
        out_arr := out_arr || jsonb_build_array(elem);
      end loop;
      return out_arr;
    when 'object' then
      for k, v in select key, value from jsonb_each(p_data) loop
        new_k := case when k = p_old then p_new else k end;
        out_obj := out_obj || jsonb_build_object(new_k, public.jsonb_replace_uid(v, p_old, p_new));
      end loop;
      return out_obj;
    else
      return p_data;
  end case;
end;
$$;

comment on function public.jsonb_replace_uid(jsonb, text, text) is
  'Remplace récursivement p_old par p_new dans les clés et valeurs string d''un jsonb.';

revoke all on function public.jsonb_replace_uid(jsonb, text, text) from public;
grant execute on function public.jsonb_replace_uid(jsonb, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Remap uid satellite tables (rôles privés) + game_sessions.state
-- ---------------------------------------------------------------------------

create or replace function public.remap_lobby_user_id(
  p_lobby_id uuid,
  p_old_user_id uuid,
  p_new_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_lobby_id is null or p_old_user_id is null or p_new_user_id is null then
    return;
  end if;
  if p_old_user_id = p_new_user_id then
    return;
  end if;

  -- Spot the fake : rôle imposteur privé
  if to_regclass('public.traitre_private') is not null then
    update public.traitre_private
    set user_id = p_new_user_id
    where lobby_id = p_lobby_id
      and user_id = p_old_user_id;
  end if;

  -- Fil rouge (optionnel / legacy)
  if to_regclass('public.fil_rouge_private') is not null then
    update public.fil_rouge_private
    set user_id = p_new_user_id
    where lobby_id = p_lobby_id
      and user_id = p_old_user_id;

    update public.fil_rouge_private
    set mission_target_uid = p_new_user_id
    where lobby_id = p_lobby_id
      and mission_target_uid = p_old_user_id;
  end if;

  -- Messages : cohérence affichage / RLS (non bloquant pour le gameplay)
  update public.lobby_messages
  set user_id = p_new_user_id
  where lobby_id = p_lobby_id
    and user_id = p_old_user_id;

  -- État de partie multijoueur (votes, ready, placements indexés par uid)
  if to_regclass('public.game_sessions') is not null then
    update public.game_sessions
    set state = public.jsonb_replace_uid(state, p_old_user_id::text, p_new_user_id::text)
    where lobby_id = p_lobby_id;
  end if;
end;
$$;

comment on function public.remap_lobby_user_id(uuid, uuid, uuid) is
  'Propage un changement de user_id après reclaim invité (traitre_private, game_sessions.state, …).';

revoke all on function public.remap_lobby_user_id(uuid, uuid, uuid) from public;
grant execute on function public.remap_lobby_user_id(uuid, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- RPC principale : reclaim membership invité
-- ---------------------------------------------------------------------------

create or replace function public.reclaim_guest_membership(
  p_member_id uuid,
  p_code text,
  p_display_name text
)
returns table (lobby_id uuid, reclaimed boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_member public.lobby_members%rowtype;
  v_lobby public.lobbies%rowtype;
  v_code text;
  v_name text;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Non authentifié.';
  end if;

  v_code := upper(trim(coalesce(p_code, '')));
  v_name := trim(coalesce(p_display_name, ''));

  if p_member_id is null then
    raise exception 'Membership invalide.';
  end if;
  if char_length(v_code) < 4 then
    raise exception 'Code lobby invalide.';
  end if;
  if char_length(v_name) < 2 then
    raise exception 'Pseudo invalide.';
  end if;

  select m.*
  into v_member
  from public.lobby_members m
  where m.id = p_member_id;

  if not found then
    raise exception 'Membership introuvable.';
  end if;

  select l.*
  into v_lobby
  from public.lobbies l
  where l.id = v_member.lobby_id;

  if not found then
    raise exception 'Lobby introuvable.';
  end if;

  if upper(trim(v_lobby.code)) <> v_code then
    raise exception 'Code lobby incorrect.';
  end if;

  if upper(trim(v_member.display_name)) <> upper(v_name) then
    raise exception 'Pseudo incorrect.';
  end if;

  -- Déjà le propriétaire actuel : succès idempotent
  if v_member.user_id = v_uid then
    lobby_id := v_lobby.id;
    reclaimed := false;
    return next;
    return;
  end if;

  -- Sécurité stricte : seules les memberships dont l'ancien propriétaire est anonymous
  if not public.is_auth_user_anonymous(v_member.user_id) then
    raise exception 'Cette place est liée à un compte connecté et ne peut pas être reprise en invité.';
  end if;

  -- Reclaim atomique
  update public.lobby_members
  set user_id = v_uid
  where id = p_member_id
    and user_id = v_member.user_id;

  if not found then
    raise exception 'Reclaim impossible (membership modifiée entre-temps).';
  end if;

  perform public.remap_lobby_user_id(v_lobby.id, v_member.user_id, v_uid);

  lobby_id := v_lobby.id;
  reclaimed := true;
  return next;
end;
$$;

comment on function public.reclaim_guest_membership(uuid, text, text) is
  'Re-lie une membership invité orpheline (ancien user anonymous) au auth.uid() courant.';

revoke all on function public.reclaim_guest_membership(uuid, text, text) from public;
grant execute on function public.reclaim_guest_membership(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- RPC lecture : méta lobby pour reprise (phase 3 — pas de reclaim implicite)
-- ---------------------------------------------------------------------------

create or replace function public.peek_lobby_by_membership(p_member_id uuid)
returns table (
  lobby_id uuid,
  code text,
  status text,
  game_id text,
  reclaimable boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_member public.lobby_members%rowtype;
  v_lobby public.lobbies%rowtype;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Non authentifié.';
  end if;

  if p_member_id is null then
    return;
  end if;

  select m.*
  into v_member
  from public.lobby_members m
  where m.id = p_member_id;

  if not found then
    return;
  end if;

  select l.*
  into v_lobby
  from public.lobbies l
  where l.id = v_member.lobby_id;

  if not found then
    return;
  end if;

  -- Expiration alignée sur find_lobby_by_code (24 h)
  if coalesce(v_lobby.last_activity_at, v_lobby.updated_at, v_lobby.created_at)
     <= now() - interval '24 hours' then
    return;
  end if;

  lobby_id := v_lobby.id;
  code := v_lobby.code;
  status := v_lobby.status;
  game_id := v_lobby.game_id;

  reclaimable :=
    (v_member.user_id = v_uid)
    or public.is_auth_user_anonymous(v_member.user_id);

  return next;
end;
$$;

comment on function public.peek_lobby_by_membership(uuid) is
  'Méta lobby pour carte « Reprendre ». reclaimable=true si déjà lié ou si ancien propriétaire anonymous.';

revoke all on function public.peek_lobby_by_membership(uuid) from public;
grant execute on function public.peek_lobby_by_membership(uuid) to authenticated;
