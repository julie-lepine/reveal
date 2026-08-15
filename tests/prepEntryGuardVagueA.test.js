/**
 * Pré-résolution Vague A - gardes entry au mount prep (alignement Trivia/Consensus/Traître).
 * Les preps autrefois sans garde : Hot Take, SpeedVote, Clutch, Wrong Answer,
 * Dilemma, TruthMeter.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

/** @type {{ file: string, mount: string, prepId: string, entryFn: string }[]} */
const PREP_GUARDS = [
  {
    file: "js/screens/hotTakePrep.js",
    mount: "mountHotTakePrep",
    prepId: "hottake-prep",
    entryFn: "getHotTakeEntryScreen",
  },
  {
    file: "js/screens/speedVotePrep.js",
    mount: "mountSpeedVotePrep",
    prepId: "speedvote-prep",
    entryFn: "getSpeedVoteEntryScreen",
  },
  {
    file: "js/screens/clutchPrep.js",
    mount: "mountClutchPrep",
    prepId: "clutch-prep",
    entryFn: "getClutchEntryScreen",
  },
  {
    file: "js/screens/drawItPrep.js",
    mount: "mountDrawItPrep",
    prepId: "drawit-prep",
    entryFn: "getDrawItEntryScreen",
  },
  {
    file: "js/screens/wrongAnswerPrep.js",
    mount: "mountWrongAnswerPrep",
    prepId: "wronganswer-prep",
    entryFn: "getWrongAnswerEntryScreen",
  },
  {
    file: "js/screens/dilemmaPrep.js",
    mount: "mountDilemmaPrep",
    prepId: "dilemma-prep",
    entryFn: "getDilemmaEntryScreen",
  },
  {
    file: "js/screens/truthMeterPrep.js",
    mount: "mountTruthMeterPrep",
    prepId: "truthmeter-prep",
    entryFn: "getTruthMeterEntryScreen",
  },
];

/** Références déjà alignées (ne pas casser). */
const REFERENCE_PREPS = [
  {
    file: "js/screens/triviaSetup.js",
    prepId: "trivia-prep",
    entryCall: "trivia.getEntryScreen()",
  },
  {
    file: "js/screens/consensusSetup.js",
    prepId: "consensus-prep",
    entryCall: "consensus.getEntryScreen()",
  },
  {
    file: "js/screens/traitrePrep.js",
    prepId: "traitre-prep",
    entryCall: "getTraitreEntryScreen()",
  },
];

function extractMountBody(src, mountName) {
  const start = src.indexOf(`export function ${mountName}`);
  assert.notEqual(start, -1, `${mountName} introuvable`);
  const brace = src.indexOf("{", start);
  let depth = 0;
  for (let i = brace; i < src.length; i++) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(brace, i + 1);
    }
  }
  throw new Error(`${mountName} non fermée`);
}

function assertGuardBefore(body, prepId, entryExpr) {
  const guardRe = new RegExp(
    `${entryExpr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*;?\\s*\\n\\s*if \\([^)]+!== "${prepId}"\\) \\{\\s*\\n\\s*navigate\\([^)]+\\);\\s*\\n\\s*return null;`
  );
  // Plus souple : accepter const entry = fn(); if (entry !== "…")
  const alt = new RegExp(
    `if \\(\\s*(?:const entry = )?${entryExpr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*!==\\s*"${prepId}"\\s*\\)`
  );
  const soft = /if\s*\(\s*entry\s*!==\s*"([^"]+)"\s*\)\s*\{[\s\S]*?navigate\(\s*entry\s*\)[\s\S]*?return null/;
  const hasSoft =
    soft.test(body) && body.includes(`!== "${prepId}"`) && body.includes("navigate(entry)");
  const hasInline = alt.test(body) || guardRe.test(body);
  assert.ok(hasSoft || hasInline, `garde entry manquante pour ${prepId}`);

  const guardIdx = body.search(/if\s*\(\s*entry\s*!==/);
  const inlineIdx = body.search(new RegExp(`!==\\s*"${prepId}"`));
  const idx = guardIdx >= 0 ? guardIdx : inlineIdx;
  assert.ok(idx >= 0);

  const afterGuard = body.slice(idx);
  // Side effects après la garde seulement
  const createIdx = body.indexOf("createPrepLobbyController");
  if (createIdx >= 0) {
    assert.ok(idx < createIdx, "garde avant createPrepLobbyController");
  }
  const paintIdx = Math.min(
    ...["app.innerHTML", "pageShell(", "prepGuestFollowOnSession("]
      .map((s) => body.indexOf(s))
      .filter((i) => i >= 0)
      .concat([Infinity])
  );
  if (paintIdx !== Infinity) {
    assert.ok(idx < paintIdx, "garde avant paint / guestFollow");
  }

  // Pas de paint dans le chemin redirect : return null immédiatement après navigate
  const guardBlock = afterGuard.slice(0, afterGuard.indexOf("return null") + 12);
  assert.doesNotMatch(guardBlock, /app\.innerHTML/);
  assert.doesNotMatch(guardBlock, /pageShell\(/);
  assert.doesNotMatch(guardBlock, /onGameSessionChange\(/);
}

describe("Pré-résolution Vague A - gardes prep manquantes", () => {
  for (const spec of PREP_GUARDS) {
    it(`${spec.file} : ${spec.entryFn} → navigate si ≠ ${spec.prepId}, avant side effects`, () => {
      const src = readFileSync(join(ROOT, spec.file), "utf8");
      const body = extractMountBody(src, spec.mount);
      assert.match(body, /if\s*\(\s*!requireLobbyPlay\(\)\s*\)\s*return null/);
      assert.match(body, new RegExp(`const entry = ${spec.entryFn}\\(\\)`));
      assertGuardBefore(body, spec.prepId, `${spec.entryFn}()`);
      // Suivi invité conservé après la garde (pas dans le chemin redirect)
      assert.match(body, /prepGuestFollowOnSession\(/);
      const guestIdx = body.indexOf("prepGuestFollowOnSession");
      const entryIdx = body.indexOf(`const entry = ${spec.entryFn}()`);
      assert.ok(entryIdx < guestIdx);
    });
  }

  it("références Trivia / Consensus / Traître conservent une garde entry", () => {
    for (const spec of REFERENCE_PREPS) {
      const src = readFileSync(join(ROOT, spec.file), "utf8");
      assert.match(
        src,
        new RegExp(`!== "${spec.prepId}"[\\s\\S]{0,80}navigate\\(`)
      );
    }
  });

  it("ne touche pas routerNestedRedirect / Guess Lie prep", () => {
    const router = readFileSync(join(ROOT, "js/core/router.js"), "utf8");
    // Pas de carte ENTRY dans router (Vague A)
    assert.doesNotMatch(router, /getHotTakeEntryScreen/);
    assert.doesNotMatch(router, /ENTRY_RESOLVERS/);
    const glMenu = readFileSync(join(ROOT, "js/screens/guessLieMenu.js"), "utf8");
    // Guess Lie hors Vague A - pas d'exigence de changer
    assert.ok(glMenu.length > 0);
  });
});
