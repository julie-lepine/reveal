-- =============================================================================
-- FEATURE-TIERNIGHT-03-D1 — Runbook SQL canonique (ordre + smokes)
-- =============================================================================
-- NE PAS coller ce fichier entier d’un coup dans Supabase SQL Editor.
-- Les smokes métier utilisent les runbooks / scripts déjà livrés (03A, 05, A1-bis).
-- Ce document fixe l’ORDRE FINAL et les invariants D à vérifier sur la VRAIE base.
--
-- Statut apply : À EXÉCUTER manuellement sur staging avant QA multijoueur.
-- L’agent ne déclare PAS ces smokes verts sans preuve d’exécution réelle.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- A. FONCTIONS FINALES REQUISES (signatures / sécurité / ACL)
-- -----------------------------------------------------------------------------
--
-- 1) public.tiernight_series_validate_series_shape(jsonb, text) → jsonb
--    Définition FINALE = A1-bis (feature-tiernight-03-a1bis-series-shape-strict.sql)
--    IMMUTABLE (pas SECURITY DEFINER)
--    ACL : REVOKE ALL FROM public, anon, authenticated (interne only)
--
-- 2) Helpers directs (définis surtout dans SERIES-03A) — non exposés :
--    tiernight_series_validate_placement
--    tiernight_series_validate_roster
--    tiernight_series_validate_finished
--    tiernight_series_validate_expected_items
--    tiernight_series_is_finished_flag
--    tiernight_series_compute_scores
--    (+ golden helpers 03a si présents)
--    ACL : REVOKE ALL FROM public/anon/authenticated
--
-- 3) public.finalize_tiernight_series_round(
--      p_lobby_id uuid,
--      p_run_id text,
--      p_round_id text,
--      p_round_index integer,
--      p_expected_phase text default 'ranking',
--      p_force boolean default false
--    ) → jsonb
--    Définition FINALE = SERIES-03A hardening
--      (feature-tiernight-series-03a-finalize-round-hardening.sql)
--    SECURITY DEFINER ; search_path = pg_catalog, public
--    ACL : GRANT EXECUTE TO authenticated ; REVOKE FROM public, anon
--
-- 4) public.advance_tiernight_series_round(
--      p_lobby_id uuid,
--      p_run_id text,
--      p_current_round_id text,
--      p_current_round_index integer,
--      p_expected_phase text default 'between_rounds'
--    ) → jsonb
--    Définition FINALE = SERIES-05
--      (feature-tiernight-series-05-advance-round.sql)
--    SECURITY DEFINER ; search_path = pg_catalog, public
--    ACL : GRANT EXECUTE TO authenticated ; REVOKE FROM public, anon
--
-- INTERDICTION : rejouer SERIES-03 / 03A / A1 / contrat 03 APRÈS A1-bis
-- sans ré-appliquer A1-bis ensuite — ces fichiers REPLACE le validateur
-- avec une définition plus ancienne (counts / customs / types JSON).

-- -----------------------------------------------------------------------------
-- B. ORDRE CANONIQUE D’APPLICATION
-- -----------------------------------------------------------------------------
--
-- B1. Greenfield (base vierge) :
--   1. feature-tiernight-series-03-finalize-round.sql          (base RPC finalize)
--   2. feature-tiernight-series-03a-finalize-round-hardening.sql
--   3. feature-tiernight-series-03a-is-finished-flag-null-fix.sql (si applicable)
--   4. feature-tiernight-series-03a-golden-helpers.sql         (smokes)
--   5. feature-tiernight-series-05-advance-round.sql
--   6. feature-tiernight-03-a1-series-shape-total.sql          (optionnel si déjà couvert)
--   7. feature-tiernight-03-a1bis-series-shape-strict.sql      ★ TOUJOURS DERNIER shape
--
-- B2. Base déjà partiellement migrée :
--   - Appliquer uniquement les fichiers manquants dans l’ordre ci-dessus
--   - Terminer TOUJOURS par A1-bis
--   - Vérifier §C (lecture catalogue)
--
-- B3. Base contenant 03A puis 05 puis A1-bis (cas cible D) :
--   - Aucune nouvelle migration additive requise pour D1
--   - Vérifier §C ; exécuter smokes §D–G
--   - Si un rejeu accidentel de 03A a écrasé le shape → ré-appliquer A1-bis seul

-- -----------------------------------------------------------------------------
-- C. LECTURE SEULE — catalogue (OK sans JWT hôte)
-- -----------------------------------------------------------------------------

-- C.1 Signatures finalize / advance / shape
select p.proname,
       pg_get_function_identity_arguments(p.oid) as args,
       p.prosecdef as security_definer,
       p.proconfig as config -- search_path
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'finalize_tiernight_series_round',
    'advance_tiernight_series_round',
    'tiernight_series_validate_series_shape'
  )
order by p.proname;

-- Attendu :
-- finalize : (uuid, text, text, integer, text, boolean) · prosecdef=true
-- advance  : (uuid, text, text, integer, text) · prosecdef=true
-- shape    : (jsonb, text) · prosecdef=false

-- C.2 ACL
select routine_name, grantee, privilege_type
from information_schema.routine_privileges
where routine_schema = 'public'
  and routine_name in (
    'finalize_tiernight_series_round',
    'advance_tiernight_series_round',
    'tiernight_series_validate_series_shape'
  )
order by routine_name, grantee;

-- Attendu finalize/advance : authenticated EXECUTE ; PAS anon
-- Attendu shape : aucun EXECUTE authenticated/anon (interne)

