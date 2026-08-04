/**
 * Contrats source - vague 1 suppression Fil Rouge (code mort / runtime facile).
 * Ne couvre pas gameSync.js / state.js (vague 2).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const DELETED_MODULES = [
  "js/core/filRougeUi.js",
  "js/core/filRougeToast.js",
  "js/core/filRougeResultsModal.js",
  "js/core/filRougeSession.js",
  "js/core/filRougePrivate.js",
  "js/screens/filRougeSetup.js",
  "js/screens/filRougeMission.js",
];

function read(rel) {
  return readFileSync(join(root, rel), "utf8");
}

function walkJsFiles(dir, out = []) {
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, name.name);
    if (name.isDirectory()) {
      if (name.name === "node_modules" || name.name === "www" || name.name === "android" || name.name === "ios") {
        continue;
      }
      walkJsFiles(p, out);
    } else if (name.name.endsWith(".js")) {
      out.push(p);
    }
  }
  return out;
}

describe("fil rouge vague 1 - contrats source", () => {
  it("modules Fil Rouge orphelins sont absents du disque", () => {
    for (const rel of DELETED_MODULES) {
      assert.equal(existsSync(join(root, rel)), false, `attendu absent: ${rel}`);
    }
  });

  it("aucun import actif vers les modules Fil Rouge supprimés", () => {
    const patterns = [
      /filRougeSession\.js/,
      /filRougePrivate\.js/,
      /filRougeUi\.js/,
      /filRougeToast\.js/,
      /filRougeResultsModal\.js/,
      /filRougeSetup\.js/,
      /filRougeMission\.js/,
    ];
    const files = walkJsFiles(join(root, "js")).concat(walkJsFiles(join(root, "data")));
    const offenders = [];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      for (const re of patterns) {
        if (re.test(src)) offenders.push(`${file} matches ${re}`);
      }
    }
    assert.deepEqual(offenders, []);
  });

  it("aucun jeu actif ne référence isEveningGameplayPaused", () => {
    const gamesDir = join(root, "js/games");
    const offenders = [];
    for (const name of readdirSync(gamesDir)) {
      if (!name.endsWith(".js")) continue;
      const src = readFileSync(join(gamesDir, name), "utf8");
      if (src.includes("isEveningGameplayPaused")) {
        offenders.push(name);
      }
    }
    assert.deepEqual(offenders, []);
  });

  it("main.js n’enregistre plus d’écrans Fil Rouge et n’importe plus ses modules", () => {
    const main = read("js/main.js");
    assert.equal(main.includes("filRouge"), false);
    assert.equal(main.includes("filrouge"), false);
    assert.equal(main.includes("FilRouge"), false);
    assert.equal(main.includes("FIL_ROUGE"), false);
  });

  it("classes CSS partagées Traître sont génériques (prep-min-players)", () => {
    const css = read("style.css");
    for (const sel of [
      ".prep-min-players{",
      ".prep-min-players--ok{",
      ".prep-min-players__icon{",
      ".prep-min-players__title{",
      ".prep-min-players__detail{",
    ]) {
      assert.ok(css.includes(sel), `manquant: ${sel}`);
    }
    assert.equal(css.includes("fil-rouge-setup__req"), false);
    const traitre = read("js/screens/traitrePrep.js");
    assert.ok(traitre.includes("prep-min-players"));
    assert.equal(traitre.includes("fil-rouge"), false);
  });

  it("CSS exclusif Fil Rouge (banner / modal / mission) a été retiré", () => {
    const css = read("style.css");
    assert.equal(css.includes(".fil-rouge-banner{"), false);
    assert.equal(css.includes(".fil-rouge-modal{"), false);
    assert.equal(css.includes(".fil-rouge-mission__word{"), false);
    assert.equal(css.includes(".fil-rouge-toast{"), false);
    assert.equal(css.includes(".fil-rouge-box{"), false);
  });

  it("flag FIL_ROUGE_ENABLED et data/filRouge.js sont absents (vague 2)", () => {
    assert.equal(existsSync(join(root, "data/filRouge.js")), false);
    const sync = read("js/core/gameSync.js");
    assert.equal(sync.includes("FIL_ROUGE_ENABLED"), false);
    assert.equal(sync.includes("data/filRouge.js"), false);
  });
});