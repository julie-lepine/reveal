/**
 * UX-NAV-LOBBY — Accueil hors menu en lobby, Paramètres unifiés, sortie invité.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BOTTOM_NAV_TAB,
  isBottomNavTabVisible,
  resolveBottomNavTabs,
} from "../js/core/bottomNavItems.js";
import { partySettingsActionsForRole } from "../js/core/partySettingsMenu.js";
import { SERVER_LEAVE_CONFIRM } from "../js/core/lobbyServerLeave.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

function src(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

describe("UX-NAV-LOBBY — catalogue menu", () => {
  it("1 — hors lobby, Accueil est visible dans le menu", () => {
    const tabs = resolveBottomNavTabs(false);
    assert.ok(tabs.includes(BOTTOM_NAV_TAB.HOME));
    assert.equal(isBottomNavTabVisible(false, BOTTOM_NAV_TAB.HOME), true);
    assert.equal(isBottomNavTabVisible(false, BOTTOM_NAV_TAB.SETTINGS), false);
  });

  it("2 — en lobby, Accueil est absent du menu", () => {
    const tabs = resolveBottomNavTabs(true);
    assert.equal(tabs.includes(BOTTOM_NAV_TAB.HOME), false);
    assert.equal(isBottomNavTabVisible(true, BOTTOM_NAV_TAB.HOME), false);
  });

  it("3 — en lobby, Paramètres est visible", () => {
    const tabs = resolveBottomNavTabs(true);
    assert.ok(tabs.includes(BOTTOM_NAV_TAB.SETTINGS));
    assert.equal(isBottomNavTabVisible(true, BOTTOM_NAV_TAB.SETTINGS), true);
  });

  it("15 — barre : 5 slots stables (pas de 6e entrée Home+Settings)", () => {
    assert.equal(resolveBottomNavTabs(false).length, 5);
    assert.equal(resolveBottomNavTabs(true).length, 5);
    const css = src("style.css");
    const block = css.slice(
      css.indexOf(".bottom-nav{"),
      css.indexOf(".bottom-nav.bottom-nav--hidden")
    );
    assert.match(block, /grid-template-columns:\s*1fr 1fr auto 1fr 1fr/);
    assert.match(block, /safe-area-inset-bottom/);
  });
});

describe("UX-NAV-LOBBY — Paramètres (écran settings, pas modale)", () => {
  it("4 — entrée Paramètres bottom nav → goToEveningSettings", () => {
    const nav = src("js/core/bottomNav.js");
    assert.match(nav, /goToEveningSettings/);
    assert.equal(nav.includes("openPartySettings"), false);
    assert.match(nav, /function goSettings/);
  });

  it("5 — invité : action leave seule (helper rôle)", () => {
    const actions = partySettingsActionsForRole("member");
    assert.deepEqual([...actions], ["leave"]);
    assert.equal(actions.includes("close"), false);
    const settings = src("js/screens/settings.js");
    assert.match(settings, /data-settings-party="leave"/);
    assert.match(settings, /Quitter le lobby/);
  });

  it("6 — invité ne voit pas Fermer / transfert / joueurs (helper)", () => {
    assert.equal(partySettingsActionsForRole("member").includes("close"), false);
    assert.equal(partySettingsActionsForRole("member").includes("transfer"), false);
    assert.equal(partySettingsActionsForRole("member").includes("players"), false);
  });

  it("7 — hôte conserve fermeture / transfert / joueurs", () => {
    assert.deepEqual([...partySettingsActionsForRole("host")], [
      "transfer",
      "players",
      "close",
    ]);
    const settings = src("js/screens/settings.js");
    assert.match(settings, /data-settings-party="close"/);
    assert.match(settings, /data-settings-party="transfer"/);
    assert.match(settings, /data-settings-party="players"/);
  });

  it("8 — hôte ne voit pas l’action leave réservée aux membres", () => {
    assert.equal(partySettingsActionsForRole("host").includes("leave"), false);
  });
});

describe("UX-NAV-LOBBY — sortie volontaire invité", () => {
  it("9–11 — confirm / leave / cleanup / Accueil via pipeline canonique", () => {
    const lobby = src("js/core/lobby.js");

    // confirmAndLeaveLobby : confirm membre avant leaveFn
    const confirmIdx = lobby.indexOf("export async function confirmAndLeaveLobby");
    const leaveIdx = lobby.indexOf("export async function leaveLobby(");
    const confirmBlock = lobby.slice(confirmIdx, leaveIdx);
    assert.match(confirmBlock, /SERVER_LEAVE_CONFIRM\.member/);
    assert.match(confirmBlock, /cancelled:\s*true/);
    assert.match(confirmBlock, /return leaveFn\(/);
    assert.match(confirmBlock, /dissolveFn/);

    // settings : leave/close via confirmAndLeaveLobby + notify
    const settings = src("js/screens/settings.js");
    assert.match(settings, /confirmAndLeaveLobby\(\{\s*navigateAway:\s*true/);
    assert.match(settings, /notifyVoluntaryLeaveFailure/);

    // applyLeaveLobbyLocal : reset + navigate home reset
    assert.match(lobby, /function applyLeaveLobbyLocal/);
    assert.match(lobby, /inLobby:\s*false,\s*lobby:\s*null,\s*lobbyCode:\s*null/);
    assert.match(lobby, /resetEveningState\(\)/);
    assert.match(lobby, /clearCachedGameSession\(\)/);
    assert.match(lobby, /clearGuestMembership\(\)/);
    assert.match(lobby, /navigate\("home",\s*\{\s*reset:\s*true\s*\}\)/);

    assert.equal(SERVER_LEAVE_CONFIRM.member.confirmLabel, "Quitter le lobby");
  });

  it("10 — leaveLobby membre délègue à runVoluntaryMemberLeave (pas closeLobby)", () => {
    const lobby = src("js/core/lobby.js");
    const leaveIdx = lobby.indexOf("export async function leaveLobby(");
    const end = lobby.indexOf("export async function leaveLobbyMembershipFromServer", leaveIdx);
    const block = lobby.slice(leaveIdx, end);
    assert.match(block, /runVoluntaryMemberLeave/);
    assert.equal(block.includes("closeLobbySupabase()"), false);
    const core = src("js/core/voluntaryMemberLeave.js");
    assert.match(core, /leaveLobbySupabase/);
    assert.match(core, /stopMultiplayerSync/);
    assert.match(core, /stopLobbyPresenceSync/);
  });

  it("12 — après sortie, reset nav empêche retour game-select", () => {
    const lobby = src("js/core/lobby.js");
    assert.match(lobby, /navigate\("home",\s*\{\s*reset:\s*true\s*\}\)/);
    const router = src("js/core/router.js");
    assert.match(router, /reset/);
    // game-select n’expose plus de back vers home
    const gs = src("js/screens/gameSelect.js");
    assert.match(gs, /back:\s*false/);
    assert.equal(/backTarget:\s*"home"/.test(gs), false);
  });

  it("13 — F5 en lobby : resume + catalogue sans Accueil", () => {
    const main = src("js/main.js");
    assert.match(main, /resumeEveningSession/);
    assert.match(main, /hasActiveLobby/);
    assert.deepEqual([...resolveBottomNavTabs(true)], [
      "settings",
      "games",
      "logo",
      "results",
      "final",
    ]);
  });

  it("14 — F5 après sortie : hors lobby → Accueil au catalogue, pas Paramètres", () => {
    assert.deepEqual([...resolveBottomNavTabs(false)], [
      "home",
      "games",
      "logo",
      "results",
      "final",
    ]);
    const main = src("js/main.js");
    // Sans lobby actif, boot tombe sur Accueil (pas resume hub).
    assert.match(main, /if\s*\(!resumed\)\s*navigate\("home"/);
  });

  it("16 — leave : DELETE distant avant stop sync / cleanup (contrat échec)", () => {
    const core = src("js/core/voluntaryMemberLeave.js");
    const remote = core.indexOf("await deps.leaveLobbySupabase()");
    const stopMp = core.indexOf("deps.stopMultiplayerSync()");
    const apply = core.indexOf("deps.applyLeaveLobbyLocal");
    assert.ok(remote >= 0 && stopMp >= 0 && apply >= 0);
    assert.ok(remote < stopMp, "DELETE avant stop sync");
    assert.ok(stopMp < apply, "stop sync avant cleanup");
    assert.match(core, /voluntaryLeaveInFlight/);
    assert.match(core, /busy:\s*true/);
  });
});

describe("UX-NAV-LOBBY — Accueil inaccessible en lobby (nav)", () => {
  it("goToEveningHome en lobby redirige vers hub jeux (pas Accueil)", () => {
    const nav = src("js/screens/nav.js");
    const fn = nav.slice(
      nav.indexOf("export async function goToEveningHome"),
      nav.indexOf("export function goToEveningSettings")
    );
    assert.match(fn, /returnToEveningGames\(\{\s*hubOnly:\s*true\s*\}\)/);
    assert.match(fn, /if\s*\(!hasActiveLobby\(\)\)/);
    // Accueil uniquement hors lobby — pas de navigate home après le early-return.
    const afterGuard = fn.slice(fn.indexOf("return;") + "return;".length);
    assert.equal(afterGuard.includes('navigate("home"'), false);
  });

  it("settings en lobby : push navigate (conserve pile results/game-select)", () => {
    const nav = src("js/screens/nav.js");
    const fn = nav.slice(
      nav.indexOf("export function goToEveningSettings"),
      nav.indexOf("export async function returnFromEveningProfile")
    );
    assert.match(fn, /navigate\("settings"\)/);
    assert.equal(fn.includes('["game-select", "settings"]'), false);
  });

  it("bottomNav n’appelle plus goToEveningHome", () => {
    const bottom = src("js/core/bottomNav.js");
    assert.equal(bottom.includes("goToEveningHome"), false);
    assert.equal(bottom.includes("TAB_HOME"), true); // encore pour hors-lobby render
  });
});
