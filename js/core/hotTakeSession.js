import {
  isPlayerTextTooLong,
  playerTextMaxError,
  trimPlayerText,
} from "../../data/playerTextLimits.js";
import {
  HOT_TAKE_THEMES,
  HOT_TAKE_CATALOG_ID,
  HOT_TAKE_MIX_ID,
  HOT_TAKE_ROUND_PRESETS,
  HOT_TAKE_TIMER_SEC,
  getThemeBankTexts,
} from "../../data/hotTakes.js";
import {
  HOT_TAKE_ROUND_ALL,
  estimateHotTakeDuration,
  resolveEffectiveRoundCount,
} from "./hotTakeDuration.js";
import { getActivePlayerNames, getActivePlayers } from "./players.js";
import { getLobbyParticipants } from "./lobby.js";
import { getLocalDisplayName, getState, saveStatePatch } from "./state.js";
import {
  isGameSyncActive,
  isLobbyHost,
  syncHotTakeSession,
  allMembersReady,
  hotTakeToRemote,
  patchGameState,
  requireLocalParticipantUid,
  normalizePlayerVotesMap,
} from "./gameSync.js";
import { patchGameStateWithFeedback } from "./patchGameStateFeedback.js";
import {
  computeOptimisticMapEntryApply,
  rollbackOptimisticMapEntry,
  canRollbackOptimisticSubmission,
} from "./optimisticMapEntry.js";
import { launchGameWithSync, commitHostGamePlay, commitPrepReadyToggle } from "./mpLaunch.js";
import { mergeHotTakeCustomTakes } from "./sessionMerge.js";
import * as gameSyncNs from "./gameSync.js";

/** Compte du joueur local (absent des faux gameSync de certains tests). */
function localParticipantUid() {
  return gameSyncNs.getLocalParticipantUid?.() || null;
}
import { countOtherAuthorsCustomEntries } from "./combinedGameDeck.js";
// Import local : `export { … } from` ne crée pas de liaison utilisable ici
// (addCustomTake levait « checkHotTakeModeration is not defined »).
import { checkHotTakeModeration } from "./hotTakeModeration.js";
import {
  checkCustomEntryLimit,
  isCustomLimitServerError,
  isAuthorOwnedEntryMine,
} from "./customEntryLimits.js";
export {
  checkHotTakeModeration,
  getHotTakeModerationNotice as getModerationNotice,
} from "./hotTakeModeration.js";

/** Génération commit vote (stale catch / AUDIT-003). */
let hotTakeVoteAttemptId = 0;

function defaultSession() {
  return {
    customTakes: [],
    ready: {},
    lobbyStarted: false,
    pausedBy: null,
    selectedThemeId: HOT_TAKE_CATALOG_ID,
    roundCount: 5,
    deck: null,
    takeIdx: 0,
    phase: null,
    votes: {},
    voteEndsAt: null,
    voteTimerRemaining: null,
    intermissionEndsAt: null,
    takeScored: false,
    matchScores: {},
    lastRound: null,
  };
}

function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function getHotTakeSession() {
  return getState().hotTakeGame || defaultSession();
}

function normalizeTake(entry) {
  if (typeof entry === "string") {
    const text = trimPlayerText(entry);
    if (!text) return null;
    return { id: `legacy-${text.slice(0, 24)}`, text, author: null, themeId: null };
  }
  if (!entry || typeof entry !== "object") return null;
  const text = trimPlayerText(entry.text);
  if (!text) return null;
  return {
    id: entry.id || `custom-${text.slice(0, 24)}-${entry.author || "anon"}`,
    text,
    author: entry.author || null,
    ...(entry.authorUid ? { authorUid: String(entry.authorUid) } : {}),
    themeId: entry.themeId || null,
  };
}

export async function setHotTakeTheme(themeId) {
  const session = getHotTakeSession();
  await syncHotTakeSession({ ...session, selectedThemeId: themeId, deck: null });
}

export function isLocalHotTakeHost() {
  return isLobbyHost();
}

