-- FEATURE-FRIENDS-04 hotfix — dissolve CASCADE + schema PostgREST
-- Idempotent. Coller dans le SQL Editor (même projet live).
--
-- 1) BEFORE DELETE : à la fermeture hôte (DELETE lobby → CASCADE members),
--    les co-membres sont encore visibles. AFTER DELETE les voyait trop tard.
-- 2) NOTIFY : la RPC list_recent_lobby_peers devient visible tout de suite.

drop trigger if exists lobby_encounters_on_member_del on public.lobby_members;
create trigger lobby_encounters_on_member_del
before delete on public.lobby_members
for each row execute function public.lobby_encounters_on_member();

notify pgrst, 'reload schema';
