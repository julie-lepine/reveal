/**
 * Vague 2 — store unique sondages + fetch + Realtime.
 *
 * Realtime : canal dédié `lobby-polls:${lobbyId}` (pas via scheduleLobbyRefresh) :
 * les polls ne sont pas dans le bundle lobby. onLobbyBundleUpdated sert seulement
 * à resync lobbyId / membres actifs (recalcul votes actifs sans refetch systématique).
 */
import { GAMES_AVAILABLE } from "../../data/games.js";
import { getLobby, getLobbyParticipants, hasActiveLobby } from "./lobby.js";
import { getSupabaseUserId } from "./supabaseAuth.js";
import { supabase, isSupabaseConfigured } from "./supabaseClient.js";
import { getCachedGameSession, isLobbyHost, canActAsHost } from "./gameSync.js";
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
} from "./lobbyPollLogic.js";
import {
  rpcCreateLobbyPoll,
  rpcCastLobbyPollVote,
  rpcCloseLobbyPoll,
  fetchOpenLobbyPoll,
  fetchLobbyPollVotes,
} from "./lobbyPollRpc.js";
import { formatLobbyPollRpcError } from "./lobbyPollErrors.js";

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
};

let channel = null;
let channelLobbyId = null;
let fetchGen = 0;
let debounceTimer = null;
let started = false;
let unsubBundle = null;
let unsubScreen = null;

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
}

function schedulePollRefetch(lobbyId) {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void refreshLobbyPoll(lobbyId, { quiet: true });
  }, 120);
}

function subscribeLobbyPolls(lobbyId) {
  if (!isSupabaseConfigured() || !supabase || !lobbyId) {
    setStore({ subscriptionStatus: "idle" });
    return;
  }
  if (channel && channelLobbyId === lobbyId) return;

  clearChannel();
  setStore({ subscriptionStatus: "subscribing" });
  channelLobbyId = lobbyId;

  channel = supabase
    .channel(`lobby-polls:${lobbyId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "lobby_polls",
        filter: `lobby_id=eq.${lobbyId}`,
      },
      () => schedulePollRefetch(lobbyId)
    )
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "lobby_poll_votes",
      },
      (payload) => {
        const pollId =
          payload?.new?.poll_id ||
          payload?.old?.poll_id ||
          store.activePoll?.id;
        if (!pollId || !store.activePoll || pollId !== store.activePoll.id) {
          // Vote d'un autre poll ou pas encore d'actif : refetch léger si open connu
          if (store.activePoll || payload?.new?.poll_id) {
            schedulePollRefetch(lobbyId);
          }
          return;
        }
        schedulePollRefetch(lobbyId);
      }
    )
    .subscribe((status) => {
      if (channelLobbyId !== lobbyId) return;
      if (status === "SUBSCRIBED") {
        setStore({ subscriptionStatus: "subscribed" });
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        setStore({ subscriptionStatus: "error" });
        console.warn("REVEAL lobbyPoll channel:", status);
      }
    });
}

/**
 * @param {string|null} lobbyId
 * @param {{ quiet?: boolean }} [opts]
 */
export async function refreshLobbyPoll(lobbyId, { quiet = false } = {}) {
  if (!lobbyId || !isSupabaseConfigured()) {
    setStore({
      lobbyId: lobbyId || null,
      activePoll: null,
      votesAllByUserId: {},
      loading: false,
      error: quiet ? store.error : null,
    });
    return;
  }

  const gen = ++fetchGen;
  if (!quiet) setStore({ loading: true, error: null, lobbyId });

  try {
    const row = await fetchOpenLobbyPoll(lobbyId);
    if (gen !== fetchGen) return;

    if (!row) {
      setStore({
        lobbyId,
        activePoll: null,
        votesAllByUserId: {},
        loading: false,
        error: null,
      });
      return;
    }

    const poll = normalizeLobbyPollRow(row);
    const votes = await fetchLobbyPollVotes(poll.id);
    if (gen !== fetchGen) return;

    setStore({
      lobbyId,
      activePoll: poll,
      votesAllByUserId: normalizeVotesAllByUserId(votes),
      loading: false,
      error: null,
    });
  } catch (e) {
    console.warn("REVEAL lobbyPoll fetch:", e?.message || e);
    if (gen !== fetchGen) return;
    // Ne casse pas le chat : erreur isolée
    setStore({
      lobbyId,
      loading: false,
      error: quiet ? store.error : formatLobbyPollRpcError(e),
    });
  }
}

function syncToCurrentLobby() {
  const lobbyId = hasActiveLobby() ? getLobby()?.id || null : null;
  if (!lobbyId) {
    clearChannel();
    fetchGen += 1;
    setStore({
      lobbyId: null,
      activePoll: null,
      votesAllByUserId: {},
      loading: false,
      error: null,
      subscriptionStatus: "idle",
      committing: initialCommitting(),
    });
    return;
  }

  if (store.lobbyId !== lobbyId) {
    setStore({
      lobbyId,
      activePoll: null,
      votesAllByUserId: {},
      committing: initialCommitting(),
    });
  }
  subscribeLobbyPolls(lobbyId);
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
    // Membres changés → recalcul dérivés (votes actifs)
    emit();
  });
  unsubScreen = onScreenChange(() => emit());
}

export function resetLobbyPollSyncForTests() {
  clearChannel();
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = null;
  fetchGen += 1;
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
    setStore({
      activePoll: poll,
      votesAllByUserId: {},
      committing: { create: false },
      error: null,
    });
    void refreshLobbyPoll(lobbyId, { quiet: true });
    return { ok: true, poll };
  } catch (e) {
    console.warn("REVEAL createLobbyPoll:", e);
    setStore({ committing: { create: false } });
    void refreshLobbyPoll(lobbyId, { quiet: true });
    return { ok: false, error: formatLobbyPollRpcError(e), raw: e };
  }
}

export async function castLobbyPollVote(gameId) {
  if (store.committing.vote) {
    return { ok: false, error: "already_committing" };
  }
  const poll = store.activePoll;
  const uid = getSupabaseUserId();
  if (!poll?.id || !uid) return { ok: false, error: "no_poll" };

  const prev = store.votesAllByUserId;
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
    setStore({
      committing: { vote: false },
      votesAllByUserId: prev,
    });
    void refreshLobbyPoll(store.lobbyId, { quiet: true });
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
      setStore({
        activePoll: null,
        votesAllByUserId: {},
        committing: { close: false },
      });
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
