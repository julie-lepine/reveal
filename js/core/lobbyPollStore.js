/**
 * Vague 2 — store unique sondages + fetch + Realtime.
 *
 * Realtime (un seul canal / lobby, rebuild sérialisé) :
 * - topic unique par génération : lobby-polls:${lobbyId}:${gen}
 * - lobby_polls toujours écouté (filter lobby_id)
 * - lobby_poll_votes seulement si activePollId
 * - removeChannel await sur la référence capturée avant create
 * - join-reply (CHANNEL_ERROR + joining) : replace immédiat + catch-up HTTP au SUBSCRIBED
 *
 * INSERT/UPDATE close appliqués immédiatement au store (pas uniquement via refetch).
 */
import { GAMES_AVAILABLE } from "../../data/games.js";
import { getLobby, getLobbyParticipants, hasActiveLobby } from "./lobby.js";
import { getSupabaseUserId, authReady, isAuthReadyResolved } from "./supabaseAuth.js";
import { supabase, isSupabaseConfigured } from "./supabaseClient.js";
import {
  getCachedGameSession,
  isLobbyHost,
  canActAsHost,
  refreshGameSession,
} from "./gameSync.js";
import { getCurrentScreen, onScreenChange } from "./router.js";
import { onLobbyBundleUpdated, whenLobbyRealtimeReady, getLobbyRealtimeStatus, onLobbyRealtimeStatus, getLobbyRealtimeMeta } from "./supabaseLobby.js";
import {
  rtSocketProbesEnabled,
  runSharedSocketProbes,
  pollShouldWaitForLobbyRealtime,
} from "./realtimeSocketDiagnose.js";
import {
  decidePollAfterLobbyWait,
  shouldWakePollOnLobbySubscribed,
} from "./lobbyRealtimeGate.js";
import { isChatFabAllowedScreen } from "./chatFabScreens.js";
import {
  normalizeLobbyPollRow,
  normalizeVotesAllByUserId,
  applyVoteUpsert,
  filterActiveVotes,
  tallyActiveResults,
  resolvePollLeader,
  canOfferPollCreate,
  buildPollOptionsSnapshot,
  validatePollOptionsClient,
  localScreenAllowsPollCreate,
  shouldApplyPollFetchResult,
  shouldRefetchOnVoteRealtime,
  shouldRestoreOptimisticVote,
  isRealtimeActivePollClose,
  isRealtimeOpenPollInsert,
  computeUnseenPollOnNewId,
  shouldApplyReplacementCatchup,
} from "./lobbyPollLogic.js";
import {
  createPollChannelController,
  pollRealtimeReconnectDelayMs,
} from "./lobbyPollChannel.js";
import {
  rpcCreateLobbyPoll,
  rpcCastLobbyPollVote,
  rpcCloseLobbyPoll,
  fetchOpenLobbyPoll,
  fetchLobbyPollVotes,
} from "./lobbyPollRpc.js";
import {
  extractLobbyPollErrorCode,
  formatLobbyPollRpcError,
} from "./lobbyPollErrors.js";

const listeners = new Set();

const initialCommitting = () => ({ create: false, vote: false, close: false });

/** Logs [POLL-RT] : activer via localStorage.setItem('reveal-poll-rt-debug','1') */
function pollRtEnabled() {
  try {
    return (
      typeof localStorage !== "undefined" &&
      localStorage.getItem("reveal-poll-rt-debug") === "1"
    );
  } catch {
    return false;
  }
}

function pollRtLog(tag, data = {}) {
  if (!pollRtEnabled()) return;
  console.info(`[POLL-RT] ${tag}`, {
    lobbyId: store.lobbyId,
    channelLobbyId: channelCtrl?.getState()?.channelLobbyId ?? null,
    activePollId: store.activePoll?.id ?? null,
    channelVotesPollId: channelCtrl?.getState()?.channelVotesPollId ?? null,
    eventType: data.eventType ?? null,
    newPollId: data.newPollId ?? null,
    oldStatus: data.oldStatus ?? null,
    newStatus: data.newStatus ?? null,
    subscriptionStatus:
      data.subscriptionStatus ??
      store.subscriptionStatus ??
      channelCtrl?.getState()?.subscriptionStatus ??
      null,
    authReadyResolved: isAuthReadyResolved(),
    reconnectAttempt: pollReconnectAttempts,
    reconnectDelay: data.reconnectDelay ?? null,
    ...data,
  });
}

let store = {
  lobbyId: null,
  activePoll: null,
  votesAllByUserId: {},
  loading: false,
  error: null,
  subscriptionStatus: "idle",
  committing: initialCommitting(),
  /** Pastille FAB : poll open non consulté (indépendant des messages non lus). */
  unseenPoll: false,
};

