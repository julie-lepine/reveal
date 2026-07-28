-- =============================================================================
-- E5 — Harness staging : dissolve_lobby_atomically
-- Prérequis : appliquer lobby-membership-e5-01-dissolve-lobby-atomically.sql
-- Remplacer :host_uid / :guest_uid / :lobby_id par de vrais UUID.
-- =============================================================================

-- ── Contrôle signature / owner / grants ─────────────────────────────────────
SELECT
  p.proname,
  pg_get_function_identity_arguments(p.oid) AS args,
  pg_get_userbyid(p.proowner) AS owner,
  p.prosecdef AS security_definer,
  p.proconfig AS config,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute,
  has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_execute,
  has_function_privilege('public', p.oid, 'EXECUTE') AS public_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'dissolve_lobby_atomically';
-- Attendu :
--   args = p_lobby_id uuid
--   owner = postgres
--   security_definer = true
--   config contient search_path=
--   anon_execute = false · public_execute = false
--   authenticated_execute = true · service_role_execute = true

SELECT grantee, privilege_type
FROM information_schema.routine_privileges
WHERE routine_schema = 'public' AND routine_name = 'dissolve_lobby_atomically'
ORDER BY grantee;

-- Policy SELECT lobbies (contexte re-query client — NE PAS utiliser seul comme preuve)
SELECT polname, polcmd, pg_get_expr(polqual, polrelid) AS using_expr
FROM pg_policy
WHERE polrelid = 'public.lobbies'::regclass
ORDER BY polname;
-- Attendu notamment :
--   lobbies_select_host  → auth.uid() = host_id
--   lobbies_select_member → is_lobby_member(id)
-- Donc SELECT lobbies après dissolve / pour non-membre → 0 row AMBIGU
-- (absent vs masqué). Client E5 utilise queryActiveLobbyMembership (living JOIN).

-- =============================================================================
-- SCÉNARIO 1 — hôte → DISSOLVED + cascades
-- Session auth.uid() = :host_uid ; lobby préparé avec members, messages,
-- game_sessions, polls/votes, traitre_private.
-- =============================================================================
-- SELECT public.dissolve_lobby_atomically(:lobby_id);
-- Attendu : {"status":"DISSOLVED","lobby_id":"..."}
--
-- SELECT count(*) FROM public.lobbies WHERE id = :lobby_id;              -- 0
-- SELECT count(*) FROM public.lobby_members WHERE lobby_id = :lobby_id;  -- 0
-- SELECT count(*) FROM public.lobby_messages WHERE lobby_id = :lobby_id; -- 0
-- SELECT count(*) FROM public.game_sessions WHERE lobby_id = :lobby_id;  -- 0
-- SELECT count(*) FROM public.lobby_polls WHERE lobby_id = :lobby_id;    -- 0
-- SELECT count(*) FROM public.traitre_private WHERE lobby_id = :lobby_id;-- 0

-- =============================================================================
-- SCÉNARIO 2 — 2e appel même hôte → ALREADY_GONE
-- SELECT public.dissolve_lobby_atomically(:lobby_id);
-- Attendu : {"status":"ALREADY_GONE","lobby_id":"..."}

-- =============================================================================
-- SCÉNARIO 3 — UUID inexistant → ALREADY_GONE
-- SELECT public.dissolve_lobby_atomically('00000000-0000-0000-0000-000000000099');
-- Attendu : ALREADY_GONE

-- =============================================================================
-- SCÉNARIO 4 — non-hôte → NOT_ALLOWED ; données intactes
-- Préparer lobby L4 host=:host_uid, membership guest=:guest_uid
-- Session auth.uid() = :guest_uid :
--   SELECT public.dissolve_lobby_atomically(:lobby_id_l4);
-- Attendu : NOT_ALLOWED
-- Vérif : lobby + members + sessions toujours présents

-- =============================================================================
-- SCÉNARIO 5 — non authentifié → UNAUTHENTICATED
-- Session sans JWT / role anon sans uid :
--   SELECT public.dissolve_lobby_atomically(:any_uuid);
-- Attendu : UNAUTHENTICATED
-- (ou erreur EXECUTE si anon n’a pas le grant — attendu : pas EXECUTE anon)

-- =============================================================================
-- SCÉNARIO 6 — dissolve ∥ leave membre (manuel concurrent)
-- A host dissolve_lobby_atomically · B member DELETE own lobby_members
-- Attendu : aucune violation ; 0 membership résiduelle ; pas de résurrection

-- =============================================================================
-- Policy historique DELETE (ne pas révoquer en E5)
-- =============================================================================
SELECT polname FROM pg_policy
WHERE polrelid = 'public.lobbies'::regclass AND polname = 'lobbies_delete_host';
-- Attendu : 1 ligne (anciens clients DELETE direct encore possibles)
