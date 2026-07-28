-- =============================================================================
-- Membership Vague E4 — Étape F-bis (Option B) : REVOKE strict
-- Prérequis : Option A déployée · client E4 dominant · 0 appels
--   E4_RPC_DEPRECATED observés sur une fenêtre suffisante (onglets / PWA / GH Pages).
-- =============================================================================

REVOKE ALL ON FUNCTION public.create_lobby_member(uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_lobby_member(uuid, text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.create_lobby_member(uuid, text, text, text) FROM authenticated;
-- postgres / service_role : ops uniquement.

COMMENT ON FUNCTION public.create_lobby_member(uuid, text, text, text) IS
  'E4 Option B — déprécié + REVOKE authenticated/anon/PUBLIC. '
  'Anciens clients → erreur permission (plus E4_RPC_DEPRECATED).';
