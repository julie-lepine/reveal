import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  resumeBannerSessionKey,
  evaluateResumeBannerVisibility,
  shouldShowResumeBannerAfterDismiss,
  dismissResumeBannerForSession,
  clearResumeBannerDismiss,
  getResumeBannerDismissedKey,
  __resetResumeBannerDismissForTests,
} from "../js/core/resumeBannerDismiss.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("UX-RESUME-BANNER — dismiss game-select", () => {
  beforeEach(() => {
    __resetResumeBannerDismissForTests();
  });

  it("1. session reprenable initiale → bandeau visible", () => {
    assert.equal(
      shouldShowResumeBannerAfterDismiss({
        eligible: true,
        screen: "hottake",
        gameId: "hottake",
      }),
      true
    );
    assert.equal(getResumeBannerDismissedKey(), null);
  });

  it("2. Rester ici : dismiss activé → shouldShow faux", () => {
    dismissResumeBannerForSession("hottake", "hottake");
    assert.equal(getResumeBannerDismissedKey(), "game:hottake");
    assert.equal(
      shouldShowResumeBannerAfterDismiss({
        eligible: true,
        screen: "hottake",
        gameId: "hottake",
      }),
      false
    );
  });

  it("2b. stay conserve le contrat suppress (handler source)", () => {
    const src = readFileSync(join(root, "js/core/gameResume.js"), "utf8");
    const stay = src.slice(
      src.indexOf("export function stayOnGameResumeTarget"),
      src.indexOf("export function mountGameResumeInterstitial")
    );
    assert.match(stay, /suppressRoutingForScoreView\(\)/);
    assert.match(stay, /dismissResumeBannerForSession/);
  });

  it("2c. game-select demande un render immédiat après stay", () => {
    const src = readFileSync(join(root, "js/screens/gameSelect.js"), "utf8");
    assert.match(
      src,
      /stayOnGameResumeTarget\(resumeScreen\);\s*scheduleRender\(true\)/
    );
  });

  it("3. mutation state même partie (vote) : clé stable → bandeau masqué", () => {
    dismissResumeBannerForSession("hottake", "hottake");
    // Même gameId / écran malgré un state votes différent (non utilisé dans la clé).
    assert.equal(
      shouldShowResumeBannerAfterDismiss({
        eligible: true,
        screen: "hottake",
        gameId: "hottake",
      }),
      false
    );
    assert.equal(resumeBannerSessionKey("hottake", "hottake"), "game:hottake");
  });

  it("4. render répété / bundle : reste masqué", () => {
    dismissResumeBannerForSession("hottake", "hottake");
    for (let i = 0; i < 5; i += 1) {
      assert.equal(
        shouldShowResumeBannerAfterDismiss({
          eligible: true,
          screen: "hottake",
          gameId: "hottake",
        }),
        false
      );
    }
  });

  it("5. fin de session non reprenable → dismiss réinitialisé", () => {
    dismissResumeBannerForSession("hottake", "hottake");
    assert.equal(
      shouldShowResumeBannerAfterDismiss({
        eligible: false,
        screen: null,
        gameId: "hottake",
      }),
      false
    );
    assert.equal(getResumeBannerDismissedKey(), null);
  });

  it("6. nouvelle session après trou d’éligibilité → bandeau visible", () => {
    dismissResumeBannerForSession("hottake", "hottake");
    // results / post-game
    shouldShowResumeBannerAfterDismiss({ eligible: false, screen: null });
    assert.equal(getResumeBannerDismissedKey(), null);
    assert.equal(
      shouldShowResumeBannerAfterDismiss({
        eligible: true,
        screen: "hottake-prep",
        gameId: "hottake",
      }),
      true
    );
  });

  it("7. restart sans trou : changement d’identité (autre jeu) ne hérite pas du dismiss", () => {
    dismissResumeBannerForSession("hottake", "hottake");
    assert.equal(
      shouldShowResumeBannerAfterDismiss({
        eligible: true,
        screen: "dilemma-prep",
        gameId: "dilemma",
      }),
      true
    );
    assert.equal(getResumeBannerDismissedKey(), null);
  });

  it("7b. prep→play même gameId : dismiss conservé (même session)", () => {
    dismissResumeBannerForSession("hottake-prep", "hottake");
    assert.equal(
      shouldShowResumeBannerAfterDismiss({
        eligible: true,
        screen: "hottake",
        gameId: "hottake",
      }),
      false
    );
  });

  it("7c. evaluate pure : !eligible clear ; key change re-show", () => {
    assert.deepEqual(
      evaluateResumeBannerVisibility({
        eligible: false,
        currentKey: "game:hottake",
        dismissedKey: "game:hottake",
      }),
      { show: false, dismissedKey: null }
    );
    assert.deepEqual(
      evaluateResumeBannerVisibility({
        eligible: true,
        currentKey: "game:dilemma",
        dismissedKey: "game:hottake",
      }),
      { show: true, dismissedKey: null }
    );
  });

  it("8. Rejoindre clear dismiss (source)", () => {
    const src = readFileSync(join(root, "js/core/gameResume.js"), "utf8");
    const rejoin = src.slice(
      src.indexOf("export async function rejoinGameResumeTarget"),
      src.indexOf("export function stayOnGameResumeTarget")
    );
    assert.match(rejoin, /clearResumeBannerDismiss\(\)/);
    assert.match(rejoin, /clearSessionRouteSuppress\(\)/);
    assert.match(rejoin, /force:\s*true/);
  });

  it("9. clé non basée sur label / type seul sans gameId structure", () => {
    assert.equal(resumeBannerSessionKey("hottake", "hottake"), "game:hottake");
    assert.equal(resumeBannerSessionKey("hottake-prep", null), "family:hottake");
    assert.notEqual(resumeBannerSessionKey("hottake", "hottake"), "Hot Take");
    assert.notEqual(resumeBannerSessionKey("hottake", null), "hottake"); // préfixe family:
  });

  it("10. clear explicite + interstitial hors scope documenté", () => {
    dismissResumeBannerForSession("hottake", "hottake");
    clearResumeBannerDismiss();
    assert.equal(getResumeBannerDismissedKey(), null);

    const src = readFileSync(join(root, "js/core/gameResume.js"), "utf8");
    assert.match(src, /résidu.*game-resume-stay|interstitial.*hors scope/i);
  });

  it("preuve restart Recommencer passe par post-game (trou d’éligibilité)", () => {
    const src = readFileSync(join(root, "js/core/restartGame.js"), "utf8");
    assert.match(src, /POST_GAME_SCREENS\.has\(row\.screen\)/);
  });
});
