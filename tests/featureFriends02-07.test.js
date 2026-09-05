/**
 * FEATURE-FRIENDS-02 Palier 7 — légal in-app (invitations de soirée).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PRIVACY_POLICY } from "../data/legalContent.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

describe("FEATURE-FRIENDS-02 Palier 7 — légal", () => {
  it("politique in-app : invitations éphémères + cascade + pas de fil public", () => {
    assert.equal(PRIVACY_POLICY.updated, "5 septembre 2026");
    const collected = PRIVACY_POLICY.sections.find((s) => s.heading === "Données collectées");
    const purposes = PRIVACY_POLICY.sections.find((s) => s.heading === "Finalités");
    const retention = PRIVACY_POLICY.sections.find((s) => s.heading === "Conservation");
    const deletion = PRIVACY_POLICY.sections.find((s) => s.heading === "Suppression de compte");
    assert.match(collected.body, /invitations de soirée éphémères/);
    assert.match(collected.body, /liées à un lobby vivant/);
    assert.match(collected.body, /sans le code salon/);
    assert.match(collected.body, /liste d.amis et demandes d.amitié/);
    assert.doesNotMatch(collected.body, /fil public|recherche publique de joueurs|push/);
    assert.match(purposes.body, /invitations de soirée privées/);
    assert.match(purposes.body, /liste d.amis privée/);
    assert.match(retention.body, /éphémères/);
    assert.match(retention.body, /fermeture du lobby/);
    assert.match(deletion.body, /invitations de soirée associées/);
    assert.match(deletion.body, /cascade/);
  });

  it("prompt OVH FEATURE-FRIENDS-02 documenté ; stores plus tard", () => {
    const ovh = read("docs/LEGAL_SITE_OVH.md");
    assert.match(ovh, /FEATURE-FRIENDS-02/);
    assert.match(ovh, /invitations de soirée éphémères/);
    assert.match(ovh, /privacy\.html/);
    assert.match(ovh, /App Privacy Apple \/ Play Data safety/);
  });
});
