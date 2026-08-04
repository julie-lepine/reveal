import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  TIER_NIGHT_MODES,
  DEFAULT_TIER_NIGHT_MODE,
  normalizeTierNightMode,
  getTierNightModeById,
} from "../data/tierTopics.js";
import { tierNightConfigPatchFromRemoteState } from "../js/core/tierNightConfig.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("TierNight - suppression Rank it (consensus)", () => {
  it("TIER_NIGHT_MODES ne contient plus consensus / Rank it", () => {
    assert.equal(
      TIER_NIGHT_MODES.some((m) => m.id === "consensus"),
      false
    );
    assert.deepEqual(
      TIER_NIGHT_MODES.map((m) => m.id).sort(),
      ["live", "roster"]
    );
  });

  it("mode par défaut = roster", () => {
    assert.equal(DEFAULT_TIER_NIGHT_MODE, "roster");
    assert.equal(getTierNightModeById("consensus").id, "roster");
  });

  it("normalizeTierNightMode : consensus → roster ; live inchangé", () => {
    assert.equal(normalizeTierNightMode("consensus"), "roster");
    assert.equal(normalizeTierNightMode(null), "roster");
    assert.equal(normalizeTierNightMode("live"), "live");
    assert.equal(normalizeTierNightMode("roster"), "roster");
  });

  it("select UI : pas de carte consensus, pas de chips modifiers Rank it", () => {
    const select = readFileSync(join(root, "js/screens/tierNightSelect.js"), "utf8");
    assert.equal(select.includes('data-mode="consensus"'), false);
    assert.equal(select.includes("Rank it"), false);
    assert.equal(select.includes("renderModifierChips"), false);
    assert.equal(select.includes("TIER_NIGHT_MODIFIERS"), false);
    assert.match(select, /Classe le groupe/);
    assert.match(select, /Rank live/);
  });

  it("création de liste → pipeline live (pas consensus / pas plateau)", () => {
    const create = readFileSync(join(root, "js/screens/tierNightCreate.js"), "utf8");
    assert.match(create, /setTierNightMode\("live"\)/);
    assert.match(create, /markTierNightLiveLobbyStarted/);
    assert.match(create, /tiernight-live/);
    assert.equal(create.includes('setTierNightMode("consensus")'), false);
    assert.equal(create.includes('navigate("tiernight")'), false);
  });

  it("launchTierNightSelect reset en roster", () => {
    const restart = readFileSync(join(root, "js/core/restartGame.js"), "utf8");
    assert.match(restart, /tierNightMode:\s*"roster"/);
    assert.match(restart, /mode:\s*"roster"/);
    assert.equal(/tierNightMode:\s*"consensus"/.test(restart), false);
  });

  it("patch distant mode consensus → roster", () => {
    const patch = tierNightConfigPatchFromRemoteState({
      tierNight: { mode: "consensus", topicId: "x" },
    });
    assert.equal(patch.tierNightMode, "roster");
  });

  it("noms produit : Classe le groupe + Rank live", () => {
    const roster = TIER_NIGHT_MODES.find((m) => m.id === "roster");
    const live = TIER_NIGHT_MODES.find((m) => m.id === "live");
    assert.equal(roster.name, "Classe le groupe");
    assert.equal(live.name, "Rank live");
  });
});
