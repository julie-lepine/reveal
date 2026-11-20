/**
 * Audit Draw It n°1 — fin de manche au chrono sans l'hôte.
 * Avant : seul l'hôte (ou son remplaçant) pouvait terminer la manche à 00:00.
 * Écran de l'hôte éteint → tout le monde bloqué jusqu'à 2 min.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DRAW_IT_PLAYER_REVEAL_GRACE_MS,
  canCommitDrawItReveal,
  canPlayerCommitDrawItReveal,
} from "../js/core/drawItRound.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");

const END = Date.parse("2026-11-20T20:00:00.000Z");
function drawing(overrides = {}) {
  return {
    lobbyStarted: true,
    phase: "drawing",
    roundEndsAt: new Date(END).toISOString(),
    participants: [{ userId: "a" }, { userId: "b" }, { userId: "c" }],
    drawerUid: "a",
    foundOrder: [],
    ...overrides,
  };
}

describe("Draw It : fin de manche demandée par un joueur", () => {
  it("pas avant 00:00 + délai laissé à l'hôte", () => {
    assert.equal(canPlayerCommitDrawItReveal(drawing(), END - 1000).ok, false);
    assert.equal(canPlayerCommitDrawItReveal(drawing(), END).ok, false);
    assert.equal(
      canPlayerCommitDrawItReveal(drawing(), END + DRAW_IT_PLAYER_REVEAL_GRACE_MS - 1).ok,
      false
    );
  });

  it("permise une fois le délai passé", () => {
    assert.equal(
      canPlayerCommitDrawItReveal(drawing(), END + DRAW_IT_PLAYER_REVEAL_GRACE_MS).ok,
      true
    );
  });

  it("un joueur n'a pas la fin anticipée « tout le monde a trouvé » (l'hôte, si)", () => {
    const allFound = drawing({ foundOrder: [{ uid: "b" }, { uid: "c" }] });
    assert.equal(canPlayerCommitDrawItReveal(allFound, END - 30000).ok, false);
    assert.equal(canCommitDrawItReveal(allFound, END - 30000).ok, true);
  });

  it("rien à faire hors dessin ou après la révélation", () => {
    assert.equal(canPlayerCommitDrawItReveal(drawing({ phase: "reveal" }), END + 9999).ok, false);
    assert.equal(canPlayerCommitDrawItReveal(drawing({ lobbyStarted: false }), END + 9999).ok, false);
  });
});

describe("Draw It : branchement appli et serveur", () => {
  it("multijoueur : tout joueur passe par la RPC, règle joueur si pas hôte", () => {
    const src = read("js/core/drawItSession.js");
    const fn = src.slice(src.indexOf("export async function commitDrawItReveal"));
    assert.match(fn, /mpServer && !actingHost\s*\?\s*canPlayerCommitDrawItReveal\(session, nowMs,/);
    assert.match(fn, /if \(mpServer\) \{[\s\S]{0,200}rpcRevealDrawItRound/);
  });

  it("écran : les joueurs déclenchent aussi, essais espacés", () => {
    const game = read("js/games/drawIt.js");
    assert.match(game, /: canPlayerCommitDrawItReveal\(session, nowMs, undefined, \{ presentUids \}\)\.ok;/);
    assert.match(game, /const minGapMs = hostSide \? 1000 : 2000;/);
    assert.match(game, /clientNow - lastRevealAttemptAt >= minGapMs/);
  });

  it("SQL : joueur de la partie, seulement après l'heure serveur", () => {
    const sql = read("supabase/fix-drawit-reveal-any-player.sql");
    assert.match(sql, /create or replace function public\.reveal_drawit_round\(p_lobby_id uuid\)/);
    assert.match(sql, /perform public\.assert_lobby_member\(p_lobby_id\);\s*v_player_only := true;/);
    assert.match(sql, /DRAWIT_NOT_IN_PARTY/);
    const playerBlock = sql.slice(sql.indexOf("if v_player_only then"));
    assert.match(playerBlock, /if v_ends is null or clock_timestamp\(\) < v_ends then/);
    // La fin anticipée « tout le monde a trouvé » reste réservée à l'hôte.
    assert.match(sql, /elsif\s*\(v_ends is null or clock_timestamp\(\) < v_ends\)\s*and not public\.drawit_all_guessers_found\(v_di\)/);
    // Déjà révélée : on renvoie la ligne, sans erreur (plusieurs joueurs en même temps).
    const reveal = sql.indexOf("if v_phase = 'reveal' then\n    return v_row;");
    assert.ok(reveal > 0 && reveal < sql.indexOf("if v_player_only then"));
    assert.match(sql, /grant execute on function public\.reveal_drawit_round\(uuid\) to authenticated/);
    assert.match(sql, /revoke all on function public\.reveal_drawit_round\(uuid\) from anon/);
  });
});