select
  has_function_privilege(
    'anon',
    'public.finalize_tiernight_series_round(uuid,text,text,integer,text,boolean)',
    'EXECUTE'
  ) as finalize_anon,
  has_function_privilege(
    'authenticated',
    'public.finalize_tiernight_series_round(uuid,text,text,integer,text,boolean)',
    'EXECUTE'
  ) as finalize_auth,
  has_function_privilege(
    'anon',
    'public.advance_tiernight_series_round(uuid,text,text,integer,text)',
    'EXECUTE'
  ) as advance_anon,
  has_function_privilege(
    'authenticated',
    'public.advance_tiernight_series_round(uuid,text,text,integer,text)',
    'EXECUTE'
  ) as advance_auth;
-- Attendu : *_anon=false, *_auth=true

-- C.3 Preuve A1-bis encore actif (count 8 + custom string types)
-- via runbook A1-bis S* OU :
-- select public.tiernight_series_validate_series_shape(
--   <série count=8 custom snapshot string id/name>::jsonb, '<runId>'
-- );
-- Attendu ok=true (si helper exécutable en SQL Editor via superuser / owner)

-- -----------------------------------------------------------------------------
-- D. SMOKES FINALIZE (méthode R recommandée)
-- -----------------------------------------------------------------------------
-- Méthode R : node scripts/tiernight-series-03a-smoke.mjs  (JWT hôte réel)
-- Méthode S : set_config request.jwt.claims (staging uniquement) — voir 03A runbook
--
-- Couverture minimale D1 (requête / attendu / invariants) :
--
-- D1 Finalize normal (count 3, ranking, round 0 complet)
--   Appel : finalize(..., p_force=false)
--   Attendu : ok=true, applied=true, phase=between_rounds
--   Invariants :
--     scoredRoundIds contient run:0 UNE fois
--     completedRoundIds contient run:0 UNE fois
--     roundHistory length +1 (une entrée roundId=run:0)
--     scores / gameScores.tiernight incrémentés une fois
--     tierNightsPlayed NON incrémenté (pas dernière)
--
-- D2 Finalize idempotent
--   2e appel identique
--   Attendu : ok=true, applied=false, code=ALREADY_APPLIED
--   Invariants : scores inchangés ; history length inchangée ; ledgers uniques
--
-- D3 Finalize stale
--   mauvais runId     → TNS_STALE_RUN
--   mauvais roundId   → TNS_STALE_ROUND_ID
--   mauvais index     → TNS_STALE_ROUND_INDEX
--   phase between     (sans ledger match) → TNS_INVALID_PHASE
--   (après advance) ancien round → stale / ALREADY selon preuve
--
-- D4 Finalize incomplet (sans force)
--   finished partiel → TNS_PLACEMENTS_INCOMPLETE
--   aucun score / ledger
--
-- D5 Force hôte
--   p_force=true, ≥1 finished+placement valide
--   Attendu : ok ; forced=true ; seuls participants finished scorés
--   0 finished → TNS_FORCE_NO_FINISHED
--
-- D6 Dernière manche → series_end + tierNightsPlayed
--   count 3 index 2 ; count 5 index 4 ; count 8 index 7 ; legacy 7 index 6
--   Attendu : phase=series_end ; screen=tiernight-end
--   stats.tierNightsPlayed +1 ; playerStats[*].tierNightsPlayed +1
--   2e finalize → ALREADY_APPLIED ; stats inchangés
--
-- Checklist détaillée : supabase/feature-tiernight-series-03a-smoke-runbook.sql

-- -----------------------------------------------------------------------------
-- E. SMOKES ADVANCE
-- -----------------------------------------------------------------------------
-- Méthode R : node scripts/tiernight-series-05-smoke.mjs
-- Runbook   : supabase/feature-tiernight-series-05-smoke-runbook.sql
--
-- E1 Advance normal (between_rounds)
--   Attendu : ok, applied=true, phase=ranking, roundIndex = N+1
--   Invariants :
--     queue inchangée (même jsonb)
--     scored/completed/history préservés
--     scores / playerStats / gameScores / eveningGamesRecorded inchangés
--     placements={} ; finished={} ; roundRecap=null
--     topicId = queue[N+1].topicId
--
-- E2 Idempotent / stale
--   double appel → ALREADY_ADVANCED (preuve complète) ou erreur structurée
--   ancien roundId / index → stale
--   phase ranking déjà → ALREADY ou INVALID selon preuve
--   series_end → TNS_SERIES_ENDED
--   dernière manche without next → TNS_NO_NEXT_ROUND
--
-- E3 round_result
--   Si phase=round_result (legacy / corruption) : advance DOIT lever TNS_INVALID_PHASE
--   (SQL : v_phase is distinct from 'between_rounds')

-- -----------------------------------------------------------------------------
-- F. CUSTOMS + COUNT 8
-- -----------------------------------------------------------------------------
-- Prérequis shape A1-bis.
-- Queue avec snapshot custom (id/name strings, custom=true, topicId custom:…)
-- Finalize + advance acceptés ; aucune dépendance catalogue localStorage.
-- Smokes shape : feature-tiernight-03-a1bis-series-shape-strict-runbook.sql

-- -----------------------------------------------------------------------------
-- G. PREUVE « D PRÊTE POUR QA MULTI » — case à cocher staging
-- -----------------------------------------------------------------------------
-- [ ] §C catalogue OK (signatures + ACL + A1-bis actif)
-- [ ] §D finalize normal + idempotent + stale + incomplet + force
-- [ ] §D dernière manche 3/5/8 + legacy 7 ; tierNightsPlayed ×1
-- [ ] §E advance normal + idempotent + series_end refuse + round_result refuse
-- [ ] §F custom + count 8
-- [ ] Scripts 03a-smoke.mjs + 05-smoke.mjs exit 0
--
-- Tant que non coché : QA terrain / gate ON INTERDITS.
