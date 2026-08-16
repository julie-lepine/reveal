/**
 * Draw it ! T4 — boucle 60 s, drawerOrder, mot privé, reveal.
 */
import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

const HOST_UID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const GUEST_UID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const THIRD_UID = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const LOBBY_ID = "11111111-1111-1111-1111-111111111111";

mock.module("../js/core/supabaseClient.js", {
  namedExports: {
    isSupabaseConfigured: () => false,
    supabase: null,
  },
});

const {
  defaultDrawItPrepSession,
  getDrawItSession,
  setDrawItCategory,
  setDrawItRoundCount,
  markDrawItLobbyStarted,
  commitDrawItReveal,
  commitDrawItNextRound,
  commitDrawItComplete,
  drawItToRemote,
} = await import("../js/core/drawItSession.js");
const {
  applyDrawItReveal,
  applyDrawItNextRound,
  buildDrawItDrawerOrder,
  buildDrawItLaunchState,
  buildDrawItRoundTiming,
  canCommitDrawItReveal,
  canCommitDrawItNextRound,
  canCompleteDrawItGame,
  drawerUidForRound,
  expectedDrawItGuessers,
  remainingMsUntil,
  shouldEndDrawItRound,
  DRAW_IT_PHASE_DRAWING,
  DRAW_IT_PHASE_REVEAL,
} = await import("../js/core/drawItRound.js");
const { drawItFromRemote } = await import("../js/core/gameSync.js");
const { fetchMyDrawItPrivate } = await import("../js/core/drawItPrivate.js");
const { DRAW_IT_ROUND_DURATION_MS } = await import("../data/drawIt.js");
const { saveStatePatch } = await import("../js/core/state.js");

function lobbyPatch(participants) {
  return {
    inLobby: true,
    supabaseUserId: HOST_UID,
    lobby: {
      id: LOBBY_ID,
      hostId: HOST_UID,
      participants,
    },
  };
}

function twoPlayers() {
  return [
    { userId: HOST_UID, name: "Alice", isHost: true, isLocal: true },
    { userId: GUEST_UID, name: "Bob", isHost: false, isLocal: false },
  ];
}

function threePlayers() {
  return [
    ...twoPlayers(),
    { userId: THIRD_UID, name: "Chloé", isHost: false, isLocal: false },
  ];
}

async function launchTwoPlayerGame() {
  saveStatePatch({
    ...lobbyPatch(twoPlayers()),
    drawItGame: defaultDrawItPrepSession(),
  });
  await setDrawItCategory("Facile");
  await setDrawItRoundCount(3);
  const result = await markDrawItLobbyStarted({ rosterNames: ["Alice", "Bob"] });
  assert.equal(result?.ok, true);
  return getDrawItSession();
}

describe("Draw it ! T4 — launch", () => {
  it("fige runId, participants, drawerOrder et lance la manche 1", async () => {
    const session = await launchTwoPlayerGame();
    assert.ok(session.runId);
    assert.equal(session.lobbyStarted, true);
    assert.equal(session.roundIdx, 0);
    assert.equal(session.phase, DRAW_IT_PHASE_DRAWING);
    assert.deepEqual(session.drawerOrder, [HOST_UID, GUEST_UID]);
    assert.equal(session.drawerUid, HOST_UID);
    assert.equal(session.participants.length, 2);
    assert.deepEqual(session.foundOrder, []);
    assert.deepEqual(session.guesses, []);
    assert.deepEqual(session.strokes, []);
    assert.equal(session.canvasEpoch, 0);
    assert.equal(session.strokeSeq, 0);
  });
});

describe("Draw it ! T4 — drawer rotation", () => {
  it("2 joueurs / 3 manches → A, B, A", () => {
    const order = buildDrawItDrawerOrder([
      { userId: HOST_UID },
      { userId: GUEST_UID },
    ]);
    assert.deepEqual(
      [0, 1, 2].map((i) => drawerUidForRound(order, i)),
      [HOST_UID, GUEST_UID, HOST_UID]
    );
  });

  it("3 joueurs / 5 manches → A, B, C, A, B", () => {
    const order = buildDrawItDrawerOrder(threePlayers());
    assert.deepEqual(
      [0, 1, 2, 3, 4].map((i) => drawerUidForRound(order, i)),
      [HOST_UID, GUEST_UID, THIRD_UID, HOST_UID, GUEST_UID]
    );
  });
});

