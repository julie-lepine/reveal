/**
 * Vague 2 — store unique sondages + fetch + Realtime.
 *
 * Realtime (un seul canal / lobby) :
 * - lobby_polls  → filter `lobby_id=eq.${lobbyId}`
 * - lobby_poll_votes → filter `poll_id=eq.${activePollId}` seulement si poll open
 *   (rebuild du canal quand l'id du poll actif change ; pas de 2e canal)
 *
 * scheduleLobbyRefresh n'est pas utilisé : les polls ne sont pas dans le bundle lobby.
 * onLobbyBundleUpdated = resync lobbyId + recalcul membres actifs.
 */
import { GAMES_AVAILABLE } from "../../data/games.js";
import { getLobby, getLobbyParticipants, hasActiveLobby } from "./lobby.js";
import { getSupabaseUserId } from "./supabaseAuth.js";
import { supabase, isSupabaseConfigured } from "./supabaseClient.js";
import {
  getCachedGameSession,
  isLobbyHost,
  canActAsHost,
  refreshGameSession,
} from "./gameSync.js";
import { getCurrentScreen, onScreenChange } from "./router.js";
import { onLobbyBundleUpdated } from "./supabaseLobby.js";
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
} from "./lobbyPollLogic.js";
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

let channel = null;
let channelLobbyId = null;
/** poll_id pour lequel le listener votes est branché (null = pas de listener votes). */
let channelVotesPollId = null;
let fetchGen = 0;
let debounceTimer = null;
let started = false;
let unsubBundle = null;
let unsubScreen = null;
/** Après premier hydrate d'un poll déjà open : pas de fausse alerte « nouveau ». */
let hasHydratedPollOnce = false;
/** poll id créé localement (sheet ouvert) — pas de pastille. */
let suppressUnseenForPollId = null;

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

function clearChannel() {
  if (channel && supabase) {
    try {
      supabase.removeChannel(channel);
    } catch (e) {
      console.warn("REVEAL lobbyPoll removeChannel:", e);
    }
  }
  channel = null;
  channelLobbyId = null;
  channelVotesPollId = null;
}

function schedulePollRefetch(lobbyId) {
  if (!lobbyId) return;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void refreshLobbyPoll(lobbyId, { quiet: true });
  }, 120);
}

/**
 * Fermeture distante (ou locale déjà appliquée côté serveur) :
 * vide le store immédiatement puis refetch (filet nouvel open).
 * clearChannel ne touche PAS au debounce — le refetch post-close reste planifié.
 */
export function applyActivePollClosedLocally(lobbyId, { scheduleRefetch = true } = {}) {
  invalidatePollFetches();
  setStore({
    activePoll: null,
    votesAllByUserId: {},
    committing: { ...store.committing, close: false },
    unseenPoll: false,
  });
  suppressUnseenForPollId = null;
  syncVotesSubscription();
  if (scheduleRefetch && lobbyId) {
    schedulePollRefetch(lobbyId);
  }
}

function handleLobbyPollsRealtime(lobbyId, payload) {
  if (isRealtimeActivePollClose(payload, store.activePoll?.id)) {
    applyActivePollClosedLocally(lobbyId, { scheduleRefetch: true });
    return;
  }
  schedulePollRefetch(lobbyId);
}

function noteActivePollAppeared(poll, { localCreate = false } = {}) {
  if (!poll?.id) return;
  const sheetOpen =
    typeof window !== "undefined" &&
    (() => {
      try {
        // Évite cycle import feedbackUi ↔ store : getter injecté
        return sheetOpenGetter?.() === true;
      } catch {
        return false;
      }
    })();

  if (localCreate || suppressUnseenForPollId === poll.id) {
    suppressUnseenForPollId = poll.id;
    setStore({ unseenPoll: false });
    hasHydratedPollOnce = true;
    return;
  }

  if (!hasHydratedPollOnce) {
    // Premier hydrate (boot / F5) : pas de fausse alerte « nouveau sondage »
    hasHydratedPollOnce = true;
    setStore({ unseenPoll: false });
    return;
  }

  if (!sheetOpen) {
    setStore({ unseenPoll: true });
  } else {
    setStore({ unseenPoll: false });
  }
}

let sheetOpenGetter = () => false;

/** Branché depuis feedbackUi pour pastille / create local. */
export function setLobbyPollSheetOpenGetter(fn) {
  sheetOpenGetter = typeof fn === "function" ? fn : () => false;
}

export function markLobbyPollSeen() {
  if (store.unseenPoll) {
    setStore({ unseenPoll: false });
  }
}

export function getLobbyPollUnseen() {
  return Boolean(store.unseenPoll);
}

/**
 * Un canal unique : rebuild si lobbyId ou pollId (votes) change.
 * @param {string} lobbyId
 * @param {string|null} votesPollId
 */
