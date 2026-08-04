/**
 * Membership Vague E3 - soft-hold UI post-leave (pas de checking générique).
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { saveStatePatch } from "../js/core/state.js";
import {
  getMembershipSnapshot,
  setMembershipSnapshot,
  __resetMembershipAuthForTests,
} from "../js/core/lobbyMembershipSnapshot.js";
import {
  deriveHomeMembershipChrome,
  CREATE_DISABLED_POST_LEAVE,
} from "../js/core/homeMembershipChrome.js";
import {
  beginPostLeaveHomeTransition,
  isPostLeaveHomeTransitionActive,
  getPostLeaveHomeTransitionGeneration,
  endPostLeaveHomeTransition,
  __resetPostLeaveHomeTransitionForTests,
  __getPostLeaveTransitionCallCountsForTests,
} from "../js/core/homeMembershipLeaveTransition.js";
import { commitMembershipRemoved } from "../js/core/lobbyMembershipAlign.js";
import { runVoluntaryMemberLeave } from "../js/core/voluntaryMemberLeave.js";
import {
  UID_A,
  resetMembershipSnapshotTestState,
} from "./helpers/membershipSnapshotTest.js";

const MEMBERSHIP_B = {
  lobbyId: "lobby-b-id",
  code: "BBBB",
  lobbyStatus: "waiting",
  gameId: null,
  role: "member",
  membershipId: "mem-b-1",
};

const baseChrome = {
  hasActiveLobby: false,
  loggedIn: true,
  supabaseConfigured: true,
  shouldCheckMembership: true,
  authReady: true,
  resolutionInProgress: false,
};

describe("lobbyMembershipVagueE3 - soft-hold post-leave", () => {
  beforeEach(() => {
    __resetMembershipAuthForTests();
    __resetPostLeaveHomeTransitionForTests();
    resetMembershipSnapshotTestState(UID_A);
  });

  it("1 - leave réussi + query lente : pas de Resume / checking / found ; Créer off", () => {
    setMembershipSnapshot(
      { status: "found", membership: MEMBERSHIP_B },
      "join_confirmed",
      UID_A
    );
    beginPostLeaveHomeTransition();
    commitMembershipRemoved({ userId: UID_A, lobbyId: "lobby-b-id" });

    const chrome = deriveHomeMembershipChrome({
      ...baseChrome,
      snapshot: getMembershipSnapshot(),
      resolutionInProgress: true,
      postLeaveHomeTransition: isPostLeaveHomeTransitionActive(),
    });

    assert.equal(chrome.state, "post_leave_transition");
    assert.equal(chrome.showResume, false);
    assert.equal(chrome.createEnabled, false);
    assert.equal(chrome.createDisabledReason, CREATE_DISABLED_POST_LEAVE);
    assert.equal(chrome.primaryMessage, null);
    assert.notEqual(chrome.state, "checking");
    assert.equal(getMembershipSnapshot(), null);
  });

  it("2 - résultat none : transition retirée, Créer selon règles", () => {
    beginPostLeaveHomeTransition();
    const gen = getPostLeaveHomeTransitionGeneration();
    setMembershipSnapshot({ status: "none" }, "home-query", UID_A);
    endPostLeaveHomeTransition(gen);

    const chrome = deriveHomeMembershipChrome({
      ...baseChrome,
      snapshot: getMembershipSnapshot(),
      postLeaveHomeTransition: isPostLeaveHomeTransitionActive(),
    });
    assert.equal(isPostLeaveHomeTransitionActive(), false);
    assert.equal(chrome.state, "none");
    assert.equal(chrome.createEnabled, true);
  });

  it("3 - unknown : pending avant fin soft-hold, pas de checking", () => {
    beginPostLeaveHomeTransition();
    const gen = getPostLeaveHomeTransitionGeneration();
    commitMembershipRemoved({ userId: UID_A, lobbyId: "x" }); // no-op if no found

    // Ordre atomique : pending puis end (comme Home).
    const leaveConfirmationPending = true;
    endPostLeaveHomeTransition(gen);

    const chrome = deriveHomeMembershipChrome({
      ...baseChrome,
      snapshot: null,
      resolutionInProgress: false,
      leaveConfirmationPending,
      postLeaveHomeTransition: isPostLeaveHomeTransitionActive(),
    });
    assert.equal(chrome.state, "leave_confirmation_pending");
    assert.equal(chrome.createEnabled, false);
    assert.equal(chrome.showRetry, true);
    assert.notEqual(chrome.state, "checking");
  });

  it("4 - marqueur survit conceptuellement au remount (process-level)", () => {
    beginPostLeaveHomeTransition();
    // Simule remount : nouvelle dérivation lit le même module process.
    const chrome = deriveHomeMembershipChrome({
      ...baseChrome,
      snapshot: null,
      resolutionInProgress: true,
      postLeaveHomeTransition: isPostLeaveHomeTransitionActive(),
    });
    assert.equal(isPostLeaveHomeTransitionActive(), true);
    assert.equal(chrome.state, "post_leave_transition");
    assert.notEqual(chrome.state, "checking");
  });

  it("5 - none après remount nettoie le marqueur", () => {
    const gen = beginPostLeaveHomeTransition();
    setMembershipSnapshot({ status: "none" }, "home-query", UID_A);
    endPostLeaveHomeTransition(gen);
    assert.equal(isPostLeaveHomeTransitionActive(), false);
  });

  it("6 - leave serveur échoué : pas de marqueur ; found conservé", async () => {
    setMembershipSnapshot(
      { status: "found", membership: MEMBERSHIP_B },
      "join_confirmed",
      UID_A
    );
    let began = false;
    const res = await runVoluntaryMemberLeave(
      { navigateAway: false },
      {
        getLobby: () => ({ id: "lobby-b-id", code: "BBBB" }),
        isGuest: () => false,
        isSupabaseConfigured: () => true,
        leaveLobbySupabase: async () => ({ ok: false, error: "timeout" }),
        stopMultiplayerSync: () => assert.fail("no stop"),
        stopLobbyPresenceSync: () => assert.fail("no stop"),
        signOutAnonGuestIfNeeded: async () => {},
        clearGuestMembership: () => assert.fail("no clearGuest"),
        clearLocalOpenLobbySlot: () => {},
        applyLeaveLobbyLocal: () => assert.fail("no clear"),
        getUserId: () => UID_A,
        commitMembershipRemoved: () => assert.fail("no remove"),
        beginPostLeaveHomeTransition: () => {
          began = true;
          return beginPostLeaveHomeTransition();
        },
      }
    );
    assert.equal(res.ok, false);
    assert.equal(began, false);
    assert.equal(isPostLeaveHomeTransitionActive(), false);
    assert.equal(getMembershipSnapshot()?.status, "found");
    const chrome = deriveHomeMembershipChrome({
      ...baseChrome,
      snapshot: getMembershipSnapshot(),
      postLeaveHomeTransition: false,
    });
    assert.equal(chrome.showResume, true);
  });

  it("7 - force-clear local : pas de post_leave ; found E2 conservé", () => {
    setMembershipSnapshot(
      { status: "found", membership: MEMBERSHIP_B },
      "join_confirmed",
      UID_A
    );
    saveStatePatch({ inLobby: false, lobby: null, lobbyCode: null });
    assert.equal(isPostLeaveHomeTransitionActive(), false);
    const chrome = deriveHomeMembershipChrome({
      ...baseChrome,
      snapshot: getMembershipSnapshot(),
      hasActiveLobby: false,
      postLeaveHomeTransition: false,
    });
    assert.equal(chrome.showResume, true);
    assert.equal(chrome.state, "server_membership_recoverable");
  });

  it("8 - résolution stale ne retire pas une transition plus récente", () => {
    const gen1 = beginPostLeaveHomeTransition();
    const gen2 = beginPostLeaveHomeTransition();
    assert.notEqual(gen1, gen2);
    assert.equal(endPostLeaveHomeTransition(gen1), false);
    assert.equal(isPostLeaveHomeTransitionActive(), true);
    assert.equal(endPostLeaveHomeTransition(gen2), true);
    assert.equal(isPostLeaveHomeTransitionActive(), false);
  });

  it("9 - unknown → retry → none : pending puis nettoyage", () => {
    beginPostLeaveHomeTransition();
    const gen = getPostLeaveHomeTransitionGeneration();
    let leaveConfirmationPending = true;
    endPostLeaveHomeTransition(gen);
    assert.equal(
      deriveHomeMembershipChrome({
        ...baseChrome,
        snapshot: null,
        leaveConfirmationPending,
        postLeaveHomeTransition: false,
      }).state,
      "leave_confirmation_pending"
    );

    leaveConfirmationPending = false;
    setMembershipSnapshot({ status: "none" }, "home-query", UID_A);
    assert.equal(isPostLeaveHomeTransitionActive(), false);
    assert.equal(
      deriveHomeMembershipChrome({
        ...baseChrome,
        snapshot: getMembershipSnapshot(),
        leaveConfirmationPending: false,
        postLeaveHomeTransition: false,
      }).state,
      "none"
    );
  });

  it("10 - hors leave : null + resolutionInProgress reste checking", () => {
    assert.equal(isPostLeaveHomeTransitionActive(), false);
    const chrome = deriveHomeMembershipChrome({
      ...baseChrome,
      snapshot: null,
      resolutionInProgress: true,
      postLeaveHomeTransition: false,
    });
    assert.equal(chrome.state, "checking");
    assert.match(chrome.primaryMessage || "", /Vérification de ton lobby/);
  });

  it("contrats source : begin avant commitMembershipRemoved", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");
    const root = join(dirname(fileURLToPath(import.meta.url)), "..");
    const leave = readFileSync(join(root, "js/core/voluntaryMemberLeave.js"), "utf8");
    const remoteBlock = leave.slice(
      leave.indexOf("if (remote) {"),
      leave.indexOf("// Offline / démo")
    );
    const beginIdx = remoteBlock.indexOf("deps.beginPostLeaveHomeTransition");
    const removeIdx = remoteBlock.indexOf("deps.commitMembershipRemoved");
    assert.ok(beginIdx >= 0 && removeIdx > beginIdx);

    const lobby = readFileSync(join(root, "js/core/lobby.js"), "utf8");
    assert.match(lobby, /beginPostLeaveHomeTransition/);
    const dissolve = lobby.slice(
      lobby.indexOf("export async function dissolveLobbyAsHost"),
      lobby.indexOf("export async function confirmAndLeaveLobby")
    );
    assert.ok(
      dissolve.indexOf("beginPostLeaveHomeTransition") <
        dissolve.indexOf("commitMembershipRemoved")
    );
    assert.match(dissolve, /applyHostDissolveLocalSuccess/);
    assert.match(dissolve, /invalidateCurrentLobbySessionCache/);
  });

  it("11 - postLeave + cached_active encore présent : soft-hold, pas de Resume / Retour", () => {
    beginPostLeaveHomeTransition();
    commitMembershipRemoved({ userId: UID_A, lobbyId: "lobby-b-id" });

    const chrome = deriveHomeMembershipChrome({
      ...baseChrome,
      hasActiveLobby: true,
      activeLobbyCode: "CACH",
      snapshot: null,
      resolutionInProgress: true,
      postLeaveHomeTransition: isPostLeaveHomeTransitionActive(),
    });

    assert.equal(chrome.state, "post_leave_transition");
    assert.equal(chrome.showResume, false);
    assert.equal(chrome.showReturnToLobby, false);
    assert.equal(chrome.showLeave, false);
    assert.equal(chrome.showLeaveServer, false);
    assert.equal(chrome.createEnabled, false);
    assert.equal(chrome.createDisabledReason, CREATE_DISABLED_POST_LEAVE);
    assert.notEqual(chrome.state, "cached_active");
    assert.notEqual(chrome.state, "checking");
  });

  it("12 - hors E3 : cached_active inchangé quand postLeave inactif", () => {
    const chrome = deriveHomeMembershipChrome({
      ...baseChrome,
      hasActiveLobby: true,
      activeLobbyCode: "CACH",
      snapshot: null,
      postLeaveHomeTransition: false,
    });
    assert.equal(chrome.state, "cached_active");
    assert.equal(chrome.showReturnToLobby, true);
    assert.equal(chrome.showLeave, true);
  });

  it("13 - atomicité unknown→pending : aucun checking entre end et pending", () => {
    // Contrat Home : pending = true AVANT end(gen).
    // Frame interdite : snapshot null + !transition + !pending → checking.
    beginPostLeaveHomeTransition();
    const gen = getPostLeaveHomeTransitionGeneration();

    const forbiddenIfEndFirst = () =>
      deriveHomeMembershipChrome({
        ...baseChrome,
        snapshot: null,
        leaveConfirmationPending: false,
        postLeaveHomeTransition: false,
        resolutionInProgress: false,
      }).state;
    // Prouve le trou si on endait sans pending :
    endPostLeaveHomeTransition(gen);
    assert.equal(forbiddenIfEndFirst(), "checking");

    // Contrat réel : pending avant end - derive ne voit jamais checking.
    __resetPostLeaveHomeTransitionForTests();
    beginPostLeaveHomeTransition();
    const gen2 = getPostLeaveHomeTransitionGeneration();
    const leaveConfirmationPending = true;
    // Encore postLeave + pending : pending gagne (priorité).
    assert.equal(
      deriveHomeMembershipChrome({
        ...baseChrome,
        snapshot: null,
        leaveConfirmationPending,
        postLeaveHomeTransition: true,
      }).state,
      "leave_confirmation_pending"
    );
    endPostLeaveHomeTransition(gen2);
    assert.equal(
      deriveHomeMembershipChrome({
        ...baseChrome,
        snapshot: null,
        leaveConfirmationPending: true,
        postLeaveHomeTransition: false,
      }).state,
      "leave_confirmation_pending"
    );
    assert.notEqual(
      deriveHomeMembershipChrome({
        ...baseChrome,
        snapshot: null,
        leaveConfirmationPending: true,
        postLeaveHomeTransition: false,
        resolutionInProgress: true,
      }).state,
      "checking"
    );
  });

  it("14 - leave invité cache actif : exactement un begin puis un end correspondant", async () => {
    setMembershipSnapshot(
      { status: "found", membership: MEMBERSHIP_B },
      "join_confirmed",
      UID_A
    );
    let cacheCleared = false;
    const res = await runVoluntaryMemberLeave(
      { navigateAway: false },
      {
        getLobby: () => ({ id: "lobby-b-id", code: "BBBB" }),
        isGuest: () => true,
        isSupabaseConfigured: () => true,
        leaveLobbySupabase: async () => ({ ok: true }),
        stopMultiplayerSync: () => {},
        stopLobbyPresenceSync: () => {},
        signOutAnonGuestIfNeeded: async () => {
          // Fenêtre critique : cache encore actif + transition déjà begun.
          assert.equal(isPostLeaveHomeTransitionActive(), true);
          assert.equal(
            __getPostLeaveTransitionCallCountsForTests().begin,
            1
          );
          const mid = deriveHomeMembershipChrome({
            ...baseChrome,
            hasActiveLobby: !cacheCleared,
            activeLobbyCode: "BBBB",
            snapshot: getMembershipSnapshot(),
            postLeaveHomeTransition: true,
            resolutionInProgress: true,
          });
          assert.equal(mid.state, "post_leave_transition");
          assert.equal(mid.showReturnToLobby, false);
        },
        clearGuestMembership: () => {},
        clearLocalOpenLobbySlot: () => {},
        applyLeaveLobbyLocal: () => {
          cacheCleared = true;
        },
        getUserId: () => UID_A,
        commitMembershipRemoved,
        beginPostLeaveHomeTransition,
      }
    );
    assert.equal(res.ok, true);
    const countsAfterBegin = __getPostLeaveTransitionCallCountsForTests();
    assert.equal(countsAfterBegin.begin, 1);
    assert.equal(countsAfterBegin.end, 0);
    const gen = getPostLeaveHomeTransitionGeneration();

    // Home resolveHomeMembership finally (succès none).
    endPostLeaveHomeTransition(gen);
    const counts = __getPostLeaveTransitionCallCountsForTests();
    assert.equal(counts.begin, 1);
    assert.equal(counts.end, 1);
    assert.equal(isPostLeaveHomeTransitionActive(), false);
  });

  it("15 - pipelines A/B : un seul begin par mutation (pas de begin imbriqué)", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");
    const root = join(dirname(fileURLToPath(import.meta.url)), "..");
    const lobby = readFileSync(join(root, "js/core/lobby.js"), "utf8");
    const voluntary = readFileSync(
      join(root, "js/core/voluntaryMemberLeave.js"),
      "utf8"
    );

    const dissolve = lobby.slice(
      lobby.indexOf("export async function dissolveLobbyAsHost"),
      lobby.indexOf("export async function confirmAndLeaveLobby")
    );
    const dissolveSuccess = lobby.slice(
      lobby.indexOf("function applyHostDissolveLocalSuccess"),
      lobby.indexOf("async function reconcileHostDissolveCanonicalElsewhere")
    );
    const serverOnly = lobby.slice(
      lobby.indexOf("export async function leaveLobbyMembershipFromServer"),
      lobby.indexOf("export async function transferLobbyHost")
    );
    const leaveFn = lobby.slice(
      lobby.indexOf("export async function leaveLobby("),
      lobby.indexOf("export async function leaveLobbyMembershipFromServer")
    );

    // Les trois sites ne s'appellent pas entre eux.
    assert.equal(dissolve.includes("runVoluntaryMemberLeave"), false);
    assert.equal(dissolve.includes("leaveLobbyMembershipFromServer"), false);
    assert.equal(serverOnly.includes("runVoluntaryMemberLeave"), false);
    assert.equal(serverOnly.includes("dissolveLobbyAsHost"), false);
    assert.equal(voluntary.includes("dissolveLobbyAsHost"), false);
    assert.equal(voluntary.includes("leaveLobbyMembershipFromServer"), false);

    // leaveLobby membre → runVoluntary (1 begin) ; hôte → confirm→dissolve (1 begin).
    // begin n'est pas invoqué dans leaveLobby : passé en dépendance à runVoluntary.
    assert.match(leaveFn, /runVoluntaryMemberLeave/);
    assert.equal(leaveFn.includes("beginPostLeaveHomeTransition()"), false);
    assert.match(leaveFn, /beginPostLeaveHomeTransition,/);

    // Dissolve succès : begin + commit + invalidate dans dissolveLobbyAsHost.
    assert.equal(
      (dissolveSuccess.match(/beginPostLeaveHomeTransition\(/g) || []).length,
      0
    );
    assert.match(dissolve, /applyHostDissolveLocalSuccess/);
    assert.equal(
      (dissolve.match(/beginPostLeaveHomeTransition\(/g) || []).length,
      1
    );
    assert.equal(
      (serverOnly.match(/beginPostLeaveHomeTransition\(/g) || []).length,
      1
    );

    // dissolve hôte : 1 begin + 1 end (simulation Home remount resolve).
    __resetPostLeaveHomeTransitionForTests();
    const genHost = beginPostLeaveHomeTransition();
    assert.equal(__getPostLeaveTransitionCallCountsForTests().begin, 1);
    endPostLeaveHomeTransition(genHost);
    assert.deepEqual(__getPostLeaveTransitionCallCountsForTests(), {
      begin: 1,
      end: 1,
      generation: 1,
    });

    // server-only : 1 begin + pending + 1 end (ordre Home unknown).
    __resetPostLeaveHomeTransitionForTests();
    const genSrv = beginPostLeaveHomeTransition();
    assert.equal(__getPostLeaveTransitionCallCountsForTests().begin, 1);
    const pending = true;
    endPostLeaveHomeTransition(genSrv);
    assert.equal(
      deriveHomeMembershipChrome({
        ...baseChrome,
        snapshot: null,
        leaveConfirmationPending: pending,
        postLeaveHomeTransition: false,
      }).state,
      "leave_confirmation_pending"
    );
    assert.deepEqual(__getPostLeaveTransitionCallCountsForTests(), {
      begin: 1,
      end: 1,
      generation: 1,
    });
  });
});
