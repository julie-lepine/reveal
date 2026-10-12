/**
 * Preuve client : le lancement Consensus envoie un snapshot dont
 * consensus.answers est vide, au retry après timeout et au fallback
 * upsertGameSession. Les promesses mockées ne recopient pas le payload
 * dans une base simulée.
 */
import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => (storage.has(key) ? storage.get(key) : null),
  setItem: (key, value) => {
    storage.set(key, String(value));
  },
  removeItem: (key) => {
    storage.delete(key);
  },
};

const LOBBY_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const HOST_UID = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const GUEST_UID = "guest-uid";

const LAUNCH_CONSENSUS = {
  phase: "question",
  questionIdx: 0,
  lobbyStarted: true,
  answers: {},
  launchMarker: "initial",
};

function defer() {
  /** @type {(value: unknown) => void} */
  let resolve;
  /** @type {(error: Error) => void} */
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createGate() {
  let count = 0;
  /** @type {{ need: number, resolve: () => void }[]} */
  const waiters = [];
  return {
    hit() {
      count += 1;
      for (let i = waiters.length - 1; i >= 0; i -= 1) {
        if (count >= waiters[i].need) {
          const waiter = waiters.splice(i, 1)[0];
          waiter.resolve();
        }
      }
    },
    wait(need) {
      if (count >= need) return Promise.resolve();
      return new Promise((resolve) => {
        waiters.push({ need, resolve });
      });
    },
    reset() {
      count = 0;
      waiters.length = 0;
    },
  };
}

const fetchGate = createGate();
const preservingGate = createGate();
const genericGate = createGate();

/** @type {{ promise: Promise<unknown>, resolve: (value: unknown) => void, reject: (error: Error) => void }[]} */
const fetchSlots = [];
/** @type {{ promise: Promise<unknown>, resolve: (value: unknown) => void, reject: (error: Error) => void }[]} */
const preservingSlots = [];
/** @type {object[]} */
const preservingSeen = [];
/** @type {object[]} */
const genericSeen = [];

/** @type {"hold" | "reject"} */
let rpcMode = "hold";

const fetchMock = mock.fn(async () => {
  const slot = defer();
  fetchSlots.push(slot);
  fetchGate.hit();
  return slot.promise;
});

const preservingMock = mock.fn(async (arg) => {
  preservingSeen.push(JSON.parse(JSON.stringify(arg)));
  preservingGate.hit();
  if (rpcMode === "reject") {
    throw new Error("rpc specialized rejected");
  }
  const slot = defer();
  preservingSlots.push(slot);
  return slot.promise;
});

const genericMock = mock.fn(async (arg) => {
  genericSeen.push(JSON.parse(JSON.stringify(arg)));
  genericGate.hit();
  const slot = defer();
  return slot.promise;
});

mock.module("../js/core/dialog.js", {
  namedExports: {
    isAppDialogOpen: () => false,
    showAppAlert: async () => {},
    showAppConfirm: async () => false,
    showAppRichDialog: async () => {},
    showClaimHostDialog: async () => {},
    showAppEmailPrompt: async () => null,
    showTransferHostDialog: async () => {},
    showLobbyPlayersManageDialog: async () => {},
    showEmojiPickerDialog: async () => {},
  },
});

mock.module("../js/core/supabaseGame.js", {
  namedExports: {
    fetchGameSessionByLobby: fetchMock,
    fetchGameSessionMeta: async () => null,
    upsertGameSession: genericMock,
    upsertGameSessionPreservingRosterTopics: preservingMock,
    updateGameSession: async () => null,
    deleteGameSession: async () => {},
  },
});

const { launchGameWithSync } = await import("../js/core/mpLaunch.js");
const { saveStatePatch, getState } = await import("../js/core/state.js");
const { isSupabaseConfigured } = await import("../js/core/supabaseClient.js");
const { getSupabaseUserId } = await import("../js/core/supabaseAuth.js");

function sessionRow(consensus) {
  return {
    id: "sess-1",
    lobby_id: LOBBY_ID,
    game_id: "consensus",
    screen: "consensus-prep",
    host_id: HOST_UID,
    updated_at: "2026-10-12T00:00:00.000Z",
    state: { consensus },
  };
}

const PREP_ROW = sessionRow({
  phase: null,
  questionIdx: 0,
  lobbyStarted: false,
  answers: {},
  launchMarker: "prep",
});

const FRESH_ROW = sessionRow({
  phase: "question",
  questionIdx: 0,
  lobbyStarted: true,
  answers: {
    [GUEST_UID]: {
      value: 80,
      timestamp: 10,
      submittedAt: 10,
      questionIdx: 0,
      imputed: false,
    },
  },
  launchMarker: "fresh",
});

function startLaunch(timeoutMs) {
  return launchGameWithSync({
    screen: "consensus",
    gameId: "consensus",
    mode: "push",
    timeoutMs,
    applyLocal: () => {},
    getRemoteState: () => ({ consensus: LAUNCH_CONSENSUS }),
  });
}

function guestValue(consensus) {
  return consensus?.answers?.[GUEST_UID]?.value;
}

describe("Consensus launch snapshot writes", { concurrency: false }, () => {
  beforeEach(() => {
    rpcMode = "hold";
    fetchSlots.length = 0;
    preservingSlots.length = 0;
    preservingSeen.length = 0;
    genericSeen.length = 0;
    fetchGate.reset();
    preservingGate.reset();
    genericGate.reset();
    fetchMock.mock.resetCalls();
    preservingMock.mock.resetCalls();
    genericMock.mock.resetCalls();
    saveStatePatch({
      supabaseUserId: HOST_UID,
      lobby: { id: LOBBY_ID, hostId: HOST_UID },
    });
  });

  afterEach(() => {
    mock.timers.reset();
  });

  it("A retry après timeout : le second payload n'a pas la réponse lue", async () => {
    assert.equal(isSupabaseConfigured(), true);
    assert.equal(getSupabaseUserId(), HOST_UID);
    assert.equal(getState().lobby.hostId, HOST_UID);

    mock.timers.enable({ apis: ["setTimeout"], now: 0 });

    const pending = startLaunch(1000);
    await fetchGate.wait(1);
    fetchSlots[0].resolve(PREP_ROW);

    await preservingGate.wait(1);
    assert.equal(
      preservingMock.mock.callCount(),
      1,
      "RPC spécialisé non intercepté — arrêt pour éviter un client réel."
    );
    assert.equal(preservingSlots.length, 1);

    mock.timers.tick(1000);
    const result = await pending;
    assert.equal(result.usedFallback, true);

    await fetchGate.wait(2);
    assert.equal(fetchMock.mock.callCount(), 2);
    fetchSlots[1].resolve(FRESH_ROW);

    await preservingGate.wait(2);
    assert.equal(preservingMock.mock.callCount(), 2);
    assert.equal(genericMock.mock.callCount(), 0);

    const secondFetchConsensus = FRESH_ROW.state.consensus;
    const secondPayload = preservingSeen[1].state.consensus;
    assert.equal(guestValue(secondFetchConsensus), 80);
    assert.equal(secondFetchConsensus.launchMarker, "fresh");
    assert.equal(guestValue(secondPayload), undefined);
    assert.deepEqual(secondPayload.answers, {});
    assert.equal(secondPayload.launchMarker, "initial");
    assert.notEqual(secondPayload, secondFetchConsensus);

    preservingSlots[0].resolve({
      id: "sess-1",
      lobby_id: LOBBY_ID,
      game_id: "consensus",
      screen: "consensus",
      host_id: HOST_UID,
      updated_at: "2026-10-12T00:00:01.000Z",
      state: preservingSeen[0].state,
    });
    await preservingSlots[0].promise;

    assert.equal(fetchMock.mock.callCount(), 2);
    assert.equal(preservingMock.mock.callCount(), 2);
    assert.equal(genericMock.mock.callCount(), 0);
  });

  it("B fallback après rejet du RPC : l'upsert générique envoie le snapshot initial", async () => {
    rpcMode = "reject";

    const pending = startLaunch(0);
    await fetchGate.wait(1);
    fetchSlots[0].resolve(FRESH_ROW);

    await preservingGate.wait(1);
    assert.equal(
      preservingMock.mock.callCount(),
      1,
      "RPC spécialisé non intercepté — arrêt pour éviter un client réel."
    );

    await fetchGate.wait(2);
    fetchSlots[1].resolve(FRESH_ROW);

    await genericGate.wait(1);

    assert.equal(fetchMock.mock.callCount(), 2);
    assert.equal(preservingMock.mock.callCount(), 1);
    assert.equal(genericMock.mock.callCount(), 1);

    const reread = FRESH_ROW.state.consensus;
    const sent = genericSeen[0].state.consensus;
    assert.equal(guestValue(reread), 80);
    assert.equal(reread.launchMarker, "fresh");
    assert.equal(guestValue(sent), undefined);
    assert.deepEqual(sent.answers, {});
    assert.equal(sent.launchMarker, "initial");
    assert.equal(sent.phase, "question");
    assert.notEqual(sent, reread);

    pending.catch(() => {});
  });
});
