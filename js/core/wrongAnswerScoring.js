import { WRONG_ANSWER_PODIUM_POINTS } from "../../data/wrongAnswer.js";
import { podiumPointsForRank, withCompetitionRanks } from "./competitionRank.js";

function countWrongAnswerVotes(answers = {}, votes = {}) {
  const counts = {};
  Object.keys(answers).forEach((name) => {
    counts[name] = 0;
  });
  Object.values(votes).forEach((target) => {
    if (target == null || counts[target] == null) return;
    counts[target] += 1;
  });
  return counts;
}

/**
 * Classe les auteurs par votes reçus (décroissant). Ex æquo : ordre de nom stable
 * (affichage uniquement — n'influence pas les points). Les réponses sans vote sont exclues.
 */
export function rankWrongAnswerResults(answers = {}, votes = {}) {
  const counts = countWrongAnswerVotes(answers, votes);
  const sorted = Object.entries(counts)
    .filter(([, n]) => n > 0)
    .map(([name, voteCount]) => ({
      name,
      votes: voteCount,
    }))
    .sort((a, b) => {
      if (b.votes !== a.votes) return b.votes - a.votes;
      return a.name.localeCompare(b.name);
    });
  return withCompetitionRanks(sorted, (e) => e.votes);
}

/**
 * Calcule counts, deltas et ranking sans écrire dans le state.
 * Ex æquo de votes : même rang compétition → même palier podium (1,1,3).
 */
export function computeWrongAnswerRoundAward(
  answers = {},
  votes = {},
  { podiumPoints = WRONG_ANSWER_PODIUM_POINTS } = {}
) {
  const counts = countWrongAnswerVotes(answers, votes);
  const ranking = rankWrongAnswerResults(answers, votes);
  const deltas = {};
  ranking.forEach((entry) => {
    const pts = podiumPointsForRank(entry.rank, podiumPoints);
    if (pts > 0) deltas[entry.name] = pts;
  });
  return { counts, deltas, ranking };
}
