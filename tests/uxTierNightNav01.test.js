/**
 * UX-TIERNIGHT-NAV-01 - hiérarchie navigation TierNight (création + un seul retour).
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { returnToTierNightSelectStep } from "../js/core/tierNightNav.js";
import {
  initRouter,
  navigate,
  getCurrentScreen,
  getNavStack,
  getScreenParams,
  resetNav,
  registerScreen,
} from "../js/core/router.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

function read(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

function fakeApp() {
  return {
    innerHTML: "",
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
  };
}

describe("UX-TIERNIGHT-NAV-01 - source navigation", () => {
  it("création roster réussie → returnToTierNightSelectStep topic/roster", () => {
    const create = read("js/screens/tierNightCreateRoster.js");
    assert.match(create, /returnToTierNightSelectStep/);
    assert.match(create, /step:\s*"topic"/);
    assert.match(create, /mode:\s*"roster"/);
    assert.doesNotMatch(create, /navigate\(\s*["']tiernight-select["']\s*\)/);
    assert.match(create, /tiernight-roster-topics/);
  });

  it("échec création : pas de navigation (return avant returnTo)", () => {
    const create = read("js/screens/tierNightCreateRoster.js");
    const failBlock = create.match(/if \(!result\.ok\) \{[\s\S]*?return;[\s\S]*?\}/);
    assert.ok(failBlock);
    assert.doesNotMatch(failBlock[0], /returnToTierNightSelectStep/);
    assert.doesNotMatch(failBlock[0], /navigate\(/);
  });

  it("select : params step/mode + chevron classique unique selon niveau", () => {
    const select = read("js/screens/tierNightSelect.js");
    assert.match(select, /getScreenParams/);
    assert.match(select, /params\.step === "topic"/);
    assert.match(select, /backTarget:\s*onModeLevel \? "back" : "tiernight-modes"/);
    assert.match(select, /Classe le groupe · modes de jeu/);
    assert.match(select, /Rank live · modes de jeu/);
    assert.doesNotMatch(select, /btn-back-inline/);
    assert.doesNotMatch(select, /data-tier-back/);
  });

  it("création Rank Live : retour → list/live", () => {
    const create = read("js/screens/tierNightCreate.js");
    assert.match(create, /returnToTierNightSelectStep/);
    assert.match(create, /step:\s*"list"/);
    assert.match(create, /mode:\s*"live"/);
    assert.match(create, /tiernight-live-lists/);
  });

  it("pas de double contrôle retour (inline Modes retiré)", () => {
    const select = read("js/screens/tierNightSelect.js");
    assert.doesNotMatch(select, /btn-back-inline/);
    assert.match(select, /back:\s*true/);
    assert.match(select, /"tiernight-modes"/);
  });
});

describe("UX-TIERNIGHT-NAV-01 - returnToTierNightSelectStep comportement", () => {
  beforeEach(() => {
    globalThis.requestAnimationFrame = (fn) => {
      fn();
      return 1;
    };
    resetNav();
    initRouter(fakeApp());
    for (const id of [
      "home",
      "game-select",
      "tiernight-select",
      "tiernight-create-roster",
      "tiernight-create",
    ]) {
      registerScreen(id, () => null);
    }
  });

  it("après create-roster → select topic/roster sans create dans la pile", () => {
    navigate("home", { reset: true });
    navigate("game-select");
    navigate("tiernight-select");
    navigate("tiernight-create-roster");
    assert.equal(getCurrentScreen(), "tiernight-create-roster");

    returnToTierNightSelectStep({ step: "topic", mode: "roster" });

    assert.equal(getCurrentScreen(), "tiernight-select");
    assert.deepEqual(getScreenParams(), { step: "topic", mode: "roster" });
    assert.equal(getNavStack().includes("tiernight-create-roster"), false);
    assert.equal(getNavStack().at(-1), "tiernight-select");
  });

  it("après create live → select list/live", () => {
    navigate("home", { reset: true });
    navigate("game-select");
    navigate("tiernight-select");
    navigate("tiernight-create");

    returnToTierNightSelectStep({ step: "list", mode: "live" });

    assert.equal(getCurrentScreen(), "tiernight-select");
    assert.deepEqual(getScreenParams(), { step: "list", mode: "live" });
    assert.equal(getNavStack().includes("tiernight-create"), false);
  });

  it("ne saute pas au choix des modes (step reste topic)", () => {
    navigate("home", { reset: true });
    navigate("tiernight-create-roster");
    returnToTierNightSelectStep({ step: "topic", mode: "roster" });
    assert.equal(getScreenParams().step, "topic");
    assert.notEqual(getScreenParams().step, "mode");
  });
});
