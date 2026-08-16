import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
const LOBBY_A = "11111111-1111-1111-1111-111111111111";
const LOBBY_B = "22222222-2222-2222-2222-222222222222";
const DRAWER = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const GUEST = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

const channels = [];
const removed = [];
let lobbyStatusListener = null;
let screenListener = null;
let sendImpl = () => Promise.resolve("ok");

function fakeChannel(topic, options) {
  const channel = {
    topic,
    options,
    handlers: [],
    subscribeCalls: 0,
    sent: [],
    on(type, filter, handler) {
      this.handlers.push({ type, filter, handler });
      return this;
    },
    subscribe(callback) {
      this.subscribeCalls += 1;
      this.statusCallback = callback;
      return this;
    },
    send(message) {
      this.sent.push(message);
      return sendImpl(message);
    },
  };
  channels.push(channel);
  return channel;
}

const fakeSupabase = {
  channel: fakeChannel,
  removeChannel(channel) {
    removed.push(channel);
    channel.statusCallback?.("CLOSED");
    return Promise.resolve("ok");
  },
};

mock.module("../js/core/supabaseClient.js", {
  namedExports: {
    isSupabaseConfigured: () => true,
    supabase: fakeSupabase,
  },
});
mock.module("../js/core/supabaseLobby.js", {
  namedExports: {
    whenLobbyRealtimeReady: async ({ lobbyId }) => ({
      ok: true,
      lobbyId,
      reason: "already",
      gen: 1,
    }),
    onLobbyRealtimeStatus(fn) {
      lobbyStatusListener = fn;
      return () => {};
    },
  },
});
mock.module("../js/core/router.js", {
  namedExports: {
    onScreenChange(fn) {
      screenListener = fn;
    },
  },
});

const live = await import("../js/core/drawItLive.js");

function session(overrides = {}) {
  return {
    lobbyStarted: true,
    phase: "drawing",
    runId: "run-live",
    roundIdx: 0,
    canvasEpoch: 0,
    drawerUid: DRAWER,
    roundEndsAt: new Date(Date.now() + 60_000).toISOString(),
    foundOrder: [],
    ...overrides,
  };
}

