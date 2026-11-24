/**
 * Audit pubs n°4 : liste SKAdNetwork AdMob ajoutée à Info.plist par scripts/patchNative.mjs.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ADMOB_SKADNETWORK_IDS,
  addSkAdNetworkItems,
} from "../scripts/lib/skadnetworks.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const BASE = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
\t<key>GADApplicationIdentifier</key>
\t<string>ca-app-pub-x~y</string>
</dict>
</plist>
`;

function countIds(plist) {
  return (plist.match(/<key>SKAdNetworkIdentifier<\/key>/g) || []).length;
}

describe("Audit pubs n°4 — SKAdNetwork iOS", () => {
  it("liste Google : 50 identifiants uniques, Google en premier", () => {
    assert.equal(ADMOB_SKADNETWORK_IDS.length, 50);
    assert.equal(new Set(ADMOB_SKADNETWORK_IDS).size, 50);
    assert.equal(ADMOB_SKADNETWORK_IDS[0], "cstr6suwn9.skadnetwork");
    for (const id of ADMOB_SKADNETWORK_IDS) assert.match(id, /^[a-z0-9]+\.skadnetwork$/);
  });

  it("ajoute la liste complète si absente, puis ne change plus rien", () => {
    const first = addSkAdNetworkItems(BASE);
    assert.equal(first.added, 50);
    assert.equal(countIds(first.plist), 50);
    assert.match(first.plist, /<key>SKAdNetworkItems<\/key>\s*<array>/);
    assert.match(first.plist, /GADApplicationIdentifier/);

    const again = addSkAdNetworkItems(first.plist);
    assert.equal(again.added, 0);
    assert.equal(again.plist, first.plist);
  });

  it("complète une liste existante sans doublon", () => {
    const partial = addSkAdNetworkItems(BASE, ["cstr6suwn9.skadnetwork", "custom1.skadnetwork"]).plist;
    const res = addSkAdNetworkItems(partial);
    assert.equal(res.added, 49);
    assert.equal(countIds(res.plist), 51);
    assert.equal((res.plist.match(/cstr6suwn9\.skadnetwork/g) || []).length, 1);
    assert.match(res.plist, /custom1\.skadnetwork/);
    assert.equal((res.plist.match(/<key>SKAdNetworkItems<\/key>/g) || []).length, 1);
  });

  it("patchNative.mjs l'applique à Info.plist", () => {
    const patch = readFileSync(join(ROOT, "scripts/patchNative.mjs"), "utf8");
    assert.match(patch, /from "\.\/lib\/skadnetworks\.mjs"/);
    assert.match(patch, /addSkAdNetworkItems\(plist\)/);
  });
});
