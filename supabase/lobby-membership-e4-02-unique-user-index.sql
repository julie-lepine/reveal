-- =============================================================================
-- Membership Vague E4 — Étape D : UNIQUE(user_id) + reclaim conflict propre
-- Prérequis : A duplicate_user_count = 0 · C RPC atomique déployée
-- Déployer juste avant / avec le client E (évite orphelins ancien create).
--
-- Index stable (mapping client 23505) :
--   lobby_members_one_living_per_user
-- =============================================================================

DO $$
DECLARE
  dup_users integer;
BEGIN
  SELECT count(*)::integer
  INTO dup_users
  FROM (
    SELECT m.user_id
    FROM public.lobby_members m
    GROUP BY m.user_id
    HAVING count(*) > 1
  ) d;

  IF dup_users > 0 THEN
    RAISE EXCEPTION
      'E4: % user(s) ont plusieurs lobby_members — refuser UNIQUE. '
      'Exécuter lobby-membership-e4-00-preflight-duplicates.sql et résoudre '
      'explicitement (pas de purge silencieuse).',
      dup_users;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS lobby_members_one_living_per_user
  ON public.lobby_members (user_id);

COMMENT ON INDEX public.lobby_members_one_living_per_user IS
  'E4 — au plus un membership vivant par user_id (leave=DELETE, lobby CASCADE).';

-- Reclaim : échouer proprement si auth.uid() a déjà un autre membership
-- (évite 23505 opaque sur UPDATE user_id).
CREATE OR REPLACE FUNCTION public.reclaim_guest_membership(
  p_member_id uuid,
  p_code text,
  p_display_name text
)
RETURNS TABLE(lobby_id uuid, reclaimed boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_uid uuid;
  v_member public.lobby_members%rowtype;
  v_lobby public.lobbies%rowtype;
  v_code text;
  v_name text;
  v_other_lobby uuid;
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

  -- E4 : ne pas écraser / fusionner si uid déjà membre ailleurs
  select m.lobby_id
  into v_other_lobby
  from public.lobby_members m
  where m.user_id = v_uid
    and m.id <> p_member_id
  limit 1;

  if v_other_lobby is not null then
    raise exception
      'Tu es déjà dans une autre soirée. Quitte-la avant de reprendre cette place. (lobby_members_one_living_per_user)'
      using errcode = 'P0001';
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
$function$;

COMMENT ON FUNCTION public.reclaim_guest_membership(uuid, text, text) IS
  'Re-lie une membership invité orpheline (ancien user anonymous) au auth.uid() courant. '
  'E4 : refuse si auth.uid() a déjà un autre lobby_members (UNIQUE user_id).';
