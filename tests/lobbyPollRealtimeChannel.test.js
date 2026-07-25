/**
 * Cycle de vie canal Realtime sondages — coalesce, degraded keep vs join-reply replace.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  createPollChannelController,
  shouldSkipPollChannelRebuild,
  pollRealtimeReconnectDelayMs,
  POLL_REALTIME_RECONNECT_DELAYS_MS,
  isJoinReplyChannelError,
} from "../js/core/lobbyPollChannel.js";
import {
  isRealtimeActivePollClose,
  isRealtimeOpenPollInsert,
  computeUnseenPollOnNewId,
} from "../js/core/lobbyPollLogic.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

import { inspectLobbyIdForRealtimeFilter as inspectLobbyId } from "../js/core/lobbyPollRealtimeDiagnose.js";

/**
 * @param {{ syncSubscribe?: boolean|string, autoSubscribe?: boolean, initialState?: string }} [opts]
 */
function makeMockRealtime(opts = {}) {
  const {
    syncSubscribe = false,
    autoSubscribe = true,
    initialState = "joining",
  } = opts;
  const channels = [];
  const removed = [];
  const builds = [];
  let removeGate = null;

  function holdNextRemove() {
    let release;
    removeGate = new Promise((r) => {
      release = r;
    });
    return () => {
      removeGate = null;
      release();
    };
  }

  function createChannel(topic) {
    builds.push(topic);
    const listeners = { polls: null, votes: null, status: null };
    const filters = [];
    const ch = {
      topic,
      state: initialState,
      __pollSubscribeCallCount: 0,
      on(_type, cfg, cb) {
        filters.push({ table: cfg.table, filter: cfg.filter });
        if (cfg.table === "lobby_polls") listeners.polls = cb;
        if (cfg.table === "lobby_poll_votes") listeners.votes = cb;
        return ch;
      },
      subscribe(cb) {
        listeners.status = cb;
        if (syncSubscribe === true) {
          ch.state = "joined";
          cb("SUBSCRIBED");
        } else if (syncSubscribe === "error") {
          cb("CHANNEL_ERROR", { message: "mock error" });
        } else if (autoSubscribe) {
          queueMicrotask(() => {
            ch.state = "joined";
            cb("SUBSCRIBED");
          });
        }
        return ch;
      },
      _emitStatus(status, err) {
        if (status === "SUBSCRIBED") ch.state = "joined";
        if (status === "TIMED_OUT") ch.state = "errored";
        // CHANNEL_ERROR : l'appelant fixe ch.state (joining=A, errored=B)
        listeners.status?.(status, err);
      },
      _filters: filters,
      _listeners: listeners,
    };
    channels.push(ch);
    return ch;
  }

  async function removeChannel(ch) {
    if (removeGate) await removeGate;
    ch._listeners?.status?.("CLOSED");
    removed.push(ch.topic);
    const idx = channels.indexOf(ch);
    if (idx >= 0) channels.splice(idx, 1);
  }

  return {
    createChannel,
    removeChannel,
    channels,
    removed,
    builds,
    holdNextRemove,
  };
}

describe("isJoinReplyChannelError", () => {
  it("joining + CHANNEL_ERROR → true ; errored → false", () => {
    assert.equal(isJoinReplyChannelError("CHANNEL_ERROR", "joining"), true);
    assert.equal(isJoinReplyChannelError("CHANNEL_ERROR", "errored"), false);
    assert.equal(isJoinReplyChannelError("TIMED_OUT", "joining"), false);
    assert.equal(isJoinReplyChannelError("TIMED_OUT", "errored"), false);
    assert.equal(isJoinReplyChannelError("CHANNEL_ERROR", null), false);
  });
});

describe("shouldSkipPollChannelRebuild", () => {
  it("skip si même config et subscribing|subscribed|degraded", () => {
    for (const subscriptionStatus of ["subscribing", "subscribed", "degraded"]) {
      assert.equal(
        shouldSkipPollChannelRebuild({
          hasChannel: true,
          channelLobbyId: "L",
          channelVotesPollId: null,
          desiredLobbyId: "L",
          desiredVotesPollId: null,
          subscriptionStatus,
        }),
        true,
        subscriptionStatus
      );
    }
  });

  it("ne skip pas error terminal (CLOSED path)", () => {
    assert.equal(
      shouldSkipPollChannelRebuild({
        hasChannel: true,
        channelLobbyId: "L",
        channelVotesPollId: null,
        desiredLobbyId: "L",
        desiredVotesPollId: null,
        subscriptionStatus: "error",
      }),
      false
    );
  });
});

