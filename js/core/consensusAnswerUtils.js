import {
  CONSENSUS_DEFAULT_SLIDER_VALUE,
  decorateConsensusQuestionForMode,
} from "../../data/consensus.js";

/**
 * AUDIT Consensus n°2 : question affichée, reconstruite à partir du paquet et du
 * numéro de question (même calcul que l'hôte, sans hasard). L'hôte remplaçant ne
 * peut pas envoyer `currentQuestion` (champ refusé par apply_acting_host_play) :
 * après son « Question suivante », la question enregistrée est encore l'ancienne.
 * Si elle ne correspond pas à la question du paquet, on prend celle du paquet.
 *
 * @param {{ currentQuestion?: object|null, deck?: object[]|null, questionIdx?: number,
 *   selectedModeId?: string, phase?: string|null }} session paquet déjà réhydraté
 * @returns {object|null}
 */
export function resolveConsensusCurrentQuestion(session = {}) {
  const stored = session.currentQuestion || null;
  const deck = Array.isArray(session.deck) ? session.deck : null;
  const idx = session.questionIdx;
  if (!deck || !Number.isInteger(idx)) return stored;
  const phase = session.phase;
  if (phase !== "question" && phase !== "reveal-pending" && phase !== "reveal" && phase !== "final") {
    return stored;
  }
  const base = deck[idx];
  if (!base || base.id == null) return stored;
  if (stored && stored.id != null && String(stored.id) === String(base.id)) return stored;
  return decorateConsensusQuestionForMode(base, session.selectedModeId || "standard", idx);
}

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

/**
 * Réponse à prendre en compte pour le scoring : validée pour la manche ET non imputée.
 * Les réponses imputées (joueur absent, 50 % par défaut) ne doivent ni peser dans la
 * moyenne / médiane / ancre, ni rapporter de points.
 */
export function isScorableConsensusAnswer(answer, questionIdx) {
  return isConsensusAnswerForRound(answer, questionIdx) && !answer?.imputed;
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
/** Fusionne deux réponses : une réponse validée (non imputée) l'emporte sur une imputée. */
export function pickLatestConsensusAnswer(localAnswer, remoteAnswer) {
  if (!localAnswer) return remoteAnswer || null;
  if (!remoteAnswer) return localAnswer;

  const localImputed = Boolean(localAnswer.imputed);
  const remoteImputed = Boolean(remoteAnswer.imputed);
  if (localImputed !== remoteImputed) {
    return localImputed ? remoteAnswer : localAnswer;
  }

  return (remoteAnswer.timestamp || 0) >= (localAnswer.timestamp || 0)
    ? remoteAnswer
    : localAnswer;
}

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
