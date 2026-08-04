import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  getCurrentSessionScoreMap,
  getState,
  renameLocalPlayer,
  saveStatePatch,
} from "../js/core/state.js";

/**
 * Collision rules (I-09 review):
 * - preferOld: renaming identity (Alice) wins over orphan under Alicia
 * - or: ready / dealAcks
 * - maxStats: per-counter Math.max for playerStats
 * - ranking/standings: keep better entry by domain metric
 * - sum: intentionally unused (double-count risk)
 */

function seedAlice(extra = {}) {
  saveStatePatch({
    user: { ...(getState().user || {}), name: "Alice", loggedIn: true, isGuest: true },
    lobby: {
      ...(getState().lobby || {}),
      participants: [
        { name: "Alice", isLocal: true, emoji: "🎭", color: "#A78BFA" },
        { name: "Bob", isLocal: false, emoji: "🎲", color: "#34D399" },
      ],
    },
    ...extra,
  });
}

describe("renameLocalPlayer (I-09 / SYN-06)", () => {
  let snapshot;

  beforeEach(() => {
    snapshot = structuredClone(getState());
  });

  afterEach(() => {
    saveStatePatch(snapshot);
  });

  it("no-op when name unchanged", () => {
    seedAlice({ scores: { Alice: 5 } });
    const before = structuredClone(getState());
    const res = renameLocalPlayer("Alice");
    assert.equal(res.ok, true);
    assert.deepEqual(getState().scores, before.scores);
  });

  it("rejects short names", () => {
    seedAlice();
    const res = renameLocalPlayer("A");
    assert.equal(res.ok, false);
    assert.equal(getState().user.name, "Alice");
  });

  it("baseline collision preferOld preserves in-game delta (no sum)", () => {
    // getCurrentSessionScoreMap: total[name] − baseline[name]
    // Alice session delta 10, Alicia orphan delta 2 - preferOld keeps Alice pair → delta 10.
    // sum would yield (20+5)−(10+3)=12 (fabricated). preferNew would yield 5−3=2 (lost progress).
    seedAlice({
      gameScoreSessionGameId: "clutch",
      gameScores: { clutch: { Alice: 20, Alicia: 5, Bob: 0 } },
      gameScoreSessionBaseline: { Alice: 10, Alicia: 3, Bob: 0 },
    });
    renameLocalPlayer("Alicia");
    const s = getState();
    assert.equal(s.gameScores.clutch.Alicia, 20);
    assert.equal(s.gameScoreSessionBaseline.Alicia, 10);
    assert.equal(s.gameScores.clutch.Alice, undefined);
    assert.equal(s.gameScoreSessionBaseline.Alice, undefined);
    assert.equal(getCurrentSessionScoreMap("clutch").Alicia, 10);
  });

  it("migrates nested gameScores with preferOld on collision", () => {
    seedAlice({
      gameScores: {
        clutch: { Alice: 15, Alicia: 99, Bob: 10 },
        hottake: { Alice: 20 },
      },
    });
    renameLocalPlayer("Alicia");
    assert.deepEqual(getState().gameScores, {
      clutch: { Alicia: 15, Bob: 10 },
      hottake: { Alicia: 20 },
    });
  });

  it("migrates guessLie.votes preferOld without rewriting free-text statements", () => {
    seedAlice({
      guessLie: {
        ...(getState().guessLie || {}),
        submissions: {
          Alice: {
            statements: ["Alice went to Paris", "I own a boat", "I hate pizza"],
            lie: 1,
          },
          Alicia: { statements: ["orphan", "x", "y"], lie: 0 },
          Bob: { statements: ["x", "y", "z"], lie: 0 },
        },
        votes: { Alice: 2, Bob: 1, Alicia: 0 },
      },
    });
    renameLocalPlayer("Alicia");
    const gl = getState().guessLie;
    assert.equal(gl.votes.Alicia, 2); // preferOld keeps Alice's vote
    assert.equal(gl.votes.Alice, undefined);
    assert.equal(gl.submissions.Alicia.lie, 1); // atomic preferOld, not field-merge
    assert.deepEqual(gl.submissions.Alicia.statements, [
      "Alice went to Paris",
      "I own a boat",
      "I hate pizza",
    ]);
  });

  it("playerStats uses per-counter max, not shallow mergeObjects", () => {
    seedAlice({
      playerStats: {
        Alice: {
          hotTakeMajorityWins: 5,
          liesDetected: 2,
          truthMeterBluffWins: 0,
        },
        Alicia: {
          hotTakeMajorityWins: 1,
          liesDetected: 9,
          tierNightsPlayed: 3,
        },
      },
    });
    renameLocalPlayer("Alicia");
    assert.deepEqual(getState().playerStats.Alicia, {
      hotTakeMajorityWins: 5,
      liesDetected: 9,
      truthMeterBluffWins: 0,
      tierNightsPlayed: 3,
    });
  });

  it("migrates hotTakeGame matchScores + lastRound name arrays", () => {
    seedAlice({
      hotTakeGame: {
        ...getState().hotTakeGame,
        ready: { Alice: true, Bob: false },
        votes: { Alice: "agree", Bob: "disagree" },
        matchScores: { Alice: 10, Bob: 4, Alicia: 99 },
        pausedBy: "Alice",
        customTakes: [{ id: "c1", text: "Alice is great", author: "Alice" }],
        lastRound: {
          majority: "agree",
          tied: false,
          pointsAwarded: true,
          deltas: { Alice: 5, Alicia: 99, Bob: 0 },
          dissenters: ["Alice", "Cam"],
          majorityWinners: ["Bob"],
          tieWinners: [],
        },
      },
    });
    renameLocalPlayer("Alicia");
    const ht = getState().hotTakeGame;
    assert.equal(ht.matchScores.Alicia, 10);
    assert.equal(ht.lastRound.deltas.Alicia, 5);
    assert.equal(ht.customTakes[0].text, "Alice is great");
    assert.deepEqual(ht.lastRound.dissenters, ["Alicia", "Cam"]);
  });

  it("migrates dilemmaGame matchScores + lastRound", () => {
    seedAlice({
      dilemmaGame: {
        ...getState().dilemmaGame,
        ready: { Alice: true },
        votes: { Alice: "A", Bob: "B" },
        matchScores: { Alice: 8, Bob: 2 },
        lastRound: {
          majority: "A",
          tie: false,
          majorityWinners: ["Alice", "Cam"],
          tieWinners: ["Alice"],
          deltas: { Alice: 3 },
        },
      },
    });
    renameLocalPlayer("Alicia");
    const dm = getState().dilemmaGame;
    assert.equal(dm.matchScores.Alicia, 8);
    assert.deepEqual(dm.lastRound.majorityWinners, ["Alicia", "Cam"]);
  });

  it("migrates speedVote votes as key+value without inventing an extra vote", () => {
    seedAlice({
      speedVoteGame: {
        ...getState().speedVoteGame,
        ready: { Alice: true, Bob: true },
        votes: { Alice: "Bob", Bob: "Alice", Cam: "Alice", Alicia: "Cam" },
        matchScores: { Alice: 10, Bob: 5 },
      },
    });
    renameLocalPlayer("Alicia");
    const sv = getState().speedVoteGame;
    // preferOld: Alice's vote ("Bob") replaces orphan Alicia→Cam; one entry for Alicia
    assert.deepEqual(sv.votes, { Alicia: "Bob", Bob: "Alicia", Cam: "Alicia" });
    assert.equal(Object.keys(sv.votes).length, 3);
  });

  it("clutch ranking keeps better gap/at, not first occurrence", () => {
    seedAlice({
      clutchGame: {
        ...getState().clutchGame,
        ready: { Alice: true },
        taps: {
          Alice: { ms: 4500, at: 100 },
          Alicia: { ms: 4400, at: 90 },
          Bob: { ms: 4600, at: 110 },
        },
        matchScores: { Alice: 5 },
        lastRound: {
          targetMs: 4500,
          deltas: { Alice: 5, Bob: 0 },
          ranking: [
            { name: "Alice", ms: 4500, gap: 0, tapped: true, at: 100 },
            { name: "Alicia", ms: 4400, gap: 100, tapped: true, at: 90 },
            { name: "Bob", ms: 4600, gap: 100, tapped: true, at: 110 },
          ],
        },
      },
    });
    renameLocalPlayer("Alicia");
    const clutch = getState().clutchGame;
    assert.deepEqual(clutch.taps.Alicia, { ms: 4500, at: 100 }); // preferOld tap
    const aliciaRank = clutch.lastRound.ranking.find((r) => r.name === "Alicia");
    // Better gap is 0 (from Alice), not the orphan gap 100
    assert.equal(aliciaRank.gap, 0);
    assert.equal(aliciaRank.ms, 4500);
    assert.equal(clutch.lastRound.ranking.filter((r) => r.name === "Alicia").length, 1);
  });

  it("migrates wrongAnswerGame keys, vote targets, and lastRound counts preferOld", () => {
    seedAlice({
      wrongAnswerGame: {
        ...getState().wrongAnswerGame,
        ready: { Alice: true },
        answers: {
          Alice: { text: "Alice would never", at: 1 },
          Bob: { text: "other", at: 2 },
          Alicia: { text: "orphan", at: 9 },
        },
        votes: { Alice: "Bob", Bob: "Alice" },
        matchScores: { Alice: 3 },
        lastRound: {
          prompt: "q",
          answers: { Alice: "Alice would never", Bob: "other", Alicia: "orphan" },
          votes: { Alice: "Bob", Bob: "Alice" },
          counts: { Alice: 2, Alicia: 9, Bob: 1 },
          deltas: { Alice: 3, Alicia: 99 },
        },
      },
    });
    renameLocalPlayer("Alicia");
    const wa = getState().wrongAnswerGame;
    assert.equal(wa.answers.Alicia.text, "Alice would never");
    assert.equal(wa.votes.Bob, "Alicia");
    assert.equal(wa.lastRound.counts.Alicia, 2); // not 2+9
    assert.equal(wa.lastRound.deltas.Alicia, 3); // not 3+99
  });

  it("migrates traitreGame scalars, arrays, votes and intuitionAwards preferOld", () => {
    seedAlice({
      traitreGame: {
        ...getState().traitreGame,
        ready: { Alice: true, Bob: true },
        impostorName: "Alice",
        alive: ["Alice", "Bob", "Alice", "Cam"],
        eliminated: ["Dan"],
        votes: { Bob: "Alice", Cam: "Bob" },
        dealAcks: { Alice: true },
        intuitionAwards: { Alice: 2, Alicia: 7, Bob: 1 },
        lastEliminated: null,
        lastVoteSnapshot: { Bob: "Alice" },
        lastRound: {
          winner: "civilians",
          impostorName: "Alice",
          deltas: { Bob: 5, Alice: 0 },
          breakdown: { Bob: [{ label: "Détective" }], Alice: [] },
        },
      },
    });
    renameLocalPlayer("Alicia");
    const t = getState().traitreGame;
    assert.equal(t.impostorName, "Alicia");
    assert.deepEqual(t.alive, ["Alicia", "Bob", "Cam"]);
    assert.equal(t.intuitionAwards.Alicia, 2);
    assert.equal(t.votes.Bob, "Alicia");
  });

  it("migrates truthMeterGame authorOrder, affirmation.author, matchScores, lastRound", () => {
    seedAlice({
      truthMeterGame: {
        ...getState().truthMeterGame,
        ready: { Alice: true },
        authorOrder: ["Bob", "Alice", "Cam", "Alice"],
        affirmation: { text: "Alice loves pineapple", author: "Alice" },
        votes: { Bob: 70, Cam: 40 },
        matchScores: { Alice: 10, Bob: 3 },
        lastRound: {
          bluffWin: true,
          mindReader: "Bob",
          deltas: { Alice: 5, Bob: 3 },
        },
      },
    });
    renameLocalPlayer("Alicia");
    const tm = getState().truthMeterGame;
    // Sans userId local : legacy name → nouveau pseudo (solo / guest sans UID).
    assert.deepEqual(tm.authorOrder, ["Bob", "Alicia", "Cam", "Alicia"]);
    assert.equal(tm.affirmation.author, "Alicia");
    assert.equal(tm.affirmation.text, "Alice loves pineapple");
    assert.equal(tm.matchScores.Alicia, 10);
  });

  it("TM-02: with local userId, legacy authorOrder/affirmation normalize to UID", () => {
    seedAlice({
      lobby: {
        ...(getState().lobby || {}),
        participants: [
          { name: "Alice", isLocal: true, userId: "uid-alice", emoji: "🎭", color: "#A78BFA" },
          { name: "Bob", isLocal: false, userId: "uid-bob", emoji: "🎲", color: "#34D399" },
        ],
      },
      truthMeterGame: {
        ...getState().truthMeterGame,
        authorOrder: ["Bob", "Alice"],
        affirmation: { text: "hi", author: "Alice" },
      },
    });
    renameLocalPlayer("Alicia");
    const tm = getState().truthMeterGame;
    assert.deepEqual(tm.authorOrder, ["Bob", "uid-alice"]);
    assert.equal(tm.affirmation.authorUid, "uid-alice");
    assert.equal(tm.affirmation.author, "Alicia");
  });

  it("TM-02: UID authorOrder entries are not rewritten on rename", () => {
    const uidAlice = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const uidBob = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
    seedAlice({
      lobby: {
        ...(getState().lobby || {}),
        participants: [
          { name: "Alice", isLocal: true, userId: uidAlice, emoji: "🎭", color: "#A78BFA" },
          { name: "Bob", isLocal: false, userId: uidBob, emoji: "🎲", color: "#34D399" },
        ],
      },
      truthMeterGame: {
        ...getState().truthMeterGame,
        authorOrder: [uidBob, uidAlice],
        affirmation: { text: "hi", authorUid: uidAlice, author: "Alice" },
      },
    });
    renameLocalPlayer("Alicia");
    const tm = getState().truthMeterGame;
    assert.deepEqual(tm.authorOrder, [uidBob, uidAlice]);
    assert.equal(tm.affirmation.authorUid, uidAlice);
    assert.equal(tm.affirmation.author, "Alicia");
  });

  it("trivia standings keep higher score on name collision", () => {
    seedAlice({
      triviaGame: {
        ...getState().triviaGame,
        ready: { Alice: true },
        answers: { Alice: { answerIndex: 1, answeredAt: 50 }, Bob: { answerIndex: 0, answeredAt: 80 } },
        matchScores: { Alice: 20 },
        lastRound: {
          correctIndex: 1,
          correctAnswer: "B",
          correctPlayers: ["Alice", "Cam"],
          fastestPlayer: "Alice",
          deltas: { Alice: 15 },
        },
        results: {
          standings: [
            { name: "Alice", score: 20, rank: 1 },
            { name: "Alicia", score: 50, rank: 2 },
            { name: "Bob", score: 5, rank: 3 },
          ],
        },
      },
    });
    renameLocalPlayer("Alicia");
    const tr = getState().triviaGame;
    assert.equal(tr.results.standings.filter((s) => s.name === "Alicia").length, 1);
    assert.equal(tr.results.standings.find((s) => s.name === "Alicia").score, 50);
    assert.equal(tr.lastRound.fastestPlayer, "Alicia");
  });

  it("migrates tierNightLiveGame votes and placements keys only", () => {
    seedAlice({
      tierNightLiveGame: {
        ...getState().tierNightLiveGame,
        votes: { Alice: "S", Bob: "A" },
        placements: {
          Alice: { S: ["Pizza"], A: [], B: [], C: [], D: [] },
          Bob: { S: [], A: ["Burger"], B: [], C: [], D: [] },
        },
      },
    });
    renameLocalPlayer("Alicia");
    const tnl = getState().tierNightLiveGame;
    assert.equal(tnl.votes.Alicia, "S");
    assert.deepEqual(tnl.placements.Alicia.S, ["Pizza"]);
  });

  it("migrates consensus lastRound name arrays", () => {
    seedAlice({
      consensusGame: {
        ...getState().consensusGame,
        matchScores: { Alice: 4 },
        lastRound: {
          deltas: { Alice: 2 },
          precisionPlayers: ["Alice"],
          closestPlayers: ["Bob"],
          intuitionPlayers: ["Alice", "Cam"],
          consensusPlayers: ["Alice", "Alice"],
        },
      },
    });
    renameLocalPlayer("Alicia");
    const c = getState().consensusGame;
    assert.deepEqual(c.lastRound.precisionPlayers, ["Alicia"]);
    assert.deepEqual(c.lastRound.consensusPlayers, ["Alicia"]);
  });

  it("leaves blobs untouched when old name absent", () => {
    seedAlice({
      gameScores: { clutch: { Bob: 3 } },
      speedVoteGame: { ...getState().speedVoteGame, votes: { Bob: "Cam" } },
    });
    renameLocalPlayer("Alicia");
    assert.deepEqual(getState().gameScores, { clutch: { Bob: 3 } });
    assert.deepEqual(getState().speedVoteGame.votes, { Bob: "Cam" });
  });

  it("is idempotent when run twice", () => {
    seedAlice({
      scores: { Alice: 7 },
      gameScores: { clutch: { Alice: 4 } },
      traitreGame: {
        ...getState().traitreGame,
        impostorName: "Alice",
        alive: ["Alice", "Bob"],
      },
    });
    renameLocalPlayer("Alicia");
    const mid = structuredClone(getState());
    renameLocalPlayer("Alicia");
    assert.deepEqual(getState().scores, mid.scores);
    assert.deepEqual(getState().gameScores, mid.gameScores);
    assert.deepEqual(getState().traitreGame.alive, mid.traitreGame.alive);
  });

  it("evening scores preferOld on collision; ready ORs", () => {
    seedAlice({
      scores: { Alice: 10, Alicia: 4 },
      clutchGame: {
        ...getState().clutchGame,
        ready: { Alice: true, Alicia: false, Bob: true },
      },
    });
    renameLocalPlayer("Alicia");
    assert.equal(getState().scores.Alicia, 10);
    assert.equal(getState().clutchGame.ready.Alicia, true);
  });

  it("handles missing optional blobs without throwing", () => {
    seedAlice({
      hotTakeGame: null,
      dilemmaGame: undefined,
      clutchGame: { ...getState().clutchGame, lastRound: null },
    });
    const res = renameLocalPlayer("Alicia");
    assert.equal(res.ok, true);
    assert.equal(getState().user.name, "Alicia");
  });
});
