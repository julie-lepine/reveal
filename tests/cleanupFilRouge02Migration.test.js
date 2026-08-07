/**
 * CLEANUP-FILROUGE-02 D3 — migration additive serveur (statique, non appliquée).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GAMES } from "../data/games.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const MIG = "supabase/cleanup-filrouge-02-remove-server-legacy.sql";
const POST = "supabase/tests/cleanup-filrouge-02-postdeploy-check.sql";

function read(rel) {
  return readFileSync(join(root, rel), "utf8");
}

function extractFn(src, name) {
  const needle = `create or replace function public.${name}`;
  let idx = 0;
  let last = null;
  while (true) {
    const i = src.toLowerCase().indexOf(needle.toLowerCase(), idx);
    if (i < 0) break;
    const slice = src.slice(i);
    const end = slice.indexOf("\n$$;");
    last = end >= 0 ? slice.slice(0, end + 4) : null;
    idx = i + 1;
  }
  return last;
}

describe("CLEANUP-FILROUGE-02 D3 - migration additive", () => {
  it("fichier migration + post-deploy présents", () => {
    assert.equal(existsSync(join(root, MIG)), true);
    assert.equal(existsSync(join(root, POST)), true);
  });

  it("aucune mutation ACL / COMMENT hors delta cleanup", () => {
    const src = read(MIG);
    assert.doesNotMatch(src, /^\s*revoke\b/im);
    assert.doesNotMatch(src, /^\s*grant\b/im);
    assert.doesNotMatch(src, /^\s*comment\s+on\s+function\b/im);
  });

  it("garde MD5 D2 + transaction + DROP sans CASCADE", () => {
    const src = read(MIG);
    assert.match(src, /\bbegin\s*;/i);
    assert.match(src, /\bcommit\s*;/i);
    assert.match(src, /2e3b71353bb2382e73b6b9dc11e4f7e7/);
    assert.match(src, /31d85c1ac8cd341d360e6cf1fed37d10/);
    assert.match(src, /259fe9e655dbd0577452a06dc7ccfcb2/);
    assert.match(src, /CLEANUP-FILROUGE-02 aborted/);
    assert.match(src, /drop table if exists public\.fil_rouge_private\s*;/i);
    assert.doesNotMatch(src, /drop table if exists public\.fil_rouge_private\s+cascade/i);
  });

  it("redéfinit les trois signatures exactes", () => {
    const src = read(MIG);
    assert.match(
      src,
      /create or replace function public\.apply_acting_host_play\(\s*p_lobby_id uuid,/i
    );
    assert.match(
      src,
      /create or replace function public\.complete_game_session_as_actor\(\s*p_lobby_id uuid,/i
    );
    assert.match(
      src,
      /create or replace function public\.remap_lobby_user_id\(\s*p_lobby_id uuid,/i
    );
  });

  it("apply TARGET : plus de filRougeScores ; tiernight-end conservé", () => {
    const body = extractFn(read(MIG), "apply_acting_host_play");
    assert.ok(body);
    assert.equal(body.includes("filRougeScores"), false);
    assert.equal(/filRouge/i.test(body), false);
    assert.match(body, /Scores soirée interdits/);
    assert.match(body, /'scores','stats','playerStats','eveningGamesRecorded'/);
    assert.match(body, /tiernight-end/);
    assert.match(body, /validate_trivia_acting_host_patch/);
  });

  it("complete TARGET : sans filRouge/playlistGuess ; contrats TierNight/GuessLie", () => {
    const body = extractFn(read(MIG), "complete_game_session_as_actor");
    assert.ok(body);
    assert.equal(/'filRouge'/.test(body), false);
    assert.equal(/'playlistGuess'/.test(body), false);
    assert.match(body, /'tierNight'/);
    assert.match(body, /'tierNightLive'/);
    assert.match(body, /tiernight-end/);
    assert.match(body, /finished/);
    assert.match(body, /'guessLie'/);
    assert.match(body, /lobbyComplete/);
  });

  it("remap TARGET : sans fil_rouge_private ; Traître / messages / sessions", () => {
    const body = extractFn(read(MIG), "remap_lobby_user_id");
    assert.ok(body);
    assert.equal(body.includes("fil_rouge_private"), false);
    assert.match(body, /traitre_private/);
    assert.match(body, /lobby_messages/);
    assert.match(body, /game_sessions/);
    assert.match(body, /jsonb_replace_uid/);
  });

  it("migrations historiques Fil Rouge non réécrites (fichiers inchangés de contrat)", () => {
    assert.match(read("supabase/bug-tiernight-series-qa-01-complete-screen.sql"), /'filRouge'/);
    assert.match(
      read("supabase/feature-vibecheck-01-remove-allowlist.sql"),
      /filRougeScores/
    );
    assert.match(read("supabase/reclaim-guest-membership.sql"), /fil_rouge_private/);
  });

  it("JS : stripLegacyFilRougeKeys + gameScoreSessionKey conservés", () => {
    const state = read("js/core/state.js");
    assert.match(state, /export function stripLegacyFilRougeKeys/);
    assert.match(state, /gameScoreSessionKey/);
    assert.match(read("js/core/gameSync.js"), /"gameScoreSessionKey"/);
  });

  it("Playlist Guess absent catalogue / routes / runtime js", () => {
    for (const g of GAMES) {
      assert.equal(/playlistguess|vibecheck/i.test(JSON.stringify(g)), false, g.id);
    }
    assert.equal(/playlistguess|playlistGuess|VibeCheck/i.test(read("js/main.js")), false);
    // Grep léger : aucun fichier js/core|screens|games ne doit référencer playlistguess
    const sync = read("js/core/gameSync.js");
    assert.doesNotMatch(sync, /playlistguess|playlistGuess/);
  });

  it("post-deploy check est READ ONLY SELECT", () => {
    const src = read(POST);
    assert.equal(/\bDROP\s+TABLE\b/i.test(src), false);
    assert.equal(/\bALTER\s+TABLE\b/i.test(src), false);
    assert.equal(/\bUPDATE\s+\w+/i.test(src), false);
    assert.equal(/\bDELETE\s+FROM\b/i.test(src), false);
    assert.equal(/CREATE\s+OR\s+REPLACE\s+FUNCTION/i.test(src), false);
    assert.match(src, /fil_rouge_private/);
    assert.match(src, /complete_game_session_as_actor/);
  });
});
