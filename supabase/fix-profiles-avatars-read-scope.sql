-- Audit compte et profil n°7 (2026-11-24) — profils et photos lisibles par tout le monde.
--
-- Avant : `profiles_select` = true pour tous (visiteurs sans session compris) et
-- `avatars public read` permettait de lister tout le bucket. Avec la clé publique
-- de l'appli, on aspirait d'un coup tous les pseudos, achats et photos.
--
-- Après :
--   profils : lisibles seulement par un compte connecté (invités compris), et
--   seulement les siens, ceux des joueurs avec qui il partage un salon, et ceux
--   des hôtes d'un salon existant (l'appli lit `host_pack` de l'hôte AVANT de
--   rejoindre, pour annoncer « salon plein » : à garder pour les versions déjà
--   publiées sur les stores). Les fonctions serveur (SECURITY DEFINER) ne changent pas.
--   photos : le bucket reste public (les adresses publiques s'affichent toujours),
--   mais lister ou lire par l'API est réservé à son propre fichier (nécessaire pour
--   remplacer et retirer sa photo).
--   droits : plus aucun droit pour `anon` sur `profiles` ; `authenticated` garde
--   lecture, création, modification (pas d'effacement ni de TRUNCATE).

create or replace function public.can_see_profile(p_target uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  -- profiles-read-scope-v1
  select auth.uid() is not null
    and (
      p_target = auth.uid()
      or exists (
        select 1
        from public.lobby_members me
        join public.lobby_members them on them.lobby_id = me.lobby_id
        where me.user_id = auth.uid()
          and them.user_id = p_target
      )
      or exists (
        select 1 from public.lobbies l where l.host_id = p_target
      )
    );
$$;

revoke all on function public.can_see_profile(uuid) from public, anon;
grant execute on function public.can_see_profile(uuid) to authenticated;

drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select"
on public.profiles
for select
to authenticated
using (public.can_see_profile(id));

revoke all on table public.profiles from anon;
revoke delete, truncate, references, trigger on table public.profiles from authenticated;

drop policy if exists "avatars public read" on storage.objects;
drop policy if exists "avatars owner read" on storage.objects;
create policy "avatars owner read"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'avatars'
  and name = auth.uid()::text || '/avatar.jpg'
);

notify pgrst, 'reload schema';
