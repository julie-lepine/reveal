import { TIER_LEVELS } from "../../data/tierTopics.js";
import { getActivePlayerNames } from "./players.js";
import { getLobbyParticipants } from "./lobby.js";
import { getLocalDisplayName, getState, saveStatePatch } from "./state.js";
import {
  isTierNightLiveRevealNetworkUncertainty,
  evaluateTierNightLiveRevealRecovery,
} from "./tierNightLiveReveal.js";
import {
  isGameSyncActive,
  requireLocalParticipantUid,
  normalizePlayerVotesMap,
  tierNightLiveToRemote,
  tierNightToRemote,
  userIdForName,
  nameForUserId,
  canActAsHost,
  isLobbyHost,
  refreshGameSession,
  tierNightPrepToRemote,
} from "./gameSync.js";
import { patchGameStateWithFeedback } from "./patchGameStateFeedback.js";
import { launchGameWithSync, commitHostGamePlay } from "./mpLaunch.js";
import { buildRecapsFromPlacements, getTierNightSession } from "./tierNightSession.js";
import { resolveRosterTopicConfig, ROSTER_TOPIC_PREFIX } from "./rosterTopic.js";
import {
  computeOptimisticMapEntryApply,
  rollbackOptimisticMapEntry,
  canRollbackOptimisticSubmission,
} from "./optimisticMapEntry.js";

let tierNightLiveVoteAttemptId = 0;
import { medianTierFromRanks } from "./tierNightScoring.js";
import { setLobbyPlaying } from "./lobby.js";
import { createTierNightRunId } from "./tierNightConfig.js";
import { getTierListById } from "./tierLists.js";
import {
  buildTierNightPlayerRoster,
  getTierNightExpectedVoterIds,
  votesByUidFromMixed,
  countConfirmedTierNightVotes,
  hasAllExpectedTierNightVotes,
  mapVotesForTierNightLiveUi,
  warnUnexpectedTierNightVoteKeys,
  sessionHasTierNightPlayerRoster,
} from "./tierNightRoster.js";
import { buildTierNightSeriesLaunchPayload } from "./tierNightSeriesLaunch.js";

export { prepareTierNightSeriesLaunchAttempt } from "./tierNightSeriesLaunch.js";

const TIER_RANK = { S: 0, A: 1, B: 2, C: 3, D: 4 };

function defaultLive() {
  return {
    runId: null,
    lobbyStarted: false,
    topicId: null,
    listName: "",
    deck: null,
    playerRoster: null,
    roundIdx: 0,
    phase: null,
    votes: {},
    placements: {},
    finished: false,
  };
}

