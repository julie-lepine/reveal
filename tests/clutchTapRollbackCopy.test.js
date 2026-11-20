/**
 * Clutch : un tap dont l'envoi échoue doit être annulé même si la synchro a
 * recopié la map des taps pendant l'envoi (un autre joueur tape au même moment).
 * Sinon le joueur reste sur « ✓ Tapé » alors que le serveur n'a rien reçu.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  mergeClutchTapsFrozen,
  sameClutchTap,
  simulateClutchTapCommitCycle,
} from "../js/core/clutchTapCommit.js";
import { rollbackOptimisticMapEntry } from "../js/core/optimisticMapEntry.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("Clutch : annulation du tap après recopie des taps", () => {
  it("sameClutchTap compare le contenu (ms, at), pas l'objet", () => {
    const tap = { ms: 4200, at: 1000 };
    assert.equal(sameClutchTap(tap, { ms: 4200, at: 1000 }), true);
    assert.equal(sameClutchTap(tap, { ms: 4201, at: 1000 }), false);
    assert.equal(sameClutchTap(tap, { ms: 4200, at: 999 }), false);
    assert.equal(sameClutchTap(tap, null), false);
    assert.equal(sameClutchTap({ ms: 10 }, { ms: 10, at: null }), true);
  });

  it("la recopie par la synchro casse la comparaison par identité (cause du bug)", () => {
    const alice = { ms: 4200, at: 1000 };
    const copied = mergeClutchTapsFrozen({ Bob: { ms: 3900, at: 1100 } }, { Alice: alice });
    assert.notEqual(copied.Alice, alice);
    const byIdentity = rollbackOptimisticMapEntry({
      currentMap: copied,
      key: "Alice",
      hadPreviousValue: false,
      optimisticValue: alice,
    });
    assert.equal(byIdentity.applied, false);
    const byContent = rollbackOptimisticMapEntry({
      currentMap: copied,
      key: "Alice",
      hadPreviousValue: false,
      optimisticValue: alice,
      valuesEqual: sameClutchTap,
    });
    assert.equal(byContent.applied, true);
    assert.equal("Alice" in byContent.map, false);
    assert.deepEqual(byContent.map.Bob, { ms: 3900, at: 1100 });
  });

  it("Bob tape pendant l'envoi raté d'Alice : Alice peut retaper, le tap de Bob reste", () => {
    const res = simulateClutchTapCommitCycle({
      session: { taps: {} },
      localName: "Alice",
      firstTap: { ms: 4200, at: 1000 },
      secondTap: { ms: 4300, at: 2000 },
      commitFails: true,
      mutateBeforeFail: (taps) => mergeClutchTapsFrozen({ Bob: { ms: 3900, at: 1100 } }, taps),
    });
    assert.equal(res.canTapAfterFailure, true);
    assert.equal(res.secondTapSent, true);
    assert.deepEqual(res.taps.Alice, { ms: 4300, at: 2000 });
    assert.deepEqual(res.taps.Bob, { ms: 3900, at: 1100 });
  });

  it("commitClutchTap : comparaison par contenu et identifiant récupéré dans le try", () => {
    const src = readFileSync(join(__dirname, "../js/core/clutchSession.js"), "utf8").replace(/\r\n/g, "\n");
    const fn = src.slice(src.indexOf("export async function commitClutchTap"));
    const body = fn.slice(0, fn.indexOf("\n}\n"));
    assert.match(body, /valuesEqual: sameClutchTap/);
    const tryAt = body.indexOf("try {");
    const uidAt = body.indexOf("requireLocalParticipantUid()");
    assert.ok(tryAt > 0 && uidAt > tryAt, "l'identifiant doit être récupéré dans le try");
  });
});