function payload(type, overrides = {}) {
  const common = {
    type,
    runId: "run-live",
    roundIdx: 0,
    canvasEpoch: 0,
    drawerUid: DRAWER,
  };
  if (type === "clear") return { ...common, ...overrides };
  if (type === "undo") {
    return { ...common, strokeId: "s1", ...overrides };
  }
  return {
    ...common,
    strokeId: "s1",
    seq: 1,
    color: "#fff",
    width: 4,
    ...(type === "start" || type === "chunk" ? { points: [[0.1, 0.1]] } : {}),
    ...overrides,
  };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("Draw it ! T7 — canal singleton", () => {
  beforeEach(async () => {
    live.__resetDrawItLiveForTests();
    channels.length = 0;
    removed.length = 0;
    sendImpl = () => Promise.resolve("ok");
    live.activateDrawItLive({
      lobbyId: LOBBY_A,
      getSession: () => session(),
      getLocalUid: () => DRAWER,
      onRender: () => {},
    });
    await tick();
  });

  afterEach(() => live.__resetDrawItLiveForTests());

  it("utilise exactement drawit:${lobbyId} et la config Broadcast demandée", () => {
    assert.equal(channels.length, 1);
    assert.equal(channels[0].topic, `drawit:${LOBBY_A}`);
    assert.equal(channels[0].topic.includes("run-live"), false);
    assert.deepEqual(channels[0].options, {
      config: { broadcast: { self: false, ack: false } },
    });
  });

  it("coalesce subscribing/subscribed et remplace seulement le callback au remount", async () => {
    let renders = 0;
    live.activateDrawItLive({
      lobbyId: LOBBY_A,
      getSession: () => session(),
      getLocalUid: () => DRAWER,
      onRender: () => {
        renders += 1;
      },
    });
    await tick();
    assert.equal(channels.length, 1);
    assert.equal(channels[0].subscribeCalls, 1);
    channels[0].statusCallback("SUBSCRIBED");
    channels[0].handlers[0].handler({ payload: payload("start") });
    assert.equal(renders, 1);
  });

  it("removeChannel reçoit la ref exacte avant oubli et CLOSED intentionnel ne reconnecte pas", async () => {
    const first = channels[0];
    live.teardownDrawItLive();
    await tick();
    assert.equal(removed[0], first);
    assert.equal(first.__intentionalClose, true);
    assert.equal(live.__getDrawItLiveDebugState().channel, null);
    assert.equal(channels.length, 1);
  });

  it("ignore ancien handler par génération et référence", async () => {
    const first = channels[0];
    const oldHandler = first.handlers[0].handler;
    live.activateDrawItLive({
      lobbyId: LOBBY_B,
      getSession: () => session(),
      getLocalUid: () => DRAWER,
      onRender: () => {},
    });
    await tick();
    oldHandler({ payload: payload("start") });
    assert.deepEqual(live.getDrawItLiveState().remoteInProgress, {});
    assert.equal(channels.length, 2);
  });

  it("foreground attend le nouveau SUBSCRIBED lobby puis recrée une seule fois", async () => {
    const first = channels[0];
    lobbyStatusListener("idle", { lobbyId: LOBBY_A, reason: "unsubscribe" });
    assert.equal(removed.at(-1), first);
    lobbyStatusListener("subscribed", { lobbyId: LOBBY_A, gen: 2 });
    lobbyStatusListener("subscribed", { lobbyId: LOBBY_A, gen: 2 });
    await tick();
    assert.equal(channels.length, 2);
    assert.equal(channels[1].subscribeCalls, 1);
  });

  it("un changement de manche purge le live sans recréer le channel", () => {
    const first = channels[0];
    live.syncActiveDrawItLiveSession(session({ roundIdx: 1 }));
    assert.equal(live.__getDrawItLiveDebugState().channel, first);
    assert.equal(channels.length, 1);
    assert.deepEqual(live.getDrawItLiveState().remoteInProgress, {});
  });

  it("CHANNEL_ERROR retire une seule fois puis attend un reconnect borné", () => {
    channels[0].statusCallback("CHANNEL_ERROR");
    assert.equal(removed.length, 1);
    assert.equal(live.__getDrawItLiveDebugState().channel, null);
  });

  it("results teardown et changement de lobby remplace le canal", async () => {
    screenListener("results");
    assert.equal(live.__getDrawItLiveDebugState().channel, null);
    live.activateDrawItLive({
      lobbyId: LOBBY_B,
      getSession: () => session(),
      getLocalUid: () => DRAWER,
      onRender: () => {},
    });
    await tick();
    assert.equal(channels.at(-1).topic, `drawit:${LOBBY_B}`);
  });
});

describe("Draw it ! T7 — payloads et autorisations", () => {
  it("construit start/chunk/end/clear/undo minimaux sans données interdites", () => {
    for (const type of ["start", "chunk", "end", "clear", "undo"]) {
      const built = live.buildDrawItLivePayload(type, {
        session: session(),
        uid: DRAWER,
        stroke: { strokeId: "s9", color: "#abc", width: 3, points: [[0.2, 0.3]] },
        strokeId: "s9",
        seq: 4,
      });
      assert.equal(built.type, type);
      for (const key of [
        "lobbyId",
        "game",
        "pseudo",
        "wordLabel",
        "wordId",
        "acceptedAnswers",
        "foundOrder",
        "guesses",
        "score",
      ]) {
        assert.equal(Object.hasOwn(built, key), false);
      }
    }
  });

  it("autorise seulement drawer+drawing+timer actif ; foundOrder ne bloque pas", () => {
    assert.equal(live.canEmitDrawItLive(session(), DRAWER), true);
    assert.equal(live.canEmitDrawItLive(session(), GUEST), false);
    assert.equal(live.canEmitDrawItLive(session({ phase: "reveal" }), DRAWER), false);
    assert.equal(
      live.canEmitDrawItLive(session({ foundOrder: [{ uid: GUEST }] }), DRAWER),
      true
    );
  });

  it("génère des strokeId distincts même après un remount local", () => {
    const first = live.createDrawItLiveStrokeId(DRAWER);
    const second = live.createDrawItLiveStrokeId(DRAWER);
    assert.notEqual(first, second);
    assert.match(first, new RegExp(`^${DRAWER}:`));
  });
});

describe("Draw it ! T7 — réception best-effort", () => {
  it("drop runId, roundIdx, epoch et drawer différents", () => {
    const s = session();
    const base = live.createDrawItLiveState(s);
    for (const changed of [
      { runId: "old" },
      { roundIdx: 1 },
      { canvasEpoch: 2 },
      { drawerUid: GUEST },
    ]) {
      assert.equal(
        live.applyDrawItLiveEvent(base, payload("chunk", changed), s).applied,
        false
      );
    }
  });

  it("drop duplicate/ancien seq mais accepte un trou", () => {
    const s = session();
    let result = live.applyDrawItLiveEvent(
      live.createDrawItLiveState(s),
      payload("start", { seq: 2 }),
      s
    );
    assert.equal(result.applied, true);
    assert.equal(
      live.applyDrawItLiveEvent(result.state, payload("chunk", { seq: 2 }), s)
        .applied,
      false
    );
    assert.equal(
      live.applyDrawItLiveEvent(result.state, payload("chunk", { seq: 1 }), s)
        .applied,
      false
    );
    result = live.applyDrawItLiveEvent(
      result.state,
      payload("chunk", { seq: 4, points: [[0.4, 0.4]] }),
      s
    );
    assert.equal(result.applied, true);
    assert.equal(result.state.remoteInProgress.s1.lastSeq, 4);
  });

  it("chunk sans start crée le stroke et ajoute seulement les nouveaux points", () => {
    const s = session();
    let result = live.applyDrawItLiveEvent(
      live.createDrawItLiveState(s),
      payload("chunk", { seq: 3, points: [[0.1, 0.1], [0.2, 0.2]] }),
      s
    );
    result = live.applyDrawItLiveEvent(
      result.state,
      payload("chunk", { seq: 4, points: [[0.2, 0.2], [0.3, 0.3]] }),
      s
    );
    assert.deepEqual(result.state.remoteInProgress.s1.points, [
      [0.1, 0.1],
      [0.2, 0.2],
      [0.3, 0.3],
    ]);
    assert.deepEqual(result.delta.points, [[0.3, 0.3]]);
  });

  it("end toléré sans chunks déplace vers remoteCompleted", () => {
    const s = session();
    const result = live.applyDrawItLiveEvent(
      live.createDrawItLiveState(s),
      payload("end"),
      s
    );
    assert.equal(result.applied, true);
    assert.deepEqual(result.state.remoteInProgress, {});
    assert.ok(result.state.remoteCompleted.s1);
  });

  it("clear/undo purgent et demandent un replay rare", () => {
    const s = session();
    let result = live.applyDrawItLiveEvent(
      live.createDrawItLiveState(s),
      payload("start"),
      s
    );
    result = live.applyDrawItLiveEvent(result.state, payload("undo"), s);
    assert.deepEqual(result.state.remoteInProgress, {});
    assert.equal(result.delta.type, "replay");
    result = live.applyDrawItLiveEvent(result.state, {
      type: "clear",
      runId: s.runId,
      roundIdx: s.roundIdx,
      canvasEpoch: s.canvasEpoch,
      drawerUid: DRAWER,
    }, s);
    assert.equal(result.delta.type, "replay");
  });

  it("changement round/epoch purge sans notion de channel", () => {
    const first = session();
    let state = live.applyDrawItLiveEvent(
      live.createDrawItLiveState(first),
      payload("start"),
      first
    ).state;
    state = live.syncDrawItLiveIdentity(state, session({ roundIdx: 1 }));
    assert.deepEqual(state.remoteInProgress, {});
    state = live.syncDrawItLiveIdentity(state, session({ roundIdx: 1, canvasEpoch: 2 }));
    assert.deepEqual(state.remoteCompleted, {});
  });
});

describe("Draw it ! T7 — émission 10 Hz / un en vol", () => {
  beforeEach(async () => {
    live.__resetDrawItLiveForTests();
    channels.length = 0;
    removed.length = 0;
    sendImpl = () => Promise.resolve("ok");
    live.activateDrawItLive({
      lobbyId: LOBBY_A,
      getSession: () => session(),
      getLocalUid: () => DRAWER,
      onRender: () => {},
    });
    await tick();
    channels[0].statusCallback("SUBSCRIBED");
  });

  afterEach(() => live.__resetDrawItLiveForTests());

  it("cadence déclarée 100 ms et aucun envoi par appel buffer", async () => {
    assert.equal(live.DRAW_IT_LIVE_CHUNK_MS, 100);
    live.startDrawItLiveStroke({
      strokeId: "s1",
      color: "#fff",
      width: 4,
      points: [[0.1, 0.1]],
    });
    await tick();
    const before = channels[0].sent.length;
    live.bufferDrawItLivePoints("s1", [[0.2, 0.2]]);
    live.bufferDrawItLivePoints("s1", [[0.3, 0.3]]);
    assert.equal(channels[0].sent.length, before);
    await live.flushDrawItLiveChunk();
    assert.deepEqual(channels[0].sent.at(-1).payload.points, [
      [0.2, 0.2],
      [0.3, 0.3],
    ]);
  });

  it("maximum un chunk en vol et end flush les derniers points", async () => {
    let release;
    sendImpl = () =>
      new Promise((resolve) => {
        release = resolve;
      });
    live.startDrawItLiveStroke({
      strokeId: "s1",
      color: "#fff",
      width: 4,
      points: [[0.1, 0.1]],
    });
    live.bufferDrawItLivePoints("s1", [[0.2, 0.2]]);
    assert.equal(await live.flushDrawItLiveChunk(), false);
    release("ok");
    await tick();
    sendImpl = () => Promise.resolve("ok");
    await live.endDrawItLiveStroke(
      { strokeId: "s1", color: "#fff", width: 4 },
      [[0.3, 0.3]]
    );
    const messages = channels[0].sent.map((entry) => entry.payload);
    assert.deepEqual(messages.map((entry) => entry.type), ["start", "chunk", "end"]);
    assert.deepEqual(messages[1].points, [[0.2, 0.2], [0.3, 0.3]]);
  });
});

describe("Draw it ! T7 — frontières de scope", () => {
  it("n'écrit ni game_sessions ni RPC stroke et canvas utilise les coalesced events", () => {
    const source = read("js/core/drawItLive.js");
    const canvas = read("js/core/drawItCanvas.js");
    assert.doesNotMatch(
      source,
      /\.from\(["']game_sessions["']\)|patchGameState|contribute_game_session|rpc\([^)]*stroke/i
    );
    assert.doesNotMatch(source, /Presence|postgres_changes|BroadcastChannel/);
    assert.match(canvas, /getCoalescedEvents/);
    assert.match(canvas, /drawDrawItLiveSegment/);
    assert.match(canvas, /isDrawing\(\)/);
  });
});