export function getHotTakePoolSize() {
  const session = getHotTakeSession();
  const themeId = session.selectedThemeId || HOT_TAKE_CATALOG_ID;
  const bankLen = getThemeBankTexts(themeId).length;
  const customLen = (session.customTakes || []).length;
  return bankLen + customLen;
}

export function getHotTakeRoundCount() {
  const session = getHotTakeSession();
  return session.roundCount ?? 5;
}

export async function setHotTakeRoundCount(count) {
  const session = getHotTakeSession();
  await syncHotTakeSession({ ...session, roundCount: count, deck: null });
}

export function getHotTakePrepSummary() {
  const poolSize = getHotTakePoolSize();
  const requested = getHotTakeRoundCount();
  const effective = resolveEffectiveRoundCount(requested, poolSize);
  const duration = estimateHotTakeDuration(effective);
  return {
    poolSize,
    requested,
    effective,
    durationLabel: duration.label,
    capped: requested !== HOT_TAKE_ROUND_ALL && requested > poolSize,
  };
}

export function buildHotTakeDeck() {
  const session = getHotTakeSession();
  const themeId = session.selectedThemeId || HOT_TAKE_CATALOG_ID;
  const players = getActivePlayers();
  const names = players.map((p) => p.name);

  const bank = getThemeBankTexts(themeId).map((text, i) => ({
    text,
    author: names[i % names.length] || null,
    themeId,
  }));

  const customs = (session.customTakes || []).map(normalizeTake).map((t) => ({
    text: t.text,
    author: t.author || getLocalDisplayName(),
    themeId: "custom",
  }));

  const totalAvailable = bank.length + customs.length;
  const effective = resolveEffectiveRoundCount(
    session.roundCount ?? 5,
    totalAvailable
  );
  // Les takes des joueurs sont garanties (dans la limite des manches), le reste vient de la banque.
  const customsKept = shuffleArray(customs).slice(0, effective);
  const remaining = Math.max(0, effective - customsKept.length);
  const bankKept = shuffleArray(bank).slice(0, remaining);
  const deck = shuffleArray([...customsKept, ...bankKept]);
  const next = { ...session, deck };
  saveStatePatch({ hotTakeGame: next });
  return deck;
}

export function getAllTakesForGame() {
  const session = getHotTakeSession();
  if (session.deck?.length) return session.deck.map(normalizeTake);
  return buildHotTakeDeck();
}

/** Takes ajoutées par le joueur local (seules visibles en préparation). */
export function getMyCustomTakes() {
  const me = getLocalDisplayName();
  return (getHotTakeSession().customTakes || [])
    .map(normalizeTake)
    .filter((t) => isAuthorOwnedEntryMine(t, me, localParticipantUid()));
}

/** Nombre de takes custom des autres (texte masqué jusqu’à la manche). */
export function countOtherPlayersCustomTakes(session = getHotTakeSession()) {
  return countOtherAuthorsCustomEntries(
    session.customTakes || [],
    getLocalDisplayName(),
    normalizeTake
  );
}

