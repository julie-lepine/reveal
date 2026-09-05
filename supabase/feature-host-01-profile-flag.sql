-- FEATURE-HOST-01 — Entitlement Maître de soirée (palier 9,99 €)
--
-- À coller dans SQL Editor (staging puis prod). Idempotent.
-- Le client (rôle authenticated / anon) NE PEUT PAS passer host_pack à true.
-- SQL Editor / service_role : oui (tests, puis webhook IAP).
--
-- Maître de soirée inclut Signature + Sans pub côté app. Cette migration
-- n’écrit PAS profile_pack / ad_free. Le webhook IAP posera les trois.
--
-- Test manuel après apply :
--   update public.profiles set host_pack = true where id = '<ton uuid>';
-- Recharge l’app. Invité = toujours false. Remets false pour revenir au palier gratuit.
-- Le webhook IAP posera aussi profile_pack et ad_free ; en SQL Editor tu peux les poser à part.
--
-- Consigner l’exécution dans docs/DEPLOYMENTS_SQL.md.

alter table public.profiles
  add column if not exists host_pack boolean not null default false;

comment on column public.profiles.host_pack is
  'Pack Maître de soirée (IAP 9,99 €). Écriture réservée au SQL Editor / service_role, pas au client.';

create or replace function public.profiles_protect_host_pack()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if coalesce(auth.role(), '') in ('authenticated', 'anon') then
      new.host_pack := false;
    end if;
    return new;
  end if;

  if coalesce(auth.role(), '') in ('authenticated', 'anon') then
    new.host_pack := old.host_pack;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_protect_host_pack on public.profiles;
create trigger profiles_protect_host_pack
before insert or update on public.profiles
for each row execute function public.profiles_protect_host_pack();
