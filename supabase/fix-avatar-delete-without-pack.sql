-- Audit compte et profil n°2 (2026-11-24) — effacer sa photo sans Signature.
--
-- « avatars owner delete » exigeait can_write_own_avatar() (Signature ou Maître).
-- Après un remboursement, le joueur ne pouvait plus effacer sa propre photo, qui
-- restait publique. Effacer reste réservé à son propre fichier ; envoyer et
-- remplacer (insert / update) exigent toujours Signature ou Maître.
--
-- Ne pas réexécuter feature-profile-av-storage.sql ensuite (il remettrait l'ancienne règle).

drop policy if exists "avatars owner delete" on storage.objects;
create policy "avatars owner delete"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'avatars'
  and name = auth.uid()::text || '/avatar.jpg'
);

notify pgrst, 'reload schema';
