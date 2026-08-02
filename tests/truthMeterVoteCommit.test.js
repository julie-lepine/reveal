/**
 * BUG-TRUTHMETER-01A — soumission fiable, compensation, confirmation distante.
 */
import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  computeTruthMeterVoteApply,
  compensateTruthMeterLocalVote,
  isTruthMeterVoteNetworkUncertainty,
  resolveConfirmedTruthMeterVote,
} from "../js/core/truthMeterVoteCommit.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function readSrc(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

describe("truthMeterVoteCommit — apply / compensation", () => {
  it("applique le vote local sans écraser les votes distants", () => {
    const out = computeTruthMeterVoteApply(
      { votes: { Bob: 40 } },
      "Alice",
      72
    );
    assert.deepEqual(out.previousVotes, { Bob: 40 });
    assert.deepEqual(out.nextVotes, { Bob: 40, Alice: 72 });
    assert.equal(out.hadPrevious, false);
  });

  it("conserve le vote précédent pour restauration", () => {
    const out = computeTruthMeterVoteApply(
      { votes: { Alice: 10, Bob: 40 } },
      "Alice",
      90
    );
    assert.equal(out.hadPrevious, true);
    assert.equal(out.previousLocalVote, 10);
    assert.equal(out.nextVotes.Alice, 90);
    assert.equal(out.nextVotes.Bob, 40);
  });

  it("compensation ciblée : restaure l’ancien vote sans toucher aux autres", () => {
    const live = { votes: { Alice: 90, Bob: 55, Charlie: 20 } };
    const apply = computeTruthMeterVoteApply({ votes: { Alice: 10, Bob: 40 } }, "Alice", 90);
    // Bob/Charlie sont apparus entre-temps côté store
    const compensated = compensateTruthMeterLocalVote(live, "Alice", apply);
    assert.equal(compensated.Alice, 10);
    assert.equal(compensated.Bob, 55);
    assert.equal(compensated.Charlie, 20);
  });

  it("compensation sans précédent : retire uniquement la clé locale", () => {
    const live = { votes: { Alice: 72, Bob: 40 } };
    const apply = computeTruthMeterVoteApply({ votes: { Bob: 40 } }, "Alice", 72);
    const compensated = compensateTruthMeterLocalVote(live, "Alice", apply);
    assert.equal(compensated.Alice, undefined);
    assert.equal(compensated.Bob, 40);
  });

  it("confirmation distante ignore une intention purement UI", () => {
    assert.equal(resolveConfirmedTruthMeterVote({ votes: {} }, "Alice"), null);
    assert.equal(resolveConfirmedTruthMeterVote({ votes: { Alice: 33 } }, "Alice"), 33);
    assert.equal(resolveConfirmedTruthMeterVote({ votes: { Alice: "x" } }, "Alice"), null);
  });
});

describe("truthMeterVoteCommit — incertitude réseau", () => {
  it("détecte timeout / fetch / AbortError", () => {
    assert.equal(
      isTruthMeterVoteNetworkUncertainty({ name: "AbortError", message: "aborted" }),
      true
    );
    assert.equal(
      isTruthMeterVoteNetworkUncertainty(new TypeError("Failed to fetch")),
      true
    );
    assert.equal(
      isTruthMeterVoteNetworkUncertainty({ message: "Synchronisation trop longue" }),
      true
    );
    assert.equal(
      isTruthMeterVoteNetworkUncertainty({ message: "Contribution refusée." }),
      false
    );
  });
});

