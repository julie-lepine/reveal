/**
 * N°8 de l'audit : en multijoueur, l'hôte attend 3 s de plus après la fermeture
 * du bouton avant d'annoncer le verdict. Un invité reçoit la manche avec du retard
 * (jusqu'à 2-4 s sans connexion en direct) : son tap parfait pouvait arriver après
 * la clôture de l'hôte et être classé « pas tapé ».
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CLUTCH_GRACE_MS, CLUTCH_HOST_EXTRA_WAIT_MS } from "../data/clutch.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(ROOT, "js/games/clutch.js"), "utf8");

function fnBody(name) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start > 0, `${name} introuvable`);
  const end = src.indexOf("\n  }\n", start);
  return src.slice(start, end);
}

describe("Clutch : attente de l'hôte avant le verdict", () => {
  it("3 s de plus que la grâce, qui reste à 3 s pour les joueurs", () => {
    assert.equal(CLUTCH_HOST_EXTRA_WAIT_MS, 3000);
    assert.equal(CLUTCH_GRACE_MS, 3000);
  });

  it("fin de grâce : le bouton se ferme pour tous ; solo annonce tout de suite", () => {
    const grace = fnBody("onGraceElapsed");
    assert.match(grace, /localWindowClosed = true;\s*if \(!mp\) \{\s*void goToReveal\(\);\s*return;/);
  });

  it("multijoueur : l'annonce attend la fin de l'attente supplémentaire", () => {
    const grace = fnBody("onGraceElapsed");
    assert.match(grace, /hostWaitTimer = setTimeout\(onHostWaitElapsed, CLUTCH_HOST_EXTRA_WAIT_MS\);/);
    // Plus d'annonce directe en multijoueur à la fin de la grâce.
    const mpPart = grace.slice(grace.indexOf("if (!mp) {") + "if (!mp) {".length);
    assert.doesNotMatch(mpPart.slice(mpPart.indexOf("}") + 1), /goToReveal/);
  });

  it("fin de l'attente : l'hôte (ou son remplaçant) annonce le verdict", () => {
    const wait = fnBody("onHostWaitElapsed");
    assert.match(wait, /if \(phase !== "active"\) return;\s*hostWaitElapsed = true;\s*if \(canActAsHost\(\)\) void goToReveal\(\);/);
  });

  it("le minuteur est arrêté à la sortie de l'écran et remis à zéro à chaque manche", () => {
    assert.match(fnBody("clearGrace"), /if \(hostWaitTimer\) clearTimeout\(hostWaitTimer\);\s*hostWaitTimer = null;/);
    assert.match(fnBody("ensureRoundTiming"), /localWindowClosed = false;\s*hostWaitElapsed = false;/);
  });

  it("tout le monde a tapé : verdict sans attendre (inchangé)", () => {
    assert.match(src, /if \(allClutchTapsIn\(\) && canActAsHost\(\)\) void goToReveal\(\);/);
  });
});