let fetchGen = 0;
let debounceTimer = null;
let started = false;
let unsubBundle = null;
let unsubScreen = null;
let unsubLobbyRt = null;
let socketProbesStarted = false;
/** Coalesce des queueVotesSubscription concurrentes (même config). */
let pollSubscribeInFlight = null;
let pollSubscribeInFlightKey = null;
/** Après premier hydrate d'un poll déjà open : pas de fausse alerte « nouveau ». */
let hasHydratedPollOnce = false;
/** poll id créé localement — pas de pastille. */
let suppressUnseenForPollId = null;
/** Dernier poll id « vu » (sheet ouvert / hydrate). */
let lastSeenPollId = null;

let sheetOpenGetter = () => false;

/** @type {ReturnType<typeof createPollChannelController>|null} */
let channelCtrl = null;

let pollReconnectTimer = null;
let pollReconnectAttempts = 0;
/** Promise auth injectable (tests). */
let authReadyForSync = authReady;
/** True après await authReady dans init — autorise subscribe. */
let authGatePassed = false;
/** Coalesce catch-up join-reply (même lobby). */
let joinReplyCatchupInFlight = null;
let joinReplyCatchupLobbyId = null;

function clearPollRealtimeReconnect() {
  if (pollReconnectTimer) {
    clearTimeout(pollReconnectTimer);
    pollReconnectTimer = null;
  }
  channelCtrl?.setReconnectTimerActive?.(false);
}

function resetPollRealtimeReconnectBackoff() {
  pollReconnectAttempts = 0;
  clearPollRealtimeReconnect();
}

/**
 * Reconnect manuel après CLOSED involontaire uniquement
 * (ou join-reply si circuit anti-boucle ouvert). Pas sur phx_error / TIMED_OUT.
 */
function schedulePollRealtimeReconnect() {
  if (!started || !authGatePassed || pollReconnectTimer) return;
  const lobbyIdAtSchedule = store.lobbyId;
  if (!lobbyIdAtSchedule) return;

  const delay = pollRealtimeReconnectDelayMs(pollReconnectAttempts);
  pollRtLog("reconnect scheduled", {
    reconnectAttempt: pollReconnectAttempts,
    reconnectDelay: delay,
    authReadyResolved: isAuthReadyResolved(),
    reason: "involuntary_closed",
  });
  pollReconnectAttempts += 1;
  pollReconnectTimer = setTimeout(() => {
    pollReconnectTimer = null;
    channelCtrl?.setReconnectTimerActive?.(false);
    void (async () => {
      if (!started || !authGatePassed) return;
      if (store.lobbyId !== lobbyIdAtSchedule) return;
      try {
        await authReadyForSync;
      } catch {
        return;
      }
      if (!started || store.lobbyId !== lobbyIdAtSchedule) return;
      pollRtLog("reconnect fire", {
        reconnectAttempt: pollReconnectAttempts,
        reconnectDelay: delay,
      });
      queueVotesSubscription({ reason: "reconnect_after_closed" });
    })();
  }, delay);
  channelCtrl?.setReconnectTimerActive?.(true);
}

/**
 * Catch-up HTTP après replace join-reply (SUBSCRIBED).
 * Traité comme récupération live (pas hydrate initial) pour la pastille.
 * @param {{
 *   lobbyId?: string|null,
 *   channelGen?: number|null,
 *   votesPollId?: string|null,
 *   topic?: string|null,
 *   reason?: string|null,
 * }} meta
 */
