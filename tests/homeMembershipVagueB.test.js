import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  deriveHomeMembershipChrome,
  decideMembershipSnapshotWrite,
} from "../js/core/homeMembershipChrome.js";
import {
  UID_A,
  sameIdentity,
  resetMembershipSnapshotTestState,
} from "./helpers/membershipSnapshotTest.js";
import {
  getMembershipSnapshot,
  setMembershipSnapshot,
  invalidateMembershipSnapshot,
} from "../js/core/lobbyMembershipSnapshot.js";
import {
  createMountGuard,
  advanceMountGeneration,
  resetMountGenerationForTests,
} from "../js/core/mountLifecycle.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const FOUND_MEMBERSHIP = {
  lobbyId: "lobby-1",
  code: "ABCD",
  lobbyStatus: "waiting",
  gameId: "guesslie",
  role: "member",
};

const foundSnap = () => ({
  status: "found",
  userId: UID_A,
  membership: { ...FOUND_MEMBERSHIP },
  extraCount: 0,
});

describe("homeMembershipVagueB — machine d’états", () => {
  it("1 — premier mount sans snapshot → checking", () => {
    const chrome = deriveHomeMembershipChrome({
      hasActiveLobby: false,
      snapshot: null,
      resolutionInProgress: true,
      authReady: true,
      supabaseConfigured: true,
      loggedIn: true,
      shouldCheckMembership: true,
    });
    assert.equal(chrome.state, "checking");
    assert.equal(chrome.createEnabled, false);
    assert.equal(chrome.showResume, false);
  });

  it("2 — résultat serveur none → none", () => {
    const chrome = deriveHomeMembershipChrome({
      hasActiveLobby: false,
      snapshot: { status: "none" },
      resolutionInProgress: false,
      authReady: true,
      supabaseConfigured: true,
      loggedIn: true,
      shouldCheckMembership: true,
    });
    assert.equal(chrome.state, "none");
    assert.equal(chrome.createEnabled, true);
  });

  it("3 — found, cache absent → server_membership_recoverable", () => {
    const chrome = deriveHomeMembershipChrome({
      hasActiveLobby: false,
      snapshot: foundSnap(),
      resolutionInProgress: false,
      authReady: true,
      supabaseConfigured: true,
      loggedIn: true,
      shouldCheckMembership: true,
    });
    assert.equal(chrome.state, "server_membership_recoverable");
    assert.equal(chrome.showResume, true);
    assert.equal(chrome.membershipCode, "ABCD");
    assert.equal(chrome.createEnabled, false);
    assert.equal(chrome.showLeave, false);
    assert.equal(chrome.showLeavePrepDisabled, false);
    assert.equal(chrome.showLeaveServer, true);
  });

  it("4 — cache actif → cached_active", () => {
    const chrome = deriveHomeMembershipChrome({
      hasActiveLobby: true,
      snapshot: foundSnap(),
      resolutionInProgress: true,
      authReady: true,
      supabaseConfigured: true,
      loggedIn: true,
      shouldCheckMembership: true,
      activeLobbyCode: "ZZZZ",
    });
    assert.equal(chrome.state, "cached_active");
    assert.equal(chrome.showReturnToLobby, true);
    assert.equal(chrome.showLeave, true);
    assert.equal(chrome.showResume, false);
    assert.equal(chrome.createEnabled, false);
  });

  it("5 — unknown sans ancien found → check_failed", () => {
    const chrome = deriveHomeMembershipChrome({
      hasActiveLobby: false,
      snapshot: { status: "unknown" },
      resolutionInProgress: false,
      authReady: true,
      supabaseConfigured: true,
      loggedIn: true,
      shouldCheckMembership: true,
    });
    assert.equal(chrome.state, "check_failed");
    assert.equal(chrome.showRetry, true);
    assert.equal(chrome.createEnabled, false);
    assert.equal(chrome.showResume, false);
  });

  it("6 — ancien found puis unknown → rétention (decide + chrome)", () => {
    const decision = decideMembershipSnapshotWrite(
      foundSnap(),
      { status: "unknown" },
      "membership-query",
      sameIdentity()
    );
    assert.equal(decision.action, "retain_found_same_identity");

    const chrome = deriveHomeMembershipChrome({
      hasActiveLobby: false,
      snapshot: foundSnap(),
      resolutionInProgress: false,
      authReady: true,
      supabaseConfigured: true,
      loggedIn: true,
      shouldCheckMembership: true,
      retainedFoundDespiteUnknown: true,
    });
    assert.equal(chrome.state, "server_membership_recoverable");
    assert.equal(chrome.membershipCode, "ABCD");
    assert.equal(chrome.checkStaleHint, true);
    assert.equal(chrome.createEnabled, false);
  });

  it("7 — ancien found puis none confirmé → disparition carte", () => {
    const decision = decideMembershipSnapshotWrite(
      foundSnap(),
      { status: "none" },
      "membership-query",
      sameIdentity()
    );
    assert.equal(decision.action, "write");
    assert.equal(decision.result.status, "none");

    const chrome = deriveHomeMembershipChrome({
      hasActiveLobby: false,
      snapshot: { status: "none" },
      resolutionInProgress: false,
      authReady: true,
      supabaseConfigured: true,
      loggedIn: true,
      shouldCheckMembership: true,
    });
    assert.equal(chrome.state, "none");
    assert.equal(chrome.showResume, false);
    assert.equal(chrome.membershipCode, null);
  });

  it("8 — échec Resume → found conservé + unrecoverable", () => {
    const chrome = deriveHomeMembershipChrome({
      hasActiveLobby: false,
      snapshot: foundSnap(),
      resolutionInProgress: false,
      authReady: true,
      supabaseConfigured: true,
      loggedIn: true,
      shouldCheckMembership: true,
      resumeUnrecoverable: true,
      resumeErrorMessage: "Impossible de retrouver ta soirée.",
    });
    assert.equal(chrome.state, "server_membership_unrecoverable");
    assert.equal(chrome.showResume, true);
    assert.equal(chrome.membershipCode, "ABCD");
    assert.equal(chrome.createEnabled, false);
    assert.match(chrome.errorMessage || "", /Impossible/);
  });

  it("9 — Resume réussi → cached_active après hydrate", () => {
    const chrome = deriveHomeMembershipChrome({
      hasActiveLobby: true,
      snapshot: foundSnap(),
      resolutionInProgress: false,
      authReady: true,
      supabaseConfigured: true,
      loggedIn: true,
      shouldCheckMembership: true,
      activeLobbyCode: "ABCD",
    });
    assert.equal(chrome.state, "cached_active");
    assert.equal(chrome.showReturnToLobby, true);
  });

  it("13–16 — Créer désactivé checking/found/check_failed ; actif après none", () => {
    assert.equal(
      deriveHomeMembershipChrome({
        hasActiveLobby: false,
        snapshot: null,
        resolutionInProgress: true,
        authReady: true,
        supabaseConfigured: true,
        loggedIn: true,
        shouldCheckMembership: true,
      }).createEnabled,
      false
    );
    assert.equal(
      deriveHomeMembershipChrome({
        hasActiveLobby: false,
        snapshot: foundSnap(),
        authReady: true,
        supabaseConfigured: true,
        loggedIn: true,
        shouldCheckMembership: true,
      }).createEnabled,
      false
    );
    assert.equal(
      deriveHomeMembershipChrome({
        hasActiveLobby: false,
        snapshot: { status: "unknown" },
        authReady: true,
        supabaseConfigured: true,
        loggedIn: true,
        shouldCheckMembership: true,
      }).createEnabled,
      false
    );
    assert.equal(
      deriveHomeMembershipChrome({
        hasActiveLobby: false,
        snapshot: { status: "none" },
        resolutionInProgress: false,
        authReady: true,
        supabaseConfigured: true,
        loggedIn: true,
        shouldCheckMembership: true,
      }).createEnabled,
      true
    );
    // Vague C : none + refresh → Créer off
    assert.equal(
      deriveHomeMembershipChrome({
        hasActiveLobby: false,
        snapshot: { status: "none" },
        resolutionInProgress: true,
        authReady: true,
        supabaseConfigured: true,
        loggedIn: true,
        shouldCheckMembership: true,
      }).createEnabled,
      false
    );
  });

  it("17 — server-only : leave/ferme actif (Vague D)", () => {
    const chrome = deriveHomeMembershipChrome({
      hasActiveLobby: false,
      snapshot: foundSnap(),
      authReady: true,
      supabaseConfigured: true,
      loggedIn: true,
      shouldCheckMembership: true,
    });
    assert.equal(chrome.showLeave, false);
    assert.equal(chrome.showLeavePrepDisabled, false);
    assert.equal(chrome.showLeaveServer, true);
    assert.equal(chrome.leaveServerLabel, "Quitter le lobby");
  });

  it("auth non prête → checking (pas check_failed immédiat)", () => {
    const chrome = deriveHomeMembershipChrome({
      hasActiveLobby: false,
      snapshot: null,
      resolutionInProgress: true,
      authReady: false,
      supabaseConfigured: true,
      loggedIn: true,
      shouldCheckMembership: true,
    });
    assert.equal(chrome.state, "checking");
  });

  it("visiteur sans identité → none (pas check_failed)", () => {
    const chrome = deriveHomeMembershipChrome({
      hasActiveLobby: false,
      snapshot: { status: "unknown" },
      authReady: true,
      supabaseConfigured: true,
      loggedIn: false,
      shouldCheckMembership: false,
    });
    assert.equal(chrome.state, "none");
  });
});

