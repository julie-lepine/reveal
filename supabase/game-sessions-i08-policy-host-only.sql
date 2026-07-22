-- REVEAL — I-08 étape 4 : resserrer UPDATE game_sessions (host réel uniquement)
-- Prérequis : game-sessions-i08-arch03.sql appliqué + client RPC déployé + QA OK
--
-- ROLLBACK :
-- drop policy if exists "game_sessions_update" on public.game_sessions;
-- create policy "game_sessions_update" on public.game_sessions
-- for update
-- using (public.is_lobby_member(lobby_id))
-- with check (public.is_lobby_member(lobby_id));

drop policy if exists "game_sessions_update" on public.game_sessions;
create policy "game_sessions_update" on public.game_sessions
for update
using (auth.uid() = host_id)
with check (auth.uid() = host_id);
