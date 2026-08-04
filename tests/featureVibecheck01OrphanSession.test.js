/**
 * FEATURE-VIBECHECK-01 — session orpheline playlistguess / écran non enregistré.
 * - contrat source (guards gameSync + isScreenRegistered)
 * - comportement router (navigate refuse l'écran absent)
 * - miroir local des guards (sans importer gameSync — graphe ESM https)
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { isScreenRegistered } from "../js/core/router.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const syncSrc = readFileSync(join(__dirname, "../js/core/gameSync.js"), "utf8");
const routerSrc = readFileSync(join(__dirname, "../js/core/router.js"), "utf8");

const MENU = new Set(["home", "lobby", "game-select", "settings"]);
const POST = new Set(["results", "leaderboard"]);
const SETUP = new Set([
  "traitre-prep",
  "hottake-prep",
  "speedvote-prep",
  "trivia-prep",
  "truthmeter-prep",
  "consensus-prep",
  "dilemma-prep",
  "clutch-prep",
  "wronganswer-prep",
  "guesslie-menu",
  "guesslie-setup",
  "guesslie-wait",
  "tiernight-select",
  "tiernight-create",
  "tiernight-create-roster",
]);

/** Miroir des guards post FEATURE-VIBECHECK-01 (enregistrement d'écran requis). */
function mirrorIsSessionInProgressPlay(screen, registered) {
  if (!screen || MENU.has(screen) || POST.has(screen)) return false;
  if (SETUP.has(screen)) return false;
  if (!registered.has(screen)) return false;
  return true;
}

function mirrorIsActive(screen, registered) {
  if (!screen || MENU.has(screen) || POST.has(screen)) return false;
  if (!registered.has(screen)) return false;
  return true;
}

function mirrorRouteTarget(screen, registered) {
  if (!screen) return null;
  return registered.has(screen) || screen === "lobby" ? screen : "game-select";
}

describe("FEATURE-VIBECHECK-01 orphan screens — source", () => {
  it("exporte isScreenRegistered", () => {
    assert.match(routerSrc, /export function isScreenRegistered/);
  });

  it("isSessionInProgressPlay refuse les écrans non enregistrés", () => {
    assert.match(
      syncSrc,
      /export function isSessionInProgressPlay[\s\S]*?if \(!isScreenRegistered\(screen\)\) return false;/
    );
  });

  it("isActiveGameSessionScreen refuse les écrans non enregistrés", () => {
    assert.match(
      syncSrc,
      /export function isActiveGameSessionScreen[\s\S]*?if \(!isScreenRegistered\(screen\)\) return false;/
    );
  });

  it("routeToSessionScreen retombe sur game-select si non enregistré", () => {
    assert.match(
      syncSrc,
      /isScreenRegistered\(screen\) \|\| screen === "lobby" \? screen : "game-select"/
    );
  });

  it("plus de mapping playlistguess dans RESTARTABLE / SESSION_GAME_ID_TO_TILE / GAME_SETUP", () => {
    assert.doesNotMatch(syncSrc, /"playlistguess"/);
    assert.doesNotMatch(syncSrc, /playlistguess-prep/);
    assert.doesNotMatch(syncSrc, /playlistGuess/);
  });
});

describe("FEATURE-VIBECHECK-01 orphan screens — miroir", () => {
  const registered = new Set(["home", "lobby", "game-select", "hottake"]);

  it("playlistguess n'est pas play / actif / reprenable", () => {
    assert.equal(mirrorIsSessionInProgressPlay("playlistguess", registered), false);
    assert.equal(mirrorIsSessionInProgressPlay("playlistguess-prep", registered), false);
    assert.equal(mirrorIsActive("playlistguess", registered), false);
    assert.equal(
      mirrorIsSessionInProgressPlay("playlistguess", registered) ||
        SETUP.has("playlistguess-prep"),
      false
    );
  });

  it("route cible game-select pour orphelin", () => {
    assert.equal(mirrorRouteTarget("playlistguess", registered), "game-select");
    assert.equal(mirrorRouteTarget("hottake", registered), "hottake");
  });
});

describe("FEATURE-VIBECHECK-01 orphan screens — router (sans mount DOM)", () => {
  it("isScreenRegistered refuse playlistguess sans initRouter", () => {
    // Pas d'enregistrement de ces ids dans main.js → false même après boot.
    assert.equal(isScreenRegistered("playlistguess"), false);
    assert.equal(isScreenRegistered("playlistguess-prep"), false);
  });
});
