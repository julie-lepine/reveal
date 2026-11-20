/**
 * Clutch, hôte qui quitte en pleine manche : le remplaçant automatique n'est désigné
 * qu'après ~2 min d'absence. Pendant ce temps, les invités voyaient seulement
 * « Temps écoulé - en attente du verdict… ». Désormais, 15 s après la fin du temps
 * de tap sans verdict, ils sont prévenus que l'hôte ne répond plus.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CLUTCH_HOST_SILENT_AFTER_MS } from "../data/clutch.js";
import { CLUTCH_HOST_SILENT_LABEL } from "../js/core/clutchTapCommit.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(ROOT, "js/games/clutch.js"), "utf8");

function fnBody(name) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start > 0, `${name} introuvable`);
  return src.slice(start, src.indexOf("\n  }\n", start));
}

describe("Clutch : invités prévenus quand l'hôte ne répond plus", () => {
  it("délai et texte", () => {
    assert.equal(CLUTCH_HOST_SILENT_AFTER_MS, 15000);
    assert.equal(
      CLUTCH_HOST_SILENT_LABEL,
      "L’hôte ne répond plus… la partie reprendra toute seule s’il ne revient pas."
    );
  });

  it("le minuteur démarre à la fin du temps de tap, en multijoueur", () => {
    const grace = fnBody("onGraceElapsed");
    const mpPart = grace.slice(grace.indexOf("if (!mp) {"));
    assert.match(mpPart, /hostSilentTimer = setTimeout\(onHostSilent, CLUTCH_HOST_SILENT_AFTER_MS\);/);
  });

  it("à l'échéance, seule la phrase est mise à jour (pas de re-rendu complet)", () => {
    const silent = fnBody("onHostSilent");
    assert.match(silent, /if \(phase !== "active"\) return;\s*hostSilent = true;\s*refreshActiveLive\(\);/);
  });

  it("message réservé aux invités, prioritaire sur « Temps écoulé »", () => {
    const text = fnBody("activeStatusText");
    const silentAt = text.indexOf("hostSilent && mp && !canActAsHost()");
    const elapsedAt = text.indexOf('"Temps écoulé - en attente du verdict…"');
    assert.ok(silentAt > 0 && elapsedAt > silentAt);
    assert.match(text, /hostSilent && mp && !canActAsHost\(\)\s*\?\s*CLUTCH_HOST_SILENT_LABEL/);
  });

  it("remis à zéro à chaque manche, arrêté à la sortie de l'écran", () => {
    assert.match(fnBody("ensureRoundTiming"), /hostWaitElapsed = false;\s*hostSilent = false;/);
    assert.match(fnBody("clearGrace"), /if \(hostSilentTimer\) clearTimeout\(hostSilentTimer\);\s*hostSilentTimer = null;/);
  });
});