describe("homeMembershipVagueB — snapshot + lifecycle", () => {
  beforeEach(() => {
    resetMembershipSnapshotTestState(UID_A);
    resetMountGenerationForTests();
  });

  it("10 — remount Home → snapshot mémoire réutilisé", () => {
    setMembershipSnapshot(foundSnap(), "home-query", UID_A);
    const snap = getMembershipSnapshot();
    assert.equal(snap.status, "found");
    assert.equal(snap.membership.code, "ABCD");

    const chrome = deriveHomeMembershipChrome({
      hasActiveLobby: false,
      snapshot: snap,
      resolutionInProgress: true,
      authReady: true,
      supabaseConfigured: true,
      loggedIn: true,
      shouldCheckMembership: true,
    });
    assert.equal(chrome.state, "server_membership_recoverable");
    assert.equal(chrome.membershipCode, "ABCD");
  });

  it("6b — apply politique : unknown ne wipe pas found en mémoire", () => {
    setMembershipSnapshot(foundSnap(), "home-query", UID_A);
    const decision = decideMembershipSnapshotWrite(
      getMembershipSnapshot(),
      { status: "unknown" },
      "home-query",
      sameIdentity()
    );
    assert.equal(decision.action, "retain_found_same_identity");
    // Consommateur n’appelle pas set(unknown)
    assert.equal(getMembershipSnapshot().status, "found");
    assert.equal(getMembershipSnapshot().membership.code, "ABCD");
  });

  it("7b — none confirmé écrit et retire la carte", () => {
    setMembershipSnapshot(foundSnap(), "home-query", UID_A);
    const decision = decideMembershipSnapshotWrite(
      getMembershipSnapshot(),
      { status: "none" },
      "home-query",
      sameIdentity()
    );
    assert.equal(decision.action, "write");
    setMembershipSnapshot(decision.result, decision.source, UID_A);
    assert.equal(getMembershipSnapshot().status, "none");
    assert.equal(getMembershipSnapshot().membership, undefined);
  });

  it("11 — résultat async après unmount → pas de mutation snapshot", () => {
    const mount = createMountGuard();
    mount.dispose();
    const shouldContinue = () => mount.isMounted() && mount.isCurrentMount();
    assert.equal(shouldContinue(), false);

    const lateResult = {
      status: "found",
      membership: FOUND_MEMBERSHIP,
      extraCount: 0,
    };
    if (shouldContinue()) {
      setMembershipSnapshot(lateResult, "stale", UID_A);
    }
    assert.equal(getMembershipSnapshot(), null);
  });

  it("12 — deux mounts : le premier résultat tardif ne remplace pas le second", () => {
    advanceMountGeneration();
    const mount1 = createMountGuard();
    advanceMountGeneration();
    const mount2 = createMountGuard();

    setMembershipSnapshot({ status: "none" }, "mount2-early", UID_A);

    // Résultat tardif mount1
    if (mount1.isMounted() && mount1.isCurrentMount()) {
      setMembershipSnapshot(foundSnap(), "mount1-late", UID_A);
    }
    assert.equal(getMembershipSnapshot().status, "none");

    // Résultat mount2 courant
    if (mount2.isMounted() && mount2.isCurrentMount()) {
      setMembershipSnapshot(foundSnap(), "mount2", UID_A);
    }
    assert.equal(getMembershipSnapshot().status, "found");
    assert.equal(getMembershipSnapshot().source, "mount2");

    mount1.dispose();
    mount2.dispose();
  });

  it("unmount n’invalide pas le snapshot", () => {
    setMembershipSnapshot(foundSnap(), "home-query", UID_A);
    const mount = createMountGuard();
    mount.dispose();
    // Home cleanup ne doit pas appeler invalidate — snapshot survit
    assert.equal(getMembershipSnapshot().status, "found");
  });
});

