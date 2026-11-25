/**
 * Skin Nouvel An : le texte blanc des boutons principaux (dégradé
 * --color-primary-hot → --color-primary) doit rester au moins aussi lisible
 * qu'avec les couleurs d'origine (tokens.css).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(__dirname, "..", p), "utf8");

function luminance(hex) {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastOnWhite(hex) {
  return 1.05 / (luminance(hex) + 0.05);
}

function tokenIn(css, selector, name) {
  const start = css.indexOf(`${selector} {`);
  assert.ok(start >= 0, `bloc ${selector} introuvable`);
  const block = css.slice(start, css.indexOf("}", start));
  const m = block.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`));
  assert.ok(m, `${name} absent de ${selector}`);
  return m[1];
}

function rootToken(css, name) {
  const m = css.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`));
  assert.ok(m, `${name} absent de tokens.css`);
  return m[1];
}

describe("skin Nouvel An : contraste du texte blanc", () => {
  const skins = read("css/event-skins.css");
  const tokens = read("css/tokens.css");

  for (const name of ["--color-primary", "--color-primary-hot"]) {
    it(`${name} au moins aussi lisible que l'original`, () => {
      const nye = contrastOnWhite(tokenIn(skins, "html.event-nye", name));
      const base = contrastOnWhite(rootToken(tokens, name));
      assert.ok(
        nye >= base,
        `${name} : ${nye.toFixed(2)}:1 contre ${base.toFixed(2)}:1 à l'origine`
      );
    });
  }
});
