/**
 * « Jouer à un autre jeu » sous « Recommencer » en fin de partie.
 * Hôte seulement (les invités ne lancent pas de jeu), libellé et style communs.
 * Contrats source (pas d'import de gameSync.js réel : cycle Node).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(join(__dirname, "..", rel), "utf8");

describe("bouton « Jouer à un autre jeu »", () => {
  const restart = read("js/core/restartGame.js");

  it("helper partagé : libellé commun, hôte seulement, data-nav ou id", () => {
    assert.match(restart, /export const OTHER_GAME_LABEL = "Jouer à un autre jeu"/);
    const fn = restart.slice(restart.indexOf("export function eveningRecapOtherGameButtonHtml"));
    assert.match(fn, /if \(isGameSyncActive\(\) && !isLobbyHost\(\)\) return "";/);
    assert.match(fn, /data-nav="game-select"/);
    assert.match(fn, /evening-recap__other-game/);
  });

  it("Résultats : juste sous Recommencer, plus de « Autre jeu » en bas", () => {
    const results = read("js/screens/results.js");
    assert.match(
      results,
      /\$\{eveningRecapRestartButtonHtml\(last\)\}\s*\$\{eveningRecapOtherGameButtonHtml\(\)\}/
    );
    assert.doesNotMatch(results, />Autre jeu</);
    assert.match(results, /data-nav="leaderboard">Classement</);
  });

  it("Classement : bouton partagé à la place de « Autre jeu »", () => {
    const board = read("js/screens/leaderboard.js");
    assert.match(board, /\$\{eveningRecapOtherGameButtonHtml\(\)\}/);
    assert.doesNotMatch(board, />Autre jeu</);
  });

  it("Spot the fake : gestionnaire de sortie gardé, libellé harmonisé", () => {
    const traitre = read("js/games/traitre.js");
    assert.match(traitre, /eveningRecapOtherGameButtonHtml\(\{ id: "btn-traitre-exit" \}\)/);
    assert.doesNotMatch(traitre, /Retour au menu jeux/);
    assert.match(traitre, /#btn-traitre-exit/);
  });

  it("styles communs : Recommencer principal, autre jeu secondaire", () => {
    const css = read("css/screens.css");
    assert.match(css, /\.evening-recap__restart\{[\s\S]*?background:linear-gradient\(135deg, var\(--g1\), var\(--g2\)\)/);
    assert.match(css, /\.evening-recap__other-game\{/);
  });
});
