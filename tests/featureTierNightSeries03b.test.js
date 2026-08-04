/**
 * FEATURE-TIERNIGHT-SERIES-03B — customs wire, moteur unique, finished strict.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CUSTOM_ROSTER_TOPIC_ID_PREFIX,
  createCustomRosterTopicId,
} from "../js/core/customRosterTopics.js";
import { ROSTER_TOPIC_PREFIX, parseRosterTopicDescriptor } from "../js/core/rosterTopic.js";
import { validateTierNightSeries } from "../js/core/tierNightSeries.js";
import {
  validateTierNightSeriesFinished,
  isTierNightSeriesFinishedFlag,
  selectTierNightSeriesForceParticipants,
  validateTierNightSeriesPlacement,
} from "../js/core/tierNightSeriesPlacement.js";
import {
  buildTierNightSeriesGoldenFixtures,
  computeTierNightSeriesRoundScores,
} from "../js/core/tierNightSeriesScoreCompute.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SQL = readFileSync(
  join(ROOT, "supabase/feature-tiernight-series-03a-finalize-round-hardening.sql"),
  "utf8"
);

function extractFinalizeBody(sql) {
  const start = sql.indexOf(
    "create or replace function public.finalize_tiernight_series_round"
  );
  const end = sql.indexOf("-- Permissions", start);
  assert.ok(start >= 0 && end > start);
  return sql.slice(start, end);
}

function place(map) {
  const placed = { S: [], A: [], B: [], C: [], D: [] };
  for (const [item, tier] of Object.entries(map)) placed[tier].push(item);
  return placed;
}

function minimalSeries({ topicId, snapCustom = false, snapId = null } = {}) {
  const runId = "run-03b";
  const rawId = snapId ?? topicId.replace(/^roster:/, "");
  const queue = [0, 1, 2].map((i) => ({
    roundId: `${runId}:${i}`,
    roundIndex: i,
    topicId: i === 0 ? topicId : `roster:catalog-${i}`,
    topicSnapshot: {
      id: i === 0 ? rawId : `catalog-${i}`,
      name: `Theme ${i}`,
      emoji: "x",
      categoryId: "survival",
      ...(snapCustom ? { custom: true } : { custom: false }),
    },
  }));
  return {
    version: 1,
    categoryIds: ["survival"],
    roundCount: 3,
    queue,
    roundIndex: 0,
    phase: "ranking",
    scoredRoundIds: [],
    completedRoundIds: [],
  };
}

describe("FEATURE-TIERNIGHT-SERIES-03B - préfixe custom réel", () => {
  it("cite le contrat runtime custom-roster- / roster:", () => {
    assert.equal(CUSTOM_ROSTER_TOPIC_ID_PREFIX, "custom-roster-");
    assert.equal(ROSTER_TOPIC_PREFIX, "roster:");
    const id = createCustomRosterTopicId();
    assert.ok(id.startsWith("custom-roster-"));
    const wire = parseRosterTopicDescriptor(id).topicId;
    assert.equal(wire, `${ROSTER_TOPIC_PREFIX}${id}`);
    assert.match(wire, /^roster:custom-roster-/);
    assert.equal(wire.startsWith("roster:custom:"), false);
  });

  it("SQL rejette roster:custom-roster- (pas roster:custom:)", () => {
    assert.match(SQL, /custom-roster-/);
    assert.match(SQL, /position\('custom-roster-' in v_raw_id\) = 1/);
    // l'ancien préfixe théorique ne doit plus être le critère actif
    assert.equal(/position\('roster:custom:' in v_topic_id\)/.test(SQL), false);
  });

  it("vrai wire custom rejeté par validateTierNightSeries JS", () => {
    const raw = createCustomRosterTopicId();
    const wire = `${ROSTER_TOPIC_PREFIX}${raw}`;
    const series = minimalSeries({ topicId: wire, snapId: raw, snapCustom: false });
    const res = validateTierNightSeries(series, { runId: "run-03b" });
    assert.equal(res.ok, false);
    assert.equal(res.code, "CUSTOM_IN_SERIES_QUEUE");
  });

  it("custom avec snapshot.custom=false toujours rejeté (wire)", () => {
    const raw = createCustomRosterTopicId();
    const wire = `${ROSTER_TOPIC_PREFIX}${raw}`;
    const series = minimalSeries({ topicId: wire, snapId: raw, snapCustom: false });
    assert.equal(series.queue[0].topicSnapshot.custom, false);
    const res = validateTierNightSeries(series, { runId: "run-03b" });
    assert.equal(res.ok, false);
    assert.equal(res.code, "CUSTOM_IN_SERIES_QUEUE");
  });

  it("thème catalogue accepté", () => {
    const series = minimalSeries({
      topicId: "roster:catalog-0",
      snapId: "catalog-0",
      snapCustom: false,
    });
    // queue entries 1,2 also catalog-* — ok for shape
    const res = validateTierNightSeries(series, { runId: "run-03b" });
    assert.equal(res.ok, true);
  });
});

describe("FEATURE-TIERNIGHT-SERIES-03B - moteur SQL canonique unique", () => {
  it("RPC appelle compute_scores une fois et n’inline pas median/points", () => {
    const body = extractFinalizeBody(SQL);
    assert.equal(
      (body.match(/tiernight_series_compute_scores\(/g) || []).length,
      1
    );
    assert.equal((body.match(/tiernight_series_median_rank\(/g) || []).length, 0);
    assert.equal((body.match(/tiernight_series_points_for_diff\(/g) || []).length, 0);
    assert.match(body, /Moteur canonique UNIQUE/);
  });

  it("les 7 fixtures golden passent sur le moteur JS (même contrat que SQL helper)", () => {
    const fixtures = buildTierNightSeriesGoldenFixtures();
    assert.equal(fixtures.length, 7);
    for (const f of fixtures) {
      const again = computeTierNightSeriesRoundScores({
        items: f.items,
        placementsByUid: f.placementsByUid,
        participantUids: f.participantUids,
        reverse: f.reverse,
      });
      assert.equal(again.ok, true, f.id);
      assert.deepEqual(
        again.recaps.map((r) => ({
          uid: r.uid,
          proximityPoints: r.proximityPoints,
          outsiderBonus: r.outsiderBonus,
          consensusPoints: r.consensusPoints,
        })),
        f.expected.scores,
        f.id
      );
    }
  });
});

describe("FEATURE-TIERNIGHT-SERIES-03B - finished strict", () => {
  const u1 = "11111111-1111-4111-8111-111111111111";
  const u2 = "22222222-2222-4222-8222-222222222222";
  const foreign = "99999999-9999-4999-8999-999999999999";
  const roster = [{ userId: u1 }, { userId: u2 }];
  const items = ["a", "b"];
  const full = place({ a: "S", b: "A" });

  it("true / false / absent", () => {
    assert.equal(validateTierNightSeriesFinished({ [u1]: true }, roster).ok, true);
    assert.equal(validateTierNightSeriesFinished({ [u1]: false }, roster).ok, true);
    assert.equal(validateTierNightSeriesFinished({}, roster).ok, true);
    assert.equal(isTierNightSeriesFinishedFlag({ [u1]: true }, u1), true);
    assert.equal(isTierNightSeriesFinishedFlag({ [u1]: false }, u1), false);
    assert.equal(isTierNightSeriesFinishedFlag({}, u1), false);
  });

  it("chaîne / nombre / objet → TNS_FINISHED_INVALID_VALUE", () => {
    assert.equal(
      validateTierNightSeriesFinished({ [u1]: "true" }, roster).code,
      "TNS_FINISHED_INVALID_VALUE"
    );
    assert.equal(
      validateTierNightSeriesFinished({ [u1]: 1 }, roster).code,
      "TNS_FINISHED_INVALID_VALUE"
    );
    assert.equal(
      validateTierNightSeriesFinished({ [u1]: {} }, roster).code,
      "TNS_FINISHED_INVALID_VALUE"
    );
  });

  it("clé étrangère true seule → aucun participant force", () => {
    const r = selectTierNightSeriesForceParticipants({
      roster,
      finished: { [foreign]: true },
      placements: { [foreign]: full },
      items,
    });
    assert.deepEqual(r.participants, []);
    assert.ok(r.foreignFinished.includes(foreign));
  });

  it("SQL expose validate_finished", () => {
    assert.match(SQL, /tiernight_series_validate_finished/);
    assert.match(SQL, /TNS_FINISHED_INVALID_VALUE/);
  });

  it("force avec un roster finished valide", () => {
    const r = selectTierNightSeriesForceParticipants({
      roster,
      finished: { [u1]: true, [u2]: false },
      placements: { [u1]: full, [u2]: full },
      items,
    });
    assert.deepEqual(r.participants, [u1]);
  });
});

describe("FEATURE-TIERNIGHT-SERIES-03B - non-branchement", () => {
  it("RPC non branchée gameplay", () => {
    for (const rel of [
      "js/core/gameSync.js",
      "js/games/tierNight.js",
      "js/screens/tierNightSelect.js",
      "js/screens/tierNightEnd.js",
    ]) {
      const src = readFileSync(join(ROOT, rel), "utf8");
      assert.equal(src.includes("commitTierNightSeriesRoundResult"), false, rel);
    }
  });
});
