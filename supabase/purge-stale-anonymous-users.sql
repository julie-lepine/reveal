-- Audit compte et profil n°8 (2026-11-24) — comptes invités jamais supprimés.
--
-- La politique dit que les données du mode invité expirent toutes seules, mais
-- rien ne supprimait les comptes invités (472 au 2026-11-24, dont 427 inactifs
-- depuis plus de 30 jours). Chaque nuit : suppression des comptes invités
-- (`is_anonymous`) sans aucune activité depuis 30 jours. Le reste (profil, votes,
-- messages…) part en cascade.
--
-- « Activité » = la plus récente de : connexion, mise à jour du compte, session
-- renouvelée, jeton renouvelé. La date de connexion seule ne suffit pas : un invité
-- qui garde l'appli renouvelle sa session sans se reconnecter (3 cas au 2026-11-24).
-- Un invité encore membre d'un salon n'est jamais supprimé.
-- Par lots (500 par appel) pour ne pas bloquer la base longtemps.

create or replace function public.purge_stale_anonymous_users(p_limit int default 500)
returns int
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  -- purge-anon-v1
  v_n int;
begin
  with stale as (
    select u.id
    from auth.users u
    where u.is_anonymous is true
      and greatest(
            u.created_at,
            u.last_sign_in_at,
            u.updated_at,
            (select max(greatest(s.refreshed_at, s.updated_at)) from auth.sessions s where s.user_id = u.id),
            (select max(r.updated_at) from auth.refresh_tokens r where r.user_id = u.id::text)
          ) < now() - interval '30 days'
      and not exists (select 1 from public.lobby_members m where m.user_id = u.id)
    order by u.created_at
    limit greatest(coalesce(p_limit, 500), 1)
  )
  delete from auth.users u
  using stale
  where u.id = stale.id
    and u.is_anonymous is true;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.purge_stale_anonymous_users(int) from public, anon, authenticated;

-- Tâche planifiée : chaque nuit à 04:45 UTC (après reveal-warehouse-purge à 04:15).
select cron.unschedule(jobid) from cron.job where jobname = 'reveal-purge-stale-anonymous-users';
select cron.schedule(
  'reveal-purge-stale-anonymous-users',
  '45 4 * * *',
  $cron$select public.purge_stale_anonymous_users();$cron$
);