function subscribeLobbyPolls(lobbyId, votesPollId = null) {
  if (!isSupabaseConfigured() || !supabase || !lobbyId) {
    setStore({ subscriptionStatus: "idle" });
    return;
  }
  const nextVotesId = votesPollId || null;
  if (
    channel &&
    channelLobbyId === lobbyId &&
    channelVotesPollId === nextVotesId
  ) {
    return;
  }

  clearChannel();
  setStore({ subscriptionStatus: "subscribing" });
  channelLobbyId = lobbyId;
  channelVotesPollId = nextVotesId;

  let builder = supabase.channel(`lobby-polls:${lobbyId}`).on(
    "postgres_changes",
    {
      event: "*",
      schema: "public",
      table: "lobby_polls",
      filter: `lobby_id=eq.${lobbyId}`,
    },
    (payload) => handleLobbyPollsRealtime(lobbyId, payload)
  );

  if (nextVotesId) {
    builder = builder.on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "lobby_poll_votes",
        filter: `poll_id=eq.${nextVotesId}`,
      },
      (payload) => {
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
    );
  }

  channel = builder.subscribe((status) => {
    if (channelLobbyId !== lobbyId) return;
    if (status === "SUBSCRIBED") {
      setStore({ subscriptionStatus: "subscribed" });
    } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
      setStore({ subscriptionStatus: "error" });
      console.warn("REVEAL lobbyPoll channel:", status);
    }
  });
}

function syncVotesSubscription() {
  const lobbyId = store.lobbyId;
  if (!lobbyId) return;
  const pollId =
    store.activePoll?.status === "open" ? store.activePoll.id : null;
  subscribeLobbyPolls(lobbyId, pollId);
}

/**
 * @param {string|null} lobbyId
 * @param {{ quiet?: boolean }} [opts]
 */
export async function refreshLobbyPoll(lobbyId, { quiet = false } = {}) {
  if (!lobbyId || !isSupabaseConfigured()) {
    invalidatePollFetches();
    setStore({
      lobbyId: lobbyId || null,
      activePoll: null,
      votesAllByUserId: {},
      loading: false,
      error: quiet ? store.error : null,
    });
    syncVotesSubscription();
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
      })
    ) {
      return;
    }

    if (!row) {
      setStore({
        lobbyId,
        activePoll: null,
        votesAllByUserId: {},
        loading: false,
        error: null,
        unseenPoll: false,
      });
      syncVotesSubscription();
      return;
    }

    const poll = normalizeLobbyPollRow(row);
    if (!poll || poll.status !== "open") {
      setStore({
        lobbyId,
        activePoll: null,
        votesAllByUserId: {},
        loading: false,
        error: null,
        unseenPoll: false,
      });
      syncVotesSubscription();
      return;
    }

    const votes = await fetchLobbyPollVotes(poll.id);
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

    const prevId = store.activePoll?.id || null;
    setStore({
      lobbyId,
      activePoll: poll,
      votesAllByUserId: normalizeVotesAllByUserId(votes),
      loading: false,
      error: null,
    });
    if (prevId !== poll.id) {
      noteActivePollAppeared(poll, { localCreate: false });
    } else if (!hasHydratedPollOnce) {
      hasHydratedPollOnce = true;
    }
    syncVotesSubscription();
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

function syncToCurrentLobby() {
  const lobbyId = hasActiveLobby() ? getLobby()?.id || null : null;
  if (!lobbyId) {
    clearChannel();
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
    return;
  }

  if (store.lobbyId !== lobbyId) {
    invalidatePollFetches();
    hasHydratedPollOnce = false;
    suppressUnseenForPollId = null;
    setStore({
      lobbyId,
      activePoll: null,
      votesAllByUserId: {},
      committing: initialCommitting(),
      unseenPoll: false,
    });
  }
  subscribeLobbyPolls(lobbyId, store.activePoll?.id || null);
  void refreshLobbyPoll(lobbyId);
}

export function initLobbyPollSync() {
  if (started) return;
  started = true;
  syncToCurrentLobby();
  unsubBundle = onLobbyBundleUpdated(() => {
    const nextId = hasActiveLobby() ? getLobby()?.id || null : null;
    if (nextId !== store.lobbyId || nextId !== channelLobbyId) {
      syncToCurrentLobby();
      return;
    }
    emit();
  });
  unsubScreen = onScreenChange(() => emit());
}

export function resetLobbyPollSyncForTests() {
  clearChannel();
  invalidatePollFetches();
  listeners.clear();
  unsubBundle?.();
  unsubBundle = null;
  unsubScreen?.();
  unsubScreen = null;
  started = false;
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
  sheetOpenGetter = () => false;
}

/** @internal tests */
export function __testForceActivePoll(poll, votes = {}) {
  setStore({
    lobbyId: store.lobbyId || "test-lobby",
    activePoll: poll,
    votesAllByUserId: votes,
    unseenPoll: true,
    committing: initialCommitting(),
  });
  hasHydratedPollOnce = true;
}

/** @internal tests — simule close Realtime invité */
export function __testSimulateRealtimeClose(payload) {
  const lobbyId = store.lobbyId || "test-lobby";
  handleLobbyPollsRealtime(lobbyId, payload);
}

/** @internal tests */
export function __testIsDebouncePending() {
  return Boolean(debounceTimer);
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
    setStore({
      activePoll: poll,
      votesAllByUserId: {},
      committing: { create: false },
      error: null,
      unseenPoll: false,
    });
    hasHydratedPollOnce = true;
    syncVotesSubscription();
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