function runJoinReplyReplacementCatchup(meta = {}) {
  const lobbyId = meta.lobbyId || store.lobbyId;
  const expectedGen = meta.channelGen ?? null;

  console.info("[POLL-RT] replacement_catchup_start", {
    lobbyId,
    oldChannelGen: null,
    newChannelGen: expectedGen,
    topic: meta.topic ?? channelCtrl?.getState()?.topic ?? null,
    votesPollId: meta.votesPollId ?? store.activePoll?.id ?? null,
    channelState: channelCtrl?.getState()?.subscriptionStatus ?? null,
    reason: meta.reason || "join_reply_error_replace",
  });

  if (
    !shouldApplyReplacementCatchup({
      expectedChannelGen: expectedGen,
      currentChannelGen: channelCtrl?.getState()?.channelGen ?? null,
      catchupLobbyId: lobbyId,
      storeLobbyId: store.lobbyId,
      started,
    })
  ) {
    pollRtLog("replacement_catchup_skipped", {
      lobbyId,
      expectedGen,
      currentGen: channelCtrl?.getState()?.channelGen ?? null,
    });
    return Promise.resolve();
  }

  if (joinReplyCatchupInFlight && joinReplyCatchupLobbyId === lobbyId) {
    pollRtLog("replacement_catchup_coalesced", { lobbyId });
    return joinReplyCatchupInFlight;
  }

  joinReplyCatchupLobbyId = lobbyId;
  joinReplyCatchupInFlight = (async () => {
    try {
      await refreshLobbyPoll(lobbyId, {
        quiet: true,
        liveCatchup: true,
        expectedChannelGen: expectedGen,
      });
      if (
        !shouldApplyReplacementCatchup({
          expectedChannelGen: expectedGen,
          currentChannelGen: channelCtrl?.getState()?.channelGen ?? null,
          catchupLobbyId: lobbyId,
          storeLobbyId: store.lobbyId,
          started,
        })
      ) {
        return;
      }
      console.info("[POLL-RT] replacement_catchup_applied", {
        lobbyId,
        oldChannelGen: null,
        newChannelGen: channelCtrl?.getState()?.channelGen ?? expectedGen,
        topic: channelCtrl?.getState()?.topic ?? meta.topic ?? null,
        votesPollId: store.activePoll?.id ?? null,
        channelState: channelCtrl?.getState()?.subscriptionStatus ?? null,
        reason: meta.reason || "join_reply_error_replace",
        activePollId: store.activePoll?.id ?? null,
        unseenPoll: store.unseenPoll,
      });
    } finally {
      if (joinReplyCatchupLobbyId === lobbyId) {
        joinReplyCatchupInFlight = null;
        joinReplyCatchupLobbyId = null;
      }
    }
  })();

  return joinReplyCatchupInFlight;
}

function emit() {
  for (const fn of listeners) {
    try {
      fn(getLobbyPollSnapshot());
    } catch (e) {
      console.warn("REVEAL lobbyPoll listener:", e);
    }
  }
}

function setStore(patch) {
  store = { ...store, ...patch };
  if (patch.committing) {
    store.committing = { ...store.committing, ...patch.committing };
  }
  emit();
}

export function getLobbyPollState() {
  return store;
}

export function onLobbyPollChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function activeMemberIdsFromLobby() {
  return (getLobbyParticipants() || [])
    .map((p) => p.userId)
    .filter(Boolean)
    .map(String);
}

export function getLobbyPollDerived(state = store) {
  const activeMemberIds = activeMemberIdsFromLobby();
  const votesActiveByUserId = filterActiveVotes(
    state.votesAllByUserId,
    activeMemberIds
  );
  const uid = getSupabaseUserId();
  const myVote = uid ? votesActiveByUserId[uid] ?? null : null;
  const options = state.activePoll?.options || [];
  const resultsByOption = tallyActiveResults(options, votesActiveByUserId);
  const leader = resolvePollLeader(resultsByOption);
  const activeVoterCount = Object.keys(votesActiveByUserId).length;
  const activeMemberCount = activeMemberIds.length;

  const sessionRow = getCachedGameSession();
  const lobbyGameId = getLobby()?.gameId ?? null;
  const localScreen = getCurrentScreen();

  const canCreate = canOfferPollCreate({
    localScreen,
    sessionRow,
    lobbyGameId,
    activePoll: state.activePoll,
  });

  const canCloseExplicit =
    Boolean(state.activePoll) &&
    (isLobbyHost() || canActAsHost()) &&
    !state.committing.close;

  const showCreateCta =
    canCreate &&
    isChatFabAllowedScreen(localScreen) &&
    localScreenAllowsPollCreate(localScreen);

  return {
    activeMemberIds,
    votesActiveByUserId,
    myVote,
    activeVoterCount,
    activeMemberCount,
    resultsByOption,
    leader,
    canCreate,
    canCloseExplicit,
    showCreateCta,
    localScreen,
  };
}

export function getLobbyPollSnapshot() {
  return {
    ...store,
    committing: { ...store.committing },
    derived: getLobbyPollDerived(store),
    catalogGames: GAMES_AVAILABLE.map((g) => ({
      id: g.id,
      title: g.title,
      emoji: g.emoji,
    })),
  };
}

function schedulePollRefetch(lobbyId) {
  if (!lobbyId) return;
  pollRtLog("schedule refetch", { lobbyId });
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void refreshLobbyPoll(lobbyId, { quiet: true });
  }, 120);
}

function isSheetOpen() {
  try {
    return sheetOpenGetter?.() === true;
  } catch {
    return false;
  }
}

/**
 * Applique un poll open (INSERT Realtime ou fetch).
 * @param {object} poll
 * @param {{ localCreate?: boolean, fromRealtime?: boolean, clearVotes?: boolean }} [opts]
 */
