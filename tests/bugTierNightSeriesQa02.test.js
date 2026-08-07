/**
 * BUG-TIERNIGHT-SERIES-QA-02 — outsider +5, between consensusPoints, fantômes UID.
 */
import { describe, it, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  EVENING_POINTS,
  TIER_NIGHT_OUTSIDER_BONUS,
} from "../data/eveningScoring.js";
import { computeTierNightSeriesRoundScores } from "../js/core/tierNightSeriesScoreCompute.js";
import {
  buildEveningStandingPlayers,
  collectEveningContributorNames,
  isDisplayableEveningContributorKey,
} from "../js/core/eveningStandings.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

function read(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

describe("BUG-TIERNIGHT-SERIES-QA-02 - outsider +5", () => {
  it("constante dédiée ; EVENING_POINTS.BONUS reste 15", () => {
    assert.equal(TIER_NIGHT_OUTSIDER_BONUS, 5);
    assert.equal(EVENING_POINTS.BONUS, 15);
    assert.equal(EVENING_POINTS.WIN, 10);
  });

  it("1. outsider : proximity 13 → bonus 5 → consensus 18", () => {
    const items = ["X", "Y", "Z"];
    const u1 = "11111111-1111-4111-8111-111111111111";
    const u2 = "22222222-2222-4222-8222-222222222222";
    // X spread : A=S B=B → outsider tie ; Y/Z consensus match → 15+15 ; X → 10 chacun
    const place = (map) => {
      const placed = { S: [], A: [], B: [], C: [], D: [] };
      for (const [item, tier] of Object.entries(map)) placed[tier].push(item);
      return placed;
    };
    const result = computeTierNightSeriesRoundScores({
      items,
      participantUids: [u1, u2],
      displayNames: { [u1]: "A", [u2]: "B" },
      placementsByUid: {
        [u1]: place({ X: "S", Y: "A", Z: "A" }),
        [u2]: place({ X: "B", Y: "A", Z: "A" }),
      },
    });
    assert.equal(result.ok, true);
    for (const r of result.recaps) {
      assert.equal(r.proximityPoints, 13);
      assert.equal(r.outsiderBonus, 5);
      assert.equal(r.consensusPoints, 18);
    }
  });

  it("2. non-outsider : bonus 0", () => {
    const items = ["X", "Y"];
    const u1 = "11111111-1111-4111-8111-111111111111";
    const u2 = "22222222-2222-4222-8222-222222222222";
    const place = (map) => {
      const placed = { S: [], A: [], B: [], C: [], D: [] };
      for (const [item, tier] of Object.entries(map)) placed[tier].push(item);
      return placed;
    };
    const result = computeTierNightSeriesRoundScores({
      items,
      participantUids: [u1, u2],
      displayNames: { [u1]: "A", [u2]: "B" },
      placementsByUid: {
        [u1]: place({ X: "A", Y: "A" }),
        [u2]: place({ X: "A", Y: "A" }),
      },
    });
    assert.equal(result.ok, true);
    for (const r of result.recaps) {
      assert.equal(r.outsiderBonus, 0);
      assert.equal(r.consensusPoints, r.proximityPoints);
    }
  });

  it("3. between affiche consensusPoints seulement", () => {
    const between = read("js/screens/tierNightBetween.js");
    assert.match(between, /Number\(r\.consensusPoints\) \|\| 0/);
    assert.doesNotMatch(
      between,
      /consensusPoints\) \|\| 0\) \+ \(Number\(r\.outsiderBonus\)/
    );
    assert.match(between, /dont \+\$\{outsider\} outsider/);
  });

  it("sources JS utilisent TIER_NIGHT_OUTSIDER_BONUS", () => {
    const series = read("js/core/tierNightSeriesScoreCompute.js");
    const session = read("js/core/tierNightSession.js");
    assert.match(series, /TIER_NIGHT_OUTSIDER_BONUS/);
    assert.match(session, /TIER_NIGHT_OUTSIDER_BONUS/);
    assert.doesNotMatch(series, /outsiderBonus = EVENING_POINTS\.BONUS/);
    assert.doesNotMatch(session, /outsiderBonus = EVENING_POINTS\.BONUS/);
  });

  it("SQL migration outsider 5 présente", () => {
    const sql = read("supabase/bug-tiernight-series-qa-02-outsider-bonus.sql");
    assert.match(sql, /to_jsonb\(5\)/);
    assert.match(sql, /proximityPoints'\)::int, 0\) \+ 5/);
    assert.doesNotMatch(sql, /outsiderBonus'\}, to_jsonb\(15\)/);
  });
});

describe("BUG-TIERNIGHT-SERIES-QA-02 - fantômes UID", () => {
  it("isDisplayableEveningContributorKey exclut alias UID→pseudo", () => {
    const resolve = (k) => (k === "uid-a" ? "Alice" : k === "Alice" ? "Alice" : null);
    assert.equal(isDisplayableEveningContributorKey("uid-a", resolve), false);
    assert.equal(isDisplayableEveningContributorKey("Alice", resolve), true);
    assert.equal(isDisplayableEveningContributorKey("Bob", resolve), true);
  });

  it("collectEveningContributorNames ignore clés techniques", () => {
    const resolve = (k) => (k.startsWith("uid-") ? k.replace("uid-", "") : k);
    const names = collectEveningContributorNames({
      gameScores: {
        tiernight: { Alice: 18, "uid-Alice": 18, Bob: 10 },
      },
      resolveDisplayName: resolve,
    });
    assert.equal(names.has("Alice"), true);
    assert.equal(names.has("Bob"), true);
    assert.equal(names.has("uid-Alice"), false);
  });

  it("buildEveningStandingPlayers : 2 actifs + pas d’UID", () => {
    const resolve = (k) =>
      k === "1c2146d8-f372-4efc-b265-4b02eed118f5" ? "Joulaille YOUHOU" : k;
    const players = buildEveningStandingPlayers({
      activePlayers: [
        { name: "Joulaille YOUHOU", emoji: "🦊", color: "#f00" },
        { name: "Joulaille____", emoji: "🎲", color: "#0f0" },
      ],
      gameScores: {
        tiernight: {
          "Joulaille YOUHOU": 18,
          "Joulaille____": 18,
          "1c2146d8-f372-4efc-b265-4b02eed118f5": 18,
        },
      },
      resolveDisplayName: resolve,
    });
    assert.equal(players.length, 2);
    assert.ok(players.every((p) => !p.name.includes("-")));
  });

  it("apply finalize / merge : helpers exportés", () => {
    const sync = read("js/core/gameSync.js");
    const play = read("js/core/tierNightSeriesPlaySession.js");
    assert.match(sync, /export function mergeRemoteGameScoresIntoLocal/);
    assert.match(sync, /export function pruneUidAliasKeysFromScoreMap/);
    assert.match(play, /mergeRemoteGameScoresIntoLocal/);
    assert.doesNotMatch(play, /patch\.gameScores = rpcState\.gameScores/);
  });

  it("joueur historique légitime conservé", () => {
    const players = buildEveningStandingPlayers({
      activePlayers: [{ name: "Alice", emoji: "A", color: "#f00" }],
      scores: { Alice: 10, Charlie: 20 },
      gameScores: { tiernight: { Alice: 10, Charlie: 20 } },
      resolveDisplayName: (k) => k,
    });
    assert.equal(players.some((p) => p.name === "Charlie" && p.historical), true);
  });
});
