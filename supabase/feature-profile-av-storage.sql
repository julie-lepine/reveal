-- FEATURE-PROFILE-AV-STORAGE — écriture bucket avatars : owner + Signature effective
--
-- Ticket AV-STORAGE (P2). Idempotent. Ne PAS réexécuter feature-profile-05-avatar.sql
-- après ce patch (05 recréerait les policies owner-only).
--
-- Prérequis :
--   feature-profile-05-avatar.sql (bucket avatars + policies nommées)
--   feature-host-01-profile-flag.sql (colonne host_pack)
--
-- Ne touche pas : bucket public, policy SELECT "avatars public read",
-- triggers profiles_signature_avatar / ID-OLD, webhook, client.
-- Hors scope : AV-REPLACE (ordre remove→upload), orphelins à la suppression de compte.
--
-- À coller dans SQL Editor (prod). Consigner dans docs/DEPLOYMENTS_SQL.md §32.

do $$
begin
  if to_regclass('storage.objects') is null then
    raise exception 'AVSTORAGE_STORAGE_OBJECTS_MISSING';
  end if;
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'host_pack'
  ) then
    raise exception 'AVSTORAGE_HOST_PACK_MISSING';
  end if;
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'profile_pack'
  ) then
    raise exception 'AVSTORAGE_PROFILE_PACK_MISSING';
  end if;
end $$;

-- Lecture pack via auth.uid() uniquement : pas d’argument uid, pas d’écriture profiles.
-- security definer : ne dépend pas de profiles_select (using true aujourd’hui, peut se resserrer).
-- Ne permet pas de s’octroyer profile_pack / host_pack (triggers protect_* inchangés).
create or replace function public.can_write_own_avatar()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  -- av-storage-v1
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and (
        coalesce(p.profile_pack, false)
        or coalesce(p.host_pack, false)
      )
  );
$$;

revoke all on function public.can_write_own_avatar() from public;
revoke all on function public.can_write_own_avatar() from anon;
grant execute on function public.can_write_own_avatar() to authenticated;

drop policy if exists "avatars owner insert" on storage.objects;
create policy "avatars owner insert"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'avatars'
  and name = auth.uid()::text || '/avatar.jpg'
  and public.can_write_own_avatar()
);

drop policy if exists "avatars owner update" on storage.objects;
create policy "avatars owner update"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'avatars'
  and name = auth.uid()::text || '/avatar.jpg'
  and public.can_write_own_avatar()
)
with check (
  bucket_id = 'avatars'
  and name = auth.uid()::text || '/avatar.jpg'
  and public.can_write_own_avatar()
);

drop policy if exists "avatars owner delete" on storage.objects;
create policy "avatars owner delete"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'avatars'
  and name = auth.uid()::text || '/avatar.jpg'
  and public.can_write_own_avatar()
);

notify pgrst, 'reload schema';
