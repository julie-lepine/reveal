-- =============================================================================
-- E4 — Harness staging : preuves SQL concurrentes (NO-GO prod sans résultats)
-- =============================================================================
-- Prérequis projet staging :
--   1. e4-00 préflight → duplicate_user_count = 0
--   2. Appliquer e4-01 puis e4-02
--   3. Deux clients SQL avec JWT distincts OU deux onglets SQL Editor +
--      SET LOCAL request.jwt.claim.sub / role (selon setup) OU script Node
--      scripts/e4StagingConcurrent.mjs (si service_role / users test).
--
-- Remplacer :uid_a / :uid_b par de vrais UUID auth.users de test.
-- Après chaque scénario : coller counts + jsonb résultats dans le rapport QA.
-- =============================================================================

-- ── Contrôle post e4-01 ─────────────────────────────────────────────────────
SELECT
  p.proname,
  pg_get_userbyid(p.proowner) AS owner,
  p.prosecdef AS security_definer,
  p.proconfig AS config,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute,
  has_function_privilege('public', p.oid, 'EXECUTE') AS public_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'create_lobby_atomically';
-- Attendu : security_definer true · search_path public · anon false · authenticated true

SELECT grantee, privilege_type
FROM information_schema.routine_privileges
WHERE routine_schema = 'public' AND routine_name = 'create_lobby_atomically'
ORDER BY grantee;
-- Attendu : pas de ligne PUBLIC/anon EXECUTE ; authenticated + service_role (+ postgres)

-- ── Contrôle post e4-02 ─────────────────────────────────────────────────────
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public' AND indexname = 'lobby_members_one_living_per_user';
-- Attendu : 1 ligne UNIQUE (user_id)

-- =============================================================================
-- SCÉNARIO 1 — create ↔ create (même UID)
-- Session A et B : même auth.uid() = :uid_a
-- Lancer quasi-simultanément :
--   SELECT public.create_lobby_atomically('HostA', '👤', '#A78BFA');
-- Attendu :
--   une réponse status=CREATED, une status=ALREADY_EXISTS (pas 23505 brut)
-- Vérif :
-- =============================================================================
-- SELECT count(*) FROM public.lobbies WHERE host_id = :uid_a;           -- = 1 (après cleanup)
-- SELECT count(*) FROM public.lobby_members WHERE user_id = :uid_a;     -- = 1
-- SELECT status FROM … (noter les deux jsonb)

-- Cleanup session 1 (hôte) :
-- DELETE FROM public.lobbies WHERE host_id = :uid_a;  -- cascade members

-- =============================================================================
-- SCÉNARIO 2a — create gagne, join perd (même UID)
-- A : create_lobby_atomically → CREATED (noter lobby_id_A)
-- B (même uid) : INSERT lobby_members vers un AUTRE lobby :lobby_b (pré-créé
--    par un autre host) → doit 23505 lobby_members_one_living_per_user
-- Vérif : count memberships uid_a = 1 ; lobby_id = lobby_id_A
-- Aucun orphelin create (create déjà commité OK)

-- =============================================================================
-- SCÉNARIO 2b — join gagne, create perd (même UID)
-- Préparer lobby L2 (host autre user) sans membership pour uid_a.
-- Transaction create ralentie (optionnel) OU ordre :
--   1) B INSERT membership uid_a → L2 COMMIT
--   2) A create_lobby_atomically → ALREADY_EXISTS (lock + relecture)
-- Si A a commencé INSERT lobby avant le lock release de B :
--   advisory lock force A à attendre ; puis ALREADY_EXISTS ; rollback implicite
--   si A était après lock et avant insert — pas d’orphelin.
-- Forcer orphelin-check :
--   SELECT l.id FROM lobbies l
--   WHERE l.host_id = :uid_a
--     AND NOT EXISTS (SELECT 1 FROM lobby_members m WHERE m.lobby_id = l.id);
-- Attendu : 0 rows après scénario

-- =============================================================================
-- SCÉNARIO 3 — join ↔ join deux lobbies (même UID)
-- Lobbies L3, L4 pré-créés (hosts autres).
-- Deux sessions uid_a INSERT membership L3 et L4 en parallèle.
-- Attendu : 1 row lobby_members pour uid_a ; une session 23505
--   message contient lobby_members_one_living_per_user

-- =============================================================================
-- SCÉNARIO 4 — deux UID
-- uid_a et uid_b create_lobby_atomically en parallèle → 2 CREATED, 2 members

-- =============================================================================
-- SCÉNARIO 5 — reclaim
-- Préparer :
--   membership X : row id=:mem_x lobby LX, user_id = guest_anon_old (is_anonymous)
--   membership Y : row user_id = :uid_current (déjà membre)
-- En session auth.uid() = :uid_current :
--   SELECT * FROM reclaim_guest_membership(:mem_x, :code_x, :name_x);
-- Attendu : exception métier contenant lobby_members_one_living_per_user
-- Vérif :
--   SELECT user_id FROM lobby_members WHERE id = :mem_x;  -- inchangé (= guest_anon_old)
--   SELECT user_id FROM lobby_members WHERE user_id = :uid_current; -- Y intact
-- Ordre mutations reclaim (e4-02) :
--   1 auth null check
--   2 load X + lobby + code/name checks
--   3 idempotent si déjà owner
--   4 SELECT autre membership pour uid → RAISE (AVANT update)
--   5 is_auth_user_anonymous(old)
--   6 UPDATE user_id
--   7 remap_lobby_user_id
-- Donc aucun UPDATE/DELETE si conflit Y existe.

-- =============================================================================
-- SCÉNARIO 6 — forme erreur PostgREST (via client JS staging)
-- INSERT volontaire 2e membership même uid (après 1 existant) avec supabase-js
-- Coller JSON error : code, message, details, hint, constraint
-- Forme typique PostgREST (souvent SANS constraint) :
-- {
--   "code": "23505",
--   "message": "duplicate key value violates unique constraint \"lobby_members_one_living_per_user\"",
--   "details": "Key (user_id)=(...) already exists.",
--   "hint": null
-- }
