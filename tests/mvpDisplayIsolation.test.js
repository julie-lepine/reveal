import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { sortAndRankByScore } from "../js/core/competitionRank.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Miroir exact de resolveFallbackBadge (badges.js) - hors import pour éviter Supabase. */
function resolveFallbackBadge(index, total, hasStatBadge) {
  if (hasStatBadge) return "";
  if (index === 0) return "MVP de la soirée";
  if (total > 1 && index === total - 1) return "En progression";
  return "";
}

/** Miroir getSortedActivePlayers : score seul, pas de localeCompare. */
function sortByScoreOnly(players, scores) {
  return [...players].sort(
    (a, b) => (scores[b.name] || 0) - (scores[a.name] || 0)
  );
}

function assignFallbackBadges(sorted) {
  return sorted.map((p, index) => ({
    ...p,
    score: p.score,
    badge: resolveFallbackBadge(index, sorted.length, false),
  }));
}

describe("MVP isolé du tri d’affichage", () => {
  it("getSortedActivePlayers (source) ne départage plus par nom", () => {
    const src = readFileSync(join(root, "js/core/players.js"), "utf8");
    const fn = src.slice(
      src.indexOf("export function getSortedActivePlayers"),
      src.indexOf("export function getEveningStandingPlayers")
    );
    assert.match(fn, /scores\[b\.name\].*scores\[a\.name\]/);
    assert.doesNotMatch(fn, /localeCompare/);
  });

  it("égalité de score : MVP suit l’ordre score-seul ; sortAndRankByScore ne le déplace pas", () => {
    const players = [
      { name: "Zoé", score: 10 },
      { name: "Alice", score: 10 },
      { name: "Bob", score: 3 },
    ];
    const scores = { Zoé: 10, Alice: 10, Bob: 3 };

    const byScoreOnly = sortByScoreOnly(players, scores);
    assert.deepEqual(
      byScoreOnly.map((p) => p.name),
      ["Zoé", "Alice", "Bob"]
    );

    const badged = assignFallbackBadges(byScoreOnly);
    assert.equal(badged[0].name, "Zoé");
    assert.equal(badged[0].badge, "MVP de la soirée");
    assert.equal(badged.find((p) => p.name === "Alice")?.badge, "");

    const forDisplay = sortAndRankByScore(badged, (p) => p.score);
    assert.equal(forDisplay[0].name, "Alice");
    assert.equal(forDisplay[0].badge, "");
    assert.equal(
      forDisplay.find((p) => p.name === "Zoé")?.badge,
      "MVP de la soirée"
    );
  });
});
