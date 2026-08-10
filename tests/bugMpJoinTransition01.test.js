/**
 * BUG-MP-JOIN-TRANSITION-01 — flash Home intermédiaire après join.
 *
 * Pendant syncPending.token (JOINING) : pas de chrome membership interactif
 * (Retour / Quitter) ni contrôles create/join, même si hasActiveLobby est déjà vrai.
 * FEATURE-MP-JOIN-UX-01 : copy HERO / statusMessage évolués — contrats ci-dessous.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  deriveHomeJoinTransitionUi,
  HOME_JOIN_PENDING_TITLE,
} from "../js/core/homeJoinTransition.js";
import { deriveHomeMembershipChrome } from "../js/core/homeMembershipChrome.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const homeSrc = readFileSync(join(__dirname, "../js/screens/home.js"), "utf8");

describe("BUG-MP-JOIN-TRANSITION-01 — deriveHomeJoinTransitionUi", () => {
  it("TEST 2 — membership connue + joinPendingActive → suppress Retour/formulaire", () => {
    const ui = deriveHomeJoinTransitionUi({
      joinPendingActive: true,
      lobbyCode: "H5VQAN",
    });
    assert.equal(ui.active, true);
    assert.equal(ui.suppressMembershipActions, true);
    assert.equal(ui.suppressLobbyControls, true);
    assert.equal(ui.title, HOME_JOIN_PENDING_TITLE);
    assert.equal(ui.heroCode, "H5VQAN");
    assert.match(ui.statusMessage, /Connexion au lobby H5VQAN/);

    const chrome = deriveHomeMembershipChrome({
      hasActiveLobby: true,
      activeLobbyCode: "H5VQAN",
      snapshot: {
        status: "found",
        membership: { code: "H5VQAN", lobbyId: "L1", role: "member" },
      },
      authReady: true,
      supabaseConfigured: true,
      loggedIn: true,
      shouldCheckMembership: true,
    });
    assert.equal(chrome.state, "cached_active");
    assert.equal(chrome.showReturnToLobby, true);
    assert.equal(ui.suppressMembershipActions, true);
  });

  it("TEST 5 — hors transaction join : pas de suppress (Retour légitime)", () => {
    const ui = deriveHomeJoinTransitionUi({
      joinPendingActive: false,
      lobbyCode: "H5VQAN",
    });
    assert.equal(ui.active, false);
    assert.equal(ui.suppressMembershipActions, false);
    assert.equal(ui.suppressLobbyControls, false);
    assert.equal(ui.statusMessage, null);
  });

  it("sans code : message générique", () => {
    const ui = deriveHomeJoinTransitionUi({ joinPendingActive: true });
    assert.equal(ui.statusMessage, "Connexion au lobby en cours");
    assert.equal(ui.heroCode, null);
  });
});

describe("BUG-MP-JOIN-TRANSITION-01 — contrats source Home", () => {
  it("importe deriveHomeJoinTransitionUi", () => {
    assert.match(homeSrc, /from "\.\.\/core\/homeJoinTransition\.js"/);
    assert.match(homeSrc, /deriveHomeJoinTransitionUi/);
  });

  it("TEST 1/2 — paint : suppress membership + contrôles si joinUi actif", () => {
    assert.match(homeSrc, /deriveHomeJoinTransitionUi\(\{/);
    assert.match(
      homeSrc,
      /const membershipActionsHtml = joinUi\.suppressMembershipActions\s*\?\s*loggedIn\s*\?\s*homeJoinPendingStatusHtml\(joinUi\)\s*:\s*""\s*:\s*homeMembershipActionsHtml\(chrome\)/
    );
    assert.match(
      homeSrc,
      /showLoggedInLobbyControls = loggedIn && !joinUi\.suppressLobbyControls/
    );
    assert.match(homeSrc, /home-join-pending/);
  });

  it("TEST 3 — navigateAfterLobbyJoin await avant end syncPending (handlers join)", () => {
    for (const marker of [
      'if (e.target.closest("#btn-join-lobby"))',
      'if (e.target.closest("#btn-guest-join") || e.target.closest("#btn-guest-rejoin"))',
      'if (e.target.closest("#btn-pending-join-remote"))',
    ]) {
      const start = homeSrc.indexOf(marker);
      assert.notEqual(start, -1, marker);
      const slice = homeSrc.slice(start, start + 4500);
      const navIdx = slice.indexOf("await navigateAfterLobbyJoin");
      const finallyIdx = slice.indexOf("} finally {");
      const endIdx = slice.indexOf("syncPending.end(pendingToken)");
      assert.ok(navIdx > 0, `${marker}: navigateAfterLobbyJoin`);
      assert.ok(finallyIdx > navIdx, `${marker}: finally après navigate`);
      assert.ok(endIdx > finallyIdx, `${marker}: end dans finally`);
    }
  });

  it("TEST 4 — échec : end dans finally + restoreHomeAfterFailedJoin", () => {
    const join = homeSrc.slice(homeSrc.indexOf('if (e.target.closest("#btn-join-lobby"))'));
    assert.match(join, /if \(!res\.ok\)/);
    assert.match(join, /syncPending\.end\(pendingToken\)/);
    assert.match(join, /if \(!joinSucceeded\) await restoreHomeAfterFailedJoin\(\)/);
    assert.match(homeSrc, /async function restoreHomeAfterFailedJoin\(/);
    assert.match(
      homeSrc,
      /async function restoreHomeAfterFailedJoin\([\s\S]*?await resolveHomeMembership\(\{ force: true \}\)/
    );
  });

  it("TEST 6 — double clic : garde token + start syncPending", () => {
    const join = homeSrc.slice(
      homeSrc.indexOf('if (e.target.closest("#btn-join-lobby"))'),
      homeSrc.indexOf('if (e.target.closest("#btn-guest-join")')
    );
    assert.match(join, /if \(syncPending\.getState\(\)\.token != null\) return;/);
    assert.match(join, /syncPending\.start\(\)/);
    const create = homeSrc.slice(homeSrc.indexOf('if (e.target.closest("#btn-create-lobby"))'));
    assert.match(create, /if \(syncPending\.getState\(\)\.token != null\) return;/);
  });

  it("TEST 7 — pas de branche démo locale dans handlers join Home", () => {
    const joinStart = homeSrc.indexOf('if (e.target.closest("#btn-join-lobby"))');
    const guestStart = homeSrc.indexOf(
      'if (e.target.closest("#btn-guest-join") || e.target.closest("#btn-guest-rejoin"))'
    );
    const slice = homeSrc.slice(joinStart, guestStart + 2200);
    assert.doesNotMatch(slice, /DEMO_NPC|openLobbies|joinLobbyLocal|fakeJoin/i);
    assert.match(slice, /await joinLobby\(/);
    assert.match(slice, /await joinLobbyAsGuest\(/);
  });

  it("pending-join-remote aussi sous syncPending + restore après échec", () => {
    const fn = homeSrc.slice(
      homeSrc.indexOf('if (e.target.closest("#btn-pending-join-remote"))'),
      homeSrc.indexOf('if (e.target.closest("#btn-membership-retry"))')
    );
    assert.match(fn, /syncPending\.start\(\)/);
    assert.match(fn, /syncPending\.end\(pendingToken\)/);
    assert.match(fn, /if \(!joinSucceeded\) await restoreHomeAfterFailedJoin\(\)/);
  });

  it("échec join sans rollback : forceClearClientLobbyState si hasActiveLobby orphelin", () => {
    const lobbySrc = readFileSync(join(__dirname, "../js/core/lobby.js"), "utf8");
    const start = lobbySrc.indexOf("export async function joinLobby(");
    const slice = lobbySrc.slice(start, start + 4500);
    assert.match(
      slice,
      /if \(!rollbackSnapshot && hasActiveLobby\(\)\) \{\s*\r?\n\s*forceClearClientLobbyState\(\);/
    );
  });
});
