-- OPS-LOBBY-04 — Activation idempotente du job pg_cron (purge lobbies)
-- Exécuter dans le SQL Editor en tant que rôle capable de gérer pg_cron (souvent postgres).
-- Prérequis : migration lobby-lifecycle.sql déjà appliquée (fonction purge_stale_lobbies présente).
--
-- Ce fichier n'active PAS l'extension si absente : vérifier d'abord via le runbook
-- (select * from pg_extension where extname = 'pg_cron').
-- Sur Supabase Dashboard : Database → Extensions → activer « pg_cron » si besoin,
-- puis rejouer ce script.

-- ── 0. Garde : extension ────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise exception
      'OPS-LOBBY-04: extension pg_cron absente. Active-la dans Dashboard → Extensions, puis réexécute.';
  end if;
end $$;

-- ── 1. Garde : fonction de purge ────────────────────────────────────────────
do $$
begin
  if to_regprocedure('public.purge_stale_lobbies()') is null then
    raise exception
      'OPS-LOBBY-04: public.purge_stale_lobbies() introuvable. Appliquer supabase/lobby-lifecycle.sql d''abord.';
  end if;
end $$;

-- ── 2. Idempotence : retirer un job homonyme s'il existe ─────────────────────
select cron.unschedule(j.jobid)
from cron.job j
where j.jobname = 'reveal-purge-stale-lobbies';

-- ── 3. Planifier (toutes les 15 min) ────────────────────────────────────────
-- Justification : seuils métier min = 45 min (waiting sans présence) ;
-- 15 min ≈ 3 ticks avant le plus court seuil, sans surcharge.
select cron.schedule(
  'reveal-purge-stale-lobbies',
  '*/15 * * * *',
  $$select public.purge_stale_lobbies();$$
);

-- ── 4. Vérification ─────────────────────────────────────────────────────────
select jobid, jobname, schedule, command, active
from cron.job
where jobname = 'reveal-purge-stale-lobbies';
-- ATTENDU : 1 ligne, active = true, schedule = */15 * * * *,
--           command = select public.purge_stale_lobbies();
