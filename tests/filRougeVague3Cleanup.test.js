/**
 * Contrats vague 3 - CSS générique, message Traître, docs actives (hors SQL).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function read(rel) {
  return readFileSync(join(root, rel), "utf8");
}

function walkJsFiles(dir, out = []) {
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, name.name);
    if (name.isDirectory()) {
      if (
        name.name === "node_modules" ||
        name.name === "www" ||
        name.name === "android" ||
        name.name === "ios"
      ) {
        continue;
      }
      walkJsFiles(p, out);
    } else if (name.name.endsWith(".js") || name.name.endsWith(".mjs")) {
      out.push(p);
    }
  }
  return out;
}

const ACTIVE_DOCS = [
  "docs/SUPABASE.md",
  "docs/LAUNCH.md",
  "docs/NATIVE.md",
];

describe("fil rouge vague 3 - CSS / message / docs", () => {
  it("aucune classe .fil-rouge-setup__req* dans app ou CSS", () => {
    const css = read("style.css");
    assert.equal(css.includes("fil-rouge-setup__req"), false);
    assert.equal(css.includes("fil-rouge"), false);
    for (const file of ["js/screens/traitrePrep.js"]) {
      assert.equal(read(file).includes("fil-rouge"), false, file);
    }
  });

  it("classes prep-min-players présentes et utilisées par Traître", () => {
    const css = read("style.css");
    for (const sel of [
      ".prep-min-players{",
      ".prep-min-players--ok{",
      ".prep-min-players__icon{",
      ".prep-min-players__title{",
      ".prep-min-players__detail{",
    ]) {
      assert.ok(css.includes(sel), sel);
    }
    const traitre = read("js/screens/traitrePrep.js");
    assert.ok(traitre.includes("prep-min-players"));
    assert.ok(traitre.includes("prep-min-players__icon"));
    assert.ok(traitre.includes("prep-min-players__detail"));
  });

  it("aucun message runtime actif ne mentionne fil-rouge-private.sql", () => {
    const offenders = [];
    for (const file of walkJsFiles(join(root, "js"))) {
      const src = readFileSync(file, "utf8");
      if (src.includes("fil-rouge-private.sql")) offenders.push(file);
    }
    assert.deepEqual(offenders, []);
    const traitreMsg = read("js/core/traitrePrivate.js");
    assert.ok(traitreMsg.includes("traitre-private.sql"));
    assert.ok(traitreMsg.includes("game-sessions-i08-arch03.sql"));
  });

  it("JS runtime actif : pas de Fil Rouge hors stripLegacyFilRougeKeys", () => {
    const offenders = [];
    for (const file of walkJsFiles(join(root, "js"))) {
      let src = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
      const norm = file.replace(/\\/g, "/");
      if (norm.endsWith("js/core/state.js")) {
        src = src
          .replace(
            /\/\*\*[\s\S]*?Retire les clés Fil Rouge[\s\S]*?export function stripLegacyFilRougeKeys\([\s\S]*?\n\}\n/,
            ""
          )
          .replace(/const cleaned = stripLegacyFilRougeKeys\(merged\);/g, "const cleaned = merged;");
      }
      if (/fil-rouge|Fil Rouge|FIL_ROUGE|filRouge|Mot interdit|Mot Interdit/i.test(src)) {
        offenders.push(file);
      }
    }
    assert.deepEqual(offenders, []);
  });

  it("docs actives ne présentent plus le Fil Rouge comme disponible / réactivable", () => {
    for (const rel of ACTIVE_DOCS) {
      const src = read(rel);
      assert.equal(/FIL_ROUGE_ENABLED/.test(src), false, rel);
      assert.equal(/uniquement si réactivation/i.test(src), false, rel);
      assert.equal(/si Mot interdit réactivé/i.test(src), false, rel);
      assert.equal(/Fil Rouge\*\* \(optionnel\)/i.test(src), false, rel);
      assert.equal(/fil rouge mission\s*:/i.test(src), false, rel);
    }
    const setup = read("docs/SUPABASE.md");
    assert.ok(/suppression applicative terminée/i.test(setup));
    assert.ok(setup.includes("traitre-private.sql"));
  });
});