export async function addCustomTake(text) {
  if (isPlayerTextTooLong(text)) return { ok: false, error: playerTextMaxError() };
  const trimmed = trimPlayerText(text);
  if (!trimmed) return { ok: false, error: "Texte vide." };

  const mod = checkHotTakeModeration(trimmed);
  if (mod.blocked) return { ok: false, error: mod.message };

  const session = getHotTakeSession();
  const me = getLocalDisplayName();
  const myUid = localParticipantUid();
  const limit = checkCustomEntryLimit({
    list: session.customTakes || [],
    isMine: (t) => isAuthorOwnedEntryMine(t, me, myUid),
    noun: { one: "prise", many: "prises", feminine: true },
  });
  if (!limit.ok) return { ok: false, error: limit.error };
  const entry = {
    id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    text: trimmed,
    author: me,
    ...(myUid ? { authorUid: myUid } : {}),
  };
  const merged = mergeHotTakeCustomTakes(
    [...(session.customTakes || []), entry],
    [],
    getLocalDisplayName()
  );
  saveStatePatch({ hotTakeGame: { ...session, customTakes: merged, deck: null } });
  if (!isGameSyncActive()) return { ok: true };

  if (isLobbyHost()) {
    await syncHotTakeSession({
      ...session,
      customTakes: merged,
      deck: null,
    });
    return { ok: true };
  }

  const lobbyId = getState().lobby?.id;
  if (!lobbyId) return { ok: true };
  try {
    const { rpcUpsertPlayerCustomEntry } = await import("./gameSessionRpc.js");
    const { applyRemoteSession } = await import("./gameSync.js");
    const { fetchGameSessionByLobby } = await import("./supabaseGame.js");
    const row = await rpcUpsertPlayerCustomEntry({
      lobbyId,
      game: "hottake",
      entry,
    });
    const full = row?.state ? row : await fetchGameSessionByLobby(lobbyId);
    if (full) applyRemoteSession(full);
    return { ok: true };
  } catch (e) {
    // Annule l'ajout optimiste : sinon la prise reste visible chez l'invité seul.
    const cur = getHotTakeSession();
    saveStatePatch({
      hotTakeGame: {
        ...cur,
        customTakes: (cur.customTakes || []).filter((t) => t?.id !== entry.id),
      },
    });
    return {
      ok: false,
      error: isCustomLimitServerError(e) ? e.message : CUSTOM_TAKE_SAVE_ERROR,
    };
  }
}

const CUSTOM_TAKE_SAVE_ERROR =
  "Ta prise n'a pas pu être enregistrée. Vérifie ta connexion et réessaie.";
const CUSTOM_TAKE_DELETE_ERROR =
  "Ta prise n'a pas pu être supprimée. Vérifie ta connexion et réessaie.";

export async function removeCustomTake(takeId) {
  const me = getLocalDisplayName();
  const myUid = localParticipantUid();
  const session = getHotTakeSession();
  const removed = (session.customTakes || [])
    .map(normalizeTake)
    .filter(Boolean)
    .find((t) => t.id === takeId && isAuthorOwnedEntryMine(t, me, myUid));
  const next = (session.customTakes || [])
    .map(normalizeTake)
    .filter(Boolean)
    .filter((t) => !(t.id === takeId && isAuthorOwnedEntryMine(t, me, myUid)));
  saveStatePatch({ hotTakeGame: { ...session, customTakes: next, deck: null } });
  if (!isGameSyncActive()) return { ok: true };

  if (isLobbyHost()) {
    await syncHotTakeSession({ ...session, customTakes: next, deck: null });
    return { ok: true };
  }

  const lobbyId = getState().lobby?.id;
  if (!lobbyId) return { ok: true };
  try {
    const { rpcDeletePlayerCustomEntry } = await import("./gameSessionRpc.js");
    const { applyRemoteSession } = await import("./gameSync.js");
    const { fetchGameSessionByLobby } = await import("./supabaseGame.js");
    const row = await rpcDeletePlayerCustomEntry({
      lobbyId,
      game: "hottake",
      entryId: takeId,
    });
    const full = row?.state ? row : await fetchGameSessionByLobby(lobbyId);
    if (full) applyRemoteSession(full);
    return { ok: true };
  } catch {
    // Remet la prise : elle est toujours dans la partie, donc toujours jouée.
    const cur = getHotTakeSession();
    const list = cur.customTakes || [];
    if (removed && !list.some((t) => t?.id === removed.id)) {
      saveStatePatch({ hotTakeGame: { ...cur, customTakes: [...list, removed] } });
    }
    return { ok: false, error: CUSTOM_TAKE_DELETE_ERROR };
  }
}

export async function setHotTakeReady(playerName, ready) {
  await commitPrepReadyToggle({
    readyKey: playerName,
    ready,
    getSession: getHotTakeSession,
    saveLocal: (session) => saveStatePatch({ hotTakeGame: session }),
    stateKey: "hotTake",
    gameId: "hottake",
    screen: "hottake-prep",
  });
}