function applyOpenPollSnapshot(poll, opts = {}) {
  if (!poll?.id) return;
  const { localCreate = false, fromRealtime = false, clearVotes = true } = opts;
  const prevId = store.activePoll?.id || null;
  const samePoll = prevId === poll.id;

  setStore({
    activePoll: poll,
    votesAllByUserId: samePoll && !clearVotes ? store.votesAllByUserId : {},
    error: null,
  });

  const badge = computeUnseenPollOnNewId({
    pollId: poll.id,
    lastSeenPollId,
    sheetOpen: isSheetOpen(),
    localCreate: localCreate || suppressUnseenForPollId === poll.id,
    isInitialHydrate: !hasHydratedPollOnce && !fromRealtime,
  });
  lastSeenPollId = badge.lastSeenPollId;
  hasHydratedPollOnce = true;
  if (localCreate || suppressUnseenForPollId === poll.id) {
    suppressUnseenForPollId = poll.id;
    lastSeenPollId = poll.id;
    setStore({ unseenPoll: false });
  } else {
    setStore({ unseenPoll: badge.unseenPoll });
  }

  // Rebuild canal hors stack Realtime (queue sérialisée)
  queueVotesSubscription({ reason: "sync" });
}

/**
 * Fermeture : store d'abord, rebuild polls-only ensuite, refetch contrôle.
 */
export function applyActivePollClosedLocally(
  lobbyId,
  { scheduleRefetch = true } = {}
) {
  pollRtLog("apply close", {
    lobbyId,
    activePollId: store.activePoll?.id,
  });
  invalidatePollFetches();
  setStore({
    activePoll: null,
    votesAllByUserId: {},
    committing: { ...store.committing, close: false },
    unseenPoll: false,
  });
  suppressUnseenForPollId = null;
  queueVotesSubscription({ reason: "sync" });
  if (scheduleRefetch && lobbyId) {
    schedulePollRefetch(lobbyId);
  }
}

function handleLobbyPollsRealtime(payload, lobbyId) {
  pollRtLog("polls event", {
    lobbyId,
    eventType: payload?.eventType || payload?.event,
    newPollId: payload?.new?.id,
    oldStatus: payload?.old?.status,
    newStatus: payload?.new?.status,
  });

  if (isRealtimeActivePollClose(payload, store.activePoll?.id)) {
    applyActivePollClosedLocally(lobbyId, { scheduleRefetch: true });
    return;
  }

  if (isRealtimeOpenPollInsert(payload, lobbyId)) {
    const poll = normalizeLobbyPollRow(payload.new);
    if (poll?.status === "open") {
      pollRtLog("apply insert", {
        lobbyId,
        newPollId: poll.id,
        newStatus: poll.status,
      });
      applyOpenPollSnapshot(poll, {
        fromRealtime: true,
        clearVotes: true,
      });
      // Normalise options + votes
      schedulePollRefetch(lobbyId);
      return;
    }
  }

  // Autre UPDATE (ex. champs non close) → refetch
  schedulePollRefetch(lobbyId);
}

function handleLobbyVotesRealtime(payload, lobbyId) {
  pollRtLog("votes event", {
    lobbyId,
    eventType: payload?.eventType || payload?.event,
    newPollId: payload?.new?.poll_id || payload?.old?.poll_id,
  });
  const eventPollId = payload?.new?.poll_id || payload?.old?.poll_id;
  if (
    !shouldRefetchOnVoteRealtime({
      activePollId: store.activePoll?.id,
      eventPollId,
    })
  ) {
    return;
  }
  schedulePollRefetch(lobbyId);
}

function ensureChannelController() {
  if (channelCtrl) return channelCtrl;
  channelCtrl = createPollChannelController({
    createChannel: (topic) => {
      if (!supabase) throw new Error("no_supabase");
      return supabase.channel(topic);
    },
    removeChannel: async (ch) => {
      if (!supabase || !ch) return;
      await supabase.removeChannel(ch);
    },
    onPollsEvent: (payload, lobbyId) => handleLobbyPollsRealtime(payload, lobbyId),
    onVotesEvent: (payload, lobbyId) => handleLobbyVotesRealtime(payload, lobbyId),
    onStatusChange: (status) => {
      setStore({ subscriptionStatus: status });
    },
    onSubscribed: (meta) => {
      resetPollRealtimeReconnectBackoff();
      if (meta?.reason === "join_reply_error_replace") {
        void runJoinReplyReplacementCatchup(meta);
      }
    },
    onInvoluntaryClosed: () => {
      schedulePollRealtimeReconnect();
    },
    log: (tag, data) => pollRtLog(tag, data),
  });
  return channelCtrl;
}

