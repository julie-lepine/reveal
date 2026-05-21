-- REVEAL — l'hôte peut supprimer son lobby (fermeture pour tous les joueurs)
-- SQL Editor → Run après schema.sql

drop policy if exists "lobbies_delete_host" on public.lobbies;
create policy "lobbies_delete_host" on public.lobbies
  for delete using (auth.uid() = host_id);
