/**
 * SYN-TRAITRE-DEALACK-01 - rollback Deal ACK + contrats UI.
 */
import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  computeOptimisticMapEntryApply,
  rollbackOptimisticMapEntry,
  canRollbackOptimisticSubmission,
} from "../js/core/optimisticMapEntry.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function read(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

describe("SYN-TRAITRE-DEALACK-01 - cycles apply/rollback", () => {
  it("succès : ACK true sans rollback", () => {
    const apply = computeOptimisticMapEntryApply({
      map: { Bob: true },
      key: "Alice",
      value: true,
    });
    assert.equal(apply.hadPreviousValue, false);
    assert.deepEqual(apply.nextMap, { Bob: true, Alice: true });
  });

  it("échec : clé absente avant → delete réel", () => {
    const apply = computeOptimisticMapEntryApply({ map: {}, key: "Alice", value: true });
    const rolled = rollbackOptimisticMapEntry({
      currentMap: apply.nextMap,
      key: "Alice",
      hadPreviousValue: false,
      optimisticValue: true,
    });
    assert.equal(rolled.applied, true);
    assert.equal(Object.prototype.hasOwnProperty.call(rolled.map, "Alice"), false);
  });

  it("échec : clé existante → restaure previous", () => {
    const apply = computeOptimisticMapEntryApply({
      map: { Alice: true },
      key: "Alice",
      value: true,
    });
    const rolled = rollbackOptimisticMapEntry({
      currentMap: { Alice: true, Bob: true },
      key: "Alice",
      hadPreviousValue: true,
      previousValue: true,
      optimisticValue: true,
    });
    assert.equal(rolled.applied, true);
    assert.equal(rolled.map.Alice, true);
    assert.equal(rolled.map.Bob, true);
  });

  it("autres ACK préservés", () => {
    const apply = computeOptimisticMapEntryApply({ map: { Bob: true }, key: "Alice", value: true });
    const rolled = rollbackOptimisticMapEntry({
      currentMap: { Alice: true, Bob: true, Carol: true },
      key: "Alice",
      hadPreviousValue: false,
      optimisticValue: true,
    });
    assert.deepEqual(rolled.map, { Bob: true, Carol: true });
  });

  it("stale attemptId : no-op", () => {
    const rolled = rollbackOptimisticMapEntry({
      currentMap: { Alice: true },
      key: "Alice",
      hadPreviousValue: false,
      optimisticValue: true,
      attemptId: 1,
      currentAttemptId: 2,
    });
    assert.equal(rolled.applied, false);
    assert.equal(rolled.map.Alice, true);
  });

  it("phase changée : garde refuse", () => {
    assert.equal(
      canRollbackOptimisticSubmission({ phase: "deal" }, { phase: "speak" }),
      false
    );
  });
});

