/**
 * Audit n°4 — points de soirée de fin de partie (Trivia, Consensus) ajoutés par
 * le serveur (`finalize_trivia_scores` / `finalize_consensus_scores`), une fois
 * par partie, que ce soit l'hôte ou son remplaçant qui termine.
 *
 * Avant : ajoutés sur le téléphone de celui qui termine. Un remplaçant ne les
 * envoyait jamais (perdus pour les autres) ; Trivia pouvait compter deux fois.
 *
 * Les fonctions pures ci-dessous sont le miroir du calcul serveur (tests).
 */
import { TRIVIA_LOBBY_PODIUM_POINTS } from "../../data/trivia.js";
import { competitionRanksFromSortedScores, podiumPointsForRank } from "./competitionRank.js";

function scoreOf(matchScores, uid) {
  const value = matchScores?.[uid];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * Trivia : score du quiz + bonus podium (rang « compétition ») pour chaque membre
 * du salon, seulement si le total est positif. Clés = identifiants (uid).
 * @param {Record<string, number>} matchScores
 * @param {string[]} memberUids
 */
export function triviaEveningDeltas(matchScores = {}, memberUids = []) {
  const rows = [...new Set(memberUids)]
    .map((uid) => ({ uid, s: scoreOf(matchScores, uid) }))
    .sort((a, b) => b.s - a.s);
  const ranks = competitionRanksFromSortedScores(rows.map((r) => r.s));
  const out = {};
  rows.forEach((row, i) => {
    const total = row.s + podiumPointsForRank(ranks[i], TRIVIA_LOBBY_PODIUM_POINTS);
    if (total > 0) out[row.uid] = total;
  });
  return out;
}

/** Consensus : score de la partie des membres du salon, s'il est positif (pas de bonus). */
export function consensusEveningDeltas(matchScores = {}, memberUids = []) {
  const out = {};
  for (const uid of new Set(memberUids)) {
    const s = scoreOf(matchScores, uid);
    if (s > 0) out[uid] = s;
  }
  return out;
}

const RPC_BY_GAME = {
  trivia: "finalize_trivia_scores",
  consensus: "finalize_consensus_scores",
};

/**
 * Demande au serveur d'ajouter les points de soirée de la partie (idempotent),
 * puis applique la partie renvoyée sur ce téléphone. Lève une erreur en cas d'échec.
 * @param {"trivia"|"consensus"} gameId
 */
export async function finalizeEveningScoresOnServer(gameId) {
  const rpc = RPC_BY_GAME[gameId];
  if (!rpc) throw new Error(`finalize: jeu inconnu (${gameId})`);
  const { getState } = await import("./state.js");
  const { rpcFinalizeEveningScores } = await import("./gameSessionRpc.js");
  const { applyRemoteSession, refreshGameSession } = await import("./gameSync.js");
  const lobbyId = getState().lobby?.id;
  if (!lobbyId) throw new Error("Lobby introuvable.");
  const row = await rpcFinalizeEveningScores({ rpc, lobbyId });
  let full = row;
  if (!row?.state) full = await refreshGameSession();
  if (!full?.state) throw new Error("Points de soirée non confirmés.");
  applyRemoteSession(full);
  return full;
}
