/**
 * Audit Tier Night :
 * 1. Le vrai hôte envoyait la liste des classements connue de son téléphone, qui
 *    remplaçait celle du serveur ({ ...current, ...incoming }) : un invité tout juste
 *    validé pouvait être effacé. En série (tout le multijoueur), l'hôte passe
 *    désormais par la même RPC que les invités.
 * 2. « terminé » était noté avant l'envoi, sans gestion d'erreur : en cas d'échec,
 *    le joueur restait en attente sans être compté. Désormais retour au classement
 *    + message.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(ROOT, "js/games/tierNight.js"), "utf8").replace(/\r\n/g, "\n");

function fnBody(name) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start > 0, `${name} introuvable`);
  return src.slice(start, src.indexOf("\n  }\n", start));
}

describe("Tier Night : envoi du classement", () => {
  const finish = fnBody("finishGame");

  it("série : hôte comme invités, par la RPC (placement puis terminé)", () => {
    const body = fnBody("contributeOwnPlacement");
    const placementAt = body.indexOf('kind: "placement"');
    const finishedAt = body.indexOf('kind: "finished"');
    assert.ok(placementAt > 0 && finishedAt > placementAt);
    assert.match(body, /if \(!lobbyId\) throw new Error/);
    assert.match(finish, /\} else \{[\s\S]*?await contributeOwnPlacement\(\);/);
  });

  it("l'écriture de la liste complète reste réservée au mode classique (vrai hôte)", () => {
    assert.match(finish, /if \(isLobbyHost\(\) && !hasActiveTierNightSeries\(\)\) \{/);
  });

  it("échec : retour au classement et message, sans passer à la fin de manche", () => {
    const catchPart = finish.slice(finish.indexOf("} catch (err) {"));
    assert.match(catchPart, /finished = false;\s*finishFailed = true;\s*if \(alive\) render\(\);\s*return;/);
    const catchAt = finish.indexOf("} catch (err) {");
    const finalizeAt = finish.indexOf("hostFinalizeTierNightSeriesRound(");
    assert.ok(catchAt > 0 && finalizeAt > catchAt, "la fin de manche n'est tentée qu'après un envoi réussi");
  });

  it("message sous « Valider ma tierlist »", () => {
    assert.match(src, /export const TIER_FINISH_FAILED_LABEL = "Ton classement n’est pas parti, réessaie !";/);
    assert.match(
      src,
      /id="btn-validate">Valider ma tierlist<\/button>\$\{\s*finishFailed \? `<p class="hint">\$\{escapeHtml\(TIER_FINISH_FAILED_LABEL\)\}<\/p>` : ""/
    );
  });
});