describe("commitTraitreDealAck - mocks comportementaux", () => {
  const UID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  let savedSession;
  let patchShouldFail;
  const patchMock = mock.fn(async () => {
    if (patchShouldFail) throw new Error("sync failed");
  });
  const saveStatePatchMock = mock.fn((patch) => {
    if (patch.traitreGame) savedSession = patch.traitreGame;
  });
  const getStateMock = mock.fn(() => ({
    lobby: { id: "lobby-1" },
    traitreGame: savedSession,
  }));

  let commitTraitreDealAck;
  let __resetTraitreDealAckAttemptIdForTests;

  beforeEach(async () => {
    savedSession = {
      phase: "deal",
      dealAcks: { Bob: true },
      alive: ["Alice", "Bob"],
      lobbyStarted: true,
    };
    patchShouldFail = false;
    patchMock.mock.resetCalls();
    saveStatePatchMock.mock.resetCalls();

    mock.module("../js/core/patchGameStateFeedback.js", {
      namedExports: { patchGameStateWithFeedback: patchMock },
    });
    mock.module("../js/core/gameSync.js", {
      namedExports: {
        isGameSyncActive: mock.fn(() => true),
        requireLocalParticipantUid: mock.fn(() => UID),
        requirePlayerUid: mock.fn((n) => `uid-${n}`),
        nameForUserId: mock.fn(),
        isLobbyHost: mock.fn(() => false),
        allMembersReady: mock.fn(),
        syncTraitreSession: mock.fn(),
        traitreToRemote: mock.fn((s) => s),
        patchGameState: mock.fn(),
        normalizePlayerVotesMap: (v) => v || {},
      },
    });
    mock.module("../js/core/lobby.js", {
      namedExports: {
        getLobbyParticipants: mock.fn(() => [
          { userId: UID, name: "Alice" },
          { userId: "uid-bob", name: "Bob" },
        ]),
        setLobbyPlaying: mock.fn(),
      },
    });
    mock.module("../js/core/state.js", {
      namedExports: {
        getState: getStateMock,
        getLocalDisplayName: mock.fn(() => "Alice"),
        saveStatePatch: saveStatePatchMock,
        addScore: mock.fn(),
        bumpPlayerStat: mock.fn(),
      },
    });
    mock.module("../js/core/mpLaunch.js", {
      namedExports: {
        commitHostGamePlay: mock.fn(),
        commitPrepReadyToggle: mock.fn(),
        launchGameWithSync: mock.fn(),
      },
    });
    mock.module("../js/core/players.js", {
      namedExports: {
        getActivePlayerNames: mock.fn(() => ["Alice", "Bob"]),
        getActivePlayers: mock.fn(() => [{ name: "Alice" }, { name: "Bob" }]),
      },
    });
    mock.module("../js/core/traitrePrivate.js", {
      namedExports: {
        clearTraitrePrivateForLobby: mock.fn(),
        hostDistributeTraitreRoles: mock.fn(),
      },
    });
    mock.module("../js/core/traitreScoring.js", {
      namedExports: {
        buildTraitreEliminationPatch: mock.fn(),
        computeTraitreScoreDeltas: mock.fn(),
      },
    });
    mock.module("../data/traitre.js", {
      namedExports: {
        TRAITRE_MIN_PLAYERS: 3,
        TRAITRE_POINTS: {},
        pickRandomTraitrePair: mock.fn(),
        getTraitrePairById: mock.fn(),
      },
    });
    mock.module("../js/core/sessionMerge.js", {
      namedExports: {
        normalizeKeyedVotes: mock.fn((v) => v || {}),
      },
    });

    const mod = await import("../js/core/traitreSession.js");
    commitTraitreDealAck = mod.commitTraitreDealAck;
    __resetTraitreDealAckAttemptIdForTests = mod.__resetTraitreDealAckAttemptIdForTests;
    __resetTraitreDealAckAttemptIdForTests();
  });

  afterEach(() => {
    mock.restoreAll();
  });

  it("succès : wire UID true + Alice locale", async () => {
    const out = await commitTraitreDealAck();
    assert.equal(out.Alice, true);
    assert.equal(savedSession.dealAcks.Bob, true);
    assert.equal(patchMock.mock.callCount(), 1);
    assert.deepEqual(patchMock.mock.calls[0].arguments[0], {
      traitre: { dealAcks: { [UID]: true } },
    });
  });

  it("échec : rollback Alice uniquement + rethrow", async () => {
    patchShouldFail = true;
    await assert.rejects(() => commitTraitreDealAck(), /sync failed/);
    assert.equal(Object.prototype.hasOwnProperty.call(savedSession.dealAcks, "Alice"), false);
    assert.equal(savedSession.dealAcks.Bob, true);
  });

  it("déjà ACK : no-op sans second patch", async () => {
    savedSession.dealAcks = { Alice: true, Bob: true };
    const out = await commitTraitreDealAck();
    assert.equal(out.Alice, true);
    assert.equal(patchMock.mock.callCount(), 0);
  });

  it("phase speak : refuse d'écrire", async () => {
    savedSession.phase = "speak";
    const out = await commitTraitreDealAck();
    assert.equal(Object.prototype.hasOwnProperty.call(out, "Alice"), false);
    assert.equal(patchMock.mock.callCount(), 0);
  });

  it("stale catch après retry : ne rollback pas le 2e ACK", async () => {
    let resolveFirst;
    const gate = new Promise((r) => {
      resolveFirst = r;
    });
    let call = 0;
    patchMock.mock.mockImplementation(async () => {
      call += 1;
      if (call === 1) {
        await gate;
        throw new Error("first failed");
      }
    });

    const p1 = commitTraitreDealAck();
    delete savedSession.dealAcks.Alice;
    const p2 = commitTraitreDealAck();
    resolveFirst();
    await assert.rejects(() => p1, /first failed/);
    await p2;
    assert.equal(savedSession.dealAcks.Alice, true);
  });

  it("phase change avant catch : no-op", async () => {
    patchShouldFail = true;
    patchMock.mock.mockImplementation(async () => {
      savedSession = { ...savedSession, phase: "speak" };
      throw new Error("sync failed");
    });
    await assert.rejects(() => commitTraitreDealAck());
    assert.equal(savedSession.dealAcks.Alice, true);
  });
});

describe("SYN-TRAITRE-DEALACK-01 - contrats source UI", () => {
  it("commitTraitreDealAck : apply + rollback + rethrow", () => {
    const src = read("js/core/traitreSession.js");
    const start = src.indexOf("export async function commitTraitreDealAck");
    const end = src.indexOf("export function __resetTraitreDealAckAttemptIdForTests");
    const block = src.slice(start, end);
    assert.match(block, /computeOptimisticMapEntryApply/);
    assert.match(block, /rollbackOptimisticMapEntry/);
    assert.match(block, /canRollbackOptimisticSubmission/);
    assert.match(block, /throw err/);
    assert.match(block, /attemptId/);
    assert.match(block, /phase:\s*session\.phase/);
  });

  it("UI : handleDealAckClick catch terminal + pending", () => {
    const src = read("js/games/traitre.js");
    assert.match(src, /async function handleDealAckClick/);
    assert.match(src, /void handleDealAckClick/);
    assert.match(src, /dealAckInFlight/);
    assert.match(src, /Catch terminal UI \(SYN-TRAITRE-DEALACK-01\)/);
    assert.match(src, /pas de seconde notification/);
    const start = src.indexOf("async function handleDealAckClick");
    const block = src.slice(start, start + 1400);
    assert.match(block, /await commitTraitreDealAck/);
    assert.match(block, /catch\s*\(error\)/);
    assert.equal(block.includes("showAppAlert"), false);
  });
});
