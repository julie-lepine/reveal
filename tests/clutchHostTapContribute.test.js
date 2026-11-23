/**
 * N°7 de l'audit : le tap Clutch de l'hôte réel passe par la contribution serveur,
 * comme celui des invités. Avant, l'hôte relisait puis réécrivait toute la partie :
 * un tap d'invité arrivé entre les deux était effacé du serveur.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  detectPlayerContribution,
  isHostPlayerContribution,
} from "../js/core/playerContribution.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HOST = "cccccccc-cccc-cccc-cccc-cccccccccccc";

describe("Tap Clutch de l'hôte : contribution serveur", () => {
  it("le tap envoyé par commitClutchTap est reconnu comme contribution « tap »", () => {
    const tap = { ms: 4100, at: 1 };
    const c = detectPlayerContribution({ clutch: { taps: { [HOST]: tap } } }, HOST);
    assert.deepEqual(c, { game: "clutch", kind: "tap", value: tap });
    assert.equal(isHostPlayerContribution(c), true);
  });

  it("les autres écritures de l'hôte gardent leur chemin habituel", () => {
    assert.equal(isHostPlayerContribution(null), false);
    // Révélation Clutch : plusieurs champs, pas une contribution.
    assert.equal(
      detectPlayerContribution(
        { clutch: { phase: "reveal", taps: { [HOST]: { ms: 1 } } } },
        HOST
      ),
      null
    );
    // Réponse Trivia de l'hôte : RPC dédiée, pas ce chemin.
    const trivia = detectPlayerContribution({ trivia: { answers: { [HOST]: { index: 1 } } } }, HOST);
    assert.equal(isHostPlayerContribution(trivia), false);
    // Tap d'un autre joueur : jamais envoyé au nom de l'hôte.
    assert.equal(
      detectPlayerContribution({ clutch: { taps: { "autre-uid": { ms: 1 } } } }, HOST),
      null
    );
  });

  it("l'écriture de l'hôte réel envoie son tap par la RPC avant toute réécriture", () => {
    const src = readFileSync(join(ROOT, "js/core/gameSync.js"), "utf8");
    const inner = src.slice(src.indexOf("async function patchGameStateInner"));
    const routeAt = inner.indexOf("if (isHostPlayerContribution(hostContribution))");
    const rewriteAt = inner.indexOf("let mergePayload = stateMerge;");
    assert.ok(routeAt > 0 && rewriteAt > routeAt, "routage avant la fusion / réécriture");
    assert.match(
      inner,
      /if \(isHostPlayerContribution\(hostContribution\)\) \{[\s\S]{0,200}return contributeGameSessionPlayerAndApply\(lobbyId, hostContribution\);/
    );
  });

  it("les invités utilisent toujours la même RPC", () => {
    const src = readFileSync(join(ROOT, "js/core/gameSync.js"), "utf8");
    const nonHost = src.slice(
      src.indexOf("async function patchGameStateAsNonHost"),
      src.indexOf("async function contributeGameSessionPlayerAndApply")
    );
    assert.match(nonHost, /return contributeGameSessionPlayerAndApply\(lobbyId, contribution\);/);
    const helper = src.slice(src.indexOf("async function contributeGameSessionPlayerAndApply"));
    assert.match(helper, /rpcContributeGameSessionPlayer\(\{\s*lobbyId,\s*game: contribution\.game,\s*kind: contribution\.kind,\s*value: contribution\.value,/);
    assert.match(helper, /applyRemoteSession\(full\);\s*return full;/);
  });
});
