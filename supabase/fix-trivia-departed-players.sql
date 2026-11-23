-- =============================================================================
-- AUDIT Trivia n°1 — joueur qui quitte le salon en pleine question
-- =============================================================================
-- Problème : la liste des joueurs attendus est figée au début de chaque question
-- (`questionPlayerUids`). La révélation automatique (submit_trivia_answer →
-- trivia_all_expected_players_answered) attendait aussi les joueurs partis du
-- salon : elle n'arrivait jamais, et les invités voyaient « Tout le monde a
-- répondu. Révélation en cours… » sans fin.
--
-- Correctif : trivia_all_expected_players_answered ne compte que les joueurs
-- attendus encore membres du salon (lobby_members). Un joueur qui a seulement
-- perdu le réseau reste membre, donc toujours attendu. S'il ne reste aucun
-- joueur attendu, pas de révélation automatique (l'hôte garde « Révéler maintenant »).
--
-- Seul appelant : submit_trivia_answer (vérifié en prod le 2026-11-23).
-- Le cas « le joueur part APRÈS que les autres ont répondu » est traité côté
-- appli : l'hôte (ou le remplaçant) appelle reveal_trivia_round quand il voit
-- le départ (js/core/triviaPresentPlayers.js).
-- Rejouable : CREATE OR REPLACE, même signature, mêmes droits.
-- =============================================================================

create or replace function public.trivia_all_expected_players_answered(
  p_lobby_id uuid,
  p_trivia jsonb
)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_expected jsonb;
  v_answers jsonb;
  v_uid text;
  v_present int := 0;
begin
  v_expected := public.trivia_question_player_uids(p_lobby_id, p_trivia);
  if jsonb_array_length(v_expected) = 0 then
    return false;
  end if;

  v_answers := coalesce(p_trivia -> 'answers', '{}'::jsonb);

  for v_uid in
    select e.uid
    from jsonb_array_elements_text(v_expected) as e(uid)
    where exists (
      select 1
      from public.lobby_members lm
      where lm.lobby_id = p_lobby_id
        and lm.user_id::text = e.uid
    )
  loop
    v_present := v_present + 1;
    if not public.trivia_answer_has_valid_index(v_answers -> v_uid) then
      return false;
    end if;
  end loop;

  return v_present > 0;
end;
$$;
