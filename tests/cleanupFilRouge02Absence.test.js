/**
 * CLEANUP-FILROUGE-02 — garde-fous d’absence app + cartographie dette SQL repo.
 * Non destructif : documente le contrat SQL *du dépôt*, pas l’état live Supabase.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GAMES } from "../data/games.js";
import { getState, stripLegacyFilRougeKeys } from "../js/core/state.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function read(rel) {
  return readFileSync(join(root, rel), "utf8");
}

/** Dernière définition connue dans le repo (ordre chronologique métier). */
const COMPLETE_SESSION_CHAIN = [
  "supabase/game-sessions-i08-arch03.sql",
  "supabase/feature-vibecheck-01-remove-allowlist.sql",
  "supabase/bug-tiernight-series-qa-01-complete-screen.sql",
  "supabase/cleanup-filrouge-02-remove-server-legacy.sql",
];

const APPLY_ACTING_HOST_CHAIN = [
  "supabase/game-sessions-i08-arch03.sql",
  "supabase/game-sessions-arch03-hotfix-acting-play-keys.sql",
  "supabase/game-sessions-trivia-01a-acting-host.sql",
  "supabase/feature-vibecheck-01-remove-allowlist.sql",
  "supabase/cleanup-filrouge-02-remove-server-legacy.sql",
];

const STATE_KEY_CHAIN = [
  "supabase/game-sessions-i08-arch03.sql",
  "supabase/feature-vibecheck-01-remove-allowlist.sql",
];

describe("CLEANUP-FILROUGE-02 - absence app", () => {
  it("catalogue : aucun jeu Fil Rouge", () => {
    for (const g of GAMES) {
      assert.equal(/fil.?rouge/i.test(JSON.stringify(g)), false, g.id);
      assert.notEqual(g.id, "filRouge");
      assert.notEqual(g.cssClass, "filrouge");
    }
  });

  it("routes main.js : aucun écran Fil Rouge", () => {
    const main = read("js/main.js");
    assert.equal(/filRouge|fil-rouge|FIL_ROUGE/i.test(main), false);
  });

  it("modules runtime Fil Rouge absents", () => {
    for (const rel of [
      "data/filRouge.js",
      "js/core/filRougeSession.js",
      "js/core/filRougePrivate.js",
      "js/screens/filRougeSetup.js",
      "js/screens/filRougeMission.js",
    ]) {
      assert.equal(existsSync(join(root, rel)), false, rel);
    }
  });

  it("eveningStateToRemote ne sérialise aucune clé Fil Rouge", () => {
    const sync = read("js/core/gameSync.js");
    const fn = sync.match(
      /function eveningStateToRemote\(\) \{([\s\S]*?)\n\}/
    );
    assert.ok(fn, "eveningStateToRemote manquant");
    assert.equal(/filRouge/i.test(fn[1]), false);
  });

  it("état courant et stripLegacyFilRougeKeys", () => {
    const st = getState();
    assert.equal(Object.hasOwn(st, "filRougeScores"), false);
    assert.equal(Object.hasOwn(st, "filRougeGame"), false);
    const legacy = {
      scores: { A: 1 },
      filRougeScores: { A: 9 },
      filRougeGame: { status: "x" },
      playerStats: { A: { hotTakeWins: 1, filRougeMissionsValidated: 2 } },
    };
    const out = stripLegacyFilRougeKeys(legacy);
    assert.equal(Object.hasOwn(out, "filRougeScores"), false);
    assert.equal(Object.hasOwn(out, "filRougeGame"), false);
    assert.equal(Object.hasOwn(out.playerStats.A, "filRougeMissionsValidated"), false);
    assert.equal(out.playerStats.A.hotTakeWins, 1);
  });

  it("gameScoreSessionKey reste une clé soirée générique", () => {
    const sync = read("js/core/gameSync.js");
    assert.match(sync, /"gameScoreSessionKey"/);
    assert.equal(Object.hasOwn(getState(), "gameScoreSessionKey"), true);
  });
});

