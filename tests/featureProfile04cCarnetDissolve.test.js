/**
 * FEATURE-PROFILE-04c / C-DISSOLVE — jetons dissolve + archive client.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

describe("FEATURE-PROFILE-04c — carnet après dissolve", () => {
  it("SQL : jetons Signature avant DELETE lobby ; pas de GRANT client", () => {
    const sql = read("supabase/feature-profile-04c-carnet-dissolve.sql");
    const fn = sql.slice(
      sql.indexOf("create or replace function public.dissolve_lobby_atomically")
    );
    const allowIdx = fn.indexOf("insert into public.signature_carnet_kick_allow");
    const delIdx = fn.indexOf("delete from public.lobbies");
    assert.ok(allowIdx >= 0 && delIdx > allowIdx);
    assert.match(fn, /profile_pack is true/);
    assert.match(fn, /DISSOLVED/);
    assert.match(fn, /host_closed/);
    assert.doesNotMatch(sql, /grant select on table public\.signature_carnet_kick_allow/);
    assert.doesNotMatch(sql, /purge_stale_lobbies/);
  });

  it("resolveLobbyClosureAndExit archive avant wipe local", () => {
    const lobby = read("js/core/lobby.js");
    const fn = lobby.slice(
      lobby.indexOf("export async function resolveLobbyClosureAndExit"),
      lobby.indexOf("export async function handleLobbyDissolvedForGuest")
    );
    const afterFlag = fn.slice(fn.indexOf("lobbyDissolveHandling = true"));
    const archiveIdx = afterFlag.indexOf("archiveSignatureEveningBeforeLeave");
    const wipeIdx = afterFlag.indexOf("applyLeaveLobbyLocal");
    assert.ok(archiveIdx >= 0 && wipeIdx > archiveIdx);
    assert.match(fn, /archivePayload/);
    const snapIdx = fn.indexOf("collectSignatureEveningArchivePayload");
    const flagIdx = fn.indexOf("lobbyDissolveHandling = true");
    assert.ok(snapIdx >= 0 && flagIdx > snapIdx);
  });

  it("Realtime / gone : snapshot avant await dissolve", () => {
    const src = read("js/core/supabaseLobby.js");
    const rt = src.slice(
      src.indexOf('event: "DELETE"'),
      src.indexOf('table: "game_sessions"')
    );
    const snapIdx = rt.indexOf("collectSignatureEveningArchivePayload");
    const importIdx = rt.indexOf('import("./lobby.js")');
    assert.ok(snapIdx >= 0 && importIdx > snapIdx);
    assert.match(rt, /archivePayload/);

    const gone = src.slice(
      src.indexOf("async function handlePossibleLobbyGone"),
      src.indexOf("const DISPLAY_NAME_TAKEN_MSG")
    );
    assert.match(
      gone,
      /resolveLobbyClosureAndExit\(\s*\{[\s\S]*archivePayload/
    );
  });

  it("runbook catalogue ; ne pas réexécuter 04 / 04b / xx-e", () => {
    const sql = read("supabase/feature-profile-04c-carnet-dissolve.sql");
    assert.match(sql, /Ne PAS réexécuter feature-profile-04-carnet/);
    assert.match(sql, /lobby-closures-xx-e/);
    const runbook = read(
      "supabase/tests/feature-profile-04c-carnet-dissolve-runbook.sql"
    );
    assert.match(runbook, /INTERDIT EN PRODUCTION/);
    assert.match(runbook, /CARNET04C_DISSOLVE_OK/);
  });
});