export async function toggleLocalHotTakeReady() {
  const name = getLocalDisplayName();
  const session = getHotTakeSession();
  await setHotTakeReady(name, !session.ready[name]);
}

export function allHotTakeReady() {
  const session = getHotTakeSession();
  if (isGameSyncActive()) {
    const remote = hotTakeToRemote(session);
    return allMembersReady(remote.ready || {});
  }
  return getActivePlayerNames().every((n) => session.ready[n]);
}

export async function resetHotTakeReady() {
  const session = getHotTakeSession();
  await syncHotTakeSession({ ...session, ready: {} });
}

export function simulateHotTakeReady(onUpdate) {
  const pool = getActivePlayerNames().filter((n) => n !== getLocalDisplayName());
  let i = 0;
  const id = setInterval(() => {
    if (i >= pool.length) {
      clearInterval(id);
      onUpdate?.();
      return;
    }
    setHotTakeReady(pool[i], true);
    i += 1;
    onUpdate?.();
  }, 600);
  return () => clearInterval(id);
}

export async function markHotTakeLobbyStarted() {
  buildHotTakeDeck();
  const next = {
    ...getHotTakeSession(),
    lobbyStarted: true,
    takeIdx: 0,
    phase: "question",
    votes: {},
    voteEndsAt: null,
    intermissionEndsAt: null,
    matchScores: {},
    lastRound: null,
  };
  return launchGameWithSync({
    screen: "hottake",
    gameId: "hottake",
    mode: "push",
    beforeCommit: async () => {
      if (isGameSyncActive() && isLobbyHost()) {
        const { setLobbyPlaying } = await import("./lobby.js");
        await setLobbyPlaying("hottake");
      }
    },
    applyLocal: () => saveStatePatch({ hotTakeGame: next }),
    getRemoteState: () => ({ hotTake: hotTakeToRemote(next) }),
  });
}

export async function pauseHotTakeVote(pausedByName, remainingSec) {
  const session = getHotTakeSession();
  const rem = Math.max(0, Math.ceil(Number(remainingSec) || 0));
  await syncHotTakeSession({
    ...session,
    pausedBy: pausedByName,
    voteTimerRemaining: rem,
    voteEndsAt: null,
  });
}

export async function resumeHotTakeVote() {
  const session = getHotTakeSession();
  const rem = session.voteTimerRemaining ?? HOT_TAKE_TIMER_SEC;
  await syncHotTakeSession({
    ...session,
    pausedBy: null,
    voteTimerRemaining: null,
    voteEndsAt: new Date(Date.now() + rem * 1000).toISOString(),
  });
}

export async function resetHotTakeSession() {
  await syncHotTakeSession(defaultSession());
}

/** Prep propre après une partie : garde thème / manches, efface customs et deck. */
export function hotTakePrepAfterGameReset() {
  const session = getHotTakeSession();
  return {
    ...defaultSession(),
    selectedThemeId: session.selectedThemeId || HOT_TAKE_CATALOG_ID,
    roundCount: session.roundCount ?? 5,
  };
}

/** Fin de partie : purge les takes custom pour tout le lobby. */
export async function resetHotTakeAfterGame({ syncRemote = true } = {}) {
  const next = hotTakePrepAfterGameReset();
  saveStatePatch({ hotTakeGame: next });
  if (syncRemote && isGameSyncActive() && isLobbyHost()) {
    await syncHotTakeSession(next);
  }
  return next;
}

export async function commitHotTakePlay(patch, patchOpts = {}) {
  return commitHostGamePlay({
    patch,
    gameId: "hottake",
    stateKey: "hotTake",
    getSession: getHotTakeSession,
    saveLocal: (session) => saveStatePatch({ hotTakeGame: session }),
    toRemote: hotTakeToRemote,
    patchOpts,
  });
}

