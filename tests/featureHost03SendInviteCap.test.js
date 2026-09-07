/**
 * FEATURE-HOST-03 / H-INVITE-FULL — send_lobby_invite refuse si salon plein.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  LOBBY_INVITE_ACTION,
  LOBBY_INVITE_LABEL,
  LOBBY_INVITE_RPC_ERROR,
  friendInviteAction,
} from "../js/config/lobbyInvites.js";
import { lobbyInviteFailMessage } from "../js/core/lobbyInvitesLogic.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

describe("FEATURE-HOST-03 — send invite cap (salon plein)", () => {
  it("delta SQL : send refuse via lobby_max_players, pas un hard 8", () => {
    const sql = read("supabase/feature-host-03-send-invite-cap.sql");
    assert.match(sql, /create or replace function public\.send_lobby_invite/);
    assert.match(
      sql,
      /get_lobby_member_count\(v_lobby_id\) >= public\.lobby_max_players\(v_lobby_id\)/
    );
    assert.match(sql, /raise exception 'lobby_invite_full'/);
    assert.doesNotMatch(sql, /get_lobby_member_count\(v_lobby_id\) >= 8/);
    assert.match(sql, /Ne PAS réexécuter feature-friends-02/);
    assert.match(sql, /H-INVITE-TRANSFER/);
    assert.doesNotMatch(sql, /create or replace function public\.accept_lobby_invite/);
  });

  it("HOST-02 ne remplace plus send ; HOST-03 est le gate d’envoi", () => {
    const host02 = read("supabase/feature-host-02-invite-cap.sql");
    assert.doesNotMatch(host02, /create or replace function public\.send_lobby_invite/);
    assert.match(host02, /FEATURE-HOST-03/);
  });

  it("UI : bouton Soirée complète ; RPC full inchangé", () => {
    assert.equal(LOBBY_INVITE_ACTION.full, "full");
    assert.equal(LOBBY_INVITE_LABEL.full, "Soirée complète");
    assert.equal(
      friendInviteAction({
        localIsRegistered: true,
        localInLobby: true,
        lobbyFull: true,
      }),
      LOBBY_INVITE_ACTION.full
    );
    assert.equal(
      friendInviteAction({
        localIsRegistered: true,
        localInLobby: true,
        pendingOut: true,
        lobbyFull: true,
      }),
      LOBBY_INVITE_ACTION.sent
    );
    assert.equal(
      friendInviteAction({ localIsRegistered: true, localInLobby: true }),
      LOBBY_INVITE_ACTION.invite
    );
    assert.equal(lobbyInviteFailMessage(LOBBY_INVITE_RPC_ERROR.full), "Cette soirée est complète.");
    const friends = read("js/screens/friends.js");
    assert.match(friends, /isCurrentLobbyFull/);
    assert.match(friends, /data-lobby-invite-full/);
    assert.match(friends, /LOBBY_INVITE_ACTION\.full/);
    const lobbyCore = read("js/core/lobby.js");
    assert.match(lobbyCore, /export function isCurrentLobbyFull/);
  });

  it("runbook catalogue refuse un send encore sans cap", () => {
    const runbook = read("supabase/tests/feature-host-03-send-invite-cap-runbook.sql");
    assert.match(runbook, /INTERDIT EN PRODUCTION/);
    assert.match(runbook, /HOST03_SEND_INVITE_CAP_OK/);
    assert.match(runbook, /HOST03_SEND_NO_CAP/);
    assert.match(runbook, /lobby_max_players/);
  });
});