describe("Draw it ! T4 — timer", () => {
  it("roundEndsAt = roundStartAt + 60s et remaining dérivé", () => {
    const now = Date.parse("2026-08-15T21:00:00.000Z");
    const timing = buildDrawItRoundTiming(now, DRAW_IT_ROUND_DURATION_MS);
    assert.equal(timing.roundStartAt, "2026-08-15T21:00:00.000Z");
    assert.equal(timing.roundEndsAt, "2026-08-15T21:01:00.000Z");
    assert.equal(remainingMsUntil(timing.roundEndsAt, now + 15_000), 45_000);
    assert.equal(remainingMsUntil(timing.roundEndsAt, now + 60_000), 0);
  });
});

describe("Draw it ! — décision pure de clôture", () => {
  const roundEndsAt = "2026-08-15T21:01:00.000Z";
  const before = Date.parse("2026-08-15T21:00:30.000Z");
  const expectedGuessers = [GUEST_UID, THIRD_UID];

  it("avant expiration + personne trouvé → false", () => {
    assert.equal(
      shouldEndDrawItRound({ now: before, roundEndsAt, expectedGuessers, foundOrder: [] }),
      false
    );
  });

  it("avant expiration + certains trouvés → false", () => {
    assert.equal(
      shouldEndDrawItRound({
        now: before,
        roundEndsAt,
        expectedGuessers,
        foundOrder: [{ uid: GUEST_UID }],
      }),
      false
    );
  });

  it("avant expiration + tous trouvés → true", () => {
    assert.equal(
      shouldEndDrawItRound({
        now: before,
        roundEndsAt,
        expectedGuessers,
        foundOrder: [{ uid: THIRD_UID }, { uid: GUEST_UID }],
      }),
      true
    );
  });

  it("exactement à roundEndsAt puis après → true", () => {
    assert.equal(
      shouldEndDrawItRound({
        now: Date.parse(roundEndsAt),
        roundEndsAt,
        expectedGuessers,
        foundOrder: [],
      }),
      true
    );
    assert.equal(
      shouldEndDrawItRound({
        now: Date.parse(roundEndsAt) + 1,
        roundEndsAt,
        expectedGuessers,
        foundOrder: [],
      }),
      true
    );
  });

  it("le drawer dans foundOrder ne compte jamais comme devineur attendu", () => {
    const session = buildDrawItLaunchState({
      session: { selectedCategoryId: "Facile", roundCount: 3, ready: {} },
      participants: threePlayers(),
      nowMs: before,
      runId: "run-expected",
    });
    const expected = expectedDrawItGuessers(session);
    assert.deepEqual(expected, [GUEST_UID, THIRD_UID]);
    assert.equal(
      shouldEndDrawItRound({
        now: before,
        roundEndsAt: session.roundEndsAt,
        expectedGuessers: expected,
        foundOrder: [
          { uid: session.drawerUid },
          { uid: GUEST_UID },
        ],
      }),
      false
    );
  });
});

