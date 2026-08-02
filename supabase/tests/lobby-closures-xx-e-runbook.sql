-- =============================================================================
-- BUG-LOBBY-XX-E — Runbook staging (tombstones lobby_closures)
-- Prérequis : appliquer supabase/lobby-closures-xx-e.sql
--
-- BLOCS A–D : mutations — STAGING UNIQUEMENT (ou BEGIN/ROLLBACK si indiqué).
-- BLOCS E–F lecture + rétention : préférer BEGIN/ROLLBACK quand possible.
-- INTERDIT EN PRODUCTION sans revue Ops (surtout E1 disable trigger, F backdate).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. Catalogue (lecture seule — OK partout)
-- ---------------------------------------------------------------------------
select to_regclass('public.lobby_closures') as lobby_closures_table;
select proname from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and proname in (
    'get_lobby_closure',
    'purge_old_lobby_closures',
    'dissolve_lobby_atomically',
    'purge_stale_lobbies'
  )
order by 1;

select pg_get_functiondef(p.oid)
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'purge_stale_lobbies';
-- ATTENDU : contient lobby_closures + inactive_expired + purge_old_lobby_closures

-- =============================================================================
-- A. Fermeture manuelle (hôte) — STAGING
-- =============================================================================
-- Prérequis : créer un lobby via l'app, noter :
--   :lobby_id  :host_uid
--
-- En tant que JWT hôte (ou via SQL Editor en simulant — préférer RPC app) :
-- select public.dissolve_lobby_atomically(:lobby_id);
--
-- Vérifs :
-- select * from public.lobbies where id = :lobby_id;           -- 0 row
-- select lobby_id, reason, closed_by_uid
-- from public.lobby_closures where lobby_id = :lobby_id;
-- ATTENDU : reason = host_closed, closed_by_uid = :host_uid

-- =============================================================================
-- B. Purge automatique — STAGING
-- =============================================================================
-- Créer lobby waiting, noter :lobby_id
-- Vieillir (bypass trigger — STAGING ONLY) :
--
-- begin;
-- alter table public.lobbies disable trigger lobbies_updated_at;
-- update public.lobbies
-- set last_activity_at = now() - interval '3 hours',
--     updated_at = now() - interval '3 hours'
-- where id = :lobby_id;
-- alter table public.lobbies enable trigger lobbies_updated_at;
-- -- Optionnel : vieillir last_seen pour règle 45 min
-- update public.lobby_members
-- set last_seen_at = now() - interval '2 hours'
-- where lobby_id = :lobby_id;
-- select public.purge_stale_lobbies();
-- select * from public.lobbies where id = :lobby_id;  -- 0
-- select reason, closed_by_uid from public.lobby_closures where lobby_id = :lobby_id;
-- -- ATTENDU : inactive_expired, closed_by_uid is null
-- rollback;  -- si tu veux annuler le test ; sinon COMMIT pour QA app

-- =============================================================================
-- C. Idempotence — STAGING
-- =============================================================================
-- Après A : select public.dissolve_lobby_atomically(:lobby_id);
-- ATTENDU : status ALREADY_GONE ; une seule ligne lobby_closures ; reason inchangée
--
-- Après B : select public.purge_stale_lobbies();
-- ATTENDU : deleted_count >= 0 ; pas de doublon PK ; reason inchangée

-- =============================================================================
-- D. Conflit de raison — STAGING (première raison canonique)
-- =============================================================================
-- begin;
-- -- Simuler tombstone inactive puis tentative host_closed sans lobby :
-- insert into public.lobby_closures (lobby_id, reason, closed_by_uid)
-- values (
--   '00000000-0000-4000-8000-0000000000d1'::uuid,
--   'inactive_expired',
--   null
-- );
-- insert into public.lobby_closures (lobby_id, reason, closed_by_uid)
-- values (
--   '00000000-0000-4000-8000-0000000000d1'::uuid,
--   'host_closed',
--   '00000000-0000-4000-8000-0000000000aa'::uuid
-- );
-- -- ATTENDU : 2e INSERT échoue en silence (ON CONFLICT DO NOTHING) ou 0 row
-- select reason, closed_by_uid from public.lobby_closures
-- where lobby_id = '00000000-0000-4000-8000-0000000000d1'::uuid;
-- -- ATTENDU : inactive_expired, closed_by_uid null
-- rollback;

-- =============================================================================
-- E. RPC lecture — préférer rôle authenticated
-- =============================================================================
-- select public.get_lobby_closure(:lobby_id);
-- ATTENDU found=true + reason
--
-- select public.get_lobby_closure('00000000-0000-4000-8000-0000000000ee'::uuid);
-- ATTENDU found=false
--
-- select public.get_lobby_closure(null);
-- ATTENDU found=false
--
-- Grants :
-- select has_table_privilege('authenticated', 'public.lobby_closures', 'select');
-- ATTENDU : false (accès via RPC seulement)
-- select has_function_privilege('authenticated', 'public.get_lobby_closure(uuid)', 'execute');
-- ATTENDU : true

-- =============================================================================
-- F. Rétention 14 j — STAGING ONLY
-- =============================================================================
-- begin;
-- insert into public.lobby_closures (lobby_id, reason, closed_at, closed_by_uid)
-- values (
--   '00000000-0000-4000-8000-0000000000f1'::uuid,
--   'inactive_expired',
--   now() - interval '15 days',
--   null
-- );
-- insert into public.lobby_closures (lobby_id, reason, closed_at, closed_by_uid)
-- values (
--   '00000000-0000-4000-8000-0000000000f2'::uuid,
--   'inactive_expired',
--   now() - interval '2 days',
--   null
-- );
-- select public.purge_old_lobby_closures();
-- select lobby_id from public.lobby_closures
-- where lobby_id in (
--   '00000000-0000-4000-8000-0000000000f1'::uuid,
--   '00000000-0000-4000-8000-0000000000f2'::uuid
-- );
-- -- ATTENDU : seul f2 reste
-- rollback;
