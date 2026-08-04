/**
 * UX-TIERNIGHT-END-01 — alléger le récap : pas de bloc « Points de la manche ».
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

function read(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

function renderTemplateFromEndScreen() {
  const src = read("js/screens/tierNightEnd.js");
  const start = src.indexOf("const content = `");
  assert.ok(start >= 0, "template content introuvable");
  const end = src.indexOf("`;", start);
  assert.ok(end > start, "fin de template introuvable");
  return src.slice(start, end);
}

describe("UX-TIERNIGHT-END-01 — structure récap tiernight-end", () => {
  it("ne rend plus Points de la manche ni le leaderboard round", () => {
    const end = read("js/screens/tierNightEnd.js");
    assert.doesNotMatch(end, /tierNightRoundScoresHtml/);
    assert.doesNotMatch(end, /getTierNightRoundPointsSorted/);
    assert.doesNotMatch(end, /Points de la manche/);
    assert.doesNotMatch(end, /data-scores="round"/);
    assert.doesNotMatch(end, /game-scores-box--round/);

    const tpl = renderTemplateFromEndScreen();
    assert.doesNotMatch(tpl, /Points de la manche/);
    assert.doesNotMatch(tpl, /tierNightRoundScoresHtml/);
  });

  it("conserve l'ordre : intro → consensus → clivant → breakdown → cumul → cartes", () => {
    const tpl = renderTemplateFromEndScreen();
    const markers = [
      { name: "intro", re: /pts consensus pour toi cette manche/ },
      { name: "consensus", re: /consensusBoardHtml\(/ },
      { name: "clivant", re: /controversialHtml\(/ },
      { name: "breakdown", re: /tierScoreBreakdownHtml\(/ },
      { name: "cumul", re: /gameCumulativeScoresHtml\(/ },
      { name: "cartes", re: /recap-list/ },
    ];
    let cursor = -1;
    for (const m of markers) {
      const idx = tpl.search(m.re);
      assert.ok(idx >= 0, `bloc manquant : ${m.name}`);
      assert.ok(idx > cursor, `ordre cassé autour de ${m.name}`);
      cursor = idx;
    }
  });

  it("cartes recap-card + pts + breakdown + cumul restent", () => {
    const end = read("js/screens/tierNightEnd.js");
    const tpl = renderTemplateFromEndScreen();
    assert.match(tpl, /recap-card/);
    assert.match(tpl, /recap-card__pts/);
    assert.match(tpl, /tierScoreBreakdownHtml\(/);
    assert.match(end, /Total manche/);
    assert.match(end, /Détail de tes points/);
    assert.match(tpl, /gameCumulativeScoresHtml\(/);
    assert.match(tpl, /Cumul des scores/);
  });

  it("helpers morts retirés du projet (plus aucun appel)", () => {
    const scores = read("js/core/gameScores.js");
    const session = read("js/core/tierNightSession.js");
    assert.doesNotMatch(scores, /tierNightRoundScoresHtml/);
    assert.doesNotMatch(scores, /Points de la manche/);
    assert.doesNotMatch(session, /getTierNightRoundPointsSorted/);
  });

  it("écran partagé Classe le groupe + Rank Live → tiernight-end", () => {
    const classic = read("js/games/tierNight.js");
    const live = read("js/games/tierNightLive.js");
    // Classic termine sur l'écran end partagé (route / navigate).
    assert.match(classic + live, /tiernight-end/);
    assert.match(live, /navigate\("tiernight-end"\)/);
    // Un seul mount pour les deux modes.
    assert.match(read("js/screens/tierNightEnd.js"), /export function mountTierNightEnd/);
  });
});