describe("Draw it ! T4 — guards de phase", () => {
  function drawingSession(extra = {}) {
    const now = 1_000_000;
    return buildDrawItLaunchState({
      session: { selectedCategoryId: "Facile", roundCount: 3, ready: {} },
      participants: twoPlayers(),
      nowMs: now,
      runId: "run-1",
    });
  }

  it("reveal avant roundEndsAt refusé", () => {
    const session = drawingSession();
    const now = Date.parse(session.roundStartAt) + 10_000;
    const check = canCommitDrawItReveal(session, now);
    assert.equal(check.ok, false);
    assert.equal(check.reason, "too_early");
    const applied = applyDrawItReveal(session, { wordLabel: "Pizza", nowMs: now });
    assert.equal(applied.ok, false);
    assert.equal(applied.session.phase, DRAW_IT_PHASE_DRAWING);
  });

  it("timeout → drawing → reveal", () => {
    const session = drawingSession();
    const now = Date.parse(session.roundEndsAt);
    const applied = applyDrawItReveal(session, { wordLabel: "Pizza", nowMs: now });
    assert.equal(applied.ok, true);
    assert.equal(applied.session.phase, DRAW_IT_PHASE_REVEAL);
    assert.equal(applied.session.lastRound.wordLabel, "Pizza");
  });

  it("foundOrder partiel ne termine pas la manche", () => {
    const session = {
      ...buildDrawItLaunchState({
        session: { selectedCategoryId: "Facile", roundCount: 3, ready: {} },
        participants: threePlayers(),
        nowMs: 1_000_000,
        runId: "run-partial",
      }),
      foundOrder: [{ uid: GUEST_UID }],
    };
    const now = Date.parse(session.roundStartAt) + 5_000;
    assert.equal(canCommitDrawItReveal(session, now).ok, false);
    assert.equal(session.phase, DRAW_IT_PHASE_DRAWING);
    const applied = applyDrawItReveal(session, { wordLabel: "fuite", nowMs: now });
    assert.equal(applied.ok, false);
    assert.equal(applied.session.phase, DRAW_IT_PHASE_DRAWING);
  });

  it("tous les devineurs trouvés → reveal avant le timeout", () => {
    const session = {
      ...buildDrawItLaunchState({
        session: { selectedCategoryId: "Facile", roundCount: 3, ready: {} },
        participants: threePlayers(),
        nowMs: 1_000_000,
        runId: "run-all-found",
      }),
      foundOrder: [{ uid: GUEST_UID }, { uid: THIRD_UID }],
    };
    const now = Date.parse(session.roundStartAt) + 5_000;
    const applied = applyDrawItReveal(session, { wordLabel: "Pizza", nowMs: now });
    assert.equal(applied.ok, true);
    assert.equal(applied.session.phase, DRAW_IT_PHASE_REVEAL);
    assert.deepEqual(applied.session.foundOrder, session.foundOrder);
    assert.deepEqual(applied.session.lastRound.foundOrder, session.foundOrder);
    assert.equal(applied.session.roundEndsAt, session.roundEndsAt);
  });

  it("reveal idempotent", () => {
    const session = drawingSession();
    const now = Date.parse(session.roundEndsAt);
    const first = applyDrawItReveal(session, { wordLabel: "Pizza", nowMs: now });
    const second = applyDrawItReveal(first.session, { wordLabel: "Autre", nowMs: now + 1000 });
    assert.equal(second.ok, false);
    assert.equal(second.reason, "already_reveal");
    assert.equal(first.session.lastRound.wordLabel, "Pizza");
  });

  it("pas de next si phase !== reveal ; last round refuse next", () => {
    const drawing = drawingSession();
    assert.equal(canCommitDrawItNextRound(drawing).ok, false);
    const now = Date.parse(drawing.roundEndsAt);
    const revealed = applyDrawItReveal(drawing, { wordLabel: "Pizza", nowMs: now }).session;
    assert.equal(canCommitDrawItNextRound(revealed).ok, true);
    const last = { ...revealed, roundIdx: 2, roundCount: 3 };
    assert.equal(canCommitDrawItNextRound(last).ok, false);
    assert.equal(canCompleteDrawItGame(last).ok, true);
  });
});

