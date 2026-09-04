-- FEATURE-PROFILE-01 — Entitlement Profil (palier 6,99 €)
--
-- À coller dans SQL Editor (staging puis prod). Idempotent.
-- Le client (rôle authenticated / anon) NE PEUT PAS passer profile_pack à true.
-- SQL Editor / service_role : oui (pour tes tests, puis webhook IAP).
--
-- Profil inclut Sans pub côté app (`isAdFree()`), mais cette migration
-- n’écrit PAS `ad_free`. Le webhook IAP (FEATURE-PROFILE-02B) posera les deux.
--
-- Test manuel après apply :
--   update public.profiles set profile_pack = true where id = '<ton uuid>';
-- Recharge l’app. Invité = toujours false. Remets false pour revenir au palier gratuit.
--
-- Consigner l’exécution dans docs/DEPLOYMENTS_SQL.md.

alter table public.profiles
  add column if not exists profile_pack boolean not null default false;

comment on column public.profiles.profile_pack is
  'Pack Profil (IAP 6,99 €). Écriture réservée au SQL Editor / service_role, pas au client.';

create or replace function public.profiles_protect_profile_pack()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if coalesce(auth.role(), '') in ('authenticated', 'anon') then
      new.profile_pack := false;
    end if;
    return new;
  end if;

  if coalesce(auth.role(), '') in ('authenticated', 'anon') then
    new.profile_pack := old.profile_pack;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_protect_profile_pack on public.profiles;
create trigger profiles_protect_profile_pack
before insert or update on public.profiles
for each row execute function public.profiles_protect_profile_pack();
