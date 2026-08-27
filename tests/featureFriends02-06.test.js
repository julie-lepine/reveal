/**
 * FEATURE-FRIENDS-02 Palier 6 — Rejoindre sans code + modale déjà ailleurs.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LOBBY_INVITE_RPC_ERROR } from "../js/config/lobbyInvites.js";
import {
  lobbyInviteAcceptPlan,
  lobbyInviteFailMessage,
} from "../js/core/lobbyInvitesLogic.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

describe("FEATURE-FRIENDS-02 Palier 6 — join sans code", () => {
  it("plan client : join / déjà ici / déjà ailleurs (pas d’auto-leave)", () => {
    assert.equal(lobbyInviteAcceptPlan({}), "join");
    assert.equal(
      lobbyInviteAcceptPlan({
        localInLobby: true,
        localLobbyId: "L1",
        inviteLobbyId: "L1",
      }),
      "already_in"
    );
    assert.equal(
      lobbyInviteAcceptPlan({
        localInLobby: true,
        localLobbyId: "L1",
        inviteLobbyId: "L2",
      }),
      "busy"
    );
    assert.equal(
      lobbyInviteAcceptPlan({
        localInLobby: false,
        localLobbyId: null,
        inviteLobbyId: "L2",
      }),
      "join"
    );
  });

  it("alertes plein / fermé / gone ; busy n’est pas un join", () => {
    assert.equal(lobbyInviteFailMessage(LOBBY_INVITE_RPC_ERROR.full), "Cette soirée est complète.");
    assert.equal(
      lobbyInviteFailMessage(LOBBY_INVITE_RPC_ERROR.closed),
      "Cette soirée n’est plus disponible."
    );
    assert.equal(
      lobbyInviteFailMessage(LOBBY_INVITE_RPC_ERROR.gone),
      "Cette invitation n’est plus valable."
    );
    assert.match(lobbyInviteFailMessage(LOBBY_INVITE_RPC_ERROR.busy), /une à la fois/);
  });

  it("join : accept puis hydrate par id, jamais le code, jamais le chat", () => {
    const src = read("js/core/lobbyInviteJoin.js");
    const joinStart = src.indexOf("export async function joinFromLobbyInvite");
    const refuseStart = src.indexOf("export async function refuseLobbyInvite");
    assert.ok(joinStart >= 0 && refuseStart > joinStart);
    const joinFn = src.slice(joinStart, refuseStart);
    assert.match(joinFn, /acceptLobbyInvite/);
    assert.match(joinFn, /hydrateAfterLobbyInviteAccept/);
    assert.doesNotMatch(joinFn, /leaveLobby\(/);
    assert.match(src, /refreshLobbyFromSupabase/);
    assert.match(src, /goToLobby/);
    assert.doesNotMatch(src, /find_lobby_by_code/);
    assert.doesNotMatch(src, /lobby_messages/);
    const catchIdx = joinFn.indexOf("} catch (err)");
    const hydrateIdx = joinFn.indexOf("hydrateAfterLobbyInviteAccept");
    assert.ok(hydrateIdx > 0 && catchIdx > hydrateIdx);
  });

  it("Quitter et rejoindre : leave puis accept ; Refuser ne quitte pas", () => {
    const src = read("js/core/lobbyInviteJoin.js");
    const leaveJoin = src.slice(src.indexOf("export async function leaveAndJoinFromLobbyInvite"));
    assert.match(leaveJoin, /leaveLobby\(\{\s*navigateAway:\s*false,\s*skipConfirm:\s*true\s*\}\)/);
    assert.match(leaveJoin, /skipLocalBusy:\s*true/);
    const refuse = src.slice(
      src.indexOf("export async function refuseLobbyInvite"),
      src.indexOf("export async function leaveAndJoinFromLobbyInvite")
    );
    assert.match(refuse, /declineLobbyInvite/);
    assert.doesNotMatch(refuse, /leaveLobby/);
    assert.doesNotMatch(refuse, /acceptLobbyInvite/);
  });

  it("page Amis + popup : rester / quitter ; dismiss laisse l’invite", () => {
    const friends = read("js/screens/friends.js");
    assert.match(friends, /lobbyInviteAcceptPlan/);
    assert.match(friends, /stay_and_refuse/);
    assert.match(friends, /leaveAndJoinFromLobbyInvite/);
    assert.match(friends, /refuseLobbyInvite|onRefuseInvite/);
    assert.match(friends, /dismissResult:\s*null/);
    assert.match(friends, /lobbyInviteFailMessage/);
    const notice = read("js/core/lobbyInviteNotice.js");
    assert.match(notice, /lobbyInviteAcceptPlan/);
    assert.match(notice, /leaveAndJoinFromLobbyInvite/);
    assert.match(notice, /stay_and_refuse/);
    assert.match(notice, /dismissResult:\s*null/);
    assert.match(notice, /lobbyInviteFailMessage/);
  });

  it("hôte : skipConfirm dissolve sans 2e modale ; serveur filet busy / 8", () => {
    const lobby = read("js/core/lobby.js");
    assert.match(lobby, /skipConfirm/);
    assert.match(lobby, /if \(skipConfirm\) \{\s*return dissolveLobbyAsHost/);
    const sql = read("supabase/feature-friends-02.sql");
    assert.match(sql, /raise exception 'lobby_invite_busy'/);
    assert.match(sql, /raise exception 'lobby_invite_full'/);
    assert.match(sql, /raise exception 'lobby_invite_closed'/);
    assert.match(sql, /get_lobby_member_count\(v_lobby_id\) >= 8/);
    assert.match(sql, /Jamais auto-leave/);
    const wrap = read("js/core/supabaseLobbyInvites.js");
    assert.doesNotMatch(wrap, /leaveLobby/);
    assert.doesNotMatch(wrap, /find_lobby_by_code/);
  });
});
