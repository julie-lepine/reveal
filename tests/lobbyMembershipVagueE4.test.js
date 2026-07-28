/**
 * Membership Vague E4 — UNIQUE user + create_lobby_atomically + mapping 23505.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  LOBBY_MEMBERS_ONE_LIVING_PER_USER,
  isLobbyMembersOneLivingPerUserConflict,
} from "../js/core/lobbyMembershipUniqueConflict.js";
import { LOBBY_CREATE_ERROR } from "../js/core/lobbyCreateGuard.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

function read(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

describe("lobbyMembershipVagueE4 — contrainte & mapping", () => {
  it("13 — conflit précis lobby_members(user_id) détecté", () => {
    assert.equal(
      isLobbyMembersOneLivingPerUserConflict({
        code: "23505",
        message: `duplicate key value violates unique constraint "${LOBBY_MEMBERS_ONE_LIVING_PER_USER}"`,
        constraint: LOBBY_MEMBERS_ONE_LIVING_PER_USER,
      }),
      true
    );
    assert.equal(
      isLobbyMembersOneLivingPerUserConflict({
        code: "23505",
        details: "Key (user_id)=(abc) already exists.",
        message: 'duplicate key value violates unique constraint on "lobby_members"',
      }),
      true
    );
  });

  it("13b — forme PostgREST réelle typique SANS champ constraint", () => {
    // Forme documentée PostgREST / supabase-js (constraint souvent absent).
    const postgrestShape = {
      code: "23505",
      message: `duplicate key value violates unique constraint "${LOBBY_MEMBERS_ONE_LIVING_PER_USER}"`,
      details: "Key (user_id)=(11111111-1111-1111-1111-111111111111) already exists.",
      hint: null,
    };
    assert.equal(postgrestShape.constraint, undefined);
    assert.equal(isLobbyMembersOneLivingPerUserConflict(postgrestShape), true);
  });

  it("13c — reclaim métier avec nom d’index dans le message", () => {
    assert.equal(
      isLobbyMembersOneLivingPerUserConflict({
        code: "P0001",
        message:
          "Tu es déjà dans une autre soirée. Quitte-la avant de reprendre cette place. (lobby_members_one_living_per_user)",
      }),
      true
    );
  });

  it("14 — autre 23505 non confondu avec ALREADY_EXISTS membership", () => {
    assert.equal(
      isLobbyMembersOneLivingPerUserConflict({
        code: "23505",
        message: 'duplicate key value violates unique constraint "lobbies_code_key"',
        details: "Key (code)=(ABCDEF) already exists.",
        hint: null,
      }),
      false
    );
    assert.equal(
      isLobbyMembersOneLivingPerUserConflict({
        code: "23505",
        message:
          'duplicate key value violates unique constraint "lobby_members_lobby_id_user_id_key"',
        details: "Key (lobby_id, user_id)=(x,y) already exists.",
      }),
      false
    );
    assert.equal(
      isLobbyMembersOneLivingPerUserConflict({
        code: "23505",
        message:
          'duplicate key value violates unique constraint "lobby_members_unique_name_per_lobby_ci"',
        details: "Key (lobby_id, upper)=(...) already exists.",
      }),
      false
    );
  });

  it("15 — Vague C codes toujours présents ; createLobby n’est plus l’autorité INSERT", () => {
    assert.equal(LOBBY_CREATE_ERROR.ALREADY_EXISTS, "LOBBY_MEMBERSHIP_ALREADY_EXISTS");
    assert.equal(LOBBY_CREATE_ERROR.CHECK_FAILED, "LOBBY_MEMBERSHIP_CHECK_FAILED");
    const lobby = read("js/core/lobby.js");
    const createIdx = lobby.indexOf("export async function createLobby()");
    const createBlock = lobby.slice(createIdx, lobby.indexOf("export async function joinLobby"));
    assert.match(createBlock, /assertCanInsertLobby/);
    assert.match(createBlock, /createLobbySupabase/);
    assert.match(createBlock, /recoverAfterMembershipAlreadyExists/);
  });
});

describe("lobbyMembershipVagueE4 — contrats source", () => {
  it("10 — CREATED via create_lobby_atomically + promote E2 existant", () => {
    const src = read("js/core/supabaseLobby.js");
    assert.match(src, /create_lobby_atomically/);
    assert.equal(src.includes('rpc(\n    "create_lobby_member"'), false);
    assert.match(src, /CREATE_CONFIRMED/);
    assert.match(src, /canonicalRow: memberData/);
  });

  it("11 — ALREADY_EXISTS → invalidate + query + recover (pas faux found RPC)", () => {
    const src = read("js/core/supabaseLobby.js");
    const fn = src.slice(
      src.indexOf("export async function recoverAfterMembershipAlreadyExists"),
      src.indexOf("export async function joinLobbySupabase")
    );
    assert.match(fn, /invalidateMembershipSnapshot/);
    assert.match(fn, /queryActiveLobbyMembership/);
    assert.match(fn, /applyMembershipQueryToSnapshot/);
    assert.match(fn, /recoverLobbyFromServer/);
    assert.equal(fn.includes('status: "found"'), false);
    assert.match(fn, /unknown/);
  });

  it("12 — re-query unknown ne fabrique pas found (source)", () => {
    const src = read("js/core/supabaseLobby.js");
    const fn = src.slice(
      src.indexOf("export async function recoverAfterMembershipAlreadyExists"),
      src.indexOf("export async function joinLobbySupabase")
    );
    assert.match(fn, /result\.status === "unknown"/);
    assert.match(fn, /unknown:\s*true/);
  });

  it("SQL e4-01/02/03 Option A ; pas de purge ; anon sans EXECUTE create_atomically", () => {
    const rpc = read("supabase/lobby-membership-e4-01-create-lobby-atomically.sql");
    assert.match(rpc, /create_lobby_atomically/);
    assert.match(rpc, /pg_advisory_xact_lock/);
    assert.match(rpc, /ALREADY_EXISTS/);
    assert.match(rpc, /auth\.uid\(\)/);
    assert.equal(/p_user_id/i.test(rpc), false);
    assert.match(rpc, /REVOKE ALL[\s\S]*FROM anon/);
    assert.match(rpc, /GRANT EXECUTE[\s\S]*TO authenticated/);

    const uniq = read("supabase/lobby-membership-e4-02-unique-user-index.sql");
    assert.match(uniq, /lobby_members_one_living_per_user/);
    assert.match(uniq, /RAISE EXCEPTION/);
    assert.match(uniq, /HAVING count\(\*\) > 1/);
    assert.equal(/DELETE FROM public\.lobby_members/i.test(uniq), false);
    assert.match(uniq, /v_other_lobby/);

    const dep = read("supabase/lobby-membership-e4-03-deprecate-create-lobby-member.sql");
    assert.match(dep, /E4_RPC_DEPRECATED/);
    assert.equal(/REVOKE ALL/i.test(dep), false);

    const rev = read("supabase/lobby-membership-e4-03b-revoke-create-lobby-member.sql");
    assert.match(rev, /REVOKE ALL/);
  });

  it("join mappe membership_already_elsewhere vers recover", () => {
    const lobby = read("js/core/lobby.js");
    assert.match(lobby, /membership_already_elsewhere/);
    assert.match(lobby, /recoverAfterMembershipAlreadyExists/);
    const sb = read("js/core/supabaseLobby.js");
    assert.match(sb, /isLobbyMembersOneLivingPerUserConflict/);
  });
});