function queueVotesSubscription({ reason = "queueVotesSubscription" } = {}) {
  if (!authGatePassed) {
    pollRtLog("queueVotesSubscription blocked (auth gate)", {
      authReadyResolved: isAuthReadyResolved(),
      reason,
    });
    return;
  }
  const lobbyId = store.lobbyId;
  if (!lobbyId || !isSupabaseConfigured() || !supabase) {
    setStore({ subscriptionStatus: "idle" });
    return;
  }
  const pollId =
    store.activePoll?.status === "open" ? store.activePoll.id : null;
  const key = `${lobbyId}::${pollId || ""}`;
  if (pollSubscribeInFlight && pollSubscribeInFlightKey === key) {
    pollRtLog("queueVotesSubscription coalesced", { reason, key });
    return pollSubscribeInFlight;
  }

  const ctrl = ensureChannelController();
  const waitedLobbyId = lobbyId;
  const waitMeta = getLobbyRealtimeMeta();

  pollSubscribeInFlightKey = key;
  pollSubscribeInFlight = (async () => {
    try {
      // Sérialisation défensive : attendre SUBSCRIBED lobby (mitigation _onConnClose).
      // Timeout → abandon_wait_future : on N'ouvre PAS le poll (évite la course).
      // Un futur lobby_realtime_subscribed matching réveillera.
      if (
        pollShouldWaitForLobbyRealtime({
          inLobby: hasActiveLobby(),
          lobbyRealtimeStatus: getLobbyRealtimeStatus(),
        })
      ) {
        pollRtLog("wait lobby realtime before poll channel", {
          reason,
          lobbyRealtimeStatus: getLobbyRealtimeStatus(),
          waitedLobbyId,
          minGen: waitMeta.gen,
        });
        const ready = await whenLobbyRealtimeReady({
          timeoutMs: 12000,
          lobbyId: waitedLobbyId,
        });
        pollRtLog("lobby realtime wait result", { reason, ...ready });
        const decision = decidePollAfterLobbyWait({
          readyOk: ready?.ok === true,
          reason: ready?.reason,
          waitedLobbyId,
          storeLobbyId: store.lobbyId,
          started,
        });
        if (decision.action !== "open_poll") {
          pollRtLog("poll open deferred", decision);
          return;
        }
      }

      if (!started || store.lobbyId !== waitedLobbyId) return;

      await ctrl.requestRebuild(waitedLobbyId, pollId, { reason });
      const st = ctrl.getState();
      if (
        st.subscriptionStatus === "subscribed" ||
        st.subscriptionStatus === "subscribing" ||
        st.subscriptionStatus === "degraded"
      ) {
        setStore({ subscriptionStatus: st.subscriptionStatus });
      } else if (st.subscriptionStatus === "error") {
        setStore({ subscriptionStatus: "error" });
      }
    } finally {
      if (pollSubscribeInFlightKey === key) {
        pollSubscribeInFlight = null;
        pollSubscribeInFlightKey = null;
      }
    }
  })();

  return pollSubscribeInFlight;
}

/** Branché depuis feedbackUi pour pastille / create local. */
export function setLobbyPollSheetOpenGetter(fn) {
  sheetOpenGetter = typeof fn === "function" ? fn : () => false;
}

export function markLobbyPollSeen() {
  if (store.activePoll?.id) {
    lastSeenPollId = store.activePoll.id;
  }
  if (store.unseenPoll) {
    setStore({ unseenPoll: false });
  }
}

export function getLobbyPollUnseen() {
  return Boolean(store.unseenPoll);
}

/**
 * @param {string|null} lobbyId
 * @param {{
 *   quiet?: boolean,
 *   liveCatchup?: boolean,
 *   expectedChannelGen?: number|null,
 * }} [opts]
 */
