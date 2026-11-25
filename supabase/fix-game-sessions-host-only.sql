-- Audit badges, classement et stats (tmp/audit-badges-classement-stats.md) n°1.
--
-- Avant : la règle d'ajout de game_sessions vérifiait seulement que la personne
-- était membre du salon et s'inscrivait elle-même comme hôte de la ligne
-- (host_id = auth.uid()), sans vérifier qu'elle était l'hôte du salon. Entre deux
-- parties, l'appli supprime la ligne (endGameSession) : un invité pouvait alors la
-- créer, y écrire points et stats (scores, playerStats) à sa guise, puis continuer
-- à la modifier (la règle de modification ne regardait que host_id de la ligne).
-- Les téléphones fusionnent les points au maximum : les valeurs gonflées restaient
-- jusqu'à la fin du salon.
--
-- Après : ajout, modification et suppression directs exigent à la fois
--   - d'être l'hôte du salon (public.is_lobby_host, qui lit lobbies.host_id) ;
--   - d'être l'hôte de la ligne (auth.uid() = host_id), comme avant.
-- Lecture inchangée (membres du salon). Les fonctions serveur (remplaçant de l'hôte,
-- transfert, reprise de l'hôte absent, fin de Draw It…) sont SECURITY DEFINER et ne
-- passent pas par ces règles : inchangées.
-- transfer_lobby_host, claim_lobby_host_if_stale et
-- upsert_game_session_preserving_roster_topics remettent déjà host_id de la ligne
-- sur le nouvel hôte du salon : l'hôte légitime garde donc tous ses droits.
--
-- Idempotent. Consigner dans docs/DEPLOYMENTS_SQL.md (fiche 59).
--
-- ROLLBACK (règles d'avant) :
-- drop policy if exists "game_sessions_insert" on public.game_sessions;
-- create policy "game_sessions_insert" on public.game_sessions
--   for insert with check (public.is_lobby_member(lobby_id) and auth.uid() = host_id);
-- drop policy if exists "game_sessions_update" on public.game_sessions;
-- create policy "game_sessions_update" on public.game_sessions
--   for update using (auth.uid() = host_id) with check (auth.uid() = host_id);
-- drop policy if exists "game_sessions_delete" on public.game_sessions;
-- create policy "game_sessions_delete" on public.game_sessions
--   for delete using (auth.uid() = host_id);

drop policy if exists "game_sessions_insert" on public.game_sessions;
create policy "game_sessions_insert" on public.game_sessions
  for insert
  with check (public.is_lobby_host(lobby_id) and auth.uid() = host_id);

drop policy if exists "game_sessions_update" on public.game_sessions;
create policy "game_sessions_update" on public.game_sessions
  for update
  using (public.is_lobby_host(lobby_id) and auth.uid() = host_id)
  with check (public.is_lobby_host(lobby_id) and auth.uid() = host_id);

drop policy if exists "game_sessions_delete" on public.game_sessions;
create policy "game_sessions_delete" on public.game_sessions
  for delete
  using (public.is_lobby_host(lobby_id) and auth.uid() = host_id);
