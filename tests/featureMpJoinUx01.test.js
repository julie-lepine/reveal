/**
 * FEATURE-MP-JOIN-UX-01 — micro-expérience visuelle JOINING / code HERO.
 *
 * Présentation only : pas de timer UX, pas de rotation de messages,
 * code = tentative active (pas membership).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  deriveHomeJoinTransitionUi,
  HOME_JOIN_PENDING_TITLE,
  normalizeJoinAttemptCode,
} from "../js/core/homeJoinTransition.js";
import { deriveHomeMembershipChrome } from "../js/core/homeMembershipChrome.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const homeSrc = readFileSync(join(ROOT, "js/screens/home.js"), "utf8");
const cssSrc = readFileSync(join(ROOT, "style.css"), "utf8");
const transitionSrc = readFileSync(
  join(ROOT, "js/core/homeJoinTransition.js"),
  "utf8"
);

describe("FEATURE-MP-JOIN-UX-01 — deriveHomeJoinTransitionUi", () => {
  it("TEST 1 — JOINING actif → titre « Entrée dans le lobby »", () => {
    const ui = deriveHomeJoinTransitionUi({
      joinPendingActive: true,
      lobbyCode: "H5VQAN",
    });
    assert.equal(ui.active, true);
    assert.equal(ui.title, HOME_JOIN_PENDING_TITLE);
    assert.match(ui.title, /Entrée dans le lobby/i);
  });

  it("TEST 2 — code HERO de la tentative", () => {
    const ui = deriveHomeJoinTransitionUi({
      joinPendingActive: true,
      lobbyCode: "h5vqan",
    });
    assert.equal(ui.heroCode, "H5VQAN");
    assert.match(ui.statusMessage, /Connexion au lobby H5VQAN en cours/);
  });

  it("TEST 3 — suppress Retour / Quitter / contrôles lobby", () => {
    const ui = deriveHomeJoinTransitionUi({
      joinPendingActive: true,
      lobbyCode: "H5VQAN",
    });
    assert.equal(ui.suppressMembershipActions, true);
    assert.equal(ui.suppressLobbyControls, true);

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
    assert.equal(chrome.showReturnToLobby, true);
    assert.equal(ui.suppressMembershipActions, true);
  });

  it("TEST 4 — tentative A puis B → seul code B pendant B", () => {
    const a = deriveHomeJoinTransitionUi({
      joinPendingActive: true,
      lobbyCode: "CODEA1",
    });
    assert.equal(a.heroCode, "CODEA1");

    const b = deriveHomeJoinTransitionUi({
      joinPendingActive: true,
      lobbyCode: "CODEB2",
    });
    assert.equal(b.heroCode, "CODEB2");
    assert.notEqual(b.heroCode, a.heroCode);
  });

  it("TEST 6 — échec / fin JOINING → pas de bloc", () => {
    const ui = deriveHomeJoinTransitionUi({
      joinPendingActive: false,
      lobbyCode: "H5VQAN",
    });
    assert.equal(ui.active, false);
    assert.equal(ui.heroCode, null);
    assert.equal(ui.title, null);
    assert.equal(ui.statusMessage, null);
  });

  it("TEST 7 — membership hors JOINING → pas de code HERO (contrat derive)", () => {
    const ui = deriveHomeJoinTransitionUi({
      joinPendingActive: false,
      lobbyCode: "H5VQAN",
    });
    assert.equal(ui.active, false);
    assert.equal(ui.suppressMembershipActions, false);
  });

  it("normalizeJoinAttemptCode — uppercase canonique", () => {
    assert.equal(normalizeJoinAttemptCode(" ab12 "), "AB12");
    assert.equal(normalizeJoinAttemptCode(null), "");
  });
});

describe("FEATURE-MP-JOIN-UX-01 — contrats source Home", () => {
  it("TEST 1/2 — paint HTML titre + code HERO + indicateur", () => {
    assert.match(homeSrc, /home-join-pending__title/);
    assert.match(homeSrc, /home-join-pending__code/);
    assert.match(homeSrc, /home-join-pending__indicator/);
    assert.match(homeSrc, /homeJoinPendingStatusHtml\(joinUi\)/);
    assert.match(homeSrc, /Entrée dans le lobby/);
  });

  it("TEST 3 — suppress membership + contrôles si joinUi actif", () => {
    assert.match(
      homeSrc,
      /const membershipActionsHtml = joinUi\.suppressMembershipActions\s*\?\s*loggedIn\s*\?\s*homeJoinPendingStatusHtml\(joinUi\)\s*:\s*""\s*:\s*homeMembershipActionsHtml\(chrome\)/
    );
    assert.match(
      homeSrc,
      /showLoggedInLobbyControls = loggedIn && !joinUi\.suppressLobbyControls/
    );
  });

  it("TEST 3b — guest JOINING : HERO panneau invité seulement (pas double box)", () => {
    assert.match(
      homeSrc,
      /joinUi\.suppressMembershipActions\s*\?\s*loggedIn\s*\?\s*homeJoinPendingStatusHtml\(joinUi\)\s*:\s*""/
    );
    // Session guest déjà active : HERO à la place du panneau rejoin.
    assert.match(
      homeSrc,
      /joinUi\.active\s*\?\s*homeJoinPendingStatusHtml\(joinUi\)\s*:\s*guestJoinPanelHtml/
    );
    // Onglet Invité (anonyme) : HERO dans #auth-panel-guest.
    assert.match(homeSrc, /id="auth-panel-guest"[\s\S]*?joinUi\.active\s*\?\s*homeJoinPendingStatusHtml\(joinUi\)/);
  });

  it("TEST 4 — source code = joinAttemptCode (pas membership / getLobby)", () => {
    assert.match(homeSrc, /let joinAttemptCode = ""/);
    const paintIdx = homeSrc.indexOf("function paint(");
    assert.ok(paintIdx > 0);
    const paintSlice = homeSrc.slice(paintIdx, paintIdx + 2500);
    assert.match(
      paintSlice,
      /lobbyCode:\s*joinPendingActive \? joinAttemptCode \|\| null : null/
    );
    assert.doesNotMatch(paintSlice, /getLobby\(\)\?\.code/);
    assert.doesNotMatch(paintSlice, /membershipCode/);
  });

  it("TEST 5 — aucun délai minimal / sleep avant navigateAfterLobbyJoin", () => {
    for (const marker of [
      'if (e.target.closest("#btn-join-lobby"))',
      'if (e.target.closest("#btn-guest-join") || e.target.closest("#btn-guest-rejoin"))',
      'if (e.target.closest("#btn-pending-join-remote"))',
    ]) {
      const start = homeSrc.indexOf(marker);
      assert.notEqual(start, -1, marker);
      const slice = homeSrc.slice(start, start + 4500);
      const navIdx = slice.indexOf("await navigateAfterLobbyJoin");
      assert.ok(navIdx > 0, `${marker}: navigateAfterLobbyJoin`);
      const beforeNav = slice.slice(0, navIdx);
      assert.doesNotMatch(beforeNav, /await\s+new\s+Promise|setTimeout\s*\(|sleep\s*\(/i);
    }
  });

  it("TEST 6 — échec : clear joinAttemptCode + end syncPending", () => {
    for (const marker of [
      'if (e.target.closest("#btn-join-lobby"))',
      'if (e.target.closest("#btn-guest-join") || e.target.closest("#btn-guest-rejoin"))',
      'if (e.target.closest("#btn-pending-join-remote"))',
    ]) {
      const start = homeSrc.indexOf(marker);
      const slice = homeSrc.slice(start, start + 5000);
      assert.match(slice, /joinAttemptCode = ""/);
      assert.match(slice, /syncPending\.end\(pendingToken\)/);
      assert.match(slice, /restoreHomeAfterFailedJoin/);
    }
  });

  it("TEST 7 — membership hors JOINING : Retour disponible (pas de hero forcé)", () => {
    assert.match(homeSrc, /homeMembershipActionsHtml\(chrome\)/);
    assert.match(homeSrc, /btn-return-lobby/);
    assert.match(
      homeSrc,
      /joinUi\.suppressMembershipActions\s*\?\s*loggedIn\s*\?\s*homeJoinPendingStatusHtml\(joinUi\)\s*:\s*""\s*:\s*homeMembershipActionsHtml\(chrome\)/
    );
  });

  it("TEST 8 — UI JOINING liée à joinPendingActive, pas visible seul", () => {
    const paintIdx = homeSrc.indexOf("function paint(");
    const paintSlice = homeSrc.slice(paintIdx, paintIdx + 2500);
    assert.match(
      paintSlice,
      /deriveHomeJoinTransitionUi\(\{\s*joinPendingActive,/
    );
    const deriveCall = paintSlice.match(
      /deriveHomeJoinTransitionUi\(\{[\s\S]*?\}\);/
    );
    assert.ok(deriveCall);
    assert.doesNotMatch(deriveCall[0], /joinPendingVisible/);
    // create lobby n'utilise pas syncPending.start
    const create = homeSrc.slice(homeSrc.indexOf('if (e.target.closest("#btn-create-lobby"))'));
    const createSlice = create.slice(0, create.indexOf('if (e.target.closest("#btn-join-lobby"))'));
    assert.doesNotMatch(createSlice, /syncPending\.start\(/);
  });

  it("TEST 9 — pas de timer / interval UX décoratif dans homeJoinTransition", () => {
    assert.doesNotMatch(transitionSrc, /\bsetInterval\b|\bsetTimeout\b|\brequestAnimationFrame\b/);
    // Interdit d'introduire une UX rotative / typewriter (hors commentaires d'exclusion).
    assert.doesNotMatch(
      transitionSrc,
      /setInterval\s*\(|phrases?\s*rotat|typewriter\s*\(|countdown\s*\(/i
    );
  });

  it("a11y — aria-label stable + bloc non interactif", () => {
    assert.match(homeSrc, /role="status"/);
    assert.match(homeSrc, /aria-label=/);
    assert.doesNotMatch(
      homeSrc.slice(
        homeSrc.indexOf("function homeJoinPendingStatusHtml"),
        homeSrc.indexOf("function homeMembershipActionsHtml")
      ),
      /<button/
    );
  });
});

describe("FEATURE-MP-JOIN-UX-01 — CSS", () => {
  it("respiration + indicateur + prefers-reduced-motion", () => {
    assert.match(cssSrc, /\.home-join-pending\s*\{/);
    assert.match(cssSrc, /@keyframes home-join-pending-breathe/);
    assert.match(cssSrc, /@keyframes home-join-pending-dot/);
    assert.match(cssSrc, /prefers-reduced-motion:\s*reduce/);
    assert.match(
      cssSrc,
      /@media \(prefers-reduced-motion: reduce\)\{[\s\S]*?\.home-join-pending[\s\S]*?animation:\s*none/
    );
  });
});
