/**
 * Cycle de vie canal Realtime sondages — rebuild sérialisé, courses, filtres.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createPollChannelController } from "../js/core/lobbyPollChannel.js";
import {
  isRealtimeActivePollClose,
  isRealtimeOpenPollInsert,
  computeUnseenPollOnNewId,
} from "../js/core/lobbyPollLogic.js";
import {
  __testSimulateRealtimePollsEvent,
  __testForceActivePoll,
  __testSetHasHydrated,
  getLobbyPollState,
  resetLobbyPollSyncForTests,
  setLobbyPollSheetOpenGetter,
  markLobbyPollSeen,
} from "../js/core/lobbyPollStore.js";

function makeMockRealtime() {
  const channels = [];
  const removed = [];
  let removeDelayMs = 0;
  let removeGate = null;

  function setRemoveDelay(ms) {
    removeDelayMs = ms;
  }

  /** Retarde le resolve de remove jusqu'à releaseRemove(). */
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
    const listeners = { polls: null, votes: null, status: null };
    const filters = [];
    const ch = {
      topic,
      on(type, cfg, cb) {
        filters.push({ table: cfg.table, filter: cfg.filter });
        if (cfg.table === "lobby_polls") listeners.polls = cb;
        if (cfg.table === "lobby_poll_votes") listeners.votes = cb;
        return ch;
      },
      subscribe(cb) {
        listeners.status = cb;
        queueMicrotask(() => cb("SUBSCRIBED"));
        return ch;
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
    if (removeDelayMs) {
      await new Promise((r) => setTimeout(r, removeDelayMs));
    }
    removed.push(ch.topic);
    const idx = channels.indexOf(ch);
    if (idx >= 0) channels.splice(idx, 1);
  }

  return {
    createChannel,
    removeChannel,
    channels,
    removed,
    setRemoveDelay,
    holdNextRemove,
    activeTopics: () => channels.map((c) => c.topic),
  };
}

describe("lobbyPollChannel lifecycle", () => {
  it("cycle complet polls-only → A → close → polls-only → B", async () => {
    const mock = makeMockRealtime();
    const pollsEvents = [];
    const votesEvents = [];
    const ctrl = createPollChannelController({
      createChannel: mock.createChannel,
      removeChannel: mock.removeChannel,
      onPollsEvent: (p) => pollsEvents.push(p),
      onVotesEvent: (p) => votesEvents.push(p),
    });

    await ctrl.requestRebuild("lobby-uuid", null);
    assert.equal(mock.channels.length, 1);
    assert.match(mock.channels[0].topic, /^lobby-polls:lobby-uuid:\d+$/);
    assert.equal(
      mock.channels[0]._filters.some((f) => f.table === "lobby_polls"),
      true
    );
    assert.equal(
      mock.channels[0]._filters.some((f) => f.table === "lobby_poll_votes"),
      false
    );
    assert.equal(ctrl.getState().subscriptionStatus, "subscribed");

    // INSERT poll A → rebuild avec votes
    await ctrl.requestRebuild("lobby-uuid", "poll-A");
    assert.equal(mock.channels.length, 1);
    assert.equal(ctrl.getState().channelVotesPollId, "poll-A");
    assert.equal(
      mock.channels[0]._filters.some(
        (f) => f.table === "lobby_poll_votes" && f.filter === "poll_id=eq.poll-A"
      ),
      true
    );

    // Close → polls-only
    await ctrl.requestRebuild("lobby-uuid", null);
    assert.equal(ctrl.getState().channelVotesPollId, null);
    assert.equal(
      mock.channels[0]._filters.some((f) => f.table === "lobby_poll_votes"),
      false
    );
    assert.equal(
      mock.channels[0]._filters.some(
        (f) => f.filter === "lobby_id=eq.lobby-uuid"
      ),
      true
    );

    // INSERT poll B → votes B
    await ctrl.requestRebuild("lobby-uuid", "poll-B");
    assert.equal(mock.channels.length, 1);
    assert.equal(ctrl.getState().channelVotesPollId, "poll-B");
    assert.match(mock.channels[0]._filters.find((f) => f.table === "lobby_poll_votes").filter, /poll-B/);

    // Les listeners polls restent branchés : événement reçu
    mock.channels[0]._emitPolls({ eventType: "INSERT", new: { id: "poll-B" } });
    assert.equal(pollsEvents.length, 1);

    await ctrl.dispose();
  });

  it("course de rebuild : remove tardif de A ne retire pas B", async () => {
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
    // Laisser B démarrer remove de A (bloqué)
    await new Promise((r) => setTimeout(r, 5));
    // Pendant ce temps, lancer C (gén plus récente)
    const pC = ctrl.requestRebuild("L", "poll-C");
    releaseRemoveA();
    await Promise.all([pB, pC]);

    assert.equal(mock.channels.length, 1);
    assert.equal(ctrl.getState().channelVotesPollId, "poll-C");
    assert.notEqual(mock.channels[0].topic, topicA);
    assert.match(mock.channels[0].topic, /:\d+$/);
    // Le canal actif n'est pas dans removed après dispose partiel — B/C topics créés
    assert.ok(mock.removed.includes(topicA));

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
    await assert.rejects(
      () => ctrl.requestRebuild("   ", null),
      /poll_channel_invalid_lobby_id/
    );
    await ctrl.dispose();
  });
});

