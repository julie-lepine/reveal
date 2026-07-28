-- =============================================================================
-- Membership Vague E4 — Tests SQL manuels / intégration (à exécuter en staging)
-- Ne remplace PAS une preuve de concurrence automatisée ; documente les scénarios.
-- Prérequis : e4-01 + e4-02 appliqués ; deux sessions JWT même / distincts users.
-- =============================================================================

-- 5. Membership déjà existante → ALREADY_EXISTS (même session)
--    SELECT public.create_lobby_atomically('Host', '👤', '#A78BFA');
--    -- 2e appel (même auth) → status ALREADY_EXISTS, même lobby_id

-- 6. Rollback si INSERT member échoue :
--    (simuler via contrainte — difficile sans hook ; vérifier qu’une exception
--     après INSERT lobby dans la même fonction annule le lobby : tester en
--     forçant une erreur display_name NOT NULL avec NULL si jamais accepté)

-- 8. Doublons : e4-02 DO block RAISE si HAVING count > 1

-- 9. Non authentifié :
--    SET LOCAL role = anon; -- sans JWT
--    SELECT create_lobby_atomically(...); → Non authentifié

-- Concurrence create↔ create / create ↔ join : deux connexions psql
-- avec SET request.jwt.claim.sub = '<uid>' ou clients Supabase parallèles.
-- Attendu create↔ create : 1 lobby, 1 member, perdant ALREADY_EXISTS.
-- Attendu create ↔ join : 1 member final ; pas d’orphelin create (txn).
