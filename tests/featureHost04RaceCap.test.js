/**
 * FEATURE-HOST-04 / H-RACE — cap sièges concurrent-safe (lock lobby puis count).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  LOBBY_FULL_MSG,
  LOBBY_FULL_SQL,
  isLobbyFullServerError,
} from "../js/config/lobbyLifecycle.js";
import { LOBBY_INVITE_RPC_ERROR } from "../js/config/lobbyInvites.js";
import { lobbyInviteFailMessage } from "../js/core/lobbyInvitesLogic.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

function triggerFn(sql) {
  const start = sql.indexOf("create or replace function public.lobby_members_enforce_seat_cap");
  const end = sql.indexOf("$$;", start);
  assert.ok(start >= 0 && end > start, "fonction trigger introuvable");
  return sql.slice(start, end);
}

describe("FEATURE-HOST-04 / H-RACE — seat cap concurrent-safe", () => {
  const sql = read("supabase/feature-host-04-race-cap.sql");
  const fn = triggerFn(sql);
  const runbook = read("supabase/tests/feature-host-04-race-cap-runbook.sql");
  const concurrent = read("supabase/tests/feature-host-04-race-cap-concurrent.sql");
  const join = read("js/core/supabaseLobby.js");
  const schema = read("supabase/schema.sql");
  const host02 = read("supabase/feature-host-02-invite-cap.sql");
  const host03 = read("supabase/feature-host-03-send-invite-cap.sql");
  const transfer = read("supabase/transfer-lobby-host.sql");

  it("lock FOR UPDATE avant cap et count ; exception lobby_full ; pas de DELETE", () => {
    assert.match(fn, /h-race-v1/);
    assert.match(fn, /security definer/);
    const lock = fn.toLowerCase().indexOf("for update");
    const cap = fn.indexOf("lobby_max_players");
    const count = fn.indexOf("get_lobby_member_count");
    assert.ok(lock >= 0 && cap > lock && count > cap, "ordre lock → cap → count");
    assert.match(fn, /raise exception 'lobby_full'/);
    assert.equal(/delete from/i.test(fn), false);
    assert.equal(/lock table/i.test(fn), false);
    assert.match(sql, /before insert on public\.lobby_members/);
    assert.match(sql, /create trigger lobby_members_enforce_seat_cap/);
    assert.match(sql, /revoke all on function public\.lobby_members_enforce_seat_cap\(\) from authenticated/);
  });

  it("ne réécrit pas HOST-02 / HOST-03 / transfer / RLS insert self", () => {
    assert.doesNotMatch(sql, /create or replace function public\.accept_lobby_invite/);
    assert.doesNotMatch(sql, /create or replace function public\.send_lobby_invite/);
    assert.doesNotMatch(sql, /create or replace function public\.lobby_max_players/);
    assert.doesNotMatch(sql, /create or replace function public\.transfer_lobby_host/);
    assert.doesNotMatch(sql, /create or replace function public\.get_lobby_member_count/);
    assert.match(schema, /members_insert_self/);
    assert.match(schema, /auth\.uid\(\) = user_id/);
    assert.match(host02, /pg_advisory_xact_lock/);
    assert.match(host03, /raise exception 'lobby_invite_full'/);
    assert.match(transfer, /set host_id = p_new_host_user_id/);
    assert.doesNotMatch(transfer, /delete from public\.lobby_members/);
  });

  it("client : check UX conservé ; trigger lobby_full mappé", () => {
    assert.match(join, /UX : refus rapide/);
    assert.match(join, /get_lobby_member_count/);
    assert.match(join, /isLobbyFullServerError\(joinErr\)/);
    assert.equal(LOBBY_FULL_SQL, "lobby_full");
    assert.equal(isLobbyFullServerError({ message: "lobby_full" }), true);
    assert.equal(isLobbyFullServerError({ message: LOBBY_FULL_MSG }), true);
    assert.equal(isLobbyFullServerError({ message: "lobby_invite_full" }), false);
    assert.equal(isLobbyFullServerError({ message: "permission denied" }), false);
    assert.equal(LOBBY_INVITE_RPC_ERROR.lobbyFull, "lobby_full");
    assert.equal(
      lobbyInviteFailMessage(LOBBY_INVITE_RPC_ERROR.lobbyFull),
      "Cette soirée est complète."
    );
    assert.equal(
      lobbyInviteFailMessage(LOBBY_INVITE_RPC_ERROR.full),
      "Cette soirée est complète."
    );
  });

  it("runbook catalogue + concurrent 2 sessions documentés", () => {
    assert.match(runbook, /HRACE_SEAT_CAP_OK/);
    assert.match(runbook, /HRACE_LOCK_AFTER_COUNT/);
    assert.match(runbook, /members_insert_self/);
    assert.match(runbook, /INTERDIT EN PRODUCTION/);
    assert.match(concurrent, /2 sessions SQL/);
    assert.match(concurrent, /pg_sleep\(8\)/);
    assert.match(concurrent, /ERROR lobby_full/);
    assert.match(concurrent, /H-TRANSFER/);
    assert.match(concurrent, /n = cap/);
    assert.match(concurrent, /N'EST PAS exécuté par `npm test`/);
  });
});
