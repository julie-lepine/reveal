/**
 * Clutch : un tap ne doit plus être perdu quand les pastilles « X a tapé ! »
 * des autres joueurs apparaissent pendant l'appui.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CLUTCH_TAP_FAILED_LABEL,
  resolveClutchTapCommitFailureUi,
} from "../js/core/clutchTapCommit.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, "../js/games/clutch.js"), "utf8").replace(/\r\n/g, "\n");

describe("Clutch : tap à l'appui", () => {
  it("le tap est pris au pointerdown, le clavier reste possible", () => {
    assert.match(src, /addEventListener\("pointerdown"[\s\S]{0,120}onTap\(\)/);
    assert.match(src, /addEventListener\("click", \(e\) => \{\s*if \(e\.detail === 0\) onTap\(\);/);
    assert.doesNotMatch(src, /#clutch-target"\)\?\.addEventListener\("click", \(\) =>/);
  });

  it("pastilles « a tapé » au-dessus du bouton, sur une ligne réservée (le bouton ne bouge pas)", () => {
    const active = src.slice(src.indexOf("function activeHtml"), src.indexOf("function revealHtml"));
    const btnAt = active.indexOf('id="clutch-target"');
    const chipsAt = active.indexOf('id="clutch-tapped"');
    assert.ok(chipsAt > 0 && btnAt > chipsAt);
    assert.match(src, /const CLUTCH_MAX_TAPPED_FACES = 5;/);
    assert.match(src, /clutch-chip--group/);
    assert.match(src, /ont tapé&nbsp;!/);
    const css = readFileSync(join(__dirname, "../css/screens.css"), "utf8");
    assert.match(css, /\.clutch-tapped:empty\{[\s\S]*?height:28px;/);
  });

  it("échec d'envoi : bouton rouvert et message clair", () => {
    assert.deepEqual(resolveClutchTapCommitFailureUi(), {
      tapCommitInFlight: false,
      localWindowClosed: false,
    });
    assert.match(CLUTCH_TAP_FAILED_LABEL, /retape/);
    assert.match(src, /tapFailed = true;/);
    assert.match(src, /tapFailed && !tapped && !localWindowClosed\s*\?\s*CLUTCH_TAP_FAILED_LABEL/);
  });
});
