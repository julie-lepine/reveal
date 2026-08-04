/**
 * Contrats vague 2 - suppression Fil Rouge dans gameSync / state / data/filRouge.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getState, stripLegacyFilRougeKeys } from "../js/core/state.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function read(rel) {
  return readFileSync(join(root, rel), "utf8");
}

function walkJsFiles(dir, out = []) {
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, name.name);
    if (name.isDirectory()) {
      if (
        name.name === "node_modules" ||
        name.name === "www" ||
        name.name === "android" ||
        name.name === "ios"
      ) {
        continue;
      }
      walkJsFiles(p, out);
    } else if (name.name.endsWith(".js") || name.name.endsWith(".mjs")) {
      out.push(p);
    }
  }
  return out;
}

const EVENING_STATE_KEYS_EXPECTED = [
  "scores",
  "playerStats",
  "gameScores",
  "gameScoreOrder",
  "gameScoreSessionBaseline",
  "gameScoreSessionGameId",
  "eveningGamesRecorded",
  "stats",
  "lastGame",
  "lastTierName",
];

const GAME_PLAY_STATE_KEYS_EXPECTED = [
  "hotTake",
  "speedVote",
  "clutch",
  "wrongAnswer",
  "traitre",
  "trivia",
  "truthMeter",
  "consensus",
  "dilemma",
  "guessLie",
  "tierNight",
  "tierNightLive",
];

describe("fil rouge vague 2 - sync / state", () => {
  it("data/filRouge.js est supprimé", () => {
    assert.equal(existsSync(join(root, "data/filRouge.js")), false);
  });

  it("aucun fichier runtime JS hors tests ne référence FIL_ROUGE_ENABLED", () => {
    const offenders = [];
    for (const file of walkJsFiles(join(root, "js")).concat(walkJsFiles(join(root, "data")))) {
      const src = readFileSync(file, "utf8");
      if (src.includes("FIL_ROUGE_ENABLED")) offenders.push(file);
    }
    assert.deepEqual(offenders, []);
  });

  it("gameSync.js ne contient plus de branches / helpers Fil Rouge", () => {
    const sync = read("js/core/gameSync.js");
    for (const needle of [
      "FIL_ROUGE",
      "filRouge",
      "FilRouge",
      "filrouge",
      "syncFilRougeSession",
      "refreshFilRougeFromSession",
      "getFilRougeResumeScreen",
      "applyRemoteFilRougeScores",
      "filRougeToRemote",
      "filRougeFromRemote",
      "mergeFilRouge",
      "filRougePreserve",
      "delete st.filRouge",
    ]) {
      assert.equal(sync.includes(needle), false, `résidu gameSync: ${needle}`);
    }
  });

  it("état initial et helpers Fil Rouge absents de state.js", () => {
    const st = getState();
    assert.equal(Object.hasOwn(st, "filRougeScores"), false);
    assert.equal(Object.hasOwn(st, "filRougeGame"), false);
    assert.equal(Object.hasOwn(st, "filRouge"), false);

    const src = read("js/core/state.js");
    assert.equal(src.includes("addFilRougeScore"), false);
    assert.equal(src.includes("getFilRougeScores"), false);
    assert.equal(src.includes("filRougeMissionsValidated: 0"), false);
    assert.equal(/filRougeScores:\s*\{\}/.test(src), false);
    assert.equal(/filRougeGame:\s*\{/.test(src), false);
  });

  it("stripLegacyFilRougeKeys : contrats de nettoyage load", () => {
    const src = read("js/core/state.js");
    const loadIdx = src.indexOf("function loadState()");
    const stripCallIdx = src.indexOf("const cleaned = stripLegacyFilRougeKeys(merged);");
    const returnIdx = src.indexOf("return cleaned;", loadIdx);
    assert.ok(loadIdx >= 0);
    assert.ok(stripCallIdx > loadIdx, "strip doit être dans loadState");
    assert.ok(returnIdx > stripCallIdx, "strip avant return du state courant");

    const aliceStats = {
      hotTakeWins: 2,
      clutchWins: 1,
      filRougeMissionsValidated: 4,
      badges: ["mvp"],
    };
    const bobStats = { hotTakeWins: 0, speedVotesPlayed: 3 };
    const legacy = {
      scores: { Alice: 10, Bob: 7 },
      filRougeScores: { Alice: 50 },
      filRougeGame: { status: "active", submissions: { u1: true } },
      playerStats: {
        Alice: aliceStats,
        Bob: bobStats,
      },
      gameScores: { clutch: { Alice: 5, Bob: 2 } },
      stats: { hotTakesPlayed: 9 },
      lastGame: { gameId: "clutch", at: 1 },
    };
    const before = structuredClone(legacy);

    const stripped = stripLegacyFilRougeKeys(legacy);

    assert.notEqual(stripped, legacy, "copie quand des clés Fil Rouge sont présentes");
    assert.deepEqual(legacy, before, "source non mutée (top-level + nested)");
    assert.equal(legacy.playerStats.Alice, aliceStats);
    assert.equal(aliceStats.filRougeMissionsValidated, 4);

    assert.equal(Object.hasOwn(stripped, "filRougeScores"), false);
    assert.equal(Object.hasOwn(stripped, "filRougeGame"), false);
    assert.equal(Object.hasOwn(stripped.playerStats.Alice, "filRougeMissionsValidated"), false);
    assert.deepEqual(stripped.playerStats.Alice, {
      hotTakeWins: 2,
      clutchWins: 1,
      badges: ["mvp"],
    });
    assert.equal(stripped.playerStats.Bob, bobStats);
    assert.deepEqual(stripped.playerStats.Bob, { hotTakeWins: 0, speedVotesPlayed: 3 });
    assert.deepEqual(stripped.scores, { Alice: 10, Bob: 7 });
    assert.deepEqual(stripped.gameScores, { clutch: { Alice: 5, Bob: 2 } });
    assert.deepEqual(stripped.stats, { hotTakesPlayed: 9 });
    assert.deepEqual(stripped.lastGame, { gameId: "clutch", at: 1 });
    assert.ok(Object.hasOwn(stripped.playerStats, "Alice"));
    assert.ok(Object.hasOwn(stripped.playerStats, "Bob"));
  });

  it("stripLegacyFilRougeKeys : no-op sans clés Fil Rouge (pas de structure vide)", () => {
    const clean = {
      scores: { Alice: 1 },
      playerStats: { Alice: { hotTakeWins: 1 } },
    };
    assert.equal(stripLegacyFilRougeKeys(clean), clean);
    assert.equal(stripLegacyFilRougeKeys(null), null);
    const noStats = { scores: { Alice: 1 }, filRougeScores: { Alice: 9 } };
    const out = stripLegacyFilRougeKeys(noStats);
    assert.equal(Object.hasOwn(out, "playerStats"), false);
    assert.equal(Object.hasOwn(out, "filRougeScores"), false);
    assert.deepEqual(out.scores, { Alice: 1 });
  });

  it("clés de soirée et play state gameSync restent stables (hors Fil Rouge)", () => {
    const sync = read("js/core/gameSync.js");
    const eveningMatch = sync.match(/const EVENING_STATE_KEYS = new Set\(\[([\s\S]*?)\]\);/);
    const playMatch = sync.match(/const GAME_PLAY_STATE_KEYS = new Set\(\[([\s\S]*?)\]\);/);
    assert.ok(eveningMatch, "EVENING_STATE_KEYS manquant");
    assert.ok(playMatch, "GAME_PLAY_STATE_KEYS manquant");
    const parseKeys = (block) =>
      [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(parseKeys(eveningMatch[1]), EVENING_STATE_KEYS_EXPECTED);
    assert.deepEqual(parseKeys(playMatch[1]), GAME_PLAY_STATE_KEYS_EXPECTED);
    assert.ok(sync.includes("...eveningStateToRemote()"));
    assert.equal(sync.includes("filRougePreserve"), false);
  });
});
