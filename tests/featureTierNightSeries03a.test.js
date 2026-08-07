/**
 * FEATURE-TIERNIGHT-SERIES-03A — placements, force, golden scoring, contrats SQL.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  validateTierNightSeriesPlacement,
  validateTierNightSeriesExpectedItems,
  selectTierNightSeriesForceParticipants,
} from "../js/core/tierNightSeriesPlacement.js";
import {
  buildTierNightSeriesGoldenFixtures,
  computeTierNightSeriesRoundScores,
  tierNightSeriesMedianRank,
  tierNightSeriesPointsForDiff,
} from "../js/core/tierNightSeriesScoreCompute.js";
import { medianTierRank } from "../js/core/tierNightScoring.js";
import { tierNightPointsForRankDiff, tierNightReversePointsForRankDiff } from "../data/eveningScoring.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SQL_03A = readFileSync(
  join(ROOT, "supabase/feature-tiernight-series-03a-finalize-round-hardening.sql"),
  "utf8"
);

function place(map) {
  const placed = { S: [], A: [], B: [], C: [], D: [] };
  for (const [item, tier] of Object.entries(map)) placed[tier].push(item);
  return placed;
}

const ITEMS = ["a", "b", "c"];

describe("FEATURE-TIERNIGHT-SERIES-03A - validate placement", () => {
  it("accepte un placement complet (tiers vides ok, ordre libre)", () => {
    const p = place({ a: "S", b: "D", c: "A" });
    assert.equal(validateTierNightSeriesPlacement(p, ITEMS).ok, true);
    const reordered = { D: ["b"], S: ["a"], A: ["c"], B: [], C: [] };
    assert.equal(validateTierNightSeriesPlacement(reordered, ITEMS).ok, true);
  });

  it("refuse item manquant / dupliqué / étranger / tier inconnu", () => {
    assert.equal(
      validateTierNightSeriesPlacement(place({ a: "S", b: "A" }), ITEMS).code,
      "TNS_PLACEMENT_MISSING_ITEM"
    );
    const dupSame = place({ a: "S", b: "A", c: "B" });
    dupSame.S.push("a");
    assert.equal(
      validateTierNightSeriesPlacement(dupSame, ITEMS).code,
      "TNS_PLACEMENT_DUPLICATE_ITEM"
    );
    const dupCross = place({ a: "S", b: "A", c: "B" });
    dupCross.A.push("a");
    assert.equal(
      validateTierNightSeriesPlacement(dupCross, ITEMS).code,
      "TNS_PLACEMENT_DUPLICATE_ITEM"
    );
    assert.equal(
      validateTierNightSeriesPlacement(place({ a: "S", b: "A", c: "B", x: "D" }), ITEMS)
        .code,
      "TNS_PLACEMENT_UNKNOWN_ITEM"
    );
    assert.equal(
      validateTierNightSeriesPlacement({ ...place({ a: "S", b: "A", c: "B" }), Z: [] }, ITEMS)
        .code,
      "TNS_PLACEMENT_UNKNOWN_TIER"
    );
  });

  it("refuse formes invalides", () => {
    assert.equal(validateTierNightSeriesPlacement(null, ITEMS).code, "TNS_PLACEMENT_NOT_OBJECT");
    assert.equal(
      validateTierNightSeriesPlacement({ S: "a", A: [], B: [], C: [], D: [] }, ITEMS).code,
      "TNS_PLACEMENT_TIER_NOT_ARRAY"
    );
    assert.equal(
      validateTierNightSeriesPlacement(
        { S: [1], A: ["b"], B: ["c"], C: [], D: [] },
        ITEMS
      ).code,
      "TNS_PLACEMENT_ITEM_NOT_TEXT"
    );
    assert.equal(
      validateTierNightSeriesExpectedItems(["a", "a"]).code,
      "TNS_ITEMS_DUPLICATE"
    );
  });
});

describe("FEATURE-TIERNIGHT-SERIES-03A - force participants", () => {
  const u1 = "11111111-1111-4111-8111-111111111111";
  const u2 = "22222222-2222-4222-8222-222222222222";
  const foreign = "99999999-9999-4999-8999-999999999999";
  const roster = [{ userId: u1 }, { userId: u2 }];
  const items = ITEMS;
  const full = place({ a: "S", b: "A", c: "B" });

  it("ignore finished hors roster", () => {
    const r = selectTierNightSeriesForceParticipants({
      roster,
      finished: { [foreign]: true },
      placements: { [foreign]: full },
      items,
    });
    assert.deepEqual(r.participants, []);
    assert.ok(r.foreignFinished.includes(foreign));
  });

  it("exclut placement sans finished", () => {
    const r = selectTierNightSeriesForceParticipants({
      roster,
      finished: { [u1]: true },
      placements: { [u1]: full, [u2]: full },
      items,
    });
    assert.deepEqual(r.participants, [u1]);
  });

  it("signale finished avec placement invalide", () => {
    const r = selectTierNightSeriesForceParticipants({
      roster,
      finished: { [u1]: true },
      placements: { [u1]: place({ a: "S" }) },
      items,
    });
    assert.equal(r.participants.length, 0);
    assert.equal(r.errors[0]?.code, "TNS_PLACEMENT_MISSING_ITEM");
  });

  it("score plusieurs finished valides", () => {
    const r = selectTierNightSeriesForceParticipants({
      roster,
      finished: { [u1]: true, [u2]: true },
      placements: { [u1]: full, [u2]: full },
      items,
    });
    assert.deepEqual(r.participants, [u1, u2]);
  });
});

describe("FEATURE-TIERNIGHT-SERIES-03A - golden scoring JS", () => {
  it("points_for_diff aligne eveningScoring", () => {
    for (const d of [0, 1, 2, 3, 4]) {
      assert.equal(tierNightSeriesPointsForDiff(d, false), tierNightPointsForRankDiff(d));
      assert.equal(tierNightSeriesPointsForDiff(d, true), tierNightReversePointsForRankDiff(d));
    }
  });

  it("médiane aligne medianTierRank", () => {
    assert.equal(tierNightSeriesMedianRank([0, 2, 4]), medianTierRank([0, 2, 4]));
    assert.equal(tierNightSeriesMedianRank([0, 4]), medianTierRank([0, 4]));
  });

  it("fixtures golden stables + ordre items invariant", () => {
    const fixtures = buildTierNightSeriesGoldenFixtures();
    assert.ok(fixtures.length >= 6);
    for (const f of fixtures) {
      assert.equal(f.expected.ok, true, f.id);
      assert.ok(Array.isArray(f.expected.scores), f.id);
    }
    const odd = fixtures.find((f) => f.id === "odd-median-exact");
    const order = fixtures.find((f) => f.id === "item-order-invariant");
    assert.deepEqual(
      odd.expected.scores.map((s) => s.consensusPoints),
      order.expected.scores.map((s) => s.consensusPoints)
    );
  });

  it("outsider tie attribue le bonus aux deux", () => {
    const f = buildTierNightSeriesGoldenFixtures().find((x) => x.id === "outsider-tie");
    const withBonus = f.expected.scores.filter((s) => s.outsiderBonus === 5);
    assert.ok(withBonus.length >= 2);
  });

  it("refuse absences silencieuses (pas de D implicite)", () => {
    const u1 = "11111111-1111-4111-8111-111111111111";
    const res = computeTierNightSeriesRoundScores({
      items: ITEMS,
      participantUids: [u1],
      placementsByUid: { [u1]: place({ a: "S", b: "A" }) },
    });
    assert.equal(res.ok, false);
    assert.equal(res.code, "TNS_PLACEMENT_MISSING_ITEM");
  });
});

describe("FEATURE-TIERNIGHT-SERIES-03A - contrats SQL / non-branchement", () => {
  it("SQL 03A contient validation, force strict, idempotence repositionnée, revoke anon", () => {
    assert.match(SQL_03A, /tiernight_series_validate_placement/);
    assert.match(SQL_03A, /tiernight_series_validate_series_shape/);
    assert.match(SQL_03A, /tiernight_series_compute_scores/);
    assert.match(SQL_03A, /TNS_PLACEMENT_MISSING_ITEM/);
    assert.match(SQL_03A, /tiernight_series_is_finished_flag/);
    assert.match(SQL_03A, /from anon/);
    assert.match(SQL_03A, /ALREADY_APPLIED/);
    assert.match(SQL_03A, /for update/i);
    // Idempotence après résolution roundId (ignorer commentaires d'en-tête)
    const resolveIdx = SQL_03A.indexOf("AVANT idempotence");
    const alreadyIdx = SQL_03A.indexOf("'ALREADY_APPLIED'", resolveIdx);
    assert.ok(resolveIdx > 0 && alreadyIdx > resolveIdx);
    assert.match(SQL_03A, /seriesCanon/);
    assert.match(SQL_03A, /roundHistory/);
  });

  it("RPC branchée via playSession (D), pas via select", () => {
    const play = readFileSync(join(ROOT, "js/core/tierNightSeriesPlaySession.js"), "utf8");
    assert.match(play, /commitTierNightSeriesRoundResult/);
    const select = readFileSync(join(ROOT, "js/screens/tierNightSelect.js"), "utf8");
    assert.equal(select.includes("commitTierNightSeriesRoundResult"), false);
  });

  it("eveningGamesRecorded documenté comme non-bloquant pour la RPC", () => {
    assert.match(SQL_03A, /n'empêche PAS cette RPC/);
  });
});
