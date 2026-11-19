/**
 * Menu > Profil : « Modifier mon profil » garde l'état ouvert / replié choisi.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PROFILE_EDIT_OPEN_KEY,
  profileEditInitiallyOpen,
  readProfileEditOpen,
  writeProfileEditOpen,
} from "../js/core/profileEditPref.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
  };
}

describe("profileEditPref", () => {
  it("sans choix : ouvert pour Signature, replié sinon", () => {
    const st = memoryStorage();
    assert.equal(readProfileEditOpen(st), null);
    assert.equal(profileEditInitiallyOpen(true, st), true);
    assert.equal(profileEditInitiallyOpen(false, st), false);
  });

  it("le choix enregistré l'emporte sur le défaut", () => {
    const st = memoryStorage();
    writeProfileEditOpen(false, st);
    assert.equal(st.getItem(PROFILE_EDIT_OPEN_KEY), "0");
    assert.equal(profileEditInitiallyOpen(true, st), false);
    writeProfileEditOpen(true, st);
    assert.equal(profileEditInitiallyOpen(false, st), true);
  });

  it("stockage indisponible : pas d'erreur, défaut de l'écran", () => {
    const broken = {
      getItem() {
        throw new Error("blocked");
      },
      setItem() {
        throw new Error("blocked");
      },
    };
    assert.doesNotThrow(() => writeProfileEditOpen(true, broken));
    assert.equal(profileEditInitiallyOpen(true, broken), true);
    assert.equal(profileEditInitiallyOpen(false, null), false);
  });

  it("settings.js lit et enregistre l'état du bloc", () => {
    const src = readFileSync(join(__dirname, "../js/screens/settings.js"), "utf8");
    assert.match(src, /profileEditInitiallyOpen\(unlocked\)/);
    assert.match(src, /addEventListener\("toggle"[\s\S]{0,80}writeProfileEditOpen/);
  });
});