describe("CLEANUP-FILROUGE-02 - dette SQL repo (pas live DB)", () => {
  it("game_session_state_key (dernière déf) : pas de mapping filRouge", () => {
    const last = STATE_KEY_CHAIN[STATE_KEY_CHAIN.length - 1];
    const src = read(last);
    const block = src.match(
      /create or replace function public\.game_session_state_key\([\s\S]*?\$\$;/
    );
    assert.ok(block, last);
    assert.equal(/filrouge|fil_rouge|filRouge/i.test(block[0]), false);
  });

  it("chronologie complete : QA-01 historique a filRouge ; dernière déf additive les retire", () => {
    const qa01 = read("supabase/bug-tiernight-series-qa-01-complete-screen.sql");
    assert.match(qa01, /'filRouge'/);
    assert.match(qa01, /'playlistGuess'/);
    assert.match(qa01, /tiernight-end/);
    const last = COMPLETE_SESSION_CHAIN[COMPLETE_SESSION_CHAIN.length - 1];
    assert.equal(last.endsWith("cleanup-filrouge-02-remove-server-legacy.sql"), true);
    const body = read(last);
    const idx = body.lastIndexOf("create or replace function public.complete_game_session_as_actor");
    assert.ok(idx >= 0);
    const fn = body.slice(idx, body.indexOf("\n$$;", idx) + 4);
    assert.equal(/'filRouge'/.test(fn), false);
    assert.equal(/'playlistGuess'/.test(fn), false);
    assert.match(fn, /tiernight-end/);
  });

  it("chronologie apply : vibecheck historique a filRougeScores ; dernière déf additive le retire", () => {
    const vibecheck = read("supabase/feature-vibecheck-01-remove-allowlist.sql");
    const vIdx = vibecheck.lastIndexOf("create or replace function public.apply_acting_host_play");
    assert.ok(vIdx >= 0);
    assert.match(vibecheck.slice(vIdx, vIdx + 8000), /filRougeScores/);
    const last = APPLY_ACTING_HOST_CHAIN[APPLY_ACTING_HOST_CHAIN.length - 1];
    const src = read(last);
    const idx = src.lastIndexOf("create or replace function public.apply_acting_host_play");
    assert.ok(idx >= 0, last);
    const body = src.slice(idx, src.indexOf("\n$$;", idx) + 4);
    assert.equal(body.includes("filRougeScores"), false);
    assert.match(body, /Scores soirée interdits/);
    assert.match(body, /tiernight-end/);
  });

  it("script audit Supabase READ ONLY présent", () => {
    const rel = "supabase/tests/cleanup-filrouge-02-server-audit.sql";
    assert.equal(existsSync(join(root, rel)), true);
    const src = read(rel);
    assert.equal(/\bDROP\s+(TABLE|FUNCTION|POLICY|TRIGGER|INDEX)\b/i.test(src), false);
    assert.equal(/\bALTER\s+TABLE\b/i.test(src), false);
    assert.equal(/\bUPDATE\s+\w+/i.test(src), false);
    assert.equal(/\bDELETE\s+FROM\b/i.test(src), false);
    assert.equal(/CREATE\s+OR\s+REPLACE\s+FUNCTION/i.test(src), false);
    assert.match(src, /fil_rouge_private/);
    assert.match(src, /complete_game_session_as_actor/);
  });

  it("jeux play state actuels toujours listés (non-régression catalogue sync)", () => {
    const sync = read("js/core/gameSync.js");
    const playMatch = sync.match(/const GAME_PLAY_STATE_KEYS = new Set\(\[([\s\S]*?)\]\);/);
    assert.ok(playMatch);
    const keys = [...playMatch[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    for (const need of [
      "hotTake",
      "guessLie",
      "trivia",
      "traitre",
      "tierNight",
      "tierNightLive",
    ]) {
      assert.ok(keys.includes(need), need);
    }
  });
});
