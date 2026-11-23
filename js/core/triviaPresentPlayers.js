/**
 * AUDIT Trivia n°1 — joueur qui quitte le salon en pleine question.
 *
 * Miroir JS de `trivia_all_expected_players_answered` (supabase/fix-trivia-departed-players.sql) :
 * parmi les joueurs attendus pour la question (`questionPlayerUids`, figés au début),
 * on ne compte que ceux encore membres du salon. Un joueur qui a seulement perdu le
 * réseau reste membre, donc toujours attendu.
 *
 * Sert à l'hôte (ou au remplaçant) : quand un joueur part après que tous les autres
 * ont répondu, plus aucune réponse n'arrive pour déclencher la révélation côté serveur.
 */

/**
 * @param {object} params
 * @param {unknown} params.remoteTrivia état Trivia distant (réponses indexées par UID)
 * @param {Iterable<string>} params.memberUserIds UID des membres actuels du salon
 * @returns {boolean} true si au moins un joueur attendu est présent et tous les présents ont répondu
 */
export function triviaAllPresentPlayersAnswered({ remoteTrivia, memberUserIds } = {}) {
  if (!remoteTrivia || typeof remoteTrivia !== "object") return false;
  if (remoteTrivia.phase !== "question") return false;
  const expected = Array.isArray(remoteTrivia.questionPlayerUids)
    ? remoteTrivia.questionPlayerUids.map(String).filter(Boolean)
    : [];
  if (!expected.length) return false;
  const members = new Set([...(memberUserIds || [])].map(String).filter(Boolean));
  // Liste des membres inconnue : on ne conclut rien (prudence).
  if (!members.size) return false;
  const present = expected.filter((uid) => members.has(uid));
  if (!present.length) return false;
  const answers = remoteTrivia.answers && typeof remoteTrivia.answers === "object"
    ? remoteTrivia.answers
    : {};
  return present.every((uid) => Number.isInteger(answers[uid]?.answerIndex));
}

/**
 * Audit Trivia n°3 : nom affiché pour le bonus vitesse. Si le plus rapide a quitté
 * le salon, son nom n'est plus connu et on recevait son identifiant technique.
 * @param {string|null|undefined} fastestPlayer pseudo (ou UID si inconnu)
 * @param {string[]} knownNames pseudos des joueurs actuels
 * @returns {string|null} libellé à afficher, null si personne
 */
export function triviaFastestPlayerLabel(fastestPlayer, knownNames = []) {
  if (fastestPlayer == null || fastestPlayer === "") return null;
  const name = String(fastestPlayer);
  return knownNames.includes(name) ? name : "un joueur parti";
}

/**
 * true si un joueur attendu pour la question n'est plus dans le salon
 * (c'est le seul cas où l'hôte doit déclencher lui-même la révélation).
 */
export function triviaHasDepartedExpectedPlayer({ remoteTrivia, memberUserIds } = {}) {
  if (!remoteTrivia || !Array.isArray(remoteTrivia.questionPlayerUids)) return false;
  const members = new Set([...(memberUserIds || [])].map(String).filter(Boolean));
  if (!members.size) return false;
  return remoteTrivia.questionPlayerUids.some((uid) => uid && !members.has(String(uid)));
}