function shuffle(arr) {
  const a = [...(arr || [])];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function emptyPlaced() {
  const placed = {};
  TIER_LEVELS.forEach((t) => {
    placed[t] = [];
  });
  return placed;
}

export function getTierNightLiveSession() {
  return getState().tierNightLiveGame || defaultLive();
}

/** Tier médian d'un item à partir des votes (valeur = tier par votant). */
export function consensusTierForVotes(votesByName) {
  const ranks = Object.values(votesByName || {})
    .filter(Boolean)
    .map((t) => TIER_RANK[t] ?? 4);
  if (!ranks.length) return null;
  return medianTierFromRanks(ranks);
}

function votingPayload(roundIdx) {
  return { roundIdx, phase: "voting", votes: {} };
}

function tierNightLiveResetRemote() {
  return tierNightLiveToRemote({
    runId: null,
    lobbyStarted: false,
    finished: true,
    phase: "done",
    votes: {},
    roundIdx: 0,
    topicId: null,
    listName: "",
    deck: null,
    playerRoster: null,
    placements: {},
  });
}

function tierNightClassicResetRemote() {
  return tierNightToRemote({
    runId: null,
    topicId: null,
    mode: "roster",
    modifier: "normal",
    lobbyStarted: false,
    placements: {},
    finished: {},
    game: null,
    items: null,
    playerRoster: null,
  });
}

/** Lancement MP (hôte) : construit le deck partagé et démarre la 1re manche. */
export async function markTierNightLiveLobbyStarted({ topicId, listName, items }) {
  const runId = createTierNightRunId();
  const deck = shuffle(items);
  const playerRoster = buildTierNightPlayerRoster(getLobbyParticipants());
  const next = {
    ...defaultLive(),
    runId,
    lobbyStarted: true,
    topicId,
    listName,
    deck,
    playerRoster,
    placements: {},
    finished: false,
    ...votingPayload(0),
  };
  return launchGameWithSync({
    screen: "tiernight-live",
    gameId: "tiernight",
    mode: "push",
    beforeCommit: () => setLobbyPlaying("tiernight"),
    applyLocal: () =>
      saveStatePatch({
        tierNightLiveGame: next,
        tierNightGame: { runId, recaps: [], topicId: null, listName: "", controversialItem: null },
      }),
    getRemoteState: () => ({
      tierNightLive: tierNightLiveToRemote(next),
      tierNight: tierNightClassicResetRemote(),
    }),
  });
}

/** MP : envoie uniquement le vote local (merge additif côté serveur).
 * Rollback conditionnel lié au runId courant. */
export async function commitTierNightLiveVote(tier) {
  const localName = getLocalDisplayName();
  const session = getTierNightLiveSession();
  if (session.phase !== "voting") return session.votes?.[localName] ?? null;

  const attemptId = ++tierNightLiveVoteAttemptId;
  const captured = {
    runId: session.runId,
    phase: session.phase,
  };
  const apply = computeOptimisticMapEntryApply({
    map: session.votes,
    key: localName,
    value: tier,
  });
  saveStatePatch({ tierNightLiveGame: { ...session, votes: apply.nextMap } });
  if (!isGameSyncActive()) return tier;

  try {
    const uid = requireLocalParticipantUid();
    await patchGameStateWithFeedback(
      { tierNightLive: { votes: { [uid]: tier } } },
      { gameId: "tiernight", screen: "tiernight-live" }
    );
    return tier;
  } catch (err) {
    const live = getTierNightLiveSession();
    if (
      attemptId === tierNightLiveVoteAttemptId &&
      canRollbackOptimisticSubmission(captured, live)
    ) {
      const rolled = rollbackOptimisticMapEntry({
        currentMap: live.votes,
        key: localName,
        hadPreviousValue: apply.hadPreviousValue,
        previousValue: apply.previousValue,
        optimisticValue: apply.optimisticValue,
        attemptId,
        currentAttemptId: tierNightLiveVoteAttemptId,
      });
      if (rolled.applied) {
        saveStatePatch({ tierNightLiveGame: { ...live, votes: rolled.map } });
      }
    }
    throw err;
  }
}

export function __resetTierNightLiveVoteAttemptIdForTests() {
  tierNightLiveVoteAttemptId = 0;
}

/** Progression X/Y fondée sur le roster snapshoté (pas getActivePlayers). */
export function getTierNightLiveVoteProgress(session = getTierNightLiveSession()) {
  const expected = getTierNightExpectedVoterIds(session);
  const byUid = votesByUidFromMixed(
    session.votes || {},
    session.playerRoster || [],
    userIdForName
  );
  if (expected.length) {
    warnUnexpectedTierNightVoteKeys(byUid, expected);
    return {
      confirmed: countConfirmedTierNightVotes(byUid, expected),
      expected: expected.length,
      votesByUid: byUid,
    };
  }
  const names = getActivePlayerNames();
  const votes = normalizePlayerVotesMap(session.votes || {}, names);
  const confirmed = names.filter((n) => votes[n] != null && votes[n] !== "").length;
  return { confirmed, expected: names.length, votesByUid: byUid };
}

export function allTierNightLiveVotesIn(session = getTierNightLiveSession()) {
  const expected = getTierNightExpectedVoterIds(session);
  const votesByUid = votesByUidFromMixed(
    session.votes || {},
    session.playerRoster || [],
    userIdForName
  );
  if (expected.length) {
    warnUnexpectedTierNightVoteKeys(votesByUid, expected);
    return hasAllExpectedTierNightVotes(votesByUid, expected);
  }
  const names = getActivePlayerNames();
  const votes = normalizePlayerVotesMap(session.votes || {}, names);
  return names.length > 0 && names.every((n) => votes[n] != null && votes[n] !== "");
}

/** Accumule les votes de la manche courante dans les placements (par displayName snapshoté). */
export function accumulatePlacements(session = getTierNightLiveSession()) {
  const roster = session.playerRoster;
  const votes = sessionHasTierNightPlayerRoster(session)
    ? mapVotesForTierNightLiveUi(session.votes || {}, roster, nameForUserId)
    : normalizePlayerVotesMap(session.votes || {}, getActivePlayerNames());
  const item = session.deck?.[session.roundIdx];
  const placements = { ...(session.placements || {}) };
  if (item == null) return placements;
  Object.entries(votes).forEach(([name, tier]) => {
    if (!tier) return;
    const placed = placements[name] ? { ...placements[name] } : emptyPlaced();
    TIER_LEVELS.forEach((t) => {
      placed[t] = [...(placed[t] || [])];
    });
    if (!placed[tier].includes(item)) placed[tier].push(item);
    placements[name] = placed;
  });
  return placements;
}

/** Commit hôte (phase/round/placements). */
export async function commitTierNightLivePlay(patch, patchOpts = {}) {
  return commitHostGamePlay({
    patch,
    gameId: "tiernight",
    screen: "tiernight-live",
    stateKey: "tierNightLive",
    getSession: getTierNightLiveSession,
    saveLocal: (s) => saveStatePatch({ tierNightLiveGame: s }),
    toRemote: tierNightLiveToRemote,
    patchOpts,
  });
}

/**
 * BUG-TIERNIGHT-03 - commit reveal avec recovery si résultat réseau incertain.
 * N'alerte pas ici (l'UI décide auto vs manuel). Pas d'optimistic phase locale.
 *
 * @param {{ requireAllVotes?: boolean, source?: string }} [opts]
 * @returns {Promise<{
 *   ok: boolean,
 *   session?: object,
 *   recovered?: boolean,
 *   reason?: string,
 *   uncertain?: boolean,
 *   error?: Error,
 * }>}
 */
export async function commitTierNightLiveRevealSafely(opts = {}) {
  const { requireAllVotes = true, source = "auto" } = opts;
  const session = getTierNightLiveSession();

  if (session.phase === "reveal" || session.phase === "done") {
    return { ok: true, session, recovered: false, reason: "already-reveal" };
  }
  if (session.phase !== "voting") {
    return { ok: false, reason: "wrong-phase" };
  }
  if (isGameSyncActive() && !canActAsHost()) {
    return { ok: false, reason: "not-host" };
  }
  if (requireAllVotes && !allTierNightLiveVotesIn(session)) {
    return { ok: false, reason: "incomplete" };
  }

  const runId = session.runId;
  const roundIdx = session.roundIdx;
  const placements = accumulatePlacements(session);

  try {
    const next = await commitTierNightLivePlay(
      { phase: "reveal", placements },
      // Feedback UI géré par le mount (alerte auto distincte du toast sync générique).
      { withPatchFeedback: false }
    );
    return {
      ok: true,
      session: next || getTierNightLiveSession(),
      recovered: false,
      reason: "committed",
      source,
    };
  } catch (err) {
    console.warn("[TIERNIGHT-03] reveal commit failed", {
      source,
      message: err?.message || String(err),
      code: err?.code || null,
      uncertain: isTierNightLiveRevealNetworkUncertainty(err),
    });

    if (!isTierNightLiveRevealNetworkUncertainty(err)) {
      return {
        ok: false,
        reason: "certain-failure",
        uncertain: false,
        error: err,
      };
    }

    try {
      const fresh = await refreshGameSession();
      const remote = fresh?.state?.tierNightLive;
      const recovery = evaluateTierNightLiveRevealRecovery(remote, {
        runId,
        roundIdx,
      });
      if (recovery.recovered) {
        return {
          ok: true,
          session: getTierNightLiveSession(),
          recovered: true,
          reason: recovery.reason,
        };
      }
      return {
        ok: false,
        reason: recovery.reason || "uncertain-still-voting",
        uncertain: true,
        error: err,
      };
    } catch (refreshErr) {
      console.warn("[TIERNIGHT-03] reveal recovery refresh failed", refreshErr);
      return {
        ok: false,
        reason: "uncertain-refresh-failed",
        uncertain: true,
        error: err,
      };
    }
  }
}

/** Construit les recaps finaux à partir des placements accumulés (hôte). */
export function buildTierNightLiveRecaps(session = getTierNightLiveSession()) {
  return buildRecapsFromPlacements(
    session.topicId,
    session.listName,
    session.deck || [],
    session.placements || {}
  );
}

/** Marque la partie live terminée côté serveur (sort tout le monde de l'écran live). */
export async function markTierNightLiveFinished() {
  await commitTierNightLivePlay({ phase: "done", finished: true, votes: {} });
}

export function resetTierNightLive() {
  saveStatePatch({ tierNightLiveGame: defaultLive() });
}

/**
 * Lancement MP Classe le groupe / plateau mono-thème (hôte).
 * FEATURE-TIERNIGHT-03-F — toute *nouvelle* session roster classic est refusée.
 * (Sessions legacy déjà actives se lisent hors de ce helper.)
 */
export async function markTierNightClassicStarted({ topicId, mode, modifier }) {
  if (mode === "roster" || mode == null || mode === "") {
    console.error(
      "FEATURE-TIERNIGHT-03-F: markTierNightClassicStarted blocked — parcours série final"
    );
    return {
      ok: false,
      error: "Le parcours série est actif : lancez depuis la préparation.",
      code: "SERIES_GATE_BLOCKS_CLASSIC",
    };
  }

  const runId = createTierNightRunId();
  const playerRoster = buildTierNightPlayerRoster(getLobbyParticipants());
  const sessionSnap = getState().tierNightGame || null;

  let list;
  if (typeof topicId === "string" && topicId.startsWith(ROSTER_TOPIC_PREFIX)) {
    const config = resolveRosterTopicConfig(topicId, sessionSnap);
    if (!config.found) {
      console.warn("[TierNight] unknown roster topic", topicId);
      return { ok: false, error: "Thème introuvable." };
    }
    list = {
      id: config.topicId,
      name: config.listName,
      emoji: config.topicEmoji,
      roster: true,
      custom: config.custom,
      items: playerRoster.map((p) => p.displayName),
    };
  } else {
    list = getTierListById(topicId);
  }
  if (!list) {
    return { ok: false, error: "Liste introuvable." };
  }

  const listName = list.name || "";
  const topicEmoji = list.custom ? "" : list.emoji || "👥";
  const items = list.roster
    ? playerRoster.map((p) => p.displayName)
    : [...(list.items || [])];

  saveStatePatch({
    tierNightTopicId: topicId,
    tierNightMode: mode,
    tierNightModifier: modifier,
    tierNightGame: {
      runId,
      recaps: [],
      topicId,
      listName,
      topicEmoji,
      controversialItem: null,
      items,
      playerRoster,
    },
    tierNightLiveGame: defaultLive(),
  });
  const remoteTierNight = tierNightToRemote({
    runId,
    topicId,
    mode,
    modifier,
    lobbyStarted: true,
    placements: {},
    finished: {},
    game: true,
    items,
    playerRoster,
    listName,
    topicEmoji,
  });
  return launchGameWithSync({
    screen: "tiernight",
    gameId: "tiernight",
    mode: "push",
    beforeCommit: () => setLobbyPlaying("tiernight"),
    applyLocal: () => {},
    getRemoteState: () => ({
      tierNight: remoteTierNight,
      tierNightLive: tierNightLiveResetRemote(),
    }),
  });
}

/**
 * FEATURE-TIERNIGHT-SERIES-04 / 03-B1 — lancement MP/local d’une série (manche 1).
 * Ne finalise pas la manche ; n’appelle pas la RPC SERIES-03.
 * Application locale immédiate ; consumed + reset prep dans la même mutation remote.
 *
 * @param {object} opts
 * @param {object} opts.attempt — sortie de prepareTierNightSeriesLaunchAttempt
 * @param {string[]} [opts.consumedCustomRosterTopicIds] — ledger one-shot (même mutation)
 * @param {object|null} [opts.resetPrepSession] — prep reset publié avec le launch
 */
export async function markTierNightSeriesStarted({
  attempt,
  consumedCustomRosterTopicIds = null,
  resetPrepSession = null,
} = {}) {
  if (isGameSyncActive() && !isLobbyHost()) {
    return { ok: false, error: "Seul l'hôte peut lancer la série." };
  }

  const built = buildTierNightSeriesLaunchPayload(attempt);
  if (!built.ok) {
    return {
      ok: false,
      error: built.error || "Tentative de lancement série invalide.",
      code: built.code,
    };
  }

  const previousLocal = {
    tierNightTopicId: getState().tierNightTopicId,
    tierNightMode: getState().tierNightMode,
    tierNightModifier: getState().tierNightModifier,
    tierNightGame: getState().tierNightGame ? { ...getState().tierNightGame } : null,
    consumedCustomRosterTopicIds: Array.isArray(getState().consumedCustomRosterTopicIds)
      ? [...getState().consumedCustomRosterTopicIds]
      : [],
    tierNightSeriesPrep: getState().tierNightSeriesPrep
      ? { ...getState().tierNightSeriesPrep }
      : null,
  };

  const localGame = {
    ...built.localGame,
    lobbyStarted: true,
  };

  const localPatch = {
    tierNightTopicId: built.topicId,
    tierNightMode: built.mode,
    tierNightModifier: built.modifier,
    tierNightGame: localGame,
    tierNightLiveGame: defaultLive(),
  };
  if (Array.isArray(consumedCustomRosterTopicIds)) {
    localPatch.consumedCustomRosterTopicIds = consumedCustomRosterTopicIds.map(String);
  }
  if (resetPrepSession && typeof resetPrepSession === "object") {
    localPatch.tierNightSeriesPrep = { ...resetPrepSession };
  }

  // Application locale immédiate (Realtime confirme / merge, ne déclenche pas seul)
  saveStatePatch(localPatch);

  if (!isGameSyncActive()) {
    return { ok: true, localOnly: true, attempt, previousLocal };
  }

  try {
    const result = await launchGameWithSync({
      screen: "tiernight",
      gameId: "tiernight",
      mode: "push",
      beforeCommit: () => setLobbyPlaying("tiernight"),
      applyLocal: () => {
        saveStatePatch(localPatch);
      },
      getRemoteState: () => {
        const remote = {
          tierNight: built.remoteTierNight,
          tierNightLive: tierNightLiveResetRemote(),
        };
        if (Array.isArray(consumedCustomRosterTopicIds)) {
          remote.consumedCustomRosterTopicIds = consumedCustomRosterTopicIds.map(String);
        }
        if (resetPrepSession && typeof resetPrepSession === "object") {
          remote.tierNightPrep = tierNightPrepToRemote(resetPrepSession);
        }
        return remote;
      },
    });

    if (result?.ok === false) {
      saveStatePatch(previousLocal);
      return {
        ...result,
        attempt,
        rolledBack: true,
      };
    }

    return { ...result, attempt, ok: result?.ok !== false };
  } catch (error) {
    saveStatePatch(previousLocal);
    return {
      ok: false,
      error: error?.message || "Échec du lancement série.",
      attempt,
      rolledBack: true,
      uncertain: true,
    };
  }
}

export { votingPayload as tierNightLiveVotingPayload };
