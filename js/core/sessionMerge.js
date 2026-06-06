/**
 * Fusions d'état multijoueur (prêt, customs par auteur) - testables sans Supabase.
 */

export function normalizeDilemmaEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  const optionA = String(entry.optionA || "").trim();
  const optionB = String(entry.optionB || "").trim();
  if (!optionA || !optionB) return null;
  return {
    id: entry.id || `custom-${optionA}-${optionB}`,
    optionA,
    optionB,
    author: entry.author || null,
    tier: entry.tier || "custom",
  };
}

export function normalizeHotTakeEntry(entry) {
  if (typeof entry === "string") {
    const text = entry.trim();
    if (!text) return null;
    return { id: `legacy-${text.slice(0, 24)}`, text, author: null, themeId: null };
  }
  if (!entry || typeof entry !== "object") return null;
  const text = String(entry.text || "").trim();
  if (!text) return null;
  return {
    id: entry.id || `custom-${text.slice(0, 24)}-${entry.author || "anon"}`,
    text,
    author: entry.author || null,
    themeId: entry.themeId || null,
  };
}

/** En préparation : un joueur « prêt » côté local ou remote compte pour tous les actifs. */
export function mergeReadyMapsLocal(localReady = {}, remoteReady = {}, activeNames = []) {
  const merged = { ...remoteReady };
  activeNames.forEach((name) => {
    if (localReady[name] || remoteReady[name]) merged[name] = true;
  });
  return merged;
}

/**
 * Liste locale = source de vérité pour le joueur local ; remote = entrées des autres auteurs.
 * Les suppressions locales ne sont pas réinjectées depuis le serveur.
 */
export function mergeAuthorOwnedCustomList(
  localList = [],
  remoteList = [],
  { normalize, localAuthor }
) {
  const me = localAuthor;
  const byId = new Map();
  for (const raw of remoteList) {
    const item = normalize(raw);
    if (!item) continue;
    const author = item.author;
    if (author && author !== me) byId.set(item.id, item);
  }
  for (const raw of localList) {
    const item = normalize(raw);
    if (item) byId.set(item.id, item);
  }
  return [...byId.values()];
}

export function mergeDilemmaCustomDilemmas(localList, remoteList, localAuthor) {
  return mergeAuthorOwnedCustomList(localList, remoteList, {
    normalize: normalizeDilemmaEntry,
    localAuthor,
  });
}

export function mergeHotTakeCustomTakes(localList, remoteList, localAuthor) {
  return mergeAuthorOwnedCustomList(localList, remoteList, {
    normalize: normalizeHotTakeEntry,
    localAuthor,
  });
}

/**
 * Deck Hot Take / Dilemma : null en prep (customs modifiables).
 * En partie lancée, deck figé — remote prioritaire.
 */
export function mergeCustomGameDeck(local = {}, remote = {}) {
  const started = Boolean(local.lobbyStarted || remote.lobbyStarted);
  if (!started) return null;
  if (Array.isArray(remote.deck) && remote.deck.length) return remote.deck;
  if (Array.isArray(local.deck) && local.deck.length) return local.deck;
  return remote.deck ?? local.deck ?? null;
}

/** Fusion deck côté blob session (patch serveur). */
export function mergeRemoteCustomGameDeck(cur = {}, inc = {}) {
  const started = Boolean(cur?.lobbyStarted || inc?.lobbyStarted);
  if (!started) return null;
  if (Array.isArray(inc?.deck)) return inc.deck;
  if (inc?.deck === null && !cur?.lobbyStarted) return null;
  return inc?.deck ?? cur?.deck ?? null;
}

/** Patch invité : uniquement des votes — ne doit pas écraser phase / scoring / manche. */
export function isVotesOnlyGamePatch(inc = {}) {
  const keys = Object.keys(inc);
  return keys.length === 1 && keys[0] === "votes";
}

/** Patch invité : uniquement des réponses (Consensus, Trivia). */
export function isAnswersOnlyGamePatch(inc = {}) {
  const keys = Object.keys(inc);
  return keys.length === 1 && keys[0] === "answers";
}

