/**
 * Estimations durée game-prep (jeux sans estimateur historique).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { estimateWrongAnswerDuration } from "../js/core/wrongAnswerDuration.js";
import { estimateClutchDuration } from "../js/core/clutchDuration.js";
import { estimateTruthMeterDuration } from "../js/core/truthMeterDuration.js";
import { estimateTraitreDuration } from "../js/core/traitreDuration.js";
import { estimateTierNightSeriesDuration } from "../js/core/tierNightSeriesDuration.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");

describe("prep duration estimates - Wrong Answer / Clutch", () => {
  it("Wrong Answer : ~90–150 s / manche", () => {
    assert.equal(estimateWrongAnswerDuration(0).label, "-");
    assert.equal(estimateWrongAnswerDuration(3).minSec, 270);
    assert.equal(estimateWrongAnswerDuration(3).maxSec, 450);
    assert.equal(estimateWrongAnswerDuration(3).label, "~5-8 min");
    assert.equal(estimateWrongAnswerDuration(5).label, "~8-13 min");
    assert.equal(estimateWrongAnswerDuration(8).label, "~12-20 min");
  });

  it("Clutch : timers produit + reveal", () => {
    assert.equal(estimateClutchDuration(0).label, "-");
    assert.equal(estimateClutchDuration(3).minSec, 84);
    assert.equal(estimateClutchDuration(3).maxSec, 153);
    assert.equal(estimateClutchDuration(3).label, "~1-3 min");
    assert.equal(estimateClutchDuration(5).label, "~2-4 min");
    assert.equal(estimateClutchDuration(8).label, "~4-7 min");
  });

  it("sessions exposent durationLabel réel (pas seulement « N manches »)", () => {
    assert.match(read("js/core/wrongAnswerSession.js"), /estimateWrongAnswerDuration/);
    assert.match(read("js/core/clutchSession.js"), /estimateClutchDuration/);
    assert.doesNotMatch(
      read("js/core/wrongAnswerSession.js"),
      /durationLabel:\s*`\$\{requested\} manche/
    );
    assert.doesNotMatch(
      read("js/core/clutchSession.js"),
      /durationLabel:\s*`\$\{requested\} manche/
    );
  });

  it("prep UI affiche estimation (pattern Hot Take)", () => {
    const wa = read("js/screens/wrongAnswerPrep.js");
    const clutch = read("js/screens/clutchPrep.js");
    assert.match(wa, /wronganswer-duration/);
    assert.match(wa, /\(estimation\)/);
    assert.match(clutch, /clutch-duration/);
    assert.match(clutch, /\(estimation\)/);
  });
});

describe("prep duration estimates - Rank Live / TruthMeter / Spot the fake", () => {
  it("Rank Live réutilise estimateTierNightSeriesDuration", () => {
    assert.match(
      read("js/core/tierNightLivePrepSession.js"),
      /estimateTierNightSeriesDuration/
    );
    assert.equal(estimateTierNightSeriesDuration(5).label, "~8-12 min");
    const live = read("js/screens/tierNightLivePrep.js");
    assert.match(live, /prep\.durationLabel/);
    assert.match(live, /hot-take-duration/);
    assert.match(live, /card-heading">Longueur de série/);
    assert.match(live, /card-heading">Catégories/);
    assert.match(live, /data-live-cat/);
    assert.match(live, /theme-chips theme-chips--rounds/);
    assert.doesNotMatch(live, /listes dans la série/);
    assert.doesNotMatch(live, /thèmes disponibles/);
    assert.match(live, /\(estimation\)/);
  });

  it("TruthMeter : ~70–100 s / joueur", () => {
    assert.equal(estimateTruthMeterDuration(0).label, "-");
    assert.equal(estimateTruthMeterDuration(3).minSec, 3 * 70);
    assert.equal(estimateTruthMeterDuration(3).maxSec, 3 * 100);
    assert.equal(estimateTruthMeterDuration(3).label, "~4-5 min");
    assert.equal(estimateTruthMeterDuration(5).label, "~6-8 min");
  });

  it("Spot the fake : fourchettes par taille de lobby", () => {
    assert.equal(estimateTraitreDuration(2).label, "-");
    assert.equal(estimateTraitreDuration(3).label, "~8-12 min");
    assert.equal(estimateTraitreDuration(5).label, "~12-18 min");
    assert.equal(estimateTraitreDuration(7).label, "~15-25 min");
  });

  it("prep TruthMeter / Traitre affichent l'estimation", () => {
    assert.match(read("js/screens/truthMeterPrep.js"), /estimateTruthMeterDuration/);
    assert.match(read("js/screens/truthMeterPrep.js"), /truth-meter-duration/);
    assert.match(read("js/screens/traitrePrep.js"), /estimateTraitreDuration/);
    assert.match(read("js/screens/traitrePrep.js"), /traitre-duration/);
  });
});
