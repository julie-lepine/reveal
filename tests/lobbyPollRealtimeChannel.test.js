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
  MAX_JOIN_REPLY_IMMEDIATE_REPLACES,
} from "../js/core/lobbyPollChannel.js";
import {
  isRealtimeActivePollClose,
  isRealtimeOpenPollInsert,
  computeUnseenPollOnNewId,
  shouldApplyReplacementCatchup,
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
  const removedChannels = [];
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
    // Simule realtime-js : topic interne = realtime:${logical}
    const ch = {
      topic: `realtime:${topic}`,
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
    removed.push(ch.__pollLogicalTopic || ch.topic);
    removedChannels.push(ch);
    const idx = channels.indexOf(ch);
    if (idx >= 0) channels.splice(idx, 1);
  }

  return {
    createChannel,
    removeChannel,
    channels,
    removed,
    removedChannels,
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

  it("join-reply (state=joining) → replace immédiat, pas de timer reconnect", async () => {
    let involuntary = 0;
    /** @type {object[]} */
    const subscribedMeta = [];
    const mock = makeMockRealtime({ autoSubscribe: false });
    const ctrl = createPollChannelController({
      createChannel: mock.createChannel,
      removeChannel: mock.removeChannel,
      onPollsEvent: () => {},
      onVotesEvent: () => {},
      onSubscribed: (meta) => {
        subscribedMeta.push(meta);
      },
      onInvoluntaryClosed: () => {
        involuntary += 1;
      },
    });

    await ctrl.requestRebuild("L", null, { reason: "boot" });
    const genBefore = ctrl.getState().channelGen;
    assert.equal(mock.channels[0].state, "joining");
    assert.equal(mock.builds.length, 1);

    mock.channels[0].state = "joining";
    mock.channels[0]._emitStatus("CHANNEL_ERROR", {
      message: "ignored-text-not-a-criterion",
    });

    assert.equal(ctrl.getState().subscriptionStatus, "error");
    await new Promise((r) => setTimeout(r, 0));
    await ctrl._awaitIdle();

    assert.equal(involuntary, 0, "pas de onInvoluntaryClosed (reconnect différé)");
    assert.equal(mock.removed.length, 1);
    assert.equal(mock.builds.length, 2, "nouveau canal créé immédiatement");
    assert.ok(ctrl.getState().channelGen > genBefore);
    assert.equal(ctrl.getState().hasChannel, true);
    assert.equal(ctrl.getState().subscriptionStatus, "subscribing");
    assert.equal(ctrl.getState().lastBuildReason, "join_reply_error_replace");
    assert.equal(ctrl.getState().joinReplyImmediateStreak, 1);

    mock.channels[0].state = "joined";
    mock.channels[0]._emitStatus("SUBSCRIBED");
    assert.equal(ctrl.getState().subscriptionStatus, "subscribed");
    assert.equal(ctrl.getState().joinReplyImmediateStreak, 0);
    assert.equal(subscribedMeta.length, 1);
    assert.equal(subscribedMeta[0].reason, "join_reply_error_replace");
    assert.equal(subscribedMeta[0].lobbyId, "L");

    await ctrl.dispose();
  });

  it("join-reply avec votesPollId → remplacement conserve le désir votes", async () => {
    const mock = makeMockRealtime({ autoSubscribe: false });
    const ctrl = createPollChannelController({
      createChannel: mock.createChannel,
      removeChannel: mock.removeChannel,
      onPollsEvent: () => {},
      onVotesEvent: () => {},
      onInvoluntaryClosed: () => {},
    });

    await ctrl.requestRebuild("L", "poll-A", { reason: "boot" });
    mock.channels[0].state = "joining";
    mock.channels[0]._emitStatus("CHANNEL_ERROR");
    await new Promise((r) => setTimeout(r, 0));
    await ctrl._awaitIdle();

    assert.equal(ctrl.getState().channelVotesPollId, "poll-A");
    assert.equal(mock.builds.length, 2);
    const votesFilters = mock.channels[0]._filters.filter(
      (f) => f.table === "lobby_poll_votes"
    );
    assert.equal(votesFilters.length, 1);
    assert.match(votesFilters[0].filter, /poll_id=eq\.poll-A/);
    await ctrl.dispose();
  });

  it("plusieurs join-reply successifs → sérialisé, circuit puis reconnect différé", async () => {
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

    for (let i = 0; i < MAX_JOIN_REPLY_IMMEDIATE_REPLACES; i += 1) {
      const ch = mock.channels[0];
      assert.ok(ch, `canal actif avant join-reply #${i + 1}`);
      ch.state = "joining";
      ch._emitStatus("CHANNEL_ERROR");
      await new Promise((r) => setTimeout(r, 0));
      await ctrl._awaitIdle();
      assert.equal(involuntary, 0);
    }

    assert.equal(
      ctrl.getState().joinReplyImmediateStreak,
      MAX_JOIN_REPLY_IMMEDIATE_REPLACES
    );
    assert.equal(mock.builds.length, 1 + MAX_JOIN_REPLY_IMMEDIATE_REPLACES);

    // Encore un join-reply → circuit open → onInvoluntaryClosed, pas de build immédiat
    const buildsBeforeCircuit = mock.builds.length;
    mock.channels[0].state = "joining";
    mock.channels[0]._emitStatus("CHANNEL_ERROR");
    await new Promise((r) => setTimeout(r, 0));
    await ctrl._awaitIdle();

    assert.equal(involuntary, 1);
    assert.equal(mock.builds.length, buildsBeforeCircuit);
    assert.equal(ctrl.getState().hasChannel, false);

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

describe("RealtimeChannel.topic préservé (préfixe realtime:)", () => {
  it("createChannel reçoit le topic logique ; .topic interne non muté", async () => {
    const mock = makeMockRealtime({ syncSubscribe: true, autoSubscribe: false });
    let topicWriteCount = 0;
    const ctrl = createPollChannelController({
      createChannel: (logical) => {
        const ch = mock.createChannel(logical);
        let internal = ch.topic;
        Object.defineProperty(ch, "topic", {
          configurable: true,
          enumerable: true,
          get() {
            return internal;
          },
          set(_v) {
            topicWriteCount += 1;
            internal = _v;
          },
        });
        return ch;
      },
      removeChannel: mock.removeChannel,
      onPollsEvent: () => {},
      onVotesEvent: () => {},
    });

    await ctrl.requestRebuild("L", null, { reason: "boot" });

    assert.equal(mock.builds.length, 1);
    assert.equal(mock.builds[0], "lobby-polls:L:1");
    assert.equal(topicWriteCount, 0, "builder.topic ne doit jamais être réassigné");
    assert.equal(mock.channels[0].topic, "realtime:lobby-polls:L:1");
    assert.equal(mock.channels[0].__pollLogicalTopic, "lobby-polls:L:1");
    assert.equal(ctrl.getState().logicalTopic, "lobby-polls:L:1");
    assert.equal(ctrl.getState().topic, "lobby-polls:L:1");
    assert.equal(ctrl.getState().internalTopic, "realtime:lobby-polls:L:1");
    assert.ok(mock.channels[0].__pollChannelId);
    assert.ok(mock.channels[0].__pollControllerId);

    await ctrl.dispose();
  });

  it("replace join-reply : gen N→N+1, remove sur l'objet exact, un seul canal", async () => {
    const mock = makeMockRealtime({ autoSubscribe: false });
    const ctrl = createPollChannelController({
      createChannel: mock.createChannel,
      removeChannel: mock.removeChannel,
      onPollsEvent: () => {},
      onVotesEvent: () => {},
      onInvoluntaryClosed: () => {},
    });

    await ctrl.requestRebuild("L", null, { reason: "boot" });
    const genN = ctrl.getState().channelGen;
    const oldChannel = mock.channels[0];
    const oldInternal = oldChannel.topic;
    assert.equal(oldInternal, `realtime:lobby-polls:L:${genN}`);

    oldChannel.state = "joining";
    oldChannel._emitStatus("CHANNEL_ERROR", { message: "unmatched topic" });
    await new Promise((r) => setTimeout(r, 0));
    await ctrl._awaitIdle();

    assert.equal(mock.removedChannels.length, 1);
    assert.equal(mock.removedChannels[0], oldChannel);
    assert.equal(mock.builds.length, 2);
    assert.equal(ctrl.getState().channelGen, genN + 1);
    assert.equal(mock.channels.length, 1);
    assert.equal(mock.builds[0], `lobby-polls:L:${genN}`);
    assert.equal(mock.builds[1], `lobby-polls:L:${genN + 1}`);
    assert.equal(
      mock.channels[0].topic,
      `realtime:lobby-polls:L:${genN + 1}`
    );
    assert.notEqual(mock.channels[0].topic, oldInternal);
    assert.equal(
      mock.channels[0].__pollLogicalTopic,
      `lobby-polls:L:${genN + 1}`
    );

    await ctrl.dispose();
  });

  it("gardes stale : identité objet + channelGen (pas .topic)", async () => {
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
    const stale = mock.channels[0];
    stale.state = "joining";
    stale._emitStatus("CHANNEL_ERROR");
    await new Promise((r) => setTimeout(r, 0));
    await ctrl._awaitIdle();

    const current = mock.channels[0];
    assert.notEqual(current, stale);
    // Mutation du topic interne sur l'ancien objet ne doit pas affecter le nouveau.
    stale.topic = "realtime:forged-stale-topic";
    stale.state = "joining";
    stale._emitStatus("CHANNEL_ERROR");
    await new Promise((r) => setTimeout(r, 0));
    await ctrl._awaitIdle();

    assert.equal(involuntary, 0);
    assert.equal(mock.channels[0], current);
    assert.equal(ctrl.getState().subscriptionStatus, "subscribing");
    assert.equal(
      current.topic,
      `realtime:lobby-polls:L:${ctrl.getState().channelGen}`
    );

    await ctrl.dispose();
  });

  it("catch-up meta uniquement après SUBSCRIBED post-replace", async () => {
    /** @type {object[]} */
    const subscribedMeta = [];
    const mock = makeMockRealtime({ autoSubscribe: false });
    const ctrl = createPollChannelController({
      createChannel: mock.createChannel,
      removeChannel: mock.removeChannel,
      onPollsEvent: () => {},
      onVotesEvent: () => {},
      onSubscribed: (meta) => {
        subscribedMeta.push(meta);
      },
      onInvoluntaryClosed: () => {},
    });

    await ctrl.requestRebuild("L", null, { reason: "boot" });
    mock.channels[0].state = "joining";
    mock.channels[0]._emitStatus("CHANNEL_ERROR");
    await new Promise((r) => setTimeout(r, 0));
    await ctrl._awaitIdle();

    assert.equal(subscribedMeta.length, 0, "pas de onSubscribed avant SUBSCRIBED");
    mock.channels[0]._emitStatus("SUBSCRIBED");
    assert.equal(subscribedMeta.length, 1);
    assert.equal(subscribedMeta[0].reason, "join_reply_error_replace");
    assert.equal(subscribedMeta[0].logicalTopic, ctrl.getState().logicalTopic);
    assert.match(String(subscribedMeta[0].internalTopic), /^realtime:lobby-polls:/);

    await ctrl.dispose();
  });
});

describe("boot auth + reconnect contrat source", () => {
  it("join-reply replace immédiat + catch-up ; phx_error keep ; CLOSED reconnect", () => {
    const storeSrc = readFileSync(
      join(__dirname, "../js/core/lobbyPollStore.js"),
      "utf8"
    );
    const chSrc = readFileSync(
      join(__dirname, "../js/core/lobbyPollChannel.js"),
      "utf8"
    );
    assert.match(storeSrc, /onInvoluntaryClosed/);
    assert.match(storeSrc, /runJoinReplyReplacementCatchup/);
    assert.match(storeSrc, /liveCatchup/);
    assert.match(storeSrc, /pollRtLog\("replacement_catchup_start"/);
    assert.match(storeSrc, /pollRtLog\("replacement_catchup_applied"/);
    assert.match(chSrc, /isJoinReplyChannelError/);
    assert.match(chSrc, /join_reply_error_replace/);
    assert.match(chSrc, /MAX_JOIN_REPLY_IMMEDIATE_REPLACES/);
    assert.match(chSrc, /subscriptionStatus = "degraded"/);
    assert.match(chSrc, /onInvoluntaryClosed/);
    assert.match(chSrc, /__pollLogicalTopic/);
    assert.doesNotMatch(chSrc, /builder\.topic\s*=/);
    assert.doesNotMatch(chSrc, /onTerminalError/);
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

describe("replacement catch-up guards + pastille live", () => {
  it("shouldApplyReplacementCatchup refuse gen / lobby stale", () => {
    assert.equal(
      shouldApplyReplacementCatchup({
        expectedChannelGen: 2,
        currentChannelGen: 2,
        catchupLobbyId: "L",
        storeLobbyId: "L",
        started: true,
      }),
      true
    );
    assert.equal(
      shouldApplyReplacementCatchup({
        expectedChannelGen: 2,
        currentChannelGen: 3,
        catchupLobbyId: "L",
        storeLobbyId: "L",
        started: true,
      }),
      false
    );
    assert.equal(
      shouldApplyReplacementCatchup({
        expectedChannelGen: 2,
        currentChannelGen: 2,
        catchupLobbyId: "L",
        storeLobbyId: "OTHER",
        started: true,
      }),
      false
    );
    assert.equal(
      shouldApplyReplacementCatchup({
        expectedChannelGen: 2,
        currentChannelGen: 2,
        catchupLobbyId: "L",
        storeLobbyId: "L",
        started: false,
      }),
      false
    );
  });

  it("catch-up live → pastille si sheet fermé (pas hydrate initial)", () => {
    assert.equal(
      computeUnseenPollOnNewId({
        pollId: "p-new",
        lastSeenPollId: null,
        sheetOpen: false,
        localCreate: false,
        isInitialHydrate: false,
      }).unseenPoll,
      true
    );
    assert.equal(
      computeUnseenPollOnNewId({
        pollId: "p-new",
        lastSeenPollId: null,
        sheetOpen: false,
        localCreate: false,
        isInitialHydrate: true,
      }).unseenPoll,
      false
    );
    assert.equal(
      computeUnseenPollOnNewId({
        pollId: "p-new",
        lastSeenPollId: null,
        sheetOpen: false,
        localCreate: true,
        isInitialHydrate: false,
      }).unseenPoll,
      false
    );
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