/** Invité MP : envoie uniquement son vote (évite d'écraser phase reveal de l'hôte). Rollback ciblé si sync échoue. */
export async function commitHotTakeVote(choice) {
  const localName = getLocalDisplayName();
  const session = getHotTakeSession();
  const attemptId = ++hotTakeVoteAttemptId;
  // takeIdx = round HotTake (helper générique lit roundIdx)
  const captured = { phase: session.phase, roundIdx: session.takeIdx };
  const apply = computeOptimisticMapEntryApply({
    map: session.votes,
    key: localName,
    value: choice,
  });
  saveStatePatch({ hotTakeGame: { ...session, votes: apply.nextMap } });
  if (!isGameSyncActive()) return { ...session, votes: apply.nextMap };

  try {
    const uid = requireLocalParticipantUid();
    await patchGameStateWithFeedback({ hotTake: { votes: { [uid]: choice } } });
    return { ...session, votes: apply.nextMap };
  } catch (err) {
    const live = getHotTakeSession();
    if (
      attemptId === hotTakeVoteAttemptId &&
      canRollbackOptimisticSubmission(captured, {
        ...live,
        roundIdx: live.takeIdx,
      })
    ) {
      const rolled = rollbackOptimisticMapEntry({
        currentMap: live.votes,
        key: localName,
        hadPreviousValue: apply.hadPreviousValue,
        previousValue: apply.previousValue,
        optimisticValue: apply.optimisticValue,
        attemptId,
        currentAttemptId: hotTakeVoteAttemptId,
      });
      if (rolled.applied) {
        saveStatePatch({ hotTakeGame: { ...live, votes: rolled.map } });
      }
    }
    throw err;
  }
}

export function __resetHotTakeVoteAttemptIdForTests() {
  hotTakeVoteAttemptId = 0;
}

export function getHotTakeVotesForUi() {
  return normalizePlayerVotesMap(getHotTakeSession().votes || {});
}

export function countHotTakeVotesCast(session = getHotTakeSession()) {
  const names = getActivePlayerNames();
  const votes = normalizePlayerVotesMap(session.votes || {}, names);
  return names.filter((name) => votes[name] != null && votes[name] !== "").length;
}

export function countHotTakeVotes() {
  return countHotTakeVotesCast();
}

export function allHotTakeVotesIn(session = getHotTakeSession()) {
  const names = getActivePlayerNames();
  const votes = normalizePlayerVotesMap(session.votes || {}, names);
  return names.length > 0 && names.every((name) => votes[name] != null && votes[name] !== "");
}

export function getHotTakeEntryScreen() {
  const session = getHotTakeSession();
  if (!session.lobbyStarted) return "hottake-prep";
  return "hottake";
}

/** Vote simultané simulé pour tout le lobby */
export function simulateLobbyVotes(localChoice, options) {
  const result = {};
  const local = getLocalDisplayName();
  result[local] = localChoice;

  getActivePlayerNames().forEach((name) => {
    if (name === local) return;
    const bias = Math.random() < 0.35 ? localChoice : null;
    result[name] =
      bias || options[Math.floor(Math.random() * options.length)];
  });
  return result;
}

export function getMajorityOption(votes, options) {
  const counts = options.reduce((acc, opt) => {
    acc[opt] = Object.values(votes).filter((v) => v === opt).length;
    return acc;
  }, {});
  let max = 0;
  options.forEach((opt) => {
    if (counts[opt] > max) max = counts[opt];
  });
  if (max === 0) {
    return { majority: null, tied: false, counts, maxVotes: 0 };
  }
  const leaders = options.filter((opt) => counts[opt] === max);
  if (leaders.length !== 1) {
    return { majority: null, tied: true, counts, maxVotes: max };
  }
  return { majority: leaders[0], tied: false, counts, maxVotes: max };
}

export {
  HOT_TAKE_THEMES,
  HOT_TAKE_ROUND_PRESETS,
  HOT_TAKE_ROUND_ALL,
  HOT_TAKE_CATALOG_ID,
  HOT_TAKE_MIX_ID,
};
