/**
 * Audit Le Traître n°4 (vote pour soi) et n°5 (pseudo changé en pleine partie).
 * Le n°3 (hôte qui relit son rôle) est couvert dans traitrePrivateRoleSync.test.js.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");

describe("Le Traître n°4 : pas de vote pour soi-même", () => {
  it("la grille de vote exclut le joueur local", () => {
    const src = read("js/core/traitreSession.js");
    const fn = src.slice(src.indexOf("export function getTraitreVoteTargets("));
    assert.match(fn, /const localName = getLocalDisplayName\(\);/);
    assert.match(fn, /\(session\.alive \|\| \[\]\)\.includes\(p\.name\) && p\.name !== localName/);
  });

  it("l'envoi d'un vote pour soi est refusé avant tout envoi", () => {
    const src = read("js/core/traitreSession.js");
    const fn = src.slice(src.indexOf("export async function commitTraitreVote("));
    const guard = fn.indexOf("if (targetName === localName) return null;");
    const send = fn.indexOf("patchGameStateWithFeedback");
    assert.ok(guard > 0 && guard < send);
  });

  it("la règle est affichée", () => {
    assert.match(read("data/gameRules.js"), /On ne peut pas voter pour soi-même\./);
  });
});

describe("n°5 : pas de changement de pseudo en pleine partie", () => {
  it("bloqué pendant un jeu, permis au menu, en attente ou hors salon", () => {
    const src = read("js/core/auth.js");
    const start = src.indexOf("export function isRenameBlockedByGame(");
    const body = src.slice(start, src.indexOf("\n}\n", start) + 2);
    // Fonction pure : évaluée seule, sans charger Supabase.
    const isRenameBlockedByGame = new Function(
      "getState",
      `${body.replace("export function", "function")}\nreturn isRenameBlockedByGame;`
    )(() => ({}));
    assert.equal(isRenameBlockedByGame({ id: "l", status: "playing", gameId: "traitre" }), true);
    assert.equal(isRenameBlockedByGame({ id: "l", status: "playing", gameId: "menu" }), false);
    assert.equal(isRenameBlockedByGame({ id: "l", status: "waiting", gameId: null }), false);
    assert.equal(isRenameBlockedByGame(null), false);
  });

  it("updateProfileName refuse avant de renommer, sauf pseudo inchangé", () => {
    const src = read("js/core/auth.js");
    const fn = src.slice(src.indexOf("export async function updateProfileName("));
    const guard = fn.indexOf(
      'if (isRenameBlockedByGame() && String(name ?? "").trim() !== getLocalDisplayName()) {'
    );
    const rename = fn.indexOf("renameLocalPlayer(name)");
    assert.ok(guard > 0 && guard < rename);
    assert.match(fn, /return \{ ok: false, error: RENAME_BLOCKED_IN_GAME_MESSAGE \};/);
    assert.match(src, /RENAME_BLOCKED_IN_GAME_MESSAGE = "Change de pseudo entre deux parties\."/);
  });
});
