-- =============================================================================
-- Membership Vague E4 — Étape F (Option A, recommandée) : dépréciation douce
--
-- Objectif : anciens clients qui appellent encore create_lobby_member reçoivent
-- une erreur MÉTIER stable (observable en logs), pas un 42501 permission.
--
-- Ne PAS combiner avec REVOKE dans le même déploiement prod immédiat.
-- REVOKE = e4-03b (Option B), après observation des appels dépréciés = 0.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.create_lobby_member(
  p_lobby_id uuid,
  p_display_name text,
  p_emoji text,
  p_color text
)
RETURNS public.lobby_members
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RAISE EXCEPTION
    'E4_RPC_DEPRECATED: create_lobby_member — utiliser create_lobby_atomically.'
    USING ERRCODE = 'P0001';
END;
$function$;

COMMENT ON FUNCTION public.create_lobby_member(uuid, text, text, text) IS
  'E4 Option A — déprécié (exception métier). Grants conservés pour observabilité. '
  'REVOKE ultérieur : lobby-membership-e4-03b-revoke-create-lobby-member.sql';

-- Grants inchangés volontairement (authenticated / anon / service_role selon prod).
-- Ne pas REVOKE ici.
