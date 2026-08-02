-- OPS-LOBBY-04 — Runbook lecture seule + validation purge (SQL Editor, rôle postgres / service)
-- Ne pas exécuter les étapes destructives (E) sur Production sans staging d'abord.
--
-- ============================================================================iques :
--   A–D : lecture seule (safe)
--   E   : staging — lobby de test volontairement stale
--   F   : contrôle négatif (lobby actif intact)

-- =============================================================================
-- A. Le job existe ?
-- =============================================================================
-- ATTENDU après activation : 1 ligne jobname = 'reveal-purge-stale-lobbies'

select jobid, jobname, schedule, command, nodename, nodeport, database, username, active
from cron.job
where jobname = 'reveal-purge-stale-lobbies';

-- Si ERROR: relation "cron.job" does not exist → extension pg_cron absente.

select extname, extversion
from pg_extension
where extname = 'pg_cron';

-- =============================================================================
-- B. Le job est actif ?
-- =============================================================================
-- ATTENDU : active = true

select jobname, active, schedule, command
from cron.job
where jobname = 'reveal-purge-stale-lobbies';

-- =============================================================================
-- C. Fréquence correcte ?
-- =============================================================================
-- ATTENDU : schedule = '*/15 * * * *' (toutes les 15 min)

select jobname, schedule
from cron.job
where jobname = 'reveal-purge-stale-lobbies';

-- =============================================================================
-- D. Commande exacte ?
-- =============================================================================
-- ATTENDU : command contient purge_stale_lobbies (idéalement
--   select public.purge_stale_lobbies(); )

select jobname, command
from cron.job
where jobname = 'reveal-purge-stale-lobbies';

-- Historique récent (si job actif depuis un moment)
select jobid, runid, job_pid, status, return_message, start_time, end_time
from cron.job_run_details
where jobid = (select jobid from cron.job where jobname = 'reveal-purge-stale-lobbies' limit 1)
order by start_time desc
limit 20;

-- Fonction présente + non exécutable par authenticated
select
  p.proname,
  n.nspname,
  pg_get_function_identity_arguments(p.oid) as args,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_can_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'purge_stale_lobbies';
-- ATTENDU : auth_can_execute = false

-- =============================================================================
-- E. Lobby stale → purge (STAGING UNIQUEMENT)
-- =============================================================================
-- Prérequis manuel app :
--   1. Créer un lobby waiting de test (code noté).
--   2. Option A (rapide) : vieillir last_activity_at + last_seen_at en SQL (ci-dessous).
--      Option B (lente) : laisser 2 h / 45 min sans activité réelle.
--   3. Noter lobby_id.
--
-- E1 — Forcer un waiting « 2 h inactive » (staging) :
-- update public.lobbies
-- set last_activity_at = now() - interval '3 hours'
-- where id = '<lobby_id>'::uuid;
-- -- Note : un UPDATE lobbies recalcule last_activity_at = now() via trigger
-- -- set_lobbies_timestamps. Pour forcer le stale, désactiver temporairement
-- -- le trigger OU mettre à jour via session_replication_role / bypass :
--
-- alter table public.lobbies disable trigger lobbies_updated_at;
-- update public.lobbies
-- set last_activity_at = now() - interval '3 hours',
--     updated_at = now() - interval '3 hours'
-- where id = '<lobby_id>'::uuid;
-- alter table public.lobbies enable trigger lobbies_updated_at;
--
-- E2 — Dry-run : lister ce que purge supprimerait (même prédicat)
-- select l.id, l.code, l.status, l.last_activity_at
-- from public.lobbies l
-- where
--   not exists (select 1 from public.lobby_members m where m.lobby_id = l.id)
--   or (l.status = 'waiting' and coalesce(l.last_activity_at, l.updated_at, l.created_at) < now() - interval '2 hours')
--   or (l.status = 'playing' and coalesce(l.last_activity_at, l.updated_at, l.created_at) < now() - interval '12 hours')
--   or (
--     l.status = 'waiting'
--     and exists (select 1 from public.lobby_members m where m.lobby_id = l.id)
--     and not exists (
--       select 1 from public.lobby_members m
--       where m.lobby_id = l.id
--         and coalesce(m.last_seen_at, m.joined_at) > now() - interval '45 minutes'
--     )
--   );
--
-- E3 — Purge manuelle
-- select public.purge_stale_lobbies();
--
-- E4 — Vérifier disparition
-- select * from public.lobbies where id = '<lobby_id>'::uuid;
-- -- ATTENDU : 0 ligne
-- select * from public.lobby_members where lobby_id = '<lobby_id>'::uuid;
-- -- ATTENDU : 0 (cascade)
-- select * from public.game_sessions where lobby_id = '<lobby_id>'::uuid;
-- -- ATTENDU : 0 (cascade)
--
-- E5 — App : invités doivent recevoir DELETE Realtime / dissolution ; pas d'erreur JS.

-- =============================================================================
-- F. Lobby actif jamais supprimé
-- =============================================================================
-- Créer / utiliser un lobby waiting frais avec heartbeat récent.
-- select public.purge_stale_lobbies();
-- select id, code, status from public.lobbies where id = '<active_lobby_id>'::uuid;
-- ATTENDU : toujours présent

-- Monitoring
-- select * from public.lobby_lifecycle_audit limit 30;
