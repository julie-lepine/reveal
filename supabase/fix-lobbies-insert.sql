-- Corrige : "new row violates row-level security policy for table lobbies"
-- L'hôte doit pouvoir lire le lobby juste après l'insert (avant lobby_members).

drop policy if exists "lobbies_select_host" on public.lobbies;
create policy "lobbies_select_host" on public.lobbies
for select using (auth.uid() = host_id);