describe("lobbyPollStore Realtime apply (sans Supabase)", () => {
  it("UPDATE sans old.status ferme immédiatement", () => {
    resetLobbyPollSyncForTests();
    __testForceActivePoll({
      id: "p1",
      lobbyId: "L",
      status: "open",
      options: [{ gameId: "g1", title: "G", emoji: "🎲" }],
    });
    __testSimulateRealtimePollsEvent({
      eventType: "UPDATE",
      old: { id: "p1" },
      new: { id: "p1", status: "closed" },
    });
    assert.equal(getLobbyPollState().activePoll, null);
    assert.equal(getLobbyPollState().unseenPoll, false);
    resetLobbyPollSyncForTests();
  });

  it("INSERT nouveau poll sheet fermé → unseenPoll ; sheet ouvert → pin sans pastille", () => {
    resetLobbyPollSyncForTests();
    __testSetHasHydrated(true);
    setLobbyPollSheetOpenGetter(() => false);
    __testForceActivePoll(null);
    // force active null via set
    const { activePoll, ...rest } = getLobbyPollState();
    void activePoll;
    void rest;

    // Re-init state properly
    resetLobbyPollSyncForTests();
    __testSetHasHydrated(true);
    setLobbyPollSheetOpenGetter(() => false);
    // store lobbyId for filter
    __testForceActivePoll({
      id: "old",
      lobbyId: "L",
      status: "open",
      options: [],
    });
    // close first
    __testSimulateRealtimePollsEvent({
      eventType: "UPDATE",
      old: { id: "old" },
      new: { id: "old", status: "closed" },
    });
    assert.equal(getLobbyPollState().activePoll, null);

    __testSimulateRealtimePollsEvent({
      eventType: "INSERT",
      new: {
        id: "poll-B",
        lobby_id: "test-lobby",
        status: "open",
        options: [{ gameId: "g1", title: "G", emoji: "🎲" }],
      },
    });
    assert.equal(getLobbyPollState().activePoll?.id, "poll-B");
    assert.equal(getLobbyPollState().unseenPoll, true);

    // Sheet ouvert : nouveau poll C
    markLobbyPollSeen();
    setLobbyPollSheetOpenGetter(() => true);
    __testSimulateRealtimePollsEvent({
      eventType: "UPDATE",
      old: { id: "poll-B" },
      new: { id: "poll-B", status: "closed" },
    });
    __testSimulateRealtimePollsEvent({
      eventType: "INSERT",
      new: {
        id: "poll-C",
        lobby_id: "test-lobby",
        status: "open",
        options: [{ gameId: "g1", title: "G", emoji: "🎲" }],
      },
    });
    assert.equal(getLobbyPollState().activePoll?.id, "poll-C");
    assert.equal(getLobbyPollState().unseenPoll, false);

    resetLobbyPollSyncForTests();
  });

  it("INSERT après close (payload) applique B sans dépendre du refetch", () => {
    resetLobbyPollSyncForTests();
    __testSetHasHydrated(true);
    setLobbyPollSheetOpenGetter(() => true);
    __testForceActivePoll({
      id: "A",
      lobbyId: "test-lobby",
      status: "open",
      options: [{ gameId: "g1", title: "G", emoji: "🎲" }],
    });
    markLobbyPollSeen();

    __testSimulateRealtimePollsEvent({
      eventType: "UPDATE",
      old: { id: "A" },
      new: { id: "A", status: "closed", closed_at: "x" },
    });
    assert.equal(getLobbyPollState().activePoll, null);

    assert.equal(
      isRealtimeOpenPollInsert(
        {
          eventType: "INSERT",
          new: { id: "B", lobby_id: "test-lobby", status: "open" },
        },
        "test-lobby"
      ),
      true
    );

    __testSimulateRealtimePollsEvent({
      eventType: "INSERT",
      new: {
        id: "B",
        lobby_id: "test-lobby",
        status: "open",
        options: [{ gameId: "g2", title: "H", emoji: "🔥" }],
      },
    });
    assert.equal(getLobbyPollState().activePoll?.id, "B");
    assert.equal(getLobbyPollState().unseenPoll, false);

    resetLobbyPollSyncForTests();
  });
});

describe("close / insert helpers (payloads réels)", () => {
  it("close sans old.status", () => {
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

  it("pastille contrat sheet fermé", () => {
    const r = computeUnseenPollOnNewId({
      pollId: "B",
      lastSeenPollId: "A",
      sheetOpen: false,
      localCreate: false,
      isInitialHydrate: false,
    });
    assert.equal(r.unseenPoll, true);
  });
});