export async function refreshLobbyPoll(
  lobbyId,
  { quiet = false, liveCatchup = false, expectedChannelGen = null } = {}
) {
  pollRtLog("refetch start", { lobbyId, quiet, liveCatchup, expectedChannelGen });

  const channelGenStillCurrent = () => {
    if (expectedChannelGen == null) return true;
    return channelCtrl?.getState()?.channelGen === expectedChannelGen;
  };

  if (!channelGenStillCurrent()) {
    pollRtLog("refetch result", {
      lobbyId,
      skipped: true,
      reason: "stale_channel_gen_before",
      expectedChannelGen,
    });
    return;
  }

  if (!lobbyId || !isSupabaseConfigured()) {
    invalidatePollFetches();
    setStore({
      lobbyId: lobbyId || null,
      activePoll: null,
      votesAllByUserId: {},
      loading: false,
      error: quiet ? store.error : null,
    });
    queueVotesSubscription({ reason: "refresh_no_lobby" });
    return;
  }

  const gen = ++fetchGen;
  if (!quiet) setStore({ loading: true, error: null, lobbyId });

  try {
    const row = await fetchOpenLobbyPoll(lobbyId);
    if (
      !shouldApplyPollFetchResult({
        gen,
        currentGen: fetchGen,
        requestedLobbyId: lobbyId,
        storeLobbyId: store.lobbyId,
      }) ||
      !channelGenStillCurrent()
    ) {
      pollRtLog("refetch result", {
        lobbyId,
        skipped: true,
        reason: channelGenStillCurrent() ? "stale_gen" : "stale_channel_gen",
      });
      return;
    }

    if (!row) {
      pollRtLog("refetch result", { lobbyId, open: false, liveCatchup });
      setStore({
        lobbyId,
        activePoll: null,
        votesAllByUserId: {},
        loading: false,
        error: null,
        unseenPoll: false,
      });
      queueVotesSubscription({ reason: "sync" });
      return;
    }

    const poll = normalizeLobbyPollRow(row);
    if (!poll || poll.status !== "open") {
      pollRtLog("refetch result", {
        lobbyId,
        open: false,
        status: poll?.status,
        liveCatchup,
      });
      setStore({
        lobbyId,
        activePoll: null,
        votesAllByUserId: {},
        loading: false,
        error: null,
        unseenPoll: false,
      });
      queueVotesSubscription({ reason: "sync" });
      return;
    }

    const votes = await fetchLobbyPollVotes(poll.id);
    if (
      !shouldApplyPollFetchResult({
        gen,
        currentGen: fetchGen,
        requestedLobbyId: lobbyId,
        storeLobbyId: store.lobbyId,
      }) ||
      !channelGenStillCurrent()
    ) {
      pollRtLog("refetch result", {
        lobbyId,
        skipped: true,
        reason: channelGenStillCurrent()
          ? "stale_gen_votes"
          : "stale_channel_gen_votes",
      });
      return;
    }

    const prevId = store.activePoll?.id || null;
    const isNewId = prevId !== poll.id;
    pollRtLog("refetch result", {
      lobbyId,
      open: true,
      newPollId: poll.id,
      isNewId,
      liveCatchup,
    });

    setStore({
      lobbyId,
      activePoll: poll,
      votesAllByUserId: normalizeVotesAllByUserId(votes),
      loading: false,
      error: null,
    });

    if (isNewId) {
      const badge = computeUnseenPollOnNewId({
        pollId: poll.id,
        lastSeenPollId,
        sheetOpen: isSheetOpen(),
        localCreate: suppressUnseenForPollId === poll.id,
        // Catch-up post replace = récupération live, pas hydrate boot/F5.
        isInitialHydrate: liveCatchup ? false : !hasHydratedPollOnce,
      });
      lastSeenPollId = badge.lastSeenPollId;
      hasHydratedPollOnce = true;
      setStore({ unseenPoll: badge.unseenPoll });
    } else if (!hasHydratedPollOnce) {
      hasHydratedPollOnce = true;
      lastSeenPollId = poll.id;
      setStore({ unseenPoll: false });
    }

    queueVotesSubscription({ reason: liveCatchup ? "catchup_sync" : "sync" });
  } catch (e) {
    console.warn("REVEAL lobbyPoll fetch:", e?.message || e);
    if (
      !shouldApplyPollFetchResult({
        gen,
        currentGen: fetchGen,
        requestedLobbyId: lobbyId,
        storeLobbyId: store.lobbyId,
      })
    ) {
      return;
    }
    setStore({
      lobbyId,
      loading: false,
      error: quiet ? store.error : formatLobbyPollRpcError(e),
    });
  }
}

/** Invalide tout fetch en vol (close / leave lobby). */
function invalidatePollFetches() {
  fetchGen += 1;
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
}

async function tearDownChannel() {
  clearPollRealtimeReconnect();
  if (channelCtrl) {
    await channelCtrl.dispose();
  }
  setStore({ subscriptionStatus: "idle" });
}

function syncToCurrentLobby() {
  if (!authGatePassed) return;
  const lobbyId = hasActiveLobby() ? getLobby()?.id || null : null;
  if (!lobbyId) {
    resetPollRealtimeReconnectBackoff();
    void tearDownChannel();
    invalidatePollFetches();
    setStore({
      lobbyId: null,
      activePoll: null,
      votesAllByUserId: {},
      loading: false,
      error: null,
      subscriptionStatus: "idle",
      committing: initialCommitting(),
      unseenPoll: false,
    });
    hasHydratedPollOnce = false;
    suppressUnseenForPollId = null;
    lastSeenPollId = null;
    return;
  }

  if (store.lobbyId !== lobbyId) {
    resetPollRealtimeReconnectBackoff();
    invalidatePollFetches();
    hasHydratedPollOnce = false;
    suppressUnseenForPollId = null;
    lastSeenPollId = null;
    setStore({
      lobbyId,
      activePoll: null,
      votesAllByUserId: {},
      committing: initialCommitting(),
      unseenPoll: false,
    });
  } else {
    setStore({ lobbyId });
  }
  queueVotesSubscription({ reason: "syncToCurrentLobby" });
  void refreshLobbyPoll(lobbyId);
}

