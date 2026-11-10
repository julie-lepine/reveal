-- =============================================================================
-- Durcissement création de lobby — étape 2 : fermer l'INSERT direct sur lobbies
--
-- NE PAS LANCER avant :
--   1) le build avec APP_COMPATIBILITY_BUILD = 2 est disponible sur l'App Store ET le Play Store ;
--   2) le floor est relevé :
--        update public.app_client_compatibility
--           set min_client_compatibility_build = 2, updated_at = now(),
--               note = 'Build 2 : création de lobby uniquement via RPC'
--         where id = 1;
--   3) un délai raisonnable s'est écoulé (les anciens builds sans le gate ARCH-23
--      qui insèrent directement dans lobbies seront refusés).
--
-- Après cette étape, la création de lobby passe uniquement par
-- create_lobby_atomically (SECURITY DEFINER : non concernée par la révocation).
-- =============================================================================

drop policy if exists "lobbies_insert_host" on public.lobbies;
revoke insert on table public.lobbies from anon, authenticated;

-- Vérifications
-- select policyname from pg_policies where schemaname='public' and tablename='lobbies';
--   -> plus de lobbies_insert_host
-- select privilege_type from information_schema.role_table_grants
--   where table_schema='public' and table_name='lobbies'
--     and grantee in ('anon','authenticated') and privilege_type='INSERT';
--   -> 0 ligne

-- ROLLBACK
-- grant insert on table public.lobbies to anon, authenticated;
-- create policy "lobbies_insert_host" on public.lobbies
--   for insert with check (auth.uid() = host_id);
