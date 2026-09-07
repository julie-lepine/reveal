/**
 * FEATURE-PROFILE-04b / C-KICK — jeton kick + archive client après DELETE.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

describe("FEATURE-PROFILE-04b — carnet après kick", () => {
  it("SQL : table allow sans GRANT client ; kick écrit avant DELETE", () => {
    const sql = read("supabase/feature-profile-04b-carnet-kick.sql");
    assert.match(sql, /create table if not exists public\.signature_carnet_kick_allow/);
    assert.match(sql, /revoke all on table public\.signature_carnet_kick_allow from authenticated/);
    assert.doesNotMatch(sql, /grant select on table public\.signature_carnet_kick_allow/);
    const kick = sql.slice(sql.indexOf("create or replace function public.kick_lobby_member"));
    const allowIdx = kick.indexOf("insert into public.signature_carnet_kick_allow");
    const delIdx = kick.indexOf("delete from public.lobby_members");
    assert.ok(allowIdx >= 0 && delIdx > allowIdx);
    assert.match(kick, /profile_pack is true/);
  });

  it("archive accepte membre OU jeton kick 30 min, pas un salon au hasard", () => {
    const sql = read("supabase/feature-profile-04b-carnet-kick.sql");
    const arch = sql.slice(sql.indexOf("create or replace function public.archive_signature_evening"));
    assert.match(arch, /is_lobby_member\(p_lobby_id\) and not v_kick_allow/);
    assert.match(arch, /interval '30 minutes'/);
    assert.match(arch, /a\.user_id = v_uid/);
    assert.match(arch, /a\.lobby_id = p_lobby_id/);
    assert.match(arch, /delete from public\.signature_carnet_kick_allow/);
  });

  it("handleKickedFromLobby archive avant wipe local", () => {
    const lobby = read("js/core/lobby.js");
    const fn = lobby.slice(
      lobby.indexOf("export async function handleKickedFromLobby"),
      lobby.indexOf("function applyHostDissolveLocalSuccess")
    );
    const archiveIdx = fn.indexOf("archiveSignatureEveningBeforeLeave");
    const wipeIdx = fn.indexOf("applyLeaveLobbyLocal");
    assert.ok(archiveIdx >= 0 && wipeIdx > archiveIdx);
  });

  it("runbook catalogue ; ne pas réexécuter 04 / kick historique", () => {
    const sql = read("supabase/feature-profile-04b-carnet-kick.sql");
    assert.match(sql, /Ne PAS réexécuter feature-profile-04-carnet/);
    const runbook = read("supabase/tests/feature-profile-04b-carnet-kick-runbook.sql");
    assert.match(runbook, /INTERDIT EN PRODUCTION/);
    assert.match(runbook, /CARNET04B_KICK_OK/);
  });
});
