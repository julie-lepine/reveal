/**
 * Cycle de vie canal Realtime sondages — skip, reconnect, courses.
 * (Sans import lobbyPollStore : supabaseClient charge esm.sh https.)
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
} from "../js/core/lobbyPollChannel.js";
import {
  isRealtimeActivePollClose,
  isRealtimeOpenPollInsert,
  computeUnseenPollOnNewId,
} from "../js/core/lobbyPollLogic.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * @param {{ syncSubscribe?: boolean|string, autoSubscribe?: boolean }} [opts]
 */
function makeMockRealtime(opts = {}) {
  const { syncSubscribe = false, autoSubscribe = true } = opts;
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
      on(_type, cfg, cb) {
        filters.push({ table: cfg.table, filter: cfg.filter });
        if (cfg.table === "lobby_polls") listeners.polls = cb;
        if (cfg.table === "lobby_poll_votes") listeners.votes = cb;
        return ch;
      },
      subscribe(cb) {
        listeners.status = cb;
        if (syncSubscribe === true) {
          cb("SUBSCRIBED");
        } else if (syncSubscribe === "error") {
          cb("CHANNEL_ERROR");
        } else if (autoSubscribe) {
          queueMicrotask(() => cb("SUBSCRIBED"));
        }
        return ch;
      },
      _emitStatus(status) {
        listeners.status?.(status);
      },
      _emitPolls(payload) {
        listeners.polls?.(payload);
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

describe("shouldSkipPollChannelRebuild", () => {
  it("skip si même config et subscribing|subscribed", () => {
    assert.equal(
      shouldSkipPollChannelRebuild({
        hasChannel: true,
        channelLobbyId: "L",
        channelVotesPollId: null,
        desiredLobbyId: "L",
        desiredVotesPollId: null,
        subscriptionStatus: "subscribing",
      }),
      true
    );
    assert.equal(
      shouldSkipPollChannelRebuild({
        hasChannel: true,
        channelLobbyId: "L",
        channelVotesPollId: null,
        desiredLobbyId: "L",
        desiredVotesPollId: null,
        subscriptionStatus: "subscribed",
      }),
      true
    );
  });

  it("ne skip pas un état terminal error (même config)", () => {
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
    assert.equal(pollRealtimeReconnectDelayMs(1), 2000);
    assert.equal(pollRealtimeReconnectDelayMs(2), 5000);
    assert.equal(pollRealtimeReconnectDelayMs(3), 10000);
    assert.equal(pollRealtimeReconnectDelayMs(99), 10000);
  });
});

describe("lobbyPollChannel lifecycle", () => {
  it("cycle complet polls-only → A → close → polls-only → B", async () => {
    const mock = makeMockRealtime();
    const pollsEvents = [];
    const ctrl = createPollChannelController({
      createChannel: mock.createChannel,
      removeChannel: mock.removeChannel,
      onPollsEvent: (p) => pollsEvents.push(p),
      onVotesEvent: () => {},
    });

    await ctrl.requestRebuild("lobby-uuid", null);
    assert.equal(mock.channels.length, 1);
    assert.equal(ctrl.getState().channelVotesPollId, null);

    await ctrl.requestRebuild("lobby-uuid", "poll-A");
    assert.equal(ctrl.getState().channelVotesPollId, "poll-A");

    await ctrl.requestRebuild("lobby-uuid", null);
    assert.equal(ctrl.getState().channelVotesPollId, null);

    await ctrl.requestRebuild("lobby-uuid", "poll-B");
    assert.equal(mock.channels.length, 1);
    assert.equal(ctrl.getState().channelVotesPollId, "poll-B");
    mock.channels[0]._emitPolls({ eventType: "INSERT", new: { id: "poll-B" } });
    assert.equal(pollsEvents.length, 1);

    await ctrl.dispose();
  });

  it("refetch pendant SUBSCRIBING : aucun remove / second build", async () => {
    const mock = makeMockRealtime({ autoSubscribe: false });
    const ctrl = createPollChannelController({
      createChannel: mock.createChannel,
      removeChannel: mock.removeChannel,
      onPollsEvent: () => {},
      onVotesEvent: () => {},
    });

    await ctrl.requestRebuild("L", null);
    assert.equal(ctrl.getState().subscriptionStatus, "subscribing");
    assert.equal(mock.builds.length, 1);
    const topic1 = mock.channels[0].topic;

    await ctrl.requestRebuild("L", null);
    assert.equal(mock.builds.length, 1);
    assert.equal(mock.removed.length, 0);
    assert.equal(mock.channels[0].topic, topic1);

    await ctrl.dispose();
  });

  it("callback SUBSCRIBED synchrone : status subscribed", async () => {
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

  it("CHANNEL_ERROR → onTerminalError ; rebuild → SUBSCRIBED", async () => {
    let terminalCount = 0;
    let subscribedCount = 0;
    let phase = 0;
    const mock = makeMockRealtime({ autoSubscribe: false });
    const ctrl = createPollChannelController({
      createChannel: (topic) => {
        phase += 1;
        const ch = mock.createChannel(topic);
        const baseSubscribe = ch.subscribe;
        ch.subscribe = (cb) => {
          ch._listeners.status = cb;
          if (phase === 1) cb("CHANNEL_ERROR");
          else queueMicrotask(() => cb("SUBSCRIBED"));
          return ch;
        };
        void baseSubscribe;
        return ch;
      },
      removeChannel: mock.removeChannel,
      onPollsEvent: () => {},
      onVotesEvent: () => {},
      onTerminalError: () => {
        terminalCount += 1;
      },
      onSubscribed: () => {
        subscribedCount += 1;
      },
    });

    await ctrl.requestRebuild("L", null);
    assert.equal(ctrl.getState().subscriptionStatus, "error");
    assert.equal(terminalCount, 1);

    await ctrl.requestRebuild("L", null);
    await new Promise((r) => queueMicrotask(r));
    assert.equal(ctrl.getState().subscriptionStatus, "subscribed");
    assert.equal(subscribedCount, 1);
    assert.equal(mock.builds.length, 2);

    await ctrl.dispose();
  });

  it("CLOSED ancien canal : pas de onTerminalError parasite", async () => {
    let terminalCount = 0;
    const mock = makeMockRealtime({ autoSubscribe: true });
    const ctrl = createPollChannelController({
      createChannel: mock.createChannel,
      removeChannel: mock.removeChannel,
      onPollsEvent: () => {},
      onVotesEvent: () => {},
      onTerminalError: () => {
        terminalCount += 1;
      },
    });

    await ctrl.requestRebuild("L", null);
    await new Promise((r) => queueMicrotask(r));
    assert.equal(ctrl.getState().subscriptionStatus, "subscribed");

    await ctrl.requestRebuild("L", "poll-A");
    await new Promise((r) => queueMicrotask(r));
    assert.equal(ctrl.getState().subscriptionStatus, "subscribed");
    assert.equal(ctrl.getState().channelVotesPollId, "poll-A");
    assert.equal(terminalCount, 0);

    await ctrl.dispose();
  });

  it("TIMED_OUT répétés : chaque statut notifie ; store n'a qu'un timer", async () => {
    let terminalCount = 0;
    const mock = makeMockRealtime({ autoSubscribe: false });
    const ctrl = createPollChannelController({
      createChannel: mock.createChannel,
      removeChannel: mock.removeChannel,
      onPollsEvent: () => {},
      onVotesEvent: () => {},
      onTerminalError: () => {
        terminalCount += 1;
      },
    });

    await ctrl.requestRebuild("L", null);
    mock.channels[0]._emitStatus("TIMED_OUT");
    mock.channels[0]._emitStatus("TIMED_OUT");
    mock.channels[0]._emitStatus("CHANNEL_ERROR");
    assert.equal(terminalCount, 3);
    assert.equal(ctrl.getState().subscriptionStatus, "error");

    const storeSrc = readFileSync(
      join(__dirname, "../js/core/lobbyPollStore.js"),
      "utf8"
    );
    assert.match(
      storeSrc,
      /if \(!started \|\| !authGatePassed \|\| pollReconnectTimer\) return/
    );

    await ctrl.dispose();
  });

  it("course de rebuild : remove tardif ne retire pas le canal final", async () => {
    const mock = makeMockRealtime();
    const ctrl = createPollChannelController({
      createChannel: mock.createChannel,
      removeChannel: mock.removeChannel,
      onPollsEvent: () => {},
      onVotesEvent: () => {},
    });

    await ctrl.requestRebuild("L", null);
    const topicA = mock.channels[0].topic;
    const releaseRemoveA = mock.holdNextRemove();
    const pB = ctrl.requestRebuild("L", "poll-B");
    await new Promise((r) => setTimeout(r, 5));
    const pC = ctrl.requestRebuild("L", "poll-C");
    releaseRemoveA();
    await Promise.all([pB, pC]);

    assert.equal(mock.channels.length, 1);
    assert.equal(ctrl.getState().channelVotesPollId, "poll-C");
    assert.notEqual(mock.channels[0].topic, topicA);

    await ctrl.dispose();
  });

  it("refuse un lobbyId vide", async () => {
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

describe("boot auth (contrat source)", () => {
  it("aucun canal poll avant authReady : gate + ordre main.js", () => {
    const storeSrc = readFileSync(
      join(__dirname, "../js/core/lobbyPollStore.js"),
      "utf8"
    );
    const mainSrc = readFileSync(join(__dirname, "../js/main.js"), "utf8");

    assert.match(storeSrc, /await authReadyForSync/);
    assert.match(storeSrc, /authGatePassed = true/);
    assert.match(storeSrc, /if \(!authGatePassed\)/);
    assert.match(storeSrc, /queueVotesSubscription blocked \(auth gate\)/);

    const bootStart = mainSrc.indexOf("async function boot");
    const beforeBoot = mainSrc.slice(0, bootStart);
    assert.doesNotMatch(beforeBoot, /initLobbyPollSync\(\)/);

    const authIdx = mainSrc.indexOf("await authReady", bootStart);
    const pollIdx = mainSrc.indexOf("initLobbyPollSync", bootStart);
    assert.ok(authIdx >= 0 && pollIdx > authIdx);
  });
});

describe("pollRealtimeDiagnose helpers", () => {
  it("inspectLobbyId distingue UUID et code court", async () => {
    const { inspectLobbyIdForRealtimeFilter } = await import(
      "../js/core/lobbyPollRealtimeDiagnose.js"
    );
    const uuid = inspectLobbyIdForRealtimeFilter(
      "a1b2c3d4-e5f6-4890-abcd-ef1234567890"
    );
    assert.equal(uuid.looksLikeUuid, true);
    assert.equal(uuid.looksLikeShortCode, false);
    assert.equal(
      uuid.filter,
      "lobby_id=eq.a1b2c3d4-e5f6-4890-abcd-ef1234567890"
    );

    const code = inspectLobbyIdForRealtimeFilter("AB12CD");
    assert.equal(code.looksLikeShortCode, true);
    assert.equal(code.looksLikeUuid, false);
  });

  it("votes listener : nextVotes null ne produit pas poll_id=eq.null", () => {
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
    return ctrl.requestRebuild("a1b2c3d4-e5f6-4890-abcd-ef1234567890", null).then(() => {
      assert.equal(filters.length, 1);
      assert.equal(filters[0].table, "lobby_polls");
      assert.equal(
        filters[0].filter,
        "lobby_id=eq.a1b2c3d4-e5f6-4890-abcd-ef1234567890"
      );
      assert.ok(!filters.some((f) => String(f.filter || "").includes("null")));
      return ctrl.dispose();
    });
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
    assert.equal(
      computeUnseenPollOnNewId({
        pollId: "B",
        lastSeenPollId: "A",
        sheetOpen: true,
        localCreate: false,
        isInitialHydrate: false,
      }).unseenPoll,
      false
    );
  });
});