describe("Draw it ! T4 — confidentialité + next + complete", () => {
  beforeEach(async () => {
    await launchTwoPlayerGame();
  });

  it("mot absent du codec public pendant drawing", () => {
    const session = getDrawItSession();
    const remote = drawItToRemote(session);
    assert.equal(session.phase, DRAW_IT_PHASE_DRAWING);
    assert.equal("wordLabel" in remote, false);
    assert.equal("wordId" in remote, false);
    assert.equal("deck" in remote, false);
    assert.equal("acceptedAnswers" in remote, false);
    assert.equal(remote.lastRound, null);
  });

  it("mot public uniquement dans lastRound après reveal", async () => {
    const session = getDrawItSession();
    const now = Date.parse(session.roundEndsAt);
    const applied = applyDrawItReveal(session, { wordLabel: "Éléphant", nowMs: now });
    const remote = drawItToRemote(applied.session);
    assert.equal(remote.phase, DRAW_IT_PHASE_REVEAL);
    assert.equal("wordLabel" in remote, false);
    assert.equal(remote.lastRound.wordLabel, "Éléphant");
  });

  it("next round reset buffers et change de drawer", () => {
    const session = getDrawItSession();
    const now = Date.parse(session.roundEndsAt);
    const revealed = applyDrawItReveal(session, { wordLabel: "Pizza", nowMs: now }).session;
    const next = applyDrawItNextRound(revealed, { nowMs: now + 1000 }).session;
    assert.equal(next.roundIdx, 1);
    assert.equal(next.drawerUid, GUEST_UID);
    assert.equal(next.phase, DRAW_IT_PHASE_DRAWING);
    assert.equal(next.runId, session.runId);
    assert.deepEqual(next.drawerOrder, session.drawerOrder);
    assert.deepEqual(next.foundOrder, []);
    assert.deepEqual(next.guesses, []);
    assert.deepEqual(next.strokes, []);
    assert.notEqual(next.roundEndsAt, session.roundEndsAt);
  });

  it("dernière manche : pas de roundIdx +1, complete une seule fois", async () => {
    let session = getDrawItSession();
    for (let i = 0; i < 2; i += 1) {
      const now = Date.parse(session.roundEndsAt);
      session = applyDrawItReveal(session, { wordLabel: `m${i}`, nowMs: now }).session;
      session = applyDrawItNextRound(session, { nowMs: now + 1 }).session;
    }
    const now = Date.parse(session.roundEndsAt);
    session = applyDrawItReveal(session, { wordLabel: "fin", nowMs: now }).session;
    assert.equal(session.roundIdx, 2);
    assert.equal(canCommitDrawItNextRound(session).ok, false);
    saveStatePatch({ drawItGame: session });
    const first = await commitDrawItComplete();
    assert.equal(first.ok, true);
    const second = await commitDrawItComplete();
    assert.equal(second.ok, false);
    assert.equal(second.reason, "already_complete");
    assert.equal(getDrawItSession().lobbyStarted, false);
  });
});

describe("Draw it ! T4 — reconnect + remote guest", () => {
  it("hydrate conserve runId / round / drawer / timer et le mot privé du drawer", async () => {
    const launched = await launchTwoPlayerGame();
    const remote = drawItToRemote(launched);
    assert.equal("wordLabel" in remote, false);
    const hydrated = drawItFromRemote(remote);
    assert.equal(hydrated.runId, launched.runId);
    assert.equal(hydrated.roundIdx, launched.roundIdx);
    assert.equal(hydrated.drawerUid, launched.drawerUid);
    assert.equal(hydrated.roundEndsAt, launched.roundEndsAt);
    assert.equal(hydrated.phase, DRAW_IT_PHASE_DRAWING);
    saveStatePatch({ supabaseUserId: HOST_UID });
    const priv = await fetchMyDrawItPrivate(launched.runId, 0);
    assert.ok(priv?.wordLabel);
    saveStatePatch({ supabaseUserId: GUEST_UID });
    const guestPriv = await fetchMyDrawItPrivate(launched.runId, 0);
    assert.equal(guestPriv, null);
  });

  it("invité suit phase / drawer / timer sans mot avant reveal", () => {
    const now = Date.parse("2026-08-15T21:00:00.000Z");
    const launched = buildDrawItLaunchState({
      session: { selectedCategoryId: "Facile", roundCount: 3, ready: {} },
      participants: twoPlayers(),
      nowMs: now,
      runId: "run-guest",
    });
    const drawingRemote = drawItToRemote(launched);
    const guest = drawItFromRemote(drawingRemote);
    assert.equal(guest.phase, DRAW_IT_PHASE_DRAWING);
    assert.equal(guest.drawerUid, HOST_UID);
    assert.equal(guest.roundEndsAt, launched.roundEndsAt);
    assert.equal("wordLabel" in guest, false);
    assert.equal(guest.lastRound, null);

    const revealed = applyDrawItReveal(launched, {
      wordLabel: "Parapluie",
      nowMs: now + 60_000,
    }).session;
    const guestReveal = drawItFromRemote(drawItToRemote(revealed));
    assert.equal(guestReveal.phase, DRAW_IT_PHASE_REVEAL);
    assert.equal(guestReveal.lastRound.wordLabel, "Parapluie");
    assert.equal("wordLabel" in guestReveal, false);
  });
});
