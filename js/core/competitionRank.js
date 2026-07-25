/**
 * Rangs compétition (style olympique) : scores égaux → même rang, le suivant saute.
 * Ex. [10,10,8] → [1,1,3] ; [10,9,9,7] → [1,2,2,4] ; tous égaux → tous 1.
 *
 * Prérequis : `scores` est déjà trié du meilleur au moins bon
 * (score décroissant, ou métrique croissante type écart Clutch).
 * Les valeurs adjacentes égales partagent le rang ; l’ordre dans le tableau
 * (nom, etc.) n’influence pas le rang — seulement l’affichage.
 */

/** @param {readonly number[]} scoresSortedBestFirst */
export function competitionRanksFromSortedScores(scoresSortedBestFirst = []) {
  const ranks = new Array(scoresSortedBestFirst.length);
  for (let i = 0; i < scoresSortedBestFirst.length; i += 1) {
    if (i > 0 && scoresSortedBestFirst[i] === scoresSortedBestFirst[i - 1]) {
      ranks[i] = ranks[i - 1];
    } else {
      ranks[i] = i + 1;
    }
  }
  return ranks;
}

/**
 * Attache `rank` compétition aux entrées déjà triées meilleur → moins bon.
 * @template T
 * @param {T[]} entries
 * @param {(entry: T) => number} getScore
 * @returns {Array<T & { rank: number }>}
 */
export function withCompetitionRanks(entries = [], getScore = (e) => e.score) {
  const scores = entries.map((e) => getScore(e));
  const ranks = competitionRanksFromSortedScores(scores);
  return entries.map((entry, i) => ({ ...entry, rank: ranks[i] }));
}

/** Points podium [15,10,5] : rang 1 → 15, rang 2 → 10, rang 3 → 5, sinon 0. */
export function podiumPointsForRank(rank, podiumPoints = []) {
  if (!Number.isInteger(rank) || rank < 1) return 0;
  const pts = podiumPoints[rank - 1];
  return typeof pts === "number" && Number.isFinite(pts) ? pts : 0;
}

export function medalForCompetitionRank(rank) {
  if (rank === 1) return "🥇";
  if (rank === 2) return "🥈";
  if (rank === 3) return "🥉";
  return "•";
}

/** Libellé court de place (classement soirée). */
export function competitionRankLabel(rank) {
  if (rank === 1) return "1er";
  if (rank == null || !Number.isFinite(rank)) return "—";
  return `${rank}e`;
}

/** « Alice », « Alice et Bob », « Alice, Bob et Carol ». */
export function formatNameList(names = []) {
  const clean = names.map((n) => String(n || "").trim()).filter(Boolean);
  if (clean.length === 0) return "";
  if (clean.length === 1) return clean[0];
  if (clean.length === 2) return `${clean[0]} et ${clean[1]}`;
  return `${clean.slice(0, -1).join(", ")} et ${clean[clean.length - 1]}`;
}

export function winnersAtRank(standings = [], rank = 1) {
  return standings.filter((p) => p.rank === rank);
}

/** Libellé setLastGame : « gagnant : Alice » / « gagnants : Alice et Bob ». */
export function formatWinnersLabel(standings = []) {
  const winners = winnersAtRank(standings, 1);
  const names = formatNameList(winners.map((w) => w.name));
  if (!names) return "gagnant : -";
  return winners.length > 1 ? `gagnants : ${names}` : `gagnant : ${names}`;
}

/**
 * Signal ex æquo pour un podium à places limitées.
 * @returns {string} texte sans HTML, ou "" si un seul leader
 */
export function formatCoLeadersHint(winners = []) {
  if (!winners || winners.length <= 1) return "";
  const names = formatNameList(winners.map((w) => w.name));
  if (!names) return "";
  return `${names} sont premiers ex æquo`;
}

/** Tri + rangs compétition (score desc, nom pour ordre d’affichage seulement). */
export function sortAndRankByScore(entries = [], getScore = (e) => e.score) {
  const sorted = [...entries].sort((a, b) => compareScoreDescThenName(a, b, getScore));
  return withCompetitionRanks(sorted, getScore);
}

/** Tri score décroissant ; nom uniquement pour ordre d’affichage stable. */
export function compareScoreDescThenName(a, b, scoreOf = (x) => x.score) {
  const diff = scoreOf(b) - scoreOf(a);
  if (diff !== 0) return diff;
  return String(a.name || "").localeCompare(String(b.name || ""));
}
