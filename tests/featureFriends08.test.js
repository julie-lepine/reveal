/**
 * FEATURE-FRIENDS-01 Palier 8 — légal in-app (pas de fiche store).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PRIVACY_POLICY } from "../data/legalContent.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

describe("FEATURE-FRIENDS-01 Palier 8 — légal", () => {
  it("politique in-app : amis + cascade + date", () => {
    assert.equal(PRIVACY_POLICY.updated, "27 août 2026");
    const collected = PRIVACY_POLICY.sections.find((s) => s.heading === "Données collectées");
    const deletion = PRIVACY_POLICY.sections.find((s) => s.heading === "Suppression de compte");
    const purposes = PRIVACY_POLICY.sections.find((s) => s.heading === "Finalités");
    assert.match(collected.body, /liste d.amis et demandes d.amitié/);
    assert.match(collected.body, /lobby privé/);
    assert.doesNotMatch(collected.body, /fil public|recherche publique de joueurs/);
    assert.match(purposes.body, /liste d.amis privée/);
    assert.match(deletion.body, /demandes d.amitié et amitiés associées/);
    assert.match(deletion.body, /cascade/);
  });

  it("LAUNCH UGC reste sans fil public ; prompt OVH documenté", () => {
    const launch = read("docs/LAUNCH.md");
    assert.match(launch, /No public social feed/);
    assert.match(launch, /Private friend list/);
    assert.match(launch, /lobby-only discovery/);
    const ovh = read("docs/LEGAL_SITE_OVH.md");
    assert.match(ovh, /FEATURE-FRIENDS-01/);
    assert.match(ovh, /27 août 2026/);
    assert.match(ovh, /privacy\.html/);
  });
});