describe("pollRealtimeReconnectDelayMs", () => {
  it("backoff borné 1s 2s 5s 10s", () => {
    assert.deepEqual(POLL_REALTIME_RECONNECT_DELAYS_MS, [1000, 2000, 5000, 10000]);
    assert.equal(pollRealtimeReconnectDelayMs(0), 1000);
    assert.equal(pollRealtimeReconnectDelayMs(99), 10000);
  });
});

describe("lobbyPollChannel lifecycle", () => {
  it("phx_error (state=errored) → degraded keep ; pas de replace", async () => {
    let involuntary = 0;
    const mock = makeMockRealtime({ autoSubscribe: false });
    const ctrl = createPollChannelController({
      createChannel: mock.createChannel,
      removeChannel: mock.removeChannel,
      onPollsEvent: () => {},
      onVotesEvent: () => {},
      onInvoluntaryClosed: () => {
        involuntary += 1;
      },
    });

    await ctrl.requestRebuild("L", null, { reason: "boot" });
    assert.equal(ctrl.getState().subscriptionStatus, "subscribing");
    assert.equal(mock.builds.length, 1);
    const topic7 = mock.channels[0].topic;

    await ctrl.requestRebuild("L", null, { reason: "refetch_open_false" });
    await ctrl.requestRebuild("L", null, { reason: "auth_emit" });
    assert.equal(mock.builds.length, 1);
    assert.equal(mock.removed.length, 0);
    assert.equal(mock.channels[0].topic, topic7);

    mock.channels[0]._emitStatus("SUBSCRIBED");
    assert.equal(ctrl.getState().subscriptionStatus, "subscribed");

    // Famille B : constructeur a déjà passé state → errored
    mock.channels[0].state = "errored";
    mock.channels[0]._emitStatus("CHANNEL_ERROR", { message: "transport" });
    assert.equal(ctrl.getState().subscriptionStatus, "degraded");
    assert.equal(mock.builds.length, 1);
    assert.equal(mock.removed.length, 0);
    assert.equal(involuntary, 0);

    await ctrl.requestRebuild("L", null, { reason: "refetch_again" });
    assert.equal(mock.builds.length, 1);
    assert.equal(mock.removed.length, 0);

    await ctrl.dispose();
    assert.equal(involuntary, 0);
    assert.equal(ctrl.getState().subscriptionStatus, "idle");
  });

  it("join-reply (state=joining) → replace via onInvoluntaryClosed", async () => {
    let involuntary = 0;
    const mock = makeMockRealtime({ autoSubscribe: false });
    const ctrl = createPollChannelController({
      createChannel: mock.createChannel,
      removeChannel: mock.removeChannel,
      onPollsEvent: () => {},
      onVotesEvent: () => {},
      onInvoluntaryClosed: () => {
        involuntary += 1;
      },
    });

    await ctrl.requestRebuild("L", null, { reason: "boot" });
    assert.equal(mock.channels[0].state, "joining");

    mock.channels[0].state = "joining";
    mock.channels[0]._emitStatus("CHANNEL_ERROR", {
      message: "ignored-text-not-a-criterion",
    });

    assert.equal(ctrl.getState().subscriptionStatus, "error");
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(involuntary, 1);
    assert.equal(mock.removed.length, 1);
    await ctrl.dispose();
  });

  it("TIMED_OUT → degraded keep (recovery interne)", async () => {
    let involuntary = 0;
    const mock = makeMockRealtime({ autoSubscribe: false });
    const ctrl = createPollChannelController({
      createChannel: mock.createChannel,
      removeChannel: mock.removeChannel,
      onPollsEvent: () => {},
      onVotesEvent: () => {},
      onInvoluntaryClosed: () => {
        involuntary += 1;
      },
    });

    await ctrl.requestRebuild("L", null);
    mock.channels[0]._emitStatus("TIMED_OUT");
    assert.equal(ctrl.getState().subscriptionStatus, "degraded");
    assert.equal(involuntary, 0);
    assert.equal(mock.removed.length, 0);
    await ctrl.dispose();
  });

  it("CLOSED involontaire → onInvoluntaryClosed une fois", async () => {
    let involuntary = 0;
    const mock = makeMockRealtime({ autoSubscribe: false });
    const ctrl = createPollChannelController({
      createChannel: mock.createChannel,
      removeChannel: mock.removeChannel,
      onPollsEvent: () => {},
      onVotesEvent: () => {},
      onInvoluntaryClosed: () => {
        involuntary += 1;
      },
    });

    await ctrl.requestRebuild("L", null);
    mock.channels[0]._emitStatus("CLOSED");
    assert.equal(involuntary, 1);
    assert.equal(ctrl.getState().subscriptionStatus, "error");
    await ctrl.dispose();
  });

  it("plusieurs rebuilds identiques → un channel, subscribeCallCount=1", async () => {
    const mock = makeMockRealtime({ syncSubscribe: true, autoSubscribe: false });
    const ctrl = createPollChannelController({
      createChannel: mock.createChannel,
      removeChannel: mock.removeChannel,
      onPollsEvent: () => {},
      onVotesEvent: () => {},
    });

    const p1 = ctrl.requestRebuild("L", null, { reason: "a" });
    const p2 = ctrl.requestRebuild("L", null, { reason: "b" });
    const p3 = ctrl.requestRebuild("L", null, { reason: "c" });
    await Promise.all([p1, p2, p3]);

    assert.equal(mock.builds.length, 1);
    assert.equal(mock.channels.length, 1);
    assert.equal(mock.channels[0].__pollSubscribeCallCount, 1);
    assert.equal(ctrl.getState().subscriptionStatus, "subscribed");
    await ctrl.dispose();
  });

  it("callback SUBSCRIBED synchrone", async () => {
    const mock = makeMockRealtime({ syncSubscribe: true, autoSubscribe: false });
    const ctrl = createPollChannelController({
      createChannel: mock.createChannel,
      removeChannel: mock.removeChannel,
      onPollsEvent: () => {},
      onVotesEvent: () => {},
    });
    await ctrl.requestRebuild("L", null);
    assert.equal(ctrl.getState().subscriptionStatus, "subscribed");
    await ctrl.dispose();
  });

  it("cycle polls-only → votes A → polls-only → votes B", async () => {
    const mock = makeMockRealtime();
    const ctrl = createPollChannelController({
      createChannel: mock.createChannel,
      removeChannel: mock.removeChannel,
      onPollsEvent: () => {},
      onVotesEvent: () => {},
    });

    await ctrl.requestRebuild("lobby-uuid", null);
    await ctrl.requestRebuild("lobby-uuid", "poll-A");
    assert.equal(ctrl.getState().channelVotesPollId, "poll-A");
    await ctrl.requestRebuild("lobby-uuid", null);
    assert.equal(ctrl.getState().channelVotesPollId, null);
    await ctrl.requestRebuild("lobby-uuid", "poll-B");
    assert.equal(mock.channels.length, 1);
    assert.equal(ctrl.getState().channelVotesPollId, "poll-B");
    await ctrl.dispose();
  });

  it("votes null : pas de filter poll_id=eq.null", async () => {
    const mock = makeMockRealtime({ autoSubscribe: false });
    const filters = [];
    const ctrl = createPollChannelController({
      createChannel: (topic) => {
        const ch = mock.createChannel(topic);
        const origOn = ch.on.bind(ch);
        ch.on = (type, cfg, cb) => {
          filters.push(cfg);
          return origOn(type, cfg, cb);
        };
        return ch;
      },
      removeChannel: mock.removeChannel,
      onPollsEvent: () => {},
      onVotesEvent: () => {},
    });
    await ctrl.requestRebuild("a1b2c3d4-e5f6-4890-abcd-ef1234567890", null);
    assert.equal(filters.length, 1);
    assert.equal(filters[0].table, "lobby_polls");
    assert.ok(!filters.some((f) => String(f.filter || "").includes("null")));
    await ctrl.dispose();
  });

  it("ancien CLOSED après remove ne touche pas le nouveau canal", async () => {
    let involuntary = 0;
    const mock = makeMockRealtime();
    const ctrl = createPollChannelController({
      createChannel: mock.createChannel,
      removeChannel: mock.removeChannel,
      onPollsEvent: () => {},
      onVotesEvent: () => {},
      onInvoluntaryClosed: () => {
        involuntary += 1;
      },
    });

    await ctrl.requestRebuild("L", null);
    await new Promise((r) => queueMicrotask(r));
    await ctrl.requestRebuild("L", "poll-A");
    await new Promise((r) => queueMicrotask(r));
    assert.equal(ctrl.getState().subscriptionStatus, "subscribed");
    assert.equal(ctrl.getState().channelVotesPollId, "poll-A");
    assert.equal(involuntary, 0);
    await ctrl.dispose();
  });

  it("refuse lobbyId vide", async () => {
    const mock = makeMockRealtime();
    const ctrl = createPollChannelController({
      createChannel: mock.createChannel,
      removeChannel: mock.removeChannel,
      onPollsEvent: () => {},
      onVotesEvent: () => {},
    });
    await assert.rejects(
      () => ctrl.requestRebuild("", null),
      /poll_channel_invalid_lobby_id/
    );
    await ctrl.dispose();
  });
});