/** Nouvelle manche Consensus : index avancé ou réponses distantes vidées après une manche précédente. */
export function isNewConsensusQuestionRound(cur, inc) {
  if (!inc) return false;
  if (inc.phase !== "question" || inc.questionIdx == null) return false;
  if (Object.keys(inc.answers || {}).length !== 0) return false;

  if (cur?.questionIdx != null && inc.questionIdx !== cur.questionIdx) return true;

  const curHasAnswers = Object.keys(cur?.answers || {}).length > 0;
  if (!curHasAnswers) return false;

  return (
    cur?.questionIdx == null ||
    cur?.phase === "reveal" ||
    cur?.phase === "reveal-pending" ||
    cur?.phase === "final" ||
    !cur?.phase ||
    cur?.phase !== "question"
  );
}

/** Évite qu'un patch « question » tardif écrase reveal-pending / reveal (Consensus). */
const CONSENSUS_PHASE_RANK = {
  question: 0,
  "reveal-pending": 1,
  reveal: 2,
  final: 3,
};

export function mergeConsensusPhase(curPhase, incPhase, { newQuestionRound = false } = {}) {
  if (newQuestionRound) return incPhase ?? curPhase ?? null;
  const curRank = CONSENSUS_PHASE_RANK[curPhase] ?? -1;
  const incRank = CONSENSUS_PHASE_RANK[incPhase] ?? -1;
  if (curRank < 0) return incPhase ?? curPhase ?? null;
  if (incRank < 0) return curPhase ?? null;
  return incRank >= curRank ? incPhase : curPhase;
}

const TRIVIA_PHASE_RANK = {
  question: 0,
  reveal: 1,
  final: 2,
};

export function mergeTriviaPhase(curPhase, incPhase, { newQuestionRound = false } = {}) {
  if (newQuestionRound) return incPhase ?? curPhase ?? null;
  const curRank = TRIVIA_PHASE_RANK[curPhase] ?? -1;
  const incRank = TRIVIA_PHASE_RANK[incPhase] ?? -1;
  if (curRank < 0) return incPhase ?? curPhase ?? null;
  if (incRank < 0) return curPhase ?? null;
  return incRank >= curRank ? incPhase : curPhase;
}

/** Garde la réponse la plus récente (changement de réponse en phase question). */
export function pickLatestTriviaAnswer(localAnswer, remoteAnswer) {
  if (!localAnswer) return remoteAnswer || null;
  if (!remoteAnswer) return localAnswer;
  return (remoteAnswer.answeredAt || 0) >= (localAnswer.answeredAt || 0)
    ? remoteAnswer
    : localAnswer;
}

export function mergeTriviaAnswersUid(curAnswers = {}, incAnswers = {}) {
  const merged = { ...curAnswers };
  Object.entries(incAnswers).forEach(([uid, incoming]) => {
    merged[uid] = pickLatestTriviaAnswer(merged[uid], incoming);
  });
  return merged;
}

/** Ne jamais régresser reveal → voting (course réseau vote / révélation hôte). */
export function mergeForwardGamePhase(curPhase, incPhase) {
  if (curPhase === "reveal" && incPhase === "voting") return "reveal";
  if (incPhase == null || incPhase === "") return curPhase ?? null;
  return incPhase;
}

/** État dilemma pour patchGameState (inc = patch client, cur = serveur). */
export function mergeDilemmaPatchState(curDm, incDm, localAuthor, { mergeReadyUid, mergeVotes }) {
  if (!curDm) return incDm;
  if (!incDm) return curDm;
  if (isVotesOnlyGamePatch(incDm)) {
    return {
      ...curDm,
      votes: mergeVotes(curDm, incDm),
    };
  }
  return {
    ...curDm,
    ...incDm,
    phase: mergeForwardGamePhase(curDm.phase, incDm.phase),
    ready: mergeReadyUid(curDm, incDm),
    votes: mergeVotes(curDm, incDm),
    customDilemmas: mergeDilemmaCustomDilemmas(
      incDm.customDilemmas || [],
      curDm.customDilemmas || [],
      localAuthor
    ),
    deck: mergeRemoteCustomGameDeck(curDm, incDm),
  };
}

