-- =============================================================================
-- Membership Vague E4 — Étape C : create_lobby_atomically
-- Prérequis : A préflight OK (duplicate_user_count = 0) · B N/A
-- Ne pose PAS l’index UNIQUE (étape D = e4-02).
-- Ne bascule PAS le client (étape E) · Ne révoque PAS create_lobby_member (F).
--
-- Contrats member hôte alignés sur create_lobby_member prod :
--   INSERT (lobby_id, user_id=auth.uid(), display_name, emoji, color, is_host=true, ready=false)
--   SECURITY DEFINER · search_path = public · owner attendu : postgres
-- =============================================================================

CREATE OR REPLACE FUNCTION public.create_lobby_atomically(
  p_display_name text,
  p_emoji text,
  p_color text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid;
  v_code text;
  v_chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_attempt int;
  v_i int;
  v_idx int;
  v_lobby public.lobbies%ROWTYPE;
  v_member public.lobby_members%ROWTYPE;
  v_canon_lobby_id uuid;
  v_canon_code text;
  v_living_count integer;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Non authentifié.'
      USING ERRCODE = '42501';
  END IF;

  -- Sérialise create ↔ create pour ce user (join PostgREST hors lock — UNIQUE en D).
  PERFORM pg_advisory_xact_lock(hashtextextended(v_uid::text, 0));

  -- Même ordre que compareMembershipRowsDeterministic (joined_at DESC, lobby_id ASC).
  SELECT
    count(*)::integer,
    (
      SELECT m.lobby_id
      FROM public.lobby_members m
      INNER JOIN public.lobbies l ON l.id = m.lobby_id
      WHERE m.user_id = v_uid
      ORDER BY m.joined_at DESC NULLS LAST, m.lobby_id ASC
      LIMIT 1
    ),
    (
      SELECT l.code
      FROM public.lobby_members m
      INNER JOIN public.lobbies l ON l.id = m.lobby_id
      WHERE m.user_id = v_uid
      ORDER BY m.joined_at DESC NULLS LAST, m.lobby_id ASC
      LIMIT 1
    )
  INTO v_living_count, v_canon_lobby_id, v_canon_code
  FROM public.lobby_members m
  INNER JOIN public.lobbies l ON l.id = m.lobby_id
  WHERE m.user_id = v_uid;

  IF v_living_count IS NULL THEN
    v_living_count := 0;
  END IF;

  IF v_canon_lobby_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'status', 'ALREADY_EXISTS',
      'lobby_id', v_canon_lobby_id,
      'lobby_code', v_canon_code,
      'extra_count', GREATEST(v_living_count - 1, 0)
    );
  END IF;

  v_code := NULL;
  FOR v_attempt IN 1..12 LOOP
    v_code := '';
    FOR v_i IN 1..6 LOOP
      v_idx := 1 + floor(random() * length(v_chars))::integer;
      v_code := v_code || substr(v_chars, v_idx, 1);
    END LOOP;
    IF NOT EXISTS (
      SELECT 1
      FROM public.lobbies l
      WHERE upper(trim(l.code)) = upper(trim(v_code))
    ) THEN
      EXIT;
    END IF;
    v_code := NULL;
  END LOOP;

  IF v_code IS NULL THEN
    RAISE EXCEPTION 'Impossible de générer un code lobby.';
  END IF;

  INSERT INTO public.lobbies (code, host_id, status, game_id)
  VALUES (v_code, v_uid, 'waiting', NULL)
  RETURNING * INTO v_lobby;

  -- Contrat create_lobby_member (hôte).
  INSERT INTO public.lobby_members (
    lobby_id,
    user_id,
    display_name,
    emoji,
    color,
    is_host,
    ready
  )
  VALUES (
    v_lobby.id,
    v_uid,
    p_display_name,
    p_emoji,
    p_color,
    true,
    false
  )
  RETURNING * INTO v_member;

  RETURN jsonb_build_object(
    'status', 'CREATED',
    'lobby_id', v_lobby.id,
    'lobby_code', v_lobby.code,
    'extra_count', 0,
    'member', to_jsonb(v_member)
  );
END;
$function$;

COMMENT ON FUNCTION public.create_lobby_atomically(text, text, text) IS
  'E4 — crée lobby + membership hôte atomiquement. CREATED | ALREADY_EXISTS. auth.uid() only. '
  'extra_count > 0 seulement si doublons pré-UNIQUE (transitoire).';

REVOKE ALL ON FUNCTION public.create_lobby_atomically(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_lobby_atomically(text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_lobby_atomically(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_lobby_atomically(text, text, text) TO service_role;
-- Invité connecté (signInAnonymously) = rôle JWT « authenticated », pas « anon ».
-- « anon » = requête sans session : ne doit pas créer de lobby.
