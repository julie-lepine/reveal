/**
 * Vague 1 - contrats SQL sondages (statique, sans Postgres) :
 * - drift allowlist ↔ GAMES_AVAILABLE
 * - close_lobby_poll(p_poll_id, …) ciblé (pas de close aveugle par lobby)
 * - outcomes closed / already_closed / poll_not_found
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { GAMES, GAMES_AVAILABLE } from "../data/games.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SQL_PATH = join(__dirname, "../supabase/lobby-polls.sql");

const BEGIN = "-- REVEAL_POLL_GAME_ALLOWLIST_BEGIN";
const END = "-- REVEAL_POLL_GAME_ALLOWLIST_END";

function readSql() {
  return readFileSync(SQL_PATH, "utf8");
}

function extractSqlAllowlist(sql) {
  const start = sql.indexOf(BEGIN);
  const end = sql.indexOf(END);
  assert.ok(start >= 0, "marqueur BEGIN manquant dans lobby-polls.sql");
  assert.ok(end > start, "marqueur END manquant ou mal placé");
  const block = sql.slice(start + BEGIN.length, end);
  const ids = [...block.matchAll(/'([a-z0-9]+(?:-[a-z0-9]+)*)'/g)].map((m) => m[1]);
  return [...new Set(ids)];
}

/** Corps de close_lobby_poll uniquement (évite faux positifs create/vote). */
function extractCloseLobbyPollBody(sql) {
  const start = sql.indexOf("create or replace function public.close_lobby_poll");
  assert.ok(start >= 0, "close_lobby_poll manquant");
  const end = sql.indexOf("comment on function public.close_lobby_poll", start);
  assert.ok(end > start, "fin close_lobby_poll introuvable");
  return sql.slice(start, end);
}

describe("lobby poll allowlist drift (Vague 1)", () => {
  it("SQL allowlist == GAMES_AVAILABLE ids (triés)", () => {
    const fromSql = extractSqlAllowlist(readSql()).sort();
    const fromJs = GAMES_AVAILABLE.map((g) => g.id).sort();

    assert.deepEqual(
      fromSql,
      fromJs,
      `Drift allowlist sondages.\nSQL: ${fromSql.join(", ")}\nJS:  ${fromJs.join(", ")}`
    );
  });

  it("allowlist = IDs catalogue enabled, pas une liste d’écrans play reconstruite", () => {
    const catalogIds = new Set(GAMES.filter((g) => g.enabled).map((g) => g.id));
    for (const id of extractSqlAllowlist(readSql())) {
      assert.ok(catalogIds.has(id), `${id} absent de GAMES enabled`);
    }
    // Spot-check : IDs catalogue ≠ session play ids
    assert.ok(catalogIds.has("traitre-prep"));
    assert.ok(catalogIds.has("hottake-prep"));
    assert.ok(catalogIds.has("guesslie"));
    assert.ok(catalogIds.has("tiernight-select"));
    assert.equal(catalogIds.has("traitre"), false);
    assert.equal(catalogIds.has("hottake"), false);
    assert.equal(catalogIds.has("tiernight"), false);
  });

  it("au moins 2 jeux enabled (contrat options min)", () => {
    assert.ok(GAMES_AVAILABLE.length >= 2);
  });
});

describe("close_lobby_poll contrat poll_id (Vague 1)", () => {
  it("signature SQL close_lobby_poll(p_poll_id uuid, p_reason text)", () => {
    const body = extractCloseLobbyPollBody(readSql());
    assert.match(
      body,
      /create or replace function public\.close_lobby_poll\(\s*p_poll_id uuid,\s*p_reason text\s*\)/s
    );
    assert.doesNotMatch(body, /p_lobby_id/);
  });

  it("ne ferme pas aveuglément « le » open du lobby (cible where id = p_poll_id)", () => {
    const body = extractCloseLobbyPollBody(readSql());
    assert.match(body, /where p\.id = p_poll_id/);
    assert.match(body, /where id = v_poll\.id/);
    // Pas de SELECT open-only par lobby_id comme ancienne RPC
    assert.doesNotMatch(
      body,
      /where p\.lobby_id = p_lobby_id\s+and p\.status = 'open'/
    );
    assert.doesNotMatch(body, /order by p\.closed_at desc/);
  });

  it("outcomes closed, already_closed, poll_not_found (plus de no_open_poll)", () => {
    const body = extractCloseLobbyPollBody(readSql());
    assert.match(body, /'outcome',\s*'closed'/);
    assert.match(body, /'outcome',\s*'already_closed'/);
    assert.match(body, /'outcome',\s*'poll_not_found'/);
    assert.doesNotMatch(body, /no_open_poll/);
  });

  it("documente la phase create dans le SQL", () => {
    const sql = readSql();
    assert.match(sql, /poll_creation_not_allowed_in_current_phase/);
    assert.match(sql, /can_create_lobby_poll_phase/);
    assert.match(sql, /screen in \('results', 'leaderboard', 'game-select'\)/);
  });

  it("close autorisé hôte, acting host ou créateur (created_by)", () => {
    const body = extractCloseLobbyPollBody(readSql());
    assert.match(body, /is_lobby_host\(v_lobby_id\)/);
    assert.match(body, /is_acting_host\(v_lobby_id\)/);
    assert.match(body, /v_poll\.created_by is not null and v_poll\.created_by = v_uid/);
  });
});
