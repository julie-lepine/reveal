/**
 * Audit badges, classement et stats n°2 et n°3.
 *  n°2 : un joueur parti était effacé du serveur au prochain envoi de l'hôte
 *        (son uid ne se traduisait plus en pseudo).
 *  n°3 : badges calculés sur les seuls joueurs présents (« MVP » au 2e derrière
 *        un joueur parti, badges de stats transférés), égalités mal gérées.
 *  En plus : fin de manche Tier Night série, les stats serveur (clés uid)
 *        remplaçaient toutes les stats du téléphone de l'hôte.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { getState, saveStatePatch, bumpPlayerStat } from "../js/core/state.js";
import { applyAuthoritativeSeriesRpcState } from "../js/core/tierNightSeriesPlaySession.js";
import { applyRemotePlayerStats } from "../js/core/playerStatsSync.js";
import {
  __resetCachedGameSessionForTests,
  __setCachedGameSessionRowForTests,
  __testEveningStateToRemote,
  absorbServerEveningScores,
} from "../js/core/gameSync.js";
import {
  __resetEveningPlayerNamesForTests,
  carryOverMissingUidEntries,
  departedDisplayName,
  departedUidForName,
  rememberEveningPlayerNames,
  getEveningPlayerNames,
} from "../js/core/eveningPlayerNames.js";
import {
  MVP_BADGE,
  PROGRESS_BADGE,
  buildFallbackBadgeMap,
  getPlayerBadges,
} from "../js/core/badges.js";
import { getSortedEveningStandingPlayers } from "../js/core/players.js";

const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";
const C = "cccccccc-0000-4000-8000-000000000003";
const D = "dddddddd-0000-4000-8000-000000000004";
const LOBBY_ID = "11111111-0000-4000-8000-000000000000";

const ALICE = { name: "Alice", userId: A, isLocal: true, isHost: true };
const BOB = { name: "Bob", userId: B };
const CARL = { name: "Carl", userId: C };

function setLobby(participants, extra = {}) {
  saveStatePatch({
    inLobby: true,
    lobby: { id: LOBBY_ID, code: "TEST", participants },
    ...extra,
  });
}

describe("n°2 — joueurs partis gardés dans la soirée", () => {
  let snapshot;
  beforeEach(() => {
    snapshot = structuredClone(getState());
    __resetEveningPlayerNamesForTests();
    __resetCachedGameSessionForTests();
  });
  afterEach(() => {
    saveStatePatch(snapshot);
    __resetEveningPlayerNamesForTests();
    __resetCachedGameSessionForTests();
  });

  it("l'hôte qui a vu Carl le garde à l'envoi après son départ", () => {
    setLobby([ALICE, BOB, CARL], {
      scores: { Alice: 10, Bob: 20, Carl: 30 },
      playerStats: { Alice: { liesDetected: 1 }, Bob: {}, Carl: { liesDetected: 5 } },
      gameScores: { hottake: { Alice: 10, Bob: 20, Carl: 30 } },
    });
    const before = __testEveningStateToRemote();
    assert.equal(before.eveningPlayerNames[C], "Carl");
    setLobby([ALICE, BOB]);
    const after = __testEveningStateToRemote();
    assert.equal(after.scores[C], 30);
    assert.equal(after.playerStats[C].liesDetected, 5);
    assert.equal(after.gameScores.hottake[C], 30);
    assert.equal(after.eveningPlayerNames[C], "Carl");
  });

  it("téléphone qui ne connaissait pas Carl : nom et points repris de la session", () => {
    setLobby([ALICE, BOB], { scores: { Alice: 10, Bob: 20 }, playerStats: {}, gameScores: {} });
    const server = {
      scores: { [A]: 10, [B]: 20, [C]: 30 },
      playerStats: { [C]: { liesDetected: 5 } },
      eveningPlayerNames: { [C]: "Carl" },
    };
    absorbServerEveningScores(server);
    assert.equal(getState().scores.Carl, 30);
    assert.equal(getState().playerStats.Carl.liesDetected, 5);
    const names = getSortedEveningStandingPlayers().map((p) => p.name);
    assert.deepEqual(names, ["Carl", "Bob", "Alice"]);
  });

  it("session sans nom pour Carl : ses points ne sont plus effacés du serveur", () => {
    setLobby([ALICE, BOB], { scores: { Alice: 10, Bob: 20 }, playerStats: {}, gameScores: {} });
    __setCachedGameSessionRowForTests({
      lobby_id: LOBBY_ID,
      state: {
        scores: { [A]: 10, [B]: 20, [C]: 30 },
        playerStats: { [C]: { liesDetected: 5 } },
        gameScores: { hottake: { [C]: 30 } },
      },
    });
    const out = __testEveningStateToRemote();
    assert.equal(out.scores[C], 30);
    assert.deepEqual(out.playerStats[C], { liesDetected: 5 });
    assert.equal(out.gameScores.hottake[C], 30);
    assert.equal(getState().scores[C], undefined, "pas d'uid affiché comme pseudo");
  });

  it("le téléphone l'emporte sur le serveur pour un joueur qu'il connaît", () => {
    setLobby([ALICE, BOB], { scores: { Alice: 15, Bob: 20 }, playerStats: {}, gameScores: {} });
    __setCachedGameSessionRowForTests({ lobby_id: LOBBY_ID, state: { scores: { [A]: 10 } } });
    assert.equal(__testEveningStateToRemote().scores[A], 15);
  });

  it("ligne d'un autre salon ignorée", () => {
    setLobby([ALICE], { scores: { Alice: 1 }, playerStats: {}, gameScores: {} });
    __setCachedGameSessionRowForTests({ lobby_id: "autre", state: { scores: { [C]: 30 } } });
    assert.equal(__testEveningStateToRemote().scores[C], undefined);
  });

  it("même pseudo qu'un joueur présent : « (parti) », points séparés", () => {
    const newCarl = { name: "Carl", userId: D };
    setLobby([ALICE, newCarl], { scores: { Alice: 1, Carl: 2 }, playerStats: {}, gameScores: {} });
    absorbServerEveningScores({
      scores: { [A]: 1, [D]: 2, [C]: 30 },
      eveningPlayerNames: { [C]: "Carl" },
    });
    assert.equal(getState().scores.Carl, 2);
    assert.equal(getState().scores["Carl (parti)"], 30);
    const out = __testEveningStateToRemote();
    assert.equal(out.scores[D], 2);
    assert.equal(out.scores[C], 30);
  });
});

describe("eveningPlayerNames (pur)", () => {
  beforeEach(() => __resetEveningPlayerNamesForTests());

  it("ignore les clés qui ne sont pas des uid et les pseudos vides, coupe à 64", () => {
    rememberEveningPlayerNames("L", { Bob: "Bob", [C]: "  ", [D]: "x".repeat(80) });
    assert.deepEqual(getEveningPlayerNames("L"), { [D]: "x".repeat(64) });
  });

  it("ne remplace pas le pseudo d'un participant présent", () => {
    rememberEveningPlayerNames("L", { [B]: "Ancien" }, [{ userId: B, name: "Bob" }]);
    assert.deepEqual(getEveningPlayerNames("L"), {});
  });

  it("changement de salon : liste vidée", () => {
    rememberEveningPlayerNames("L1", { [C]: "Carl" });
    assert.deepEqual(getEveningPlayerNames("L2"), {});
  });

  it("aller-retour pseudo ↔ uid", () => {
    const names = { [C]: "Carl" };
    const ps = [{ userId: D, name: "Carl" }];
    assert.equal(departedDisplayName(C, names, ps), "Carl (parti)");
    assert.equal(departedUidForName("Carl (parti)", names, ps), C);
    assert.equal(departedDisplayName(D, names, ps), null);
    assert.equal(departedDisplayName(C, names, []), "Carl");
  });

  it("report : uid seulement, sans écraser", () => {
    const out = carryOverMissingUidEntries({ [A]: 5 }, { [A]: 9, [C]: 3, Bob: 4, [D]: "x" });
    assert.deepEqual(out, { [A]: 5, [C]: 3 });
  });
});

describe("n°3 — badges sur le classement complet", () => {
  let snapshot;
  beforeEach(() => {
    snapshot = structuredClone(getState());
    __resetEveningPlayerNamesForTests();
  });
  afterEach(() => {
    saveStatePatch(snapshot);
    __resetEveningPlayerNamesForTests();
  });

  it("joueur parti en tête : il est MVP et garde son badge de stat", () => {
    setLobby([ALICE, BOB], {
      scores: { Alice: 10, Bob: 20, Carl: 30 },
      playerStats: { Alice: { liesDetected: 1 }, Bob: {}, Carl: { liesDetected: 5 } },
    });
    const badges = Object.fromEntries(getPlayerBadges().map((p) => [p.name, p.badge]));
    assert.equal(badges.Carl, "Le détective");
    assert.equal(badges.Bob, "");
    assert.equal(badges.Alice, PROGRESS_BADGE);
  });

  it("égalité en tête : tous les co-leaders sont MVP", () => {
    const map = buildFallbackBadgeMap([
      { name: "Alice", score: 20 },
      { name: "Bob", score: 20 },
      { name: "Carl", score: 5 },
    ]);
    assert.deepEqual(map, { Alice: MVP_BADGE, Bob: MVP_BADGE, Carl: PROGRESS_BADGE });
  });

  it("un co-leader avec un badge de stat garde le sien", () => {
    setLobby([ALICE, BOB], {
      scores: { Alice: 20, Bob: 20 },
      playerStats: { Alice: { liesDetected: 2 }, Bob: {} },
    });
    const badges = Object.fromEntries(getPlayerBadges().map((p) => [p.name, p.badge]));
    assert.equal(badges.Alice, "Le détective");
    assert.equal(badges.Bob, MVP_BADGE);
  });

  it("« En progression » : un dernier seul, avec au moins 1 point", () => {
    assert.deepEqual(
      buildFallbackBadgeMap([
        { name: "A", score: 10 },
        { name: "B", score: 0 },
      ]),
      { A: MVP_BADGE }
    );
    assert.deepEqual(
      buildFallbackBadgeMap([
        { name: "A", score: 10 },
        { name: "B", score: 3 },
        { name: "C", score: 3 },
      ]),
      { A: MVP_BADGE }
    );
  });

  it("tout le monde à 0 : aucun badge ; joueur seul : MVP", () => {
    assert.deepEqual(buildFallbackBadgeMap([{ name: "A", score: 0 }, { name: "B", score: 0 }]), {});
    assert.deepEqual(buildFallbackBadgeMap([{ name: "A", score: 4 }]), { A: MVP_BADGE });
  });
});

describe("Tier Night série — stats de l'hôte gardées après une manche", () => {
  let snapshot;
  beforeEach(() => {
    snapshot = structuredClone(getState());
    __resetEveningPlayerNamesForTests();
    __resetCachedGameSessionForTests();
  });
  afterEach(() => {
    saveStatePatch(snapshot);
    __resetEveningPlayerNamesForTests();
    __resetCachedGameSessionForTests();
  });

  it("stats rangées par pseudo, fusion au maximum, rien de perdu à l'envoi", () => {
    setLobby([ALICE, BOB], {
      scores: { Alice: 0, Bob: 0 },
      playerStats: { Alice: { liesDetected: 2 }, Bob: {} },
      gameScores: {},
    });
    const res = applyAuthoritativeSeriesRpcState(
      {
        tierNight: { runId: "R", series: { phase: "between", roundIndex: 0, scoredRoundIds: ["r1"] } },
        scores: { [A]: 4, [B]: 8 },
        playerStats: { [A]: { liesDetected: 1, tierConsensusPoints: 4 }, [B]: { tierConsensusPoints: 8 } },
      },
      { runId: "R", expectScoredRoundId: "r1" }
    );
    assert.equal(res.ok, true);
    const ps = getState().playerStats;
    assert.equal(ps[A], undefined, "pas de clé uid dans le téléphone");
    assert.equal(ps.Alice.liesDetected, 2);
    assert.equal(ps.Alice.tierConsensusPoints, 4);
    assert.equal(ps.Bob.tierConsensusPoints, 8);
    const badges = Object.fromEntries(getPlayerBadges().map((p) => [p.name, p.badge]));
    assert.equal(badges.Bob, "Esprit consensus");
    assert.equal(badges.Alice, "Le détective");

    bumpPlayerStat("Alice", "liesDetected", 3);
    const sent = __testEveningStateToRemote().playerStats[A];
    assert.equal(sent.liesDetected, 5);
    assert.equal(sent.tierConsensusPoints, 4);
  });

  it("anciennes clés uid du téléphone rangées sous le pseudo", () => {
    setLobby([ALICE, BOB], {
      playerStats: { Alice: { liesDetected: 5 }, [A]: { liesDetected: 1, tierConsensusPoints: 4 } },
    });
    saveStatePatch({ playerStats: { Alice: { liesDetected: 5 }, [A]: { liesDetected: 1, tierConsensusPoints: 4 } } });
    applyRemotePlayerStats({ [B]: { liesFooled: 1 } }, (uid) => (uid === A ? "Alice" : uid === B ? "Bob" : null));
    const ps = getState().playerStats;
    assert.equal(ps[A], undefined);
    assert.deepEqual({ l: ps.Alice.liesDetected, t: ps.Alice.tierConsensusPoints }, { l: 5, t: 4 });
  });
});
