import { CONSENSUS_DEFAULT_SLIDER_VALUE } from "../../data/consensus.js";

export function clampConsensusValue(value) {
  if (value === null || value === undefined || value === "") {
    return CONSENSUS_DEFAULT_SLIDER_VALUE;
  }
  const num = Number(value);
  if (!Number.isFinite(num)) return CONSENSUS_DEFAULT_SLIDER_VALUE;
  return Math.max(0, Math.min(100, Math.round(num)));
}

/** Réponse validée pour la manche courante (ignore les submittedAt d'une manche précédente). */
export function isConsensusAnswerForRound(answer, questionIdx) {
  if (!answer?.submittedAt) return false;
  if (!Number.isFinite(answer.value)) return false;
  if (answer.questionIdx == null) return false;
  return answer.questionIdx === questionIdx;
}

export function stripStaleConsensusAnswers(answers = {}, questionIdx = 0) {
  const out = {};
  Object.entries(answers).forEach(([name, answer]) => {
    if (isConsensusAnswerForRound(answer, questionIdx)) {
      out[name] = answer;
    }
  });
  return out;
}

/** Complète les joueurs actifs sans réponse validée avec la valeur neutre (50 %). */
export function applyConsensusDefaultAnswers(session, playerNames) {
  const questionIdx = session.questionIdx ?? 0;
  const nextAnswers = stripStaleConsensusAnswers(session.answers || {}, questionIdx);
  const now = Date.now();
  playerNames.forEach((name) => {
    if (isConsensusAnswerForRound(nextAnswers[name], questionIdx)) return;
    nextAnswers[name] = {
      value: CONSENSUS_DEFAULT_SLIDER_VALUE,
      timestamp: now,
      submittedAt: now,
      questionIdx,
      imputed: true,
    };
  });
  return { ...session, answers: nextAnswers };
}
