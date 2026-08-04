-- =============================================================================
-- FEATURE-TIERNIGHT-SERIES-03A — Smoke runbook EXÉCUTABLE (staging isolé)
-- =============================================================================
-- NE PAS coller ce fichier entier d'un coup.
-- Prérequis : SERIES-03 puis SERIES-03A appliqués.
--
-- IMPORTANT AUTH :
--   Le SQL Editor Supabase N'A PAS automatiquement auth.uid() = hôte.
--   Méthodes supportées (choisir UNE) :
--
--   MÉTHODE R (recommandée) — client JS :
--     node scripts/tiernight-series-03a-smoke.mjs
--     (JWT réel hôte via email/password ou service + signIn)
--
--   MÉTHODE S — simulation JWT en staging UNIQUEMENT (session SQL) :
--     select set_config(
--       'request.jwt.claims',
--       json_build_object('sub', '<HOST_UUID>', 'role', 'authenticated')::text,
--       true
--     );
--     select auth.uid();  -- doit retourner <HOST_UUID>
--
-- Convention projet : lobbies de test préfixés TNS03A* ; ROLLBACK ou delete en fin.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- SECTION 0 — LECTURE SEULE (aucune mutation) — OK sans JWT
-- -----------------------------------------------------------------------------

-- 0.1 RPC installée
select p.proname, p.prosecdef,
       pg_get_function_identity_arguments(p.oid) as args
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'finalize_tiernight_series_round';

-- 0.2 ACL exactes
select grantee, privilege_type
from information_schema.routine_privileges
where routine_schema = 'public'
  and routine_name = 'finalize_tiernight_series_round';
-- Attendu : authenticated EXECUTE ; PAS anon

select
  has_function_privilege('anon', 'public.finalize_tiernight_series_round(uuid,text,text,integer,text,boolean)', 'EXECUTE') as anon_ok,
  has_function_privilege('authenticated', 'public.finalize_tiernight_series_round(uuid,text,text,integer,text,boolean)', 'EXECUTE') as auth_ok;
-- Attendu : anon_ok=false, auth_ok=true

-- 0.3 Golden helpers (fichier dédié)
-- \i feature-tiernight-series-03a-golden-helpers.sql

-- -----------------------------------------------------------------------------
-- SECTION 1 — SETUP MUTANT (MÉTHODE S) — isolé + ROLLBACK recommandé
-- Remplacer :HOST_UID / :GUEST_UID par des UUID membership réels du projet staging.
-- Ne jamais cibler un lobby prod.
-- -----------------------------------------------------------------------------

-- BEGIN;  -- décommenter pour transaction jetable

-- select set_config('request.jwt.claims',
--   json_build_object('sub', ':HOST_UID', 'role', 'authenticated')::text, true);

-- Exemple de construction (adapter aux colonnes réelles lobbies / members) :
-- DO $$
-- DECLARE
--   v_host uuid := auth.uid();
--   v_guest uuid := ':GUEST_UID'::uuid;
--   v_lobby uuid := gen_random_uuid();
--   v_run text := 'tns03a-' || substr(replace(gen_random_uuid()::text,'-',''),1,8);
--   v_items jsonb := '["alpha","beta","gamma"]'::jsonb;
--   v_place_full jsonb := '{"S":["alpha"],"A":["beta"],"B":["gamma"],"C":[],"D":[]}'::jsonb;
-- BEGIN
--   IF v_host IS NULL THEN RAISE EXCEPTION 'auth.uid() null — méthode S requise'; END IF;
--   -- INSERT lobby + members + game_sessions série valide (roundCount=3, queue déterministe)
--   -- SNAPSHOT avant : raise notice '%', (select state from game_sessions where lobby_id=v_lobby);
--   RAISE NOTICE 'lobby=% run=%', v_lobby, v_run;
-- END $$;

-- -----------------------------------------------------------------------------
-- SECTION 2 — MUTATIONS RPC (même session JWT hôte)
-- -----------------------------------------------------------------------------

-- 2.1 Première finalisation manche 0
-- select public.finalize_tiernight_series_round(v_lobby, v_run, v_run||':0', 0, 'ranking', false);
-- Assert : applied=true, phase=between_rounds, scoredRoundIds, scores UID, tierNightsPlayed inchangé

-- 2.2 Retry exact
-- select public.finalize_tiernight_series_round(v_lobby, v_run, v_run||':0', 0, 'ranking', false);
-- Assert : applied=false, ALREADY_APPLIED (même si phase=between_rounds)

-- 2.3 Retry stale index / round
-- select public.finalize_tiernight_series_round(v_lobby, v_run, v_run||':0', 1, 'ranking', false);
-- Assert : TNS_ROUND_ID_MISMATCH ou TNS_STALE_* — aucune mutation

-- 2.4 Force : finished étranger seul → TNS_FORCE_NO_FINISHED
-- Force : finished valide + placement incomplet → TNS_PLACEMENT_MISSING_ITEM
-- Force : roster finished valides → applied, non-finished exclus

-- 2.5 Dernière manche → series_end + tierNightsPlayed +1 + eveningGamesRecorded.tiernight
-- Retry → ALREADY_APPLIED sans ré-incrément

-- 2.6 Concurrence : deux sessions SQL MÉTHODE S avec même claims, même round
--     → un applied=true, un ALREADY_APPLIED

-- -----------------------------------------------------------------------------
-- SECTION 3 — NETTOYAGE
-- -----------------------------------------------------------------------------
-- ROLLBACK;  -- si BEGIN utilisé
-- ou DELETE game_sessions / lobby_members / lobbies where code like 'TNS03A%';

-- -----------------------------------------------------------------------------
-- SECTION 4 — INTERDITS
-- -----------------------------------------------------------------------------
-- Ne pas exécuter sur lobby réel / soirée en cours.
-- Ne pas utiliser service_role pour « tricher » le smoke métier hôte
--   (sauf setup admin explicitement séparé).