/** État hot take pour patchGameState. */
export function mergeHotTakePatchState(curHt, incHt, localAuthor, { mergeReadyUid, mergeVotes }) {
  if (!curHt) return incHt;
  if (!incHt) return curHt;
  if (isVotesOnlyGamePatch(incHt)) {
    return {
      ...curHt,
      votes: mergeVotes(curHt, incHt),
    };
  }
  return {
    ...curHt,
    ...incHt,
    phase: mergeForwardGamePhase(curHt.phase, incHt.phase),
    ready: mergeReadyUid(curHt, incHt),
    votes: mergeVotes(curHt, incHt),
    customTakes: mergeHotTakeCustomTakes(
      incHt.customTakes || [],
      curHt.customTakes || [],
      localAuthor
    ),
    deck: mergeRemoteCustomGameDeck(curHt, incHt),
  };
}

/** État consensus pour patchGameState. */
export function mergeConsensusPatchState(
  cur,
  inc,
  { mergeReadyUid, mergeAnswers, newQuestionRound = false }
) {
  if (!cur) return inc;
  if (!inc) return cur;
  if (isAnswersOnlyGamePatch(inc)) {
    return { ...cur, answers: mergeAnswers(cur, inc) };
  }
  return {
    ...cur,
    ...inc,
    phase: mergeConsensusPhase(cur.phase, inc.phase, { newQuestionRound }),
    ready: mergeReadyUid(cur, inc),
    answers: mergeAnswers(cur, inc),
  };
}

/** État trivia pour patchGameState. */
export function mergeTriviaPatchState(
  cur,
  inc,
  { mergeReadyUid, mergeAnswers, newQuestionRound = false }
) {
  if (!cur) return inc;
  if (!inc) return cur;
  if (isAnswersOnlyGamePatch(inc)) {
    return { ...cur, answers: mergeAnswers(cur, inc) };
  }
  return {
    ...cur,
    ...inc,
    phase: mergeTriviaPhase(cur.phase, inc.phase, { newQuestionRound }),
    ready: mergeReadyUid(cur, inc),
    answers: mergeAnswers(cur, inc),
  };
}

/** État speed vote pour patchGameState. */
export function mergeSpeedVotePatchState(cur, inc, { mergeReadyUid, mergeVotes }) {
  if (!cur) return inc;
  if (!inc) return cur;
  if (isVotesOnlyGamePatch(inc)) {
    return { ...cur, votes: mergeVotes(cur, inc) };
  }
  return {
    ...cur,
    ...inc,
    phase: mergeForwardGamePhase(cur.phase, inc.phase),
    ready: mergeReadyUid(cur, inc),
    votes: mergeVotes(cur, inc),
  };
}

/** État truth meter pour patchGameState. */
export function mergeTruthMeterPatchState(cur, inc, { mergeReadyUid, mergeVotes }) {
  if (!cur) return inc;
  if (!inc) return cur;
  if (isVotesOnlyGamePatch(inc)) {
    return { ...cur, votes: mergeVotes(cur, inc) };
  }
  return {
    ...cur,
    ...inc,
    ready: mergeReadyUid(cur, inc),
    votes: mergeVotes(cur, inc),
  };
}

export function isNewTraitreVoteRound(cur, inc) {
  if (!inc) return false;
  if (inc.phase === "vote" && cur?.phase !== "vote") return true;
  if (
    inc.phase === "vote" &&
    cur?.phase === "vote" &&
    Object.keys(inc.votes || {}).length === 0 &&
    Object.keys(cur?.votes || {}).length > 0
  ) {
    return true;
  }
  return false;
}

/** État Le Traître pour patchGameState. */
export function mergeTraitrePatchState(cur, inc, { mergeReadyUid, mergeVotes, newVoteRound = false }) {
  if (!cur) return inc;
  if (!inc) return cur;
  if (isVotesOnlyGamePatch(inc)) {
    return { ...cur, votes: mergeVotes(cur, inc) };
  }
  const incKeys = Object.keys(inc);
  if (incKeys.length === 1 && inc.dealAcks) {
    return {
      ...cur,
      dealAcks: { ...(cur.dealAcks || {}), ...inc.dealAcks },
    };
  }
  return {
    ...cur,
    ...inc,
    phase: inc.phase ?? cur.phase,
    ready: mergeReadyUid(cur, inc),
    votes: mergeVotes(cur, inc),
    dealAcks: inc.dealAcks ? { ...(cur.dealAcks || {}), ...inc.dealAcks } : cur.dealAcks,
  };
}
