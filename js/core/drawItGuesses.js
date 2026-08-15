/**
 * Domaine Draw it ! T5 — guesses + foundOrder (pur).
 * phase n'est jamais mutée ici. foundOrder ne termine pas la manche.
 */
import {
  DRAW_IT_PHASE_DRAWING,
  isDrawItRoundExpired,
} from "./drawItRound.js";
import {
  collectDrawItAcceptedAnswers,
  drawItGuessMatches,
  normalizeDrawItGuess,
} from "./drawItNormalize.js";

export const DRAW_IT_GUESS_FEED_LIMIT = 20;
export const DRAW_IT_GUESS_MAX_LENGTH = 200;

export function sanitizeDrawItFoundOrder(list) {
  const seen = new Set();
  const out = [];
  for (const item of Array.isArray(list) ? list : []) {
    const uid = item?.uid != null ? String(item.uid) : "";
    if (!uid || seen.has(uid)) continue;
    seen.add(uid);
    out.push({
      uid,
      at: item.at != null ? String(item.at) : null,
    });
  }
  return out;
}

export function sanitizeDrawItGuesses(list, limit = DRAW_IT_GUESS_FEED_LIMIT) {
  const out = [];
  for (const item of Array.isArray(list) ? list : []) {
    const uid = item?.uid != null ? String(item.uid) : "";
    if (!uid) continue;
    out.push({
      uid,
      value: item.value != null ? String(item.value) : "",
      at: item.at != null ? String(item.at) : null,
      correct: Boolean(item.correct),
    });
  }
  return out.slice(-Math.max(0, Number(limit) || DRAW_IT_GUESS_FEED_LIMIT));
}

export function isUidInDrawItFoundOrder(foundOrder, uid) {
  if (!uid) return false;
  const key = String(uid);
  return sanitizeDrawItFoundOrder(foundOrder).some((entry) => entry.uid === key);
}

export function isFrozenDrawItParticipant(session, uid) {
  if (!uid) return false;
  const key = String(uid);
  if ((session?.drawerOrder || []).some((id) => String(id) === key)) return true;
  return (session?.participants || []).some((p) => String(p?.userId || "") === key);
}

export function canSubmitDrawItGuess(session, { uid, nowMs = Date.now() } = {}) {
  if (!session?.lobbyStarted) return { ok: false, reason: "no_session" };
  if (session.phase !== DRAW_IT_PHASE_DRAWING) {
    return { ok: false, reason: "not_drawing" };
  }
  if (isDrawItRoundExpired(session.roundEndsAt, nowMs)) {
    return { ok: false, reason: "expired" };
  }
  if (!uid) return { ok: false, reason: "no_author" };
  const author = String(uid);
  if (!isFrozenDrawItParticipant(session, author)) {
    return { ok: false, reason: "not_in_party" };
  }
  if (session.drawerUid && author === String(session.drawerUid)) {
    return { ok: false, reason: "drawer" };
  }
  if (isUidInDrawItFoundOrder(session.foundOrder, author)) {
    return { ok: false, reason: "already_found" };
  }
  return { ok: true };
}

export function isDrawItGuessInputLocked(session, uid, nowMs = Date.now()) {
  return !canSubmitDrawItGuess(session, { uid, nowMs }).ok;
}

/**
 * Applique une proposition comme la RPC (après FOR UPDATE).
 * `serverAt` est obligatoire pour l'horodatage — le `at` / `clientAt` client est ignoré.
 */
export function applyDrawItGuess(
  session,
  {
    uid,
    value,
    nowMs = Date.now(),
    serverAt,
    wordLabel = "",
    acceptedAnswers = [],
  } = {}
) {
  const check = canSubmitDrawItGuess(session, { uid, nowMs });
  if (!check.ok) return { ok: false, reason: check.reason, session };

  const trimmed = String(value ?? "").trim();
  if (!trimmed) return { ok: false, reason: "empty", session };
  if (trimmed.length > DRAW_IT_GUESS_MAX_LENGTH) {
    return { ok: false, reason: "too_long", session };
  }
  if (!normalizeDrawItGuess(trimmed)) {
    return { ok: false, reason: "empty", session };
  }

  const answers = collectDrawItAcceptedAnswers(wordLabel, acceptedAnswers);
  const correct = drawItGuessMatches(trimmed, answers);
  const at = serverAt != null ? String(serverAt) : null;
  const author = String(uid);

  const guess = {
    uid: author,
    // Une bonne réponse ne doit pas publier le mot avant phase=reveal.
    value: correct ? "" : trimmed,
    at,
    correct,
  };
  const guesses = sanitizeDrawItGuesses([...(session.guesses || []), guess]);
  let foundOrder = sanitizeDrawItFoundOrder(session.foundOrder);
  if (correct && !isUidInDrawItFoundOrder(foundOrder, author)) {
    foundOrder = [...foundOrder, { uid: author, at }];
  }

  return {
    ok: true,
    correct,
    session: {
      ...session,
      guesses,
      foundOrder,
    },
  };
}

/** Simule SELECT … FOR UPDATE : chaque soumission voit l'état post-précédente. */
export function applyDrawItGuessesSerialized(session, submissions = [], secret = {}) {
  let current = session;
  const results = [];
  for (const sub of submissions) {
    const result = applyDrawItGuess(current, { ...secret, ...sub });
    if (result.ok) current = result.session;
    results.push(result);
  }
  return { session: current, results };
}

export function drawItGuessesToChatMessages(guesses, nameOf) {
  const resolve =
    typeof nameOf === "function" ? nameOf : (uid) => uid;
  return sanitizeDrawItGuesses(guesses).map((guess) => ({
    from: resolve(guess.uid) || "Joueur",
    text: guess.correct ? "✓ Mot trouvé !" : guess.value,
  }));
}
