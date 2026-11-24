/**
 * FEATURE-FRIENDS-04 Palier 4 — légal in-app (croisés 24 h).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PRIVACY_POLICY } from "../data/legalContent.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

describe("FEATURE-FRIENDS-04 Palier 4 — légal", () => {
  it("politique in-app : croisés 24 h + cascade + pas de recherche", () => {
    assert.equal(PRIVACY_POLICY.updated, "24 novembre 2026");
    const collected = PRIVACY_POLICY.sections.find((s) => s.heading === "Données collectées");
    const purposes = PRIVACY_POLICY.sections.find((s) => s.heading === "Finalités");
    const retention = PRIVACY_POLICY.sections.find((s) => s.heading === "Conservation");
    const deletion = PRIVACY_POLICY.sections.find((s) => s.heading === "Suppression de compte");
    assert.match(collected.body, /joueurs récemment croisés en salon/);
    assert.match(collected.body, /24 h après la fin du lobby commun/);
    assert.match(collected.body, /sans le code salon/);
    assert.match(collected.body, /invitations de soirée éphémères/);
    assert.match(collected.body, /liste d.amis et demandes d.amitié/);
    assert.doesNotMatch(collected.body, /fil public|recherche publique de joueurs|lobby_encounters/);
    assert.match(purposes.body, /joueurs récemment croisés/);
    assert.match(purposes.body, /ajouter en ami/);
    assert.match(purposes.body, /liste d.amis privée/);
    assert.match(retention.body, /oubliés 24 h/);
    assert.match(retention.body, /invitations de soirée sont éphémères/);
    assert.match(deletion.body, /joueurs récemment croisés associés/);
    assert.match(deletion.body, /cascade/);
  });

  it("LAUNCH : croisés récents déclarés, pas de fil public", () => {
    const launch = read("docs/LAUNCH.md");
    assert.match(launch, /Recently-crossed registered players/);
    assert.match(launch, /No public social feed/);
  });
});
