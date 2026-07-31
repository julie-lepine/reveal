import {
  TRIVIA_POINTS_CORRECT,
  TRIVIA_POINTS_FASTEST,
} from "../../data/trivia.js";

/**
 * Règle commune JS/SQL : answerIndex = number JSON entier uniquement.
 * @param {unknown} value
 */
export function isValidTriviaAnswerIndex(value) {
  return typeof value === "number" && Number.isInteger(value);
}

/**
 * Ordre reveal : answeredAt ASC, puis clé ASC ; sans timestamp en dernier.
 * @param {Array<[string, { answerIndex?: number, answeredAt?: number }]>} correctEntries
 */
export function sortCorrectEntriesForReveal(correctEntries) {
  return [...correctEntries].sort((a, b) => {
    const aAt = a[1].answeredAt;
    const bAt = b[1].answeredAt;
    const aTimed = typeof aAt === "number" && Number.isFinite(aAt);
    const bTimed = typeof bAt === "number" && Number.isFinite(bAt);
    if (aTimed && bTimed && aAt !== bAt) return aAt - bAt;
    if (aTimed && !bTimed) return -1;
    if (!aTimed && bTimed) return 1;
    return String(a[0]).localeCompare(String(b[0]));
  });
}

/**
 * Tie-break stable : answeredAt ASC, puis clé ASC (uid ou nom).
 * @param {Array<[string, { answerIndex?: number, answeredAt?: number }]>} correctEntries
 * @returns {string|null}
 */
export function pickFastestTriviaEntry(correctEntries) {
  const timed = correctEntries.filter(
    ([, answer]) =>
      typeof answer?.answeredAt === "number" && Number.isFinite(answer.answeredAt)
  );
  if (!timed.length) return null;
  return sortCorrectEntriesForReveal(timed)[0][0];
}

/**
 * Scoring pur d'une manche Trivia (miroir JS du RPC reveal_trivia_round).
 * @param {object} params
 * @param {number} params.correctIndex
 * @param {string} [params.correctAnswer]
 * @param {Record<string, { answerIndex?: number, answeredAt?: number }>} [params.answers]
 * @param {Record<string, number>} [params.matchScores]
 * @param {number} [params.pointsCorrect]
 * @param {number} [params.pointsFastest]
 */
export function scoreTriviaRoundFromAnswers({
  correctIndex,
  correctAnswer = "",
  answers = {},
  matchScores = {},
  pointsCorrect = TRIVIA_POINTS_CORRECT,
  pointsFastest = TRIVIA_POINTS_FASTEST,
}) {
  const scores = { ...matchScores };
  const answerEntries = Object.entries(answers).filter(([, answer]) =>
    isValidTriviaAnswerIndex(answer?.answerIndex)
  );
  const correctEntries = answerEntries.filter(
    ([, answer]) => answer.answerIndex === correctIndex
  );
  const orderedCorrect = sortCorrectEntriesForReveal(correctEntries);
  const fastestKey = pickFastestTriviaEntry(correctEntries);
  const deltas = {};

  orderedCorrect.forEach(([key]) => {
    scores[key] = (scores[key] || 0) + pointsCorrect;
    deltas[key] = (deltas[key] || 0) + pointsCorrect;
  });

  if (fastestKey) {
    scores[fastestKey] = (scores[fastestKey] || 0) + pointsFastest;
    deltas[fastestKey] = (deltas[fastestKey] || 0) + pointsFastest;
  }

  return {
    matchScores: scores,
    lastRound: {
      correctIndex,
      correctAnswer,
      correctPlayers: orderedCorrect.map(([key]) => key),
      fastestPlayer: fastestKey,
      deltas,
    },
  };
}
