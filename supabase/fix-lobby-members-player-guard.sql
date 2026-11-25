-- Audit sécurité Supabase d'ensemble (tmp/audit-securite-supabase.md) n°4.
--
-- Avant : les règles members_insert_self / members_update_self laissaient un joueur
-- écrire toutes les colonnes de sa propre ligne de lobby_members, en appelant la base
-- directement (clé publique + sa session) :
--   - is_host = true : le serveur n'était pas trompé (il lit lobbies.host_id), mais les
--     téléphones des autres si (l'appli prend « le premier joueur marqué hôte ») ;
--   - lobby_id changé : passage dans un autre salon sans code et sans plafond de places
--     (le plafond n'est vérifié qu'à l'arrivée) ;
--   - pseudo, emoji, couleur de longueur illimitée, renvoyés à tout le salon.
--
-- Après : un garde avant écriture.
--   - Écriture directe d'un joueur (current_user = authenticated / anon, c.-à-d. une
--     requête de l'appli, pas une fonction serveur) :
--       arrivée : is_host forcé à false (l'appli envoie déjà false ; la ligne de l'hôte
--                 est créée par create_lobby_atomically) ;
--       modification : id, lobby_id, user_id, is_host, joined_at gardent leur valeur
--                 d'avant (l'appli n'écrit que last_seen_at, ready, display_name, emoji).
--   - Toujours (joueur ou fonction serveur) : pseudo coupé à 24 caractères (comme
--     l'appli), emoji et couleur à 16.
--   Les fonctions serveur (transfert d'hôte, reprise de place, création de salon)
--   tournent avec les droits de leur propriétaire : current_user n'est alors pas
--   authenticated / anon, et elles gardent la main sur ces colonnes.
--
-- Le garde est volontairement SECURITY INVOKER : c'est ce qui permet de lire, dans
-- current_user, qui a lancé l'écriture.

create or replace function public.lobby_members_guard_player_write()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      new.is_host := false;
    else
      new.id := old.id;
      new.lobby_id := old.lobby_id;
      new.user_id := old.user_id;
      new.is_host := old.is_host;
      new.joined_at := old.joined_at;
    end if;
  end if;

  if new.display_name is not null and char_length(new.display_name) > 24 then
    new.display_name := left(new.display_name, 24);
  end if;
  if new.emoji is not null and char_length(new.emoji) > 16 then
    new.emoji := left(new.emoji, 16);
  end if;
  if new.color is not null and char_length(new.color) > 16 then
    new.color := left(new.color, 16);
  end if;

  return new;
end;
$function$;

comment on function public.lobby_members_guard_player_write() is
  'Audit sécurité Supabase n°4 (2026-11-25) : un joueur ne change ni son salon, ni son '
  'identifiant, ni is_host, ni joined_at ; pseudo 24, emoji et couleur 16.';

revoke all on function public.lobby_members_guard_player_write() from public, anon, authenticated;

-- Nom choisi pour passer après lobby_members_enforce_seat_cap et avant
-- lobby_members_stamp_signature (ordre alphabétique des déclencheurs BEFORE).
drop trigger if exists lobby_members_guard_player_write on public.lobby_members;
create trigger lobby_members_guard_player_write
  before insert or update on public.lobby_members
  for each row execute function public.lobby_members_guard_player_write();

-- Contrôle après application :
-- select tgname from pg_trigger
-- where tgrelid = 'public.lobby_members'::regclass and not tgisinternal order by 1;
