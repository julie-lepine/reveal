/**
 * Recaps série sans emoji/color → réinjection du choix lobby du joueur.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  enrichTierNightRecapsWithPlayerMeta,
  TIER_NIGHT_RECAP_FALLBACK_EMOJI,
} from "../js/core/tierNightRecapMeta.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

function read(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

describe("tierNightRecapMeta - emoji joueur", () => {
  const players = [
    { userId: "u1", name: "Alice", emoji: "🦊", color: "#f00" },
    { userId: "u2", name: "Bob", emoji: "🎲", color: "#0f0" },
  ];

  it("résout par uid (chemin série SQL)", () => {
    const out = enrichTierNightRecapsWithPlayerMeta(
      [{ uid: "u1", player: "Alice", consensusPoints: 10 }],
      players
    );
    assert.equal(out[0].emoji, "🦊");
    assert.equal(out[0].color, "#f00");
  });

  it("résout par pseudo si pas d’uid", () => {
    const out = enrichTierNightRecapsWithPlayerMeta(
      [{ player: "Bob", consensusPoints: 5 }],
      players
    );
    assert.equal(out[0].emoji, "🎲");
  });

  it("conserve l’emoji déjà présent (classique)", () => {
    const out = enrichTierNightRecapsWithPlayerMeta(
      [{ player: "Alice", emoji: "⭐", color: "#fff", consensusPoints: 1 }],
      players
    );
    assert.equal(out[0].emoji, "⭐");
  });

  it("fallback si joueur inconnu", () => {
    const out = enrichTierNightRecapsWithPlayerMeta(
      [{ player: "Ghost", consensusPoints: 0 }],
      players
    );
    assert.equal(out[0].emoji, TIER_NIGHT_RECAP_FALLBACK_EMOJI);
  });

  it("end / between / getTierNightRecaps branchés", () => {
    const end = read("js/screens/tierNightEnd.js");
    const between = read("js/screens/tierNightBetween.js");
    const session = read("js/core/tierNightSession.js");
    assert.match(end, /escapeHtml\(r\.emoji/);
    assert.match(between, /enrichTierNightRecapsWithPlayerMeta/);
    assert.match(session, /enrichTierNightRecapsWithPlayerMeta\(getTierNightSession\(\)\.recaps/);
    assert.match(read("js/core/players.js"), /userId: p\.userId/);
  });
});
