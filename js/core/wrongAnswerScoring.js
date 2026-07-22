import { WRONG_ANSWER_PODIUM_POINTS } from "../../data/wrongAnswer.js";

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
 * Classe les auteurs par votes reçus (décroissant). Égalité départagée par `answers[name].at`
 * (réponse envoyée la plus tôt en premier). Les réponses sans vote sont exclues.
 */
export function rankWrongAnswerResults(answers = {}, votes = {}) {
  const counts = countWrongAnswerVotes(answers, votes);
  return Object.entries(counts)
    .filter(([, n]) => n > 0)
    .map(([name, voteCount]) => ({
      name,
      votes: voteCount,
      at: answers[name]?.at ?? Infinity,
    }))
    .sort((a, b) => {
      if (b.votes !== a.votes) return b.votes - a.votes;
      return a.at - b.at;
    });
}

/** Calcule counts, deltas et ranking sans écrire dans le state. */
export function computeWrongAnswerRoundAward(
  answers = {},
  votes = {},
  { podiumPoints = WRONG_ANSWER_PODIUM_POINTS } = {}
) {
  const counts = countWrongAnswerVotes(answers, votes);
  const ranking = rankWrongAnswerResults(answers, votes);
  const deltas = {};
  let podiumIdx = 0;
  ranking.forEach((entry) => {
    const pts = podiumPoints[podiumIdx];
    podiumIdx += 1;
    if (pts == null) return;
    deltas[entry.name] = pts;
  });
  return { counts, deltas, ranking };
}