describe("homeMembershipVagueB — contrats Home / createLobby", () => {
  it("18 — pendingServerLobby ne décide plus du chrome (absent de home.js)", () => {
    const homeSrc = readFileSync(join(ROOT, "js/screens/home.js"), "utf8");
    assert.equal(homeSrc.includes("pendingServerLobby"), false);
    assert.equal(homeSrc.includes("peekServerLobbyForUser"), false);
    assert.match(homeSrc, /queryActiveLobbyMembership/);
    assert.match(homeSrc, /getMembershipSnapshot/);
    assert.match(homeSrc, /deriveHomeMembershipChrome/);
    assert.match(homeSrc, /createMountGuard/);
  });

  it("19 — Home volontaire : resumeEveningSession / suppress inchangés (lobby.js)", () => {
    const lobbySrc = readFileSync(join(ROOT, "js/core/lobby.js"), "utf8");
    assert.match(lobbySrc, /export async function resumeEveningSession/);
    assert.match(lobbySrc, /isSessionRouteSuppressed/);
    assert.match(lobbySrc, /force\s*=\s*false/);
  });

  it("20 — createLobby n’utilise plus peek comme garde (Vague C)", () => {
    const lobbySrc = readFileSync(join(ROOT, "js/core/lobby.js"), "utf8");
    const createIdx = lobbySrc.indexOf("export async function createLobby()");
    assert.ok(createIdx >= 0);
    const slice = lobbySrc.slice(createIdx, createIdx + 1200);
    assert.equal(slice.includes("peekServerLobbyForUser"), false);
    assert.match(slice, /assertCanInsertLobby|queryActiveLobbyMembership/);
  });

  it("Home n’importe pas la query injectable", () => {
    const homeSrc = readFileSync(join(ROOT, "js/screens/home.js"), "utf8");
    assert.equal(homeSrc.includes("lobbyMembershipQuery.js"), false);
    assert.match(homeSrc, /lobbyMembershipFetch\.js/);
  });
});
