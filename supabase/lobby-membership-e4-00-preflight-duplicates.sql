-- =============================================================================
-- Membership Vague E4 — Étape A : préflight doublons (LECTURE SEULE)
-- =============================================================================
-- Ne crée PAS l’index UNIQUE, PAS la RPC atomique, PAS de DELETE.
-- Exécuter dans Supabase → SQL Editor avant toute étape B+ du rollout E4.
--
-- Ordre de rollout retenu (voir commentaire fin de fichier) :
--   A préflight (ce script)
--   B résolution explicite validée (hors ce fichier — pas de purge silencieuse)
--   C dump create_lobby_member prod + RPC create_lobby_atomically
--   D UNIQUE(user_id) — échoue si doublons restants
--   E client → RPC atomique
--   F dépréciation create_lobby_member / ancien INSERT lobby
--
-- Canonicalité = même ordre que js/core/lobbyMembershipQuery.js
--   compareMembershipRowsDeterministic : joined_at DESC, lobby_id ASC
-- =============================================================================

-- ── A1. Users avec plus d’un membership vivant ───────────────────────────────
SELECT
  m.user_id,
  count(*)::integer AS membership_count,
  array_agg(m.lobby_id ORDER BY m.joined_at DESC NULLS LAST, m.lobby_id ASC) AS lobby_ids_joined_at_desc,
  array_agg(m.id ORDER BY m.joined_at DESC NULLS LAST, m.lobby_id ASC) AS membership_ids_canon_order,
  min(m.joined_at) AS oldest_joined_at,
  max(m.joined_at) AS newest_joined_at
FROM public.lobby_members m
GROUP BY m.user_id
HAVING count(*) > 1
ORDER BY membership_count DESC, m.user_id;

-- ── A2. Détail par user (rang 1 = membership canonique client) ───────────────
WITH ranked AS (
  SELECT
    m.user_id,
    m.id AS membership_id,
    m.lobby_id,
    m.joined_at,
    m.is_host,
    m.display_name,
    l.code AS lobby_code,
    l.status AS lobby_status,
    l.host_id,
    row_number() OVER (
      PARTITION BY m.user_id
      ORDER BY m.joined_at DESC NULLS LAST, m.lobby_id ASC
    ) AS canon_rank
  FROM public.lobby_members m
  INNER JOIN public.lobbies l ON l.id = m.lobby_id
)
SELECT
  user_id,
  canon_rank,
  membership_id,
  lobby_id,
  lobby_code,
  lobby_status,
  is_host,
  display_name,
  joined_at,
  (canon_rank = 1) AS is_canonical_for_query
FROM ranked
WHERE user_id IN (
  SELECT user_id
  FROM public.lobby_members
  GROUP BY user_id
  HAVING count(*) > 1
)
ORDER BY user_id, canon_rank;

-- ── A3. Compteur global (0 = OK pour poser l’index à l’étape D) ─────────────
SELECT
  (SELECT count(*)::integer
   FROM (
     SELECT user_id
     FROM public.lobby_members
     GROUP BY user_id
     HAVING count(*) > 1
   ) d) AS duplicate_user_count,
  (SELECT count(*)::integer FROM public.lobby_members) AS total_membership_rows;

-- =============================================================================
-- Introspection obligatoire AVANT étape C (RPC atomique)
-- create_lobby_member est ABSENT du repo — récupérer la définition déployée :
--
--   SELECT pg_get_functiondef(p.oid)
--   FROM pg_proc p
--   JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public'
--     AND p.proname = 'create_lobby_member';
--
--   SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args,
--          p.prosecdef AS security_definer,
--          p.proconfig AS config
--   FROM pg_proc p
--   JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public' AND p.proname = 'create_lobby_member';
--
--   SELECT grantee, privilege_type
--   FROM information_schema.routine_privileges
--   WHERE routine_schema = 'public' AND routine_name = 'create_lobby_member';
-- =============================================================================

-- =============================================================================
-- Rollout E4 (ordre obligatoire)
--
-- A. Audit lecture seule (ce fichier). Risque : aucun.
--
-- B. Résolution EXPLICITE des doublons (procédure humaine / ticket ops) :
--    garder le canonique (rank 1), retirer les extras via leave/dissolve
--    documentés — JAMAIS DELETE silencieux dans une migration.
--    Risque si sauté : CREATE UNIQUE INDEX échoue à D.
--
-- C. Après dump create_lobby_member prod : ajouter create_lobby_atomically
--    (même contrats member utiles) SANS encore basculer le client.
--    Ancien client continue INSERT lobby + create_lobby_member.
--    Risque fenêtre C→E : courses create↔ create encore possibles
--    jusqu’à D+E ; orphelins create encore possibles via ancien chemin.
--
-- D. CREATE UNIQUE INDEX lobby_members_one_living_per_user ON (user_id)
--    Migration DOIT RAISE si préflight A3.duplicate_user_count > 0.
--    Risque : ancien client create peut INSERT lobby puis échouer au member
--    (orphelin lobby) ; join/reclaim frappés par 23505 — client E4 requis
--    pour mapping métier. Donc D et E doivent être proches.
--
-- E. Client bascule vers create_lobby_atomically uniquement.
--    Risque coexistence : ancien client encore en INSERT+create_lobby_member
--    tant que stores / caches non mis à jour — UNIQUE limite à 1 membership
--    mais orphelins lobby possibles. Mitiger : E rapidement après D ;
--    F retire l’ancien chemin côté grants.
--
-- F. Dépréciation : REVOKE execute create_lobby_member (ou wrapper qui
--    raise 'deprecated') pour empêcher INSERT lobby → create_lobby_member
--    d’un ancien client. Sans F, l’atomicité create n’est pas garantie
--    pour les builds obsolètes (seul UNIQUE reste).
--
-- Ne pas poser D avant B. Ne pas faire E avant C. Ne pas faire F avant E
-- (sinon create cassé pour tous). Preferer D+E+F dans la même fenêtre ops.
-- =============================================================================
