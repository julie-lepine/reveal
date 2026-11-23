-- =============================================================================
-- AUDIT amis et invitations n°3 à 6 — invitations périmées et droits en trop
-- =============================================================================
-- n°3 : une invitation restait valable après la fin de l'amitié, ou après le
--       départ de celui qui avait invité.
--       → unfriend supprime les invitations entre les deux (dans les deux sens) ;
--       → accept_lobby_invite refuse (« invitation plus valable ») si l'invitant
--         n'est plus dans le salon. Modification ciblée EN PLACE (un bloc ajouté
--         avant le contrôle « salon complet »).
-- n°4 : un joueur retiré par l'hôte pouvait revenir avec une invitation envoyée
--       avant. → kick_lobby_member supprime ses invitations vers ce salon.
--       (Revenir avec le code reste possible : pas de liste de bannis.)
-- n°5 : les invitations vers une soirée fermée restaient dans la liste et
--       échouaient au clic. → list_incoming_lobby_invites ne renvoie que les
--       invitations vers une soirée active depuis moins de 24 h dont l'invitant
--       est encore membre (filtre seulement, la fonction reste en lecture).
-- n°6 : droits par défaut en trop (dont TRUNCATE, que la protection par ligne ne
--       couvre pas) sur 3 tables. → l'appli garde seulement SELECT (lecture de
--       ses invitations envoyées + temps réel) ; tout passe par les fonctions.
-- Rejouable : CREATE OR REPLACE ; l'étape en place ne fait rien si déjà faite ;
-- REVOKE sans effet si déjà retiré. Mêmes signatures, mêmes droits d'exécution.
-- Base : prod du 2026-11-23 (md5 accept 84c69e03…, kick 0e259dd2…, unfriend
-- 6da3782d…, list_incoming da5a33ae…).
-- =============================================================================

-- n°3a. unfriend : supprimer aussi les invitations entre les deux ----------------
create or replace function public.unfriend(p_other uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid;
begin
  v_uid := public.friends_require_caller();

  if p_other is null or p_other = v_uid then
    raise exception 'friends_self';
  end if;

  delete from public.friendships
  where user_a = least(v_uid, p_other)
    and user_b = greatest(v_uid, p_other);

  -- Audit amis n°3 : plus amis → plus d'invitation entre les deux.
  delete from public.lobby_invites
  where (from_user_id = v_uid and to_user_id = p_other)
     or (from_user_id = p_other and to_user_id = v_uid);

  return jsonb_build_object('result', 'ok');
end;
$$;

-- n°3b. accept_lobby_invite : l'invitant doit encore être dans le salon ----------
do $migration$
declare
  v_def text;
  v_anchor text := 'if public.get_lobby_member_count(v_lobby_id) >= public.lobby_max_players(v_lobby_id) then';
  v_marker text := '-- Audit amis n°3 : invitant encore membre';
  v_block text;
  v_count int;
begin
  v_def := pg_get_functiondef('public.accept_lobby_invite(uuid)'::regprocedure);

  if position(v_marker in v_def) > 0 then
    raise notice 'accept_lobby_invite : déjà à jour, rien à faire.';
    return;
  end if;

  v_count := (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor);
  if v_count <> 1 then
    raise exception 'accept_lobby_invite : passage attendu trouvé % fois (1 attendu). Migration annulée.', v_count;
  end if;

  v_block := v_marker || E'\n'
    || E'  if not exists (\n'
    || E'    select 1\n'
    || E'    from public.lobby_invites i\n'
    || E'    join public.lobby_members m\n'
    || E'      on m.lobby_id = i.lobby_id\n'
    || E'     and m.user_id = i.from_user_id\n'
    || E'    where i.id = p_id\n'
    || E'  ) then\n'
    || E'    raise exception ''lobby_invite_gone'';\n'
    || E'  end if;\n\n  ';

  execute replace(v_def, v_anchor, v_block || v_anchor);
end;
$migration$;

-- n°4. kick_lobby_member : supprimer les invitations du joueur retiré -----------
create or replace function public.kick_lobby_member(p_lobby_id uuid, p_target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_host_id uuid;
  v_status text;
  v_game_id text;
begin
  select host_id, status, game_id
    into v_host_id, v_status, v_game_id
  from public.lobbies
  where id = p_lobby_id;

  if v_host_id is null then
    raise exception 'Lobby introuvable.';
  end if;

  if auth.uid() is distinct from v_host_id then
    raise exception 'Seul l''hôte peut retirer un joueur.';
  end if;

  if p_target_user_id is null then
    raise exception 'Joueur invalide.';
  end if;

  if p_target_user_id = v_host_id then
    raise exception 'Tu ne peux pas te retirer toi-même (quitte le lobby ou transfère l''hôte).';
  end if;

  if not (
    coalesce(v_status, 'waiting') = 'waiting'
    or v_game_id is null
    or v_game_id = 'menu'
  ) then
    raise exception 'Tu ne peux retirer un joueur qu''au lobby ou entre deux jeux.';
  end if;

  if not exists (
    select 1 from public.lobby_members
    where lobby_id = p_lobby_id and user_id = p_target_user_id
  ) then
    raise exception 'Ce joueur n''est plus dans le lobby.';
  end if;

  if exists (
    select 1
    from public.profiles p
    where p.id = p_target_user_id
      and p.profile_pack is true
  ) then
    insert into public.signature_carnet_kick_allow (user_id, lobby_id)
    values (p_target_user_id, p_lobby_id)
    on conflict (user_id, lobby_id) do update
      set created_at = excluded.created_at;
  end if;

  delete from public.lobby_members
  where lobby_id = p_lobby_id
    and user_id = p_target_user_id;

  -- Audit amis n°4 : une invitation reçue avant ne permet plus de revenir.
  delete from public.lobby_invites
  where lobby_id = p_lobby_id
    and to_user_id = p_target_user_id;
end;
$$;

-- n°5. Liste des invitations reçues : seulement celles encore utilisables -------
create or replace function public.list_incoming_lobby_invites()
returns table(
  id uuid,
  lobby_id uuid,
  from_user_id uuid,
  display_name text,
  emoji text,
  created_at timestamp with time zone,
  name_color text,
  signature boolean,
  avatar_path text,
  avatar_rev integer
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
    i.id,
    i.lobby_id,
    i.from_user_id,
    public.friends_live_display_name(i.from_user_id),
    public.friends_live_emoji(i.from_user_id),
    i.created_at,
    public.friends_live_name_color(i.from_user_id),
    public.friends_live_signature(i.from_user_id),
    public.friends_live_avatar_path(i.from_user_id),
    public.friends_live_avatar_rev(i.from_user_id)
  from public.lobby_invites i
  join public.lobbies l
    on l.id = i.lobby_id
  where i.to_user_id = v_uid
    -- Audit amis n°5 : soirée encore active (même règle que accept_lobby_invite)…
    and coalesce(l.last_activity_at, l.updated_at, l.created_at)
      > now() - interval '24 hours'
    -- … et invitant encore dans la soirée (même règle que n°3).
    and exists (
      select 1
      from public.lobby_members m
      where m.lobby_id = i.lobby_id
        and m.user_id = i.from_user_id
    )
  order by i.created_at;
end;
$$;

-- n°6. Droits : l'appli garde seulement la lecture sur ces tables ----------------
revoke insert, update, delete, truncate, references, trigger
  on table public.friend_requests from authenticated;
revoke insert, update, delete, truncate, references, trigger
  on table public.friendships from authenticated;
revoke insert, update, delete, truncate, references, trigger
  on table public.lobby_invites from authenticated;

notify pgrst, 'reload schema';