describe("boot auth + reconnect contrat source", () => {
  it("join-reply replace ; phx_error keep ; CLOSED reconnect", () => {
    const storeSrc = readFileSync(
      join(__dirname, "../js/core/lobbyPollStore.js"),
      "utf8"
    );
    const chSrc = readFileSync(
      join(__dirname, "../js/core/lobbyPollChannel.js"),
      "utf8"
    );
    assert.match(storeSrc, /onInvoluntaryClosed/);
    assert.match(chSrc, /isJoinReplyChannelError/);
    assert.match(chSrc, /join_reply_error_replace/);
    assert.match(chSrc, /subscriptionStatus = "degraded"/);
    assert.match(chSrc, /onInvoluntaryClosed/);
    assert.doesNotMatch(chSrc, /onTerminalError/);
    assert.doesNotMatch(chSrc, /unmatched topic/);
    assert.match(storeSrc, /await authReadyForSync/);

    const mainSrc = readFileSync(join(__dirname, "../js/main.js"), "utf8");
    const bootStart = mainSrc.indexOf("async function boot");
    assert.doesNotMatch(
      mainSrc.slice(0, bootStart),
      /initLobbyPollSync\(\)/
    );
  });

  it("probes A/B/C désactivées", () => {
    const diag = readFileSync(
      join(__dirname, "../js/core/lobbyPollRealtimeDiagnose.js"),
      "utf8"
    );
    assert.match(diag, /Probes A\/B\/C désactivées/);
  });
});

describe("pollRealtimeDiagnose helpers", () => {
  it("inspectLobbyId UUID", () => {
    const uuid = inspectLobbyId("a1b2c3d4-e5f6-4890-abcd-ef1234567890");
    assert.equal(uuid.looksLikeUuid, true);
    assert.equal(uuid.looksLikeShortCode, false);
  });
});

describe("payloads close / insert / pastille", () => {
  it("UPDATE sans old.status", () => {
    assert.equal(
      isRealtimeActivePollClose(
        {
          eventType: "UPDATE",
          old: { id: "p1" },
          new: { id: "p1", status: "closed" },
        },
        "p1"
      ),
      true
    );
  });

  it("INSERT open lobby courant", () => {
    assert.equal(
      isRealtimeOpenPollInsert(
        {
          eventType: "INSERT",
          new: { id: "B", lobby_id: "L", status: "open" },
        },
        "L"
      ),
      true
    );
  });

  it("pastille sheet fermé / ouvert", () => {
    assert.equal(
      computeUnseenPollOnNewId({
        pollId: "B",
        lastSeenPollId: "A",
        sheetOpen: false,
        localCreate: false,
        isInitialHydrate: false,
      }).unseenPoll,
      true
    );
  });
});
