/**
 * Audit « l'hôte quitte en pleine manche » n°1 : Tier Night (série). Si l'hôte part
 * pendant le classement, personne ne pouvait terminer la manche : l'écran réservait
 * la fin de manche et « Voir les résultats » au vrai hôte, alors que le serveur
 * (finalize / advance_tiernight_series_round) et hostFinalizeTierNightSeriesRound
 * acceptent déjà l'hôte remplaçant.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const screen = read("js/games/tierNight.js");
const playSession = read("js/core/tierNightSeriesPlaySession.js");

function fnBody(src, name) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start > 0, `${name} introuvable`);
  return src.slice(start, src.indexOf("\n  }\n", start));
}

describe("Tier Night (série) : l'hôte remplaçant peut terminer la manche", () => {
  it("règle : vrai hôte, ou remplaçant seulement en mode série", () => {
    assert.match(
      fnBody(screen, "canLeadRoundEnd"),
      /return isLobbyHost\(\) \|\| \(hasActiveTierNightSeries\(\) && canActAsHost\(\)\);/
    );
  });

  it("la fonction de fin de manche autorise déjà le remplaçant", () => {
    assert.match(playSession, /function canHostSeriesCommit\(\) \{\s*if \(!isGameSyncActive\(\)\) return true;\s*return isLobbyHost\(\) \|\| canActAsHost\(\);/);
  });

  it("fin auto (dernier classement), bouton « Voir les résultats » et forçage utilisent la règle", () => {
    const series = screen.match(/if \(hasActiveTierNightSeries\(\)\) \{\s*(?:\/\/[^\n]*\n\s*)?if \(canLeadRoundEnd\(\)\) \{\s*await hostFinalizeTierNightSeriesRound/g) || [];
    assert.equal(series.length, 2, "fin de manche à la fin du classement et à la mise à jour de session");
    assert.match(fnBody(screen, "lobbyWaitHtml"), /const host = canLeadRoundEnd\(\);\s*const canForce = host && canForceTierNightResults\(\);/);
    assert.match(fnBody(screen, "forceResults"), /if \(!canLeadRoundEnd\(\)\) return;/);
  });

  it("le classement de chacun garde son chemin : vrai hôte en direct, les autres par la RPC", () => {
    const finish = fnBody(screen, "finishGame");
    assert.match(finish, /if \(isLobbyHost\(\)\) \{[\s\S]*?syncTierNightSession\(/);
    assert.match(finish, /rpcContributeGameSessionPlayer\(\{[\s\S]*?kind: "placement"/);
  });
});
