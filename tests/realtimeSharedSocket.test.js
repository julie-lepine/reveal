/**
 * Gate lobby Realtime — générations, waiters, coalesce, timeout abandon.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  shouldSkipLobbyRealtimeResubscribe,
  shouldApplyLobbySubscribeStatus,
  shouldWakePollOnLobbySubscribed,
  decidePollAfterLobbyWait,
  pollShouldWaitForLobbyRealtime,
  createLobbyRealtimeGateController,
} from "../js/core/lobbyRealtimeGate.js";
import { findDuplicateTopics } from "../js/core/realtimeSocketDiagnose.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function makeChannelFactory() {
  const channels = [];
  const removed = [];
  function createChannel(topic) {
    const ch = {
      topic,
      __lobbySubscribeCallCount: 0,
      subscribe(cb) {
        ch.__lobbySubscribeCallCount += 1;
        ch.__statusCb = cb;
        return ch;
      },
    };
    channels.push(ch);
    return ch;
  }
  async function removeChannel(ch) {
    removed.push(ch.topic);
  }
  return { createChannel, removeChannel, channels, removed };
}

describe("shouldSkipLobbyRealtimeResubscribe", () => {
  it("1. deux appels identiques pendant SUBSCRIBING → coalesce", () => {
    assert.equal(
      shouldSkipLobbyRealtimeResubscribe({
        desiredLobbyId: "L",
        activeLobbyId: "L",
        hasChannel: true,
        subscriptionStatus: "subscribing",
      }),
      true
    );
  });

  it("2. canal en erreur → reconstruction autorisée", () => {
    for (const subscriptionStatus of ["error", "idle", "closed"]) {
      assert.equal(
        shouldSkipLobbyRealtimeResubscribe({
          desiredLobbyId: "L",
          activeLobbyId: "L",
          hasChannel: true,
          subscriptionStatus,
        }),
        false,
        subscriptionStatus
      );
    }
  });
});

describe("createLobbyRealtimeGateController", () => {
  it("1. double subscribe identique → un channel, un subscribe", () => {
    const mock = makeChannelFactory();
    const ctrl = createLobbyRealtimeGateController(mock);
    ctrl.requestSubscribe("L");
    ctrl.requestSubscribe("L");
    assert.equal(mock.channels.length, 1);
    assert.equal(mock.channels[0].__lobbySubscribeCallCount, 1);
    assert.equal(ctrl.getState().status, "subscribing");
  });

  it("2. erreur puis resubscribe → nouveau channel", () => {
    const mock = makeChannelFactory();
    const ctrl = createLobbyRealtimeGateController(mock);
    ctrl.requestSubscribe("L");
    ctrl._emitOnActive("CHANNEL_ERROR");
    assert.equal(ctrl.getState().status, "error");
    ctrl.requestSubscribe("L");
    assert.equal(mock.channels.length, 2);
    assert.equal(ctrl.getState().status, "subscribing");
  });

  it("3. ancien SUBSCRIBED tardif après nouvelle gen → ignoré", () => {
    const mock = makeChannelFactory();
    const ctrl = createLobbyRealtimeGateController(mock);
    ctrl.requestSubscribe("L");
    const oldCh = mock.channels[0];
    ctrl.requestSubscribe("L2"); // new gen, different lobby forces rebuild
    assert.equal(ctrl.getState().lobbyId, "L2");
    // stale callback from gen1
    oldCh.__statusCb("SUBSCRIBED");
    assert.equal(ctrl.getState().status, "subscribing");
    assert.equal(ctrl.getState().lobbyId, "L2");
    ctrl._emitOnActive("SUBSCRIBED");
    assert.equal(ctrl.getState().status, "subscribed");
  });

  it("4+5. wait avant prêt → pas subscribed ; après SUBSCRIBED waiter ok", async () => {
    const mock = makeChannelFactory();
    const ctrl = createLobbyRealtimeGateController(mock);
    ctrl.requestSubscribe("L");
    const p = ctrl.whenReady("L", { timeoutMs: 50 });
    assert.equal(ctrl.getState().status, "subscribing");
    ctrl._emitOnActive("SUBSCRIBED");
    const r = await p;
    assert.equal(r.ok, true);
    assert.equal(r.reason, "subscribed");
  });

  it("6. plusieurs whenReady → tous résolus une fois SUBSCRIBED", async () => {
    const mock = makeChannelFactory();
    const ctrl = createLobbyRealtimeGateController(mock);
    ctrl.requestSubscribe("L");
    const a = ctrl.whenReady("L", { timeoutMs: 200 });
    const b = ctrl.whenReady("L", { timeoutMs: 200 });
    ctrl._emitOnActive("SUBSCRIBED");
    const [ra, rb] = await Promise.all([a, b]);
    assert.equal(ra.ok, true);
    assert.equal(rb.ok, true);
  });

  it("7. changement lobby pendant wait → timeout/abandon sans wake ancien", async () => {
    const mock = makeChannelFactory();
    const ctrl = createLobbyRealtimeGateController(mock);
    ctrl.requestSubscribe("L1");
    const waitOld = ctrl.whenReady("L1", { timeoutMs: 30 });
    ctrl.requestSubscribe("L2");
    ctrl._emitOnActive("SUBSCRIBED");
    const r = await waitOld;
    // L1 never subscribed on active channel → timeout
    assert.equal(r.ok, false);
    assert.equal(r.reason, "timeout");
    assert.equal(ctrl.getState().lobbyId, "L2");
    assert.equal(ctrl.getState().status, "subscribed");
  });

  it("8. teardown avant SUBSCRIBED → waiters invalidés, pas de réveil", async () => {
    const mock = makeChannelFactory();
    const ctrl = createLobbyRealtimeGateController(mock);
    ctrl.requestSubscribe("L");
    const wait = ctrl.whenReady("L", { timeoutMs: 5000 });
    ctrl.teardown({ reason: "teardown" });
    const r = await wait;
    assert.equal(r.ok, false);
    assert.equal(r.reason, "teardown");
    assert.equal(ctrl.getState().status, "idle");
    assert.equal(ctrl.getState().waiterCount, 0);
  });

  it("9. erreur puis récupération → un seul subscribed final", async () => {
    const mock = makeChannelFactory();
    let subscribedEvents = 0;
    const ctrl = createLobbyRealtimeGateController({
      ...mock,
      onStatus: (st) => {
        if (st === "subscribed") subscribedEvents += 1;
      },
    });
    ctrl.requestSubscribe("L");
    ctrl._emitOnActive("CHANNEL_ERROR");
    const wait = ctrl.whenReady("L", { timeoutMs: 200 });
    ctrl.requestSubscribe("L");
    ctrl._emitOnActive("SUBSCRIBED");
    const r = await wait;
    assert.equal(r.ok, true);
    assert.equal(subscribedEvents, 1);
    assert.equal(mock.channels.length, 2);
  });
});

describe("decidePollAfterLobbyWait / wake", () => {
  it("timeout → abandon_wait_future (pas open_poll)", () => {
    assert.deepEqual(
      decidePollAfterLobbyWait({
        readyOk: false,
        reason: "timeout",
        waitedLobbyId: "L",
        storeLobbyId: "L",
        started: true,
      }),
      { action: "abandon_wait_future", why: "timeout" }
    );
  });

  it("lobby changé → abort", () => {
    assert.equal(
      decidePollAfterLobbyWait({
        readyOk: true,
        reason: "subscribed",
        waitedLobbyId: "L1",
        storeLobbyId: "L2",
        started: true,
      }).action,
      "abort"
    );
  });

  it("wake poll refuse ancien lobbyId", () => {
    assert.equal(
      shouldWakePollOnLobbySubscribed({
        eventLobbyId: "old",
        storeLobbyId: "new",
        eventGen: 2,
        minGen: null,
      }),
      false
    );
    assert.equal(
      shouldWakePollOnLobbySubscribed({
        eventLobbyId: "L",
        storeLobbyId: "L",
        eventGen: 2,
        minGen: 1,
      }),
      true
    );
  });

  it("pollShouldWaitForLobbyRealtime", () => {
    assert.equal(
      pollShouldWaitForLobbyRealtime({
        inLobby: true,
        lobbyRealtimeStatus: "subscribing",
      }),
      true
    );
    assert.equal(
      pollShouldWaitForLobbyRealtime({
        inLobby: true,
        lobbyRealtimeStatus: "subscribed",
      }),
      false
    );
  });
});

describe("shouldApplyLobbySubscribeStatus", () => {
  it("ignore gen obsolète", () => {
    assert.equal(
      shouldApplyLobbySubscribeStatus({
        eventGen: 1,
        currentGen: 2,
        channelRef: {},
        activeChannelRef: {},
      }),
      false
    );
  });
});

describe("contrat source + probe 4 discriminante", () => {
  it("timeout documenté comme abandon ; gate défensive ; pas removeAllChannels", () => {
    const pollSrc = readFileSync(
      join(__dirname, "../js/core/lobbyPollStore.js"),
      "utf8"
    );
    const lobbySrc = readFileSync(
      join(__dirname, "../js/core/supabaseLobby.js"),
      "utf8"
    );
    const diagSrc = readFileSync(
      join(__dirname, "../js/core/realtimeSocketDiagnose.js"),
      "utf8"
    );
    assert.match(pollSrc, /abandon_wait_future/);
    assert.match(pollSrc, /decidePollAfterLobbyWait/);
    assert.match(pollSrc, /shouldWakePollOnLobbySubscribed/);
    assert.match(lobbySrc, /shouldApplyLobbySubscribeStatus/);
    assert.match(lobbySrc, /lobbyChannelGen/);
    assert.doesNotMatch(lobbySrc, /removeAllChannels/);
    // Probe 4 = expérience discriminante (pas un résultat attendu d'échec)
    assert.match(diagSrc, /probe4 simultaneous/);
  });

  it("findDuplicateTopics", () => {
    assert.deepEqual(findDuplicateTopics(["a", "a"]), ["a"]);
  });
});
