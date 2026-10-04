-- Sondages « prochain jeu » : les 12 jeux enabled de data/games.js.
--
-- La liste en production vient de feature-vibecheck-01-remove-allowlist.sql
-- (Wrong Answer Only, sans Draw it !). lobby-polls.sql avait Draw it !, sans
-- Wrong Answer Only. Cette fonction remplace les deux par le catalogue actuel.
-- Réexécutable. Ne pas réexécuter feature-vibecheck-01 ensuite : il retirerait Draw it !.

create or replace function public.reveal_poll_allowed_game_ids()
returns text[]
language sql
immutable
set search_path = pg_catalog, public
as $$
  -- REVEAL_POLL_GAME_ALLOWLIST_BEGIN
  select array[
    'traitre-prep',
    'consensus-prep',
    'hottake-prep',
    'guesslie',
    'speedvote-prep',
    'clutch-prep',
    'drawit-prep',
    'wronganswer-prep',
    'dilemma-prep',
    'truthmeter-prep',
    'tiernight-select',
    'trivia-prep'
  ]::text[];
  -- REVEAL_POLL_GAME_ALLOWLIST_END
$$;

revoke all on function public.reveal_poll_allowed_game_ids() from public;
grant execute on function public.reveal_poll_allowed_game_ids() to authenticated;
