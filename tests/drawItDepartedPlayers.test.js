/**
 * Audit Draw It n°2 — joueur qui quitte le salon en pleine partie.
 * Avant : devineur parti → « tout le monde a trouvé » jamais atteint (60 s par
 * manche) ; dessinateur parti → 60 s de toile vide.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  canCommitDrawItReveal,
  canPlayerCommitDrawItReveal,
  expectedDrawItGuessers,
  isDrawItDrawerGone,
} from "../js/core/drawItRound.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");

const END = Date.parse("2026-11-20T20:00:00.000Z");
const MID = END - 30000;
function drawing(overrides = {}) {
  return {
    lobbyStarted: true,
    phase: "drawing",
    roundEndsAt: new Date(END).toISOString(),
    participants: [{ userId: "a" }, { userId: "b" }, { userId: "c" }],
    drawerOrder: ["a", "b", "c"],
    drawerUid: "a",
    foundOrder: [],
    ...overrides,
  };
}

describe("Draw It : devineur parti", () => {
  it("n'est plus attendu", () => {
    assert.deepEqual(expectedDrawItGuessers({ ...drawing(), presentUids: ["a", "b"] }), ["b"]);
  });

  it("tous les présents ont trouvé : l'hôte termine la manche avant le chrono", () => {
    const s = drawing({ foundOrder: [{ uid: "b" }] });
    assert.equal(canCommitDrawItReveal(s, MID).ok, false);
    assert.equal(canCommitDrawItReveal(s, MID, { presentUids: ["a", "b"] }).ok, true);
  });

  it("liste des présents inconnue : comportement inchangé", () => {
    const s = drawing({ foundOrder: [{ uid: "b" }] });
    assert.equal(canCommitDrawItReveal(s, MID, { presentUids: [] }).ok, false);
    assert.equal(canCommitDrawItReveal(s, MID, { presentUids: null }).ok, false);
  });
});

describe("Draw It : dessinateur parti", () => {
  it("détecté seulement si on connaît les présents", () => {
    assert.equal(isDrawItDrawerGone(drawing(), ["b", "c"]), true);
    assert.equal(isDrawItDrawerGone(drawing(), ["a", "b", "c"]), false);
    assert.equal(isDrawItDrawerGone(drawing(), null), false);
  });

  it("fin de manche tout de suite, pour l'hôte comme pour les joueurs", () => {
    assert.equal(canCommitDrawItReveal(drawing(), MID, { presentUids: ["b", "c"] }).ok, true);
    assert.equal(
      canPlayerCommitDrawItReveal(drawing(), MID, undefined, { presentUids: ["b", "c"] }).ok,
      true
    );
    assert.equal(canPlayerCommitDrawItReveal(drawing(), MID, undefined, { presentUids: ["a", "b", "c"] }).ok, false);
  });

  it("l'écran l'annonce dans le récapitulatif", () => {
    const game = read("js/games/drawIt.js");
    assert.match(game, /isDrawItDrawerGone\(session, getDrawItPresentUids\(\)\)\s*\?\s*"Le dessinateur a quitté la partie\."/);
    assert.match(game, /const presentUids = getDrawItPresentUids\(\);/);
  });
});

describe("Draw It : migration serveur", () => {
  const sql = read("supabase/fix-drawit-departed-players.sql");

  it("devineurs attendus filtrés sur les membres du salon", () => {
    assert.match(sql, /create or replace function public\.drawit_all_present_guessers_found\(\s*p_lobby_id uuid,\s*p_drawit jsonb\s*\)/);
    assert.match(sql, /from public\.lobby_members m\s*where m\.lobby_id = p_lobby_id\s*and m\.user_id::text = u/);
    assert.match(sql, /revoke all on function public\.drawit_all_present_guessers_found\(uuid, jsonb\) from authenticated;/);
  });

  it("fin de manche : dessinateur parti, et devineurs présents", () => {
    assert.match(sql, /v_drawer_gone := coalesce\(v_di->>'drawerUid', ''\) <> ''/);
    assert.match(sql, /if not v_time_up and not v_drawer_gone then/);
    assert.match(sql, /and not public\.drawit_all_present_guessers_found\(p_lobby_id, v_di\)/);
    assert.match(sql, /grant execute on function public\.reveal_drawit_round\(uuid\) to authenticated;/);
  });

  it("propositions : remplacement ciblé d'une ligne, rejouable, exigé une seule fois", () => {
    assert.match(sql, /pg_get_functiondef\(\s*'public\.submit_drawit_guess\(uuid,text,integer,text\)'::regprocedure/);
    assert.match(sql, /v_new text := 'v_all_found := public\.drawit_all_present_guessers_found\(p_lobby_id, v_di\);';/);
    assert.match(sql, /if position\(v_new in v_def\) > 0 then/);
    assert.match(sql, /if v_count <> 1 then/);
  });
});
