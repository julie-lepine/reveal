-- Audit compte et profil n°11 (2026-11-24) — id d'un compte supprimé gardé dans le carnet des autres.
--
-- `signature_evenings.peer_user_ids` garde les ids des joueurs croisés dans une
-- soirée. Un tableau n'a pas de clé étrangère : à la suppression d'un compte, son
-- id restait dans le carnet des autres (jamais affiché, mais gardé). Désormais
-- retiré dès que le compte est supprimé, quelle que soit la voie (appli,
-- nettoyage des invités, tableau de bord).

create or replace function public.signature_evenings_forget_deleted_user()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  -- carnet-forget-v1
  update public.signature_evenings
  set peer_user_ids = array_remove(peer_user_ids, old.id)
  where old.id = any (peer_user_ids);
  return old;
end;
$$;

revoke all on function public.signature_evenings_forget_deleted_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_deleted_forget_carnet_peer on auth.users;
create trigger on_auth_user_deleted_forget_carnet_peer
after delete on auth.users
for each row execute function public.signature_evenings_forget_deleted_user();

-- Rattrapage unique : ids de comptes déjà supprimés (aucun au 2026-11-24).
update public.signature_evenings e
set peer_user_ids = array(
  select p from unnest(e.peer_user_ids) as p
  where exists (select 1 from auth.users u where u.id = p)
)
where exists (
  select 1 from unnest(e.peer_user_ids) as p
  where not exists (select 1 from auth.users u where u.id = p)
);
