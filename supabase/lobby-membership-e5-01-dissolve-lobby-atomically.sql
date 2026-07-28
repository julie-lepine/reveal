-- =============================================================================
-- Membership Vague E5 — dissolve_lobby_atomically
-- Un seul DELETE public.lobbies (cascades FK = transaction données).
-- Pas de satellites game_sessions / traitre_private (ON DELETE CASCADE).
-- Pas de verrou advisory.
-- Ne révoque PAS lobbies_delete_host (anciens clients DELETE direct OK).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.dissolve_lobby_atomically(p_lobby_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid;
  v_deleted_id uuid;
  v_exists boolean;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object(
      'status', 'UNAUTHENTICATED',
      'lobby_id', p_lobby_id
    );
  END IF;

  IF p_lobby_id IS NULL THEN
    RETURN jsonb_build_object(
      'status', 'ALREADY_GONE',
      'lobby_id', null
    );
  END IF;

  DELETE FROM public.lobbies
  WHERE id = p_lobby_id
    AND host_id = v_uid
  RETURNING id INTO v_deleted_id;

  IF v_deleted_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'status', 'DISSOLVED',
      'lobby_id', v_deleted_id
    );
  END IF;

  -- DEFINER : voit la ligne même si le caller n’est plus membre (distingue NOT_ALLOWED).
  SELECT EXISTS (
    SELECT 1
    FROM public.lobbies AS l
    WHERE l.id = p_lobby_id
  ) INTO v_exists;

  IF COALESCE(v_exists, false) THEN
    RETURN jsonb_build_object(
      'status', 'NOT_ALLOWED',
      'lobby_id', p_lobby_id
    );
  END IF;

  RETURN jsonb_build_object(
    'status', 'ALREADY_GONE',
    'lobby_id', p_lobby_id
  );
END;
$function$;

COMMENT ON FUNCTION public.dissolve_lobby_atomically(uuid) IS
  'E5 — dissolution hôte atomique. DISSOLVED | ALREADY_GONE | NOT_ALLOWED | UNAUTHENTICATED. '
  'auth.uid() only. Cascades FK ; pas de cleanup satellite manuel.';

REVOKE ALL ON FUNCTION public.dissolve_lobby_atomically(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dissolve_lobby_atomically(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.dissolve_lobby_atomically(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dissolve_lobby_atomically(uuid) TO service_role;
-- Invité connecté (signInAnonymously) = rôle JWT « authenticated », pas « anon ».