/**
 * Démarre le sync polls après authReady.
 * @param {{ authReadyPromise?: Promise<void> }} [opts] — injectable pour tests
 */
export async function initLobbyPollSync(opts = {}) {
  if (started) return;
  started = true;
  authReadyForSync =
    opts.authReadyPromise && typeof opts.authReadyPromise.then === "function"
      ? opts.authReadyPromise
      : authReady;

  unsubBundle = onLobbyBundleUpdated(() => {
    if (!authGatePassed) return;
    const nextId = hasActiveLobby() ? getLobby()?.id || null : null;
    const chLobby = channelCtrl?.getState()?.channelLobbyId ?? null;
    if (nextId !== store.lobbyId || nextId !== chLobby) {
      syncToCurrentLobby();
      return;
    }
    emit();
  });
  unsubScreen = onScreenChange(() => {
    if (authGatePassed) emit();
  });
  unsubLobbyRt = onLobbyRealtimeStatus((status, meta) => {
    if (!authGatePassed || status !== "subscribed") return;
    if (
      !shouldWakePollOnLobbySubscribed({
        eventLobbyId: meta?.lobbyId,
        storeLobbyId: store.lobbyId,
        eventGen: meta?.gen,
        minGen: null,
      })
    ) {
      pollRtLog("lobby_realtime_subscribed ignored (lobby mismatch)", {
        eventLobbyId: meta?.lobbyId,
        storeLobbyId: store.lobbyId,
        gen: meta?.gen,
      });
      return;
    }
    queueVotesSubscription({ reason: "lobby_realtime_subscribed" });
    if (rtSocketProbesEnabled() && !socketProbesStarted && supabase) {
      socketProbesStarted = true;
      void runSharedSocketProbes(supabase, {
        lobbyId: store.lobbyId || getLobby()?.id || null,
      });
    }
  });

  await authReadyForSync;
  if (!started) return;
  authGatePassed = true;
  pollRtLog("auth gate passed", { authReadyResolved: true });
  syncToCurrentLobby();
}

export function resetLobbyPollSyncForTests() {
  clearPollRealtimeReconnect();
  resetPollRealtimeReconnectBackoff();
  invalidatePollFetches();
  listeners.clear();
  unsubBundle?.();
  unsubBundle = null;
  unsubScreen?.();
  unsubScreen = null;
  unsubLobbyRt?.();
  unsubLobbyRt = null;
  socketProbesStarted = false;
  pollSubscribeInFlight = null;
  pollSubscribeInFlightKey = null;
  joinReplyCatchupInFlight = null;
  joinReplyCatchupLobbyId = null;
  started = false;
  authGatePassed = false;
  authReadyForSync = authReady;
  if (channelCtrl) {
    void channelCtrl.dispose();
    channelCtrl = null;
  }
  store = {
    lobbyId: null,
    activePoll: null,
    votesAllByUserId: {},
    loading: false,
    error: null,
    subscriptionStatus: "idle",
    committing: initialCommitting(),
    unseenPoll: false,
  };
  hasHydratedPollOnce = false;
  suppressUnseenForPollId = null;
  lastSeenPollId = null;
  sheetOpenGetter = () => false;
}

/** @internal tests */
export function __testForceActivePoll(poll, votes = {}) {
  setStore({
    lobbyId: store.lobbyId || poll?.lobbyId || "test-lobby",
    activePoll: poll,
    votesAllByUserId: votes,
    unseenPoll: Boolean(poll),
    committing: initialCommitting(),
  });
  hasHydratedPollOnce = true;
  lastSeenPollId = null;
}

/** @internal tests — simule événement Realtime lobby_polls */
export function __testSimulateRealtimeClose(payload) {
  const lobbyId = store.lobbyId || "test-lobby";
  handleLobbyPollsRealtime(payload, lobbyId);
}

/** @internal tests — INSERT / UPDATE générique */
export function __testSimulateRealtimePollsEvent(payload) {
  const lobbyId = store.lobbyId || "test-lobby";
  handleLobbyPollsRealtime(payload, lobbyId);
}

/** @internal tests */
export function __testIsDebouncePending() {
  return Boolean(debounceTimer);
}

/** @internal */
export function __testGetLastSeenPollId() {
  return lastSeenPollId;
}

