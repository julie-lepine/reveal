-- FEATURE-ADFREE-01 — Entitlement Sans pub (palier 2,99 €)
--
-- À coller dans SQL Editor (staging puis prod). Idempotent.
-- Le client (rôle authenticated / anon) NE PEUT PAS passer ad_free à true.
-- SQL Editor / service_role : oui (pour tes tests, puis webhook IAP).
--
-- Test manuel après apply :
--   update public.profiles set ad_free = true where id = '<ton uuid>';
-- Recharge l’app (ou « Actualiser le statut » dans Menu → Support).
-- Sur APK : plus de bannière. Remets false pour vérifier qu’elle revient.
--
-- Consigner l’exécution dans docs/DEPLOYMENTS_SQL.md.

alter table public.profiles
  add column if not exists ad_free boolean not null default false;

comment on column public.profiles.ad_free is
  'Sans pub (IAP). Écriture réservée au SQL Editor / service_role, pas au client.';

create or replace function public.profiles_protect_ad_free()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if coalesce(auth.role(), '') in ('authenticated', 'anon') then
      new.ad_free := false;
    end if;
    return new;
  end if;

  if coalesce(auth.role(), '') in ('authenticated', 'anon') then
    new.ad_free := old.ad_free;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_protect_ad_free on public.profiles;
create trigger profiles_protect_ad_free
before insert or update on public.profiles
for each row execute function public.profiles_protect_ad_free();
