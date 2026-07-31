/**
 * BUG-TRIVIA-01A — patches explicites Trivia en partie (hôte réel + acting host).
 * Ne jamais reconstruire un patch distant à partir d'un spread de session complète.
 */

/** Clés autorisées dans un patch de transition Trivia en partie. */
export const TRIVIA_PLAY_ALLOWED_KEYS = new Set([
  "phase",
  "questionIdx",
  "questionScored",
  "matchScores",
  "lastRound",
  "answers",
  "podiumApplied",
]);

/** Clés interdites (prep, dérivables, ou hors contrat Trivia). */
export const TRIVIA_PLAY_FORBIDDEN_KEYS = new Set([
  "currentQuestion",
  "results",
  "deck",
  "ready",
  "lobbyStarted",
  "selectedThemeId",
  "questionCount",
  "roundScored",
]);

/**
 * Extrait du remote complet uniquement les clés du patch explicite.
 * @throws {Error} si le patch contient des champs interdits ou invalides
 */
export function pickTriviaPlayFields(fullRemote, explicitPatch) {
  const out = {};
  if (!explicitPatch || typeof explicitPatch !== "object") return out;

  if (Object.prototype.hasOwnProperty.call(explicitPatch, "roundScored")) {
    throw new Error("Trivia: roundScored interdit");
  }
  if (
    explicitPatch.questionScored != null &&
    explicitPatch.roundScored != null
  ) {
    throw new Error("Trivia: questionScored et roundScored simultanés interdits");
  }

  for (const key of Object.keys(explicitPatch)) {
    if (TRIVIA_PLAY_FORBIDDEN_KEYS.has(key)) {
      throw new Error(`Trivia: champ interdit ${key}`);
    }
    if (!TRIVIA_PLAY_ALLOWED_KEYS.has(key)) {
      throw new Error(`Trivia: champ non autorisé ${key}`);
    }

    if (key === "answers") {
      const answers = explicitPatch.answers;
      if (answers == null || Array.isArray(answers) || typeof answers !== "object") {
        throw new Error("Trivia: answers doit être un objet vide");
      }
      if (Object.keys(answers).length !== 0) {
        throw new Error("Trivia: answers doit être un objet vide");
      }
      out.answers = {};
      continue;
    }

    if (key === "phase") {
      out.phase = explicitPatch.phase ?? null;
      continue;
    }
    if (key === "questionIdx") {
      out.questionIdx = explicitPatch.questionIdx ?? 0;
      continue;
    }
    if (key === "questionScored") {
      out.questionScored = Boolean(explicitPatch.questionScored);
      continue;
    }
    if (key === "podiumApplied") {
      out.podiumApplied = Boolean(explicitPatch.podiumApplied);
      continue;
    }
    if (key === "lastRound") {
      if (explicitPatch.lastRound === null) {
        out.lastRound = null;
      } else if (Object.prototype.hasOwnProperty.call(fullRemote, key)) {
        out.lastRound = fullRemote.lastRound;
      }
      continue;
    }

    if (Object.prototype.hasOwnProperty.call(fullRemote, key)) {
      out[key] = fullRemote[key];
    }
  }

  if (out.roundScored != null) {
    throw new Error("Trivia: roundScored interdit");
  }

  return out;
}

/** Patch explicite question → reveal (noms locaux ; conversion UID via toRemote). */
export function buildTriviaRevealExplicitPatch(scoredSession) {
  return {
    phase: "reveal",
    questionIdx: scoredSession.questionIdx ?? 0,
    questionScored: true,
    matchScores: scoredSession.matchScores || {},
    lastRound: scoredSession.lastRound ?? null,
  };
}

/** Patch explicite reveal → question suivante. */
export function buildTriviaNextQuestionExplicitPatch(nextQuestionIdx) {
  return {
    phase: "question",
    questionIdx: nextQuestionIdx,
    questionScored: false,
    lastRound: null,
    answers: {},
  };
}

/** Patch explicite reveal → final. */
export function buildTriviaFinalExplicitPatch() {
  return {
    phase: "final",
    podiumApplied: true,
  };
}

/**
 * BUG-TRIVIA-01A : currentQuestion n'est pas patché au serveur entre les manches.
 * Tous les clients dérivent la question affichée depuis deck[questionIdx].
 */
export function deriveTriviaCurrentQuestion(deck, questionIdx, fallback = null) {
  if (!Array.isArray(deck)) return fallback;
  const idx = Number(questionIdx);
  if (!Number.isInteger(idx) || idx < 0 || idx >= deck.length) return fallback;
  return deck[idx] || fallback;
}