describe("commitTruthMeterVote — mocks comportementaux", () => {
  const LOBBY_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  const UID = "cccccccc-cccc-cccc-cccc-cccccccccccc";

  let savedSession;
  let saveCalls;
  const rpcSubmitVoteMock = mock.fn();
  const refreshMock = mock.fn();
  const applyRemoteMock = mock.fn((row) => {
    if (row?.state?.truthMeter) {
      savedSession = {
        ...savedSession,
        ...row.state.truthMeter,
        votes: { ...(row.state.truthMeter.votes || {}) },
      };
    }
  });
  const showAppAlertMock = mock.fn(async () => {});
  const getLocalDisplayNameMock = mock.fn(() => "Alice");
  const requireLocalUidMock = mock.fn(() => UID);
  const isGameSyncActiveMock = mock.fn(() => true);
  const getStateMock = mock.fn(() => ({
    lobby: { id: LOBBY_ID },
    truthMeterGame: savedSession,
  }));
  const saveStatePatchMock = mock.fn((patch) => {
    saveCalls.push(patch);
    if (patch.truthMeterGame) savedSession = patch.truthMeterGame;
  });

  let commitTruthMeterVote;

  beforeEach(async () => {
    savedSession = {
      phase: "voting",
      votes: { Bob: 40 },
      affirmation: { text: "x", author: "Bob" },
      runId: "11111111-1111-1111-1111-111111111111",
      roundIdx: 0,
      lobbyStarted: true,
    };
    saveCalls = [];
    rpcSubmitVoteMock.mock.resetCalls();
    refreshMock.mock.resetCalls();
    applyRemoteMock.mock.resetCalls();
    showAppAlertMock.mock.resetCalls();
    saveStatePatchMock.mock.resetCalls();
    isGameSyncActiveMock.mock.mockImplementation(() => true);

    mock.module("../js/core/gameSessionRpc.js", {
      namedExports: {
        rpcSubmitTruthMeterVote: rpcSubmitVoteMock,
        rpcRevealTruthMeterRound: mock.fn(),
        rpcSubmitTruthMeterAffirmation: mock.fn(),
      },
    });
    mock.module("../js/core/gameSync.js", {
      namedExports: {
        isGameSyncActive: isGameSyncActiveMock,
        applyRemoteSession: applyRemoteMock,
        refreshGameSession: refreshMock,
        truthMeterToRemote: mock.fn(),
        syncTruthMeterSession: mock.fn(),
        requireLocalParticipantUid: requireLocalUidMock,
        getLocalParticipantUid: mock.fn(() => UID),
        nameForUserId: mock.fn((uid) => (uid === UID ? "Alice" : null)),
        isLobbyHost: mock.fn(() => false),
        canActAsHost: mock.fn(() => true),
        allMembersReady: mock.fn(),
        patchGameState: mock.fn(),
        normalizePlayerVotesMap: (votes) => votes || {},
      },
    });
    // BUG-TRUTHMETER-02 : truthMeterSession importe lobby.js (sinon → supabaseClient https:).
    mock.module("../js/core/lobby.js", {
      namedExports: {
        getLobbyParticipants: mock.fn(() => [
          { userId: UID, name: "Alice" },
          { userId: "uid-bob", name: "Bob" },
        ]),
        setLobbyPlaying: mock.fn(),
        setLobbyWaiting: mock.fn(),
      },
    });
    mock.module("../js/core/state.js", {
      namedExports: {
        getState: getStateMock,
        getLocalDisplayName: getLocalDisplayNameMock,
        saveStatePatch: saveStatePatchMock,
        addScore: mock.fn(),
        bumpPlayerStat: mock.fn(),
      },
    });
    mock.module("../js/core/dialog.js", {
      namedExports: { showAppAlert: showAppAlertMock },
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
    mock.module("../js/core/authErrors.js", {
      namedExports: {
        formatSyncErrorMessage: (m) => (m ? String(m) : ""),
      },
    });
    mock.module("../js/core/hotTakeSession.js", {
      namedExports: { checkHotTakeModeration: mock.fn(() => ({ blocked: false })) },
    });

    const mod = await import("../js/core/truthMeterSession.js");
    commitTruthMeterVote = mod.commitTruthMeterVote;
  });

  afterEach(() => {
    mock.restoreAll();
  });

  it("succès : submit_truth_meter_vote + vote distant confirmé", async () => {
    rpcSubmitVoteMock.mock.mockImplementation(async () => ({
      state: {
        truthMeter: {
          phase: "voting",
          votes: { [UID]: 72, "uid-bob": 40 },
          runId: savedSession.runId,
          roundIdx: 0,
        },
      },
    }));
    applyRemoteMock.mock.mockImplementation(() => {
      savedSession = {
        ...savedSession,
        votes: { Alice: 72, Bob: 40 },
      };
    });

    const choice = await commitTruthMeterVote(72);
    assert.equal(choice, 72);
    assert.equal(rpcSubmitVoteMock.mock.callCount(), 1);
    const args = rpcSubmitVoteMock.mock.calls[0].arguments[0];
    assert.equal(args.value, 72);
    assert.equal(args.runId, savedSession.runId);
    assert.equal(resolveConfirmedTruthMeterVote(savedSession, "Alice"), 72);
    assert.equal(savedSession.votes.Bob, 40);
    assert.equal(showAppAlertMock.mock.callCount(), 0);
  });

  it("échec réseau certain : compensation + alerte, Bob intact", async () => {
    rpcSubmitVoteMock.mock.mockImplementation(async () => {
      throw new Error("Contribution refusée.");
    });

    await assert.rejects(() => commitTruthMeterVote(72));
    assert.equal(savedSession.votes.Alice, undefined);
    assert.equal(savedSession.votes.Bob, 40);
    assert.equal(showAppAlertMock.mock.callCount(), 1);
  });

  it("modification échouée : restaure l’ancien vote confirmé", async () => {
    savedSession.votes = { Alice: 10, Bob: 40 };
    rpcSubmitVoteMock.mock.mockImplementation(async () => {
      throw new Error("Contribution refusée.");
    });

    await assert.rejects(() => commitTruthMeterVote(99));
    assert.equal(savedSession.votes.Alice, 10);
    assert.equal(savedSession.votes.Bob, 40);
  });

  it("incertitude réseau : refresh avant rollback final", async () => {
    rpcSubmitVoteMock.mock.mockImplementation(async () => {
      throw new TypeError("Failed to fetch");
    });
    refreshMock.mock.mockImplementation(async () => ({
      state: {
        truthMeter: {
          runId: savedSession.runId,
          roundIdx: 0,
          phase: "voting",
          votes: { [UID]: 72 },
        },
      },
    }));
    applyRemoteMock.mock.mockImplementation((row) => {
      if (row?.state?.truthMeter?.votes?.[UID] != null) {
        savedSession = { ...savedSession, votes: { Alice: 72, Bob: 40 } };
      }
    });

    const choice = await commitTruthMeterVote(72);
    assert.equal(choice, 72);
    assert.equal(refreshMock.mock.callCount(), 1);
    assert.equal(showAppAlertMock.mock.callCount(), 0);
    assert.equal(resolveConfirmedTruthMeterVote(savedSession, "Alice"), 72);
  });

  it("incertitude sans vote distant : compensation + alerte", async () => {
    rpcSubmitVoteMock.mock.mockImplementation(async () => {
      throw new TypeError("Failed to fetch");
    });
    refreshMock.mock.mockImplementation(async () => ({
      state: {
        truthMeter: {
          runId: savedSession.runId,
          roundIdx: 0,
          phase: "voting",
          votes: {},
        },
      },
    }));
    applyRemoteMock.mock.mockImplementation(() => {
      savedSession = { ...savedSession, votes: { Bob: 40 } };
    });

    await assert.rejects(() => commitTruthMeterVote(72));
    assert.equal(savedSession.votes.Alice, undefined);
    assert.equal(savedSession.votes.Bob, 40);
    assert.equal(showAppAlertMock.mock.callCount(), 1);
  });

  it("vote tardif post-reveal : message dédié, pas Réessaie", async () => {
    rpcSubmitVoteMock.mock.mockImplementation(async () => {
      const err = new Error("TRUTHMETER_INVALID_PHASE");
      err.code = "TRUTHMETER_INVALID_PHASE";
      throw err;
    });
    refreshMock.mock.mockImplementation(async () => ({
      state: {
        truthMeter: {
          runId: savedSession.runId,
          roundIdx: 0,
          phase: "reveal",
          roundScored: true,
        },
      },
    }));

    await assert.rejects(() => commitTruthMeterVote(72));
    assert.equal(showAppAlertMock.mock.callCount(), 1);
    const msg = String(showAppAlertMock.mock.calls[0].arguments[0]);
    assert.match(msg, /révélation a déjà commencé/i);
    assert.doesNotMatch(msg, /Réessaie/);
  });

  it("retry après échec peut réussir", async () => {
    let n = 0;
    rpcSubmitVoteMock.mock.mockImplementation(async () => {
      n += 1;
      if (n === 1) throw new Error("Contribution refusée.");
      return {
        state: { truthMeter: { votes: { [UID]: 55 }, phase: "voting", runId: savedSession.runId, roundIdx: 0 } },
      };
    });
    applyRemoteMock.mock.mockImplementation(() => {
      if (n >= 2) savedSession = { ...savedSession, votes: { Alice: 55, Bob: 40 } };
    });

    await assert.rejects(() => commitTruthMeterVote(55));
    assert.equal(savedSession.votes.Alice, undefined);

    const ok = await commitTruthMeterVote(55);
    assert.equal(ok, 55);
    assert.equal(resolveConfirmedTruthMeterVote(savedSession, "Alice"), 55);
  });
});

describe("contrats source — UI + contribute + ensureLocal", () => {
  const sessionSrc = readSrc("js/core/truthMeterSession.js");
  const gameSrc = readSrc("js/games/truthMeter.js");
  const sqlSrc = readSrc("supabase/game-sessions-i08-arch03.sql");

  it("commitTruthMeterVote passe par submit_truth_meter_vote (pas patch votes hôte)", () => {
    assert.match(sessionSrc, /rpcSubmitTruthMeterVote/);
    assert.match(sessionSrc, /compensateTruthMeterLocalVote/);
    assert.match(sessionSrc, /isTruthMeterVoteNetworkUncertainty|evaluateTruthMeterVoteRecovery/);
    assert.doesNotMatch(
      sessionSrc,
      /patchGameStateWithFeedback\(\{\s*truthMeter:\s*\{\s*votes/
    );
  });

  it("SQL 01B : FOR UPDATE + jsonb_set / scoring partagé", () => {
    const sql01b = readSrc("supabase/game-sessions-truthmeter-01b-reveal-round.sql");
    assert.match(sql01b, /reveal_truth_meter_round/);
    assert.match(sql01b, /submit_truth_meter_vote/);
    assert.match(sql01b, /truth_meter_apply_reveal_scoring/);
    assert.match(sql01b, /for update/i);
  });

  it("SQL contribute legacy : encore présent pour autres jeux", () => {
    assert.match(sqlSrc, /contribute_game_session_player/);
    assert.match(sqlSrc, /for update/i);
    assert.match(sqlSrc, /jsonb_set\(/);
  });

  it("UI : Vote enregistré dépend de myConfirmedVote / confirmation distante", () => {
    assert.match(gameSrc, /myConfirmedVote\(\)/);
    assert.match(gameSrc, /resolveConfirmedTruthMeterVote/);
    assert.match(gameSrc, /voteLocked \? "Vote enregistré"/);
    assert.match(gameSrc, /sendingVote \? "Envoi…"/);
    // Pas de verrouillage définitif sur myVote optimiste seul
    assert.match(gameSrc, /const voteLocked = confirmedVote != null/);
    assert.match(gameSrc, /controlsDisabled = voteLocked \|\| sendingVote/);
  });

  it("click handler : pas de mutation myVote confirmée avant await commit", () => {
    const clickIdx = gameSrc.indexOf('#btn-confirm-vote")?.addEventListener("click"');
    assert.ok(clickIdx > 0);
    const slice = gameSrc.slice(clickIdx, clickIdx + 900);
    assert.match(slice, /voteCommitInFlight = choice/);
    assert.match(slice, /await voteCommitPromise/);
    assert.doesNotMatch(slice, /myVote = choice/);
  });

  it("ensureLocalVoteCommitted attend le commit en vol puis même contrat", () => {
    assert.match(gameSrc, /async function ensureLocalVoteCommitted/);
    assert.match(gameSrc, /if \(voteCommitPromise\)/);
    assert.match(gameSrc, /await voteCommitPromise/);
    const ensureIdx = gameSrc.indexOf("async function ensureLocalVoteCommitted");
    const slice = gameSrc.slice(ensureIdx, ensureIdx + 1100);
    assert.match(slice, /commitTruthMeterVote\(choice\)/);
    assert.doesNotMatch(slice, /patchGameStateWithFeedback/);
  });

  it("aucun call site n’affiche enregistré depuis myVote seul en phase voting", () => {
    const votingIdx = gameSrc.indexOf('if (phase === "voting" && affirmation)');
    const votingSlice = gameSrc.slice(votingIdx, votingIdx + 1600);
    assert.doesNotMatch(votingSlice, /voteLocked = myVote != null/);
    assert.match(votingSlice, /confirmedVote = myConfirmedVote\(\)/);
  });

  it("01B : scoring reveal MP via commitTruthMeterReveal (plus de award client live)", () => {
    assert.match(gameSrc, /async function transitionToReveal/);
    const revealIdx = gameSrc.indexOf("async function transitionToReveal");
    const slice = gameSrc.slice(revealIdx, revealIdx + 2800);
    assert.match(slice, /commitTruthMeterReveal/);
    // Solo branch starts after MP early-return ; marqueur = scoring local.
    const soloMarker = slice.indexOf("const author = authorLabel()");
    assert.ok(soloMarker > 0, "solo authorLabel marker");
    const mpBranch = slice.slice(0, soloMarker);
    assert.match(mpBranch, /if \(mp\)/);
    assert.equal(/\bawardTruthMeterRound\b/.test(mpBranch), false);
    assert.match(slice, /awardTruthMeterRound/); // solo conserve
  });
});

/** Miroir UI des libellés voting (sans DOM). */
function truthMeterVoteButtonLabel({ confirmed, sending }) {
  if (sending) return "Envoi…";
  if (confirmed != null) return "Vote enregistré";
  return "Valider mon vote";
}

describe("libellés UI — pas de succès optimiste seul", () => {
  it("in-flight prioritaire sur présence locale", () => {
    assert.equal(
      truthMeterVoteButtonLabel({ confirmed: 50, sending: true }),
      "Envoi…"
    );
  });

  it("confirmé distant → enregistré", () => {
    assert.equal(
      truthMeterVoteButtonLabel({ confirmed: 50, sending: false }),
      "Vote enregistré"
    );
  });

  it("échec / rollback → invite à revoter", () => {
    assert.equal(
      truthMeterVoteButtonLabel({ confirmed: null, sending: false }),
      "Valider mon vote"
    );
  });
});
