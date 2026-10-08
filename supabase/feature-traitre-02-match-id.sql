-- REVEAL — Spot the fake : identité de manche
-- À exécuter dans l'éditeur SQL après traitre-private.sql et
-- feature-traitre-01-advance-play.sql.
-- L'application ne déploie pas ce fichier.

-- Les lignes déjà présentes n'ont pas de match_id. On n'invente pas d'UUID :
-- elles sont retirées, puis la colonne devient obligatoire.
alter table public.traitre_private add column if not exists match_id uuid;

delete from public.traitre_private where match_id is null;

alter table public.traitre_private alter column match_id set not null;

alter table public.traitre_private
  drop constraint if exists traitre_private_lobby_id_user_id_key;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'traitre_private_lobby_match_user_key'
      and conrelid = 'public.traitre_private'::regclass
  ) then
    alter table public.traitre_private
      add constraint traitre_private_lobby_match_user_key
      unique (lobby_id, match_id, user_id);
  end if;
end $$;

create index if not exists traitre_private_lobby_match_idx
  on public.traitre_private (lobby_id, match_id);

-- Horodatage de la ligne au moment de l'écriture, pas au BEGIN.
-- Les lobbies passent par set_lobbies_timestamps : cette fonction ne les concerne pas.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = clock_timestamp();
  return new;
end;
$$;
