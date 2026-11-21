-- =============================================================================
-- AUDIT n°4, point 4 — Guess the Lie : manches annoncées par l'hôte remplaçant
-- =============================================================================
-- Problème : Guess the Lie n'avait pas de score de partie (`matchScores`) : la
-- règle « hôte absent » (game_sessions_credit_absent_host_evening_scores, audit
-- Clutch n°10) ne le couvrait pas. Les manches annoncées par un remplaçant ne
-- comptaient au classement de la soirée de personne d'autre que lui.
--
-- Correctif :
--  * appli : Guess the Lie tient maintenant un score de partie
--    (state.guessLie.matchScores, mêmes points que la soirée), envoyé à chaque
--    révélation ;
--  * serveur (ce fichier) : 'guesslie' ajouté à la liste des jeux de la règle.
--    Rien d'autre ne change : crédit seulement si c'est un autre joueur que le
--    vrai hôte qui écrit ET que le vrai hôte est absent ; seules les hausses
--    comptent.
--
-- Méthode : modification ciblée EN PLACE de la fonction du trigger (la liste
-- apparaît une seule fois). Rejouable : ne fait rien si 'guesslie' est déjà là.
-- =============================================================================

do $migration$
declare
  v_def text;
  v_old text := '''clutch'', ''dilemma'', ''hottake'', ''speedvote'', ''wronganswer'', ''truthmeter''';
  v_new text := '''clutch'', ''dilemma'', ''hottake'', ''speedvote'', ''wronganswer'', ''truthmeter'', ''guesslie''';
  v_count int;
begin
  v_def := pg_get_functiondef(
    'public.game_sessions_credit_absent_host_evening_scores()'::regprocedure
  );

  if position(v_new in v_def) > 0 then
    raise notice 'game_sessions_credit_absent_host_evening_scores : guesslie déjà présent, rien à faire.';
    return;
  end if;

  v_count := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  if v_count <> 1 then
    raise exception 'Liste des jeux trouvée % fois (1 attendue). Migration annulée.', v_count;
  end if;

  execute replace(v_def, v_old, v_new);
end;
$migration$;
