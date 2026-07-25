/**
 * Union ordonnée des listes de jeux (soirée).
 * Ne remplace jamais une liste locale plus complète par une remote plus courte.
 */
export function mergeGameScoreOrder(...lists) {
  const out = [];
  const seen = new Set();
  lists.flat().forEach((id) => {
    if (typeof id !== "string" || !id || seen.has(id)) return;
    seen.add(id);
    out.push(id);
  });
  return out;
}

/** Ordre d’affichage « Classement par jeu » : order + clés gameScores + jeux enregistrés. */
export function resolveEveningGameScoreOrder({
  gameScoreOrder = [],
  gameScores = {},
  eveningGamesRecorded = {},
} = {}) {
  return mergeGameScoreOrder(
    gameScoreOrder,
    Object.keys(gameScores || {}),
    Object.keys(eveningGamesRecorded || {})
  );
}