/** @internal */
export function __testSetHasHydrated(v) {
  hasHydratedPollOnce = Boolean(v);
}

/** @internal */
export function __testIsAuthGatePassed() {
  return authGatePassed;
}

/** @internal */
export function __testGetReconnectState() {
  return {
    attempts: pollReconnectAttempts,
    hasTimer: Boolean(pollReconnectTimer),
  };
}

/** @param {string[]} selectedCatalogIds */
export async function createLobbyPollFromCatalog(selectedCatalogIds) {
  if (store.committing.create) {
    return { ok: false, error: "already_committing" };
  }
  const lobbyId = getLobby()?.id;
  if (!lobbyId) return { ok: false, error: "no_lobby" };

  const options = buildPollOptionsSnapshot(GAMES_AVAILABLE, selectedCatalogIds);
  const v = validatePollOptionsClient(options);
  if (!v.ok) return { ok: false, error: v.error };

  setStore({ committing: { create: true }, error: null });
  try {
    const row = await rpcCreateLobbyPoll({ lobbyId, options });
    const poll = normalizeLobbyPollRow(row);
    suppressUnseenForPollId = poll?.id || null;
    lastSeenPollId = poll?.id || null;
    setStore({
      activePoll: poll,
      votesAllByUserId: {},
      committing: { create: false },
      error: null,
      unseenPoll: false,
    });
    hasHydratedPollOnce = true;
    queueVotesSubscription({ reason: "sync" });
    void refreshLobbyPoll(lobbyId, { quiet: true });
    return { ok: true, poll };
  } catch (e) {
    console.warn("REVEAL createLobbyPoll:", e);
    setStore({ committing: { create: false } });
    const code = extractLobbyPollErrorCode(e);
    if (code === "poll_creation_not_allowed_in_current_phase") {
      try {
        await refreshGameSession();
      } catch (err) {
        console.warn("REVEAL refreshGameSession after poll create deny:", err);
      }
      emit();
    }
    void refreshLobbyPoll(lobbyId, { quiet: true });
    return { ok: false, error: formatLobbyPollRpcError(e), raw: e, code };
  }
}

export async function castLobbyPollVote(gameId) {
  if (store.committing.vote) {
    return { ok: false, error: "already_committing" };
  }
  const poll = store.activePoll;
  const lobbyId = store.lobbyId;
  const uid = getSupabaseUserId();
  if (!poll?.id || !uid) return { ok: false, error: "no_poll" };

  const prev = store.votesAllByUserId;
  const votePollId = poll.id;
  const voteLobbyId = lobbyId;
  setStore({
    committing: { vote: true },
    votesAllByUserId: applyVoteUpsert(prev, uid, gameId),
    error: null,
  });

  try {
    await rpcCastLobbyPollVote({ pollId: poll.id, gameId });
    setStore({ committing: { vote: false } });
    void refreshLobbyPoll(store.lobbyId, { quiet: true });
    return { ok: true };
  } catch (e) {
    console.warn("REVEAL castLobbyPollVote:", e);
    if (
      shouldRestoreOptimisticVote({
        votePollId,
        voteLobbyId,
        storePollId: store.activePoll?.id,
        storeLobbyId: store.lobbyId,
      })
    ) {
      setStore({
        committing: { vote: false },
        votesAllByUserId: prev,
      });
    } else {
      setStore({ committing: { vote: false } });
    }
    if (store.lobbyId) {
      void refreshLobbyPoll(store.lobbyId, { quiet: true });
    }
    return { ok: false, error: formatLobbyPollRpcError(e), raw: e };
  }
}

export async function closeLobbyPollExplicit() {
  if (store.committing.close) {
    return { ok: false, error: "already_committing" };
  }
  const poll = store.activePoll;
  if (!poll?.id) return { ok: false, error: "no_poll" };

  setStore({ committing: { close: true }, error: null });
  try {
    const res = await rpcCloseLobbyPoll({ pollId: poll.id, reason: "explicit" });
    const outcome = res?.outcome || null;
    if (outcome === "closed" || outcome === "already_closed") {
      applyActivePollClosedLocally(store.lobbyId, { scheduleRefetch: true });
    } else if (outcome === "poll_not_found") {
      applyActivePollClosedLocally(store.lobbyId, { scheduleRefetch: true });
    } else {
      setStore({ committing: { close: false } });
      void refreshLobbyPoll(store.lobbyId, { quiet: true });
    }
    return { ok: true, outcome, result: res };
  } catch (e) {
    console.warn("REVEAL closeLobbyPollExplicit:", e);
    setStore({ committing: { close: false } });
    void refreshLobbyPoll(store.lobbyId, { quiet: true });
    return { ok: false, error: formatLobbyPollRpcError(e), raw: e };
  }
}
