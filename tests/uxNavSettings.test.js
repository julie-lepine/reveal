/**
 * UX-NAV-SETTINGS - écran Menu unique (profil + soirée + support).
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
import {
  lobbySettingsActionsForRole,
} from "../js/core/partySettingsMenu.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

function src(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

describe("UX-NAV-SETTINGS - navigation", () => {
  it("lobby actif → Menu bottom nav → goToEveningSettings (pas openPartySettings)", () => {
    const nav = src("js/core/bottomNav.js");
    assert.match(nav, /goToEveningSettings/);
    assert.equal(nav.includes("openPartySettings"), false);
    assert.match(nav, /settings:\s*TAB_SETTINGS/);
    assert.match(nav, /bottom-nav__icon--menu/);
    assert.match(nav, /aria-label="Menu"/);
    assert.match(nav, /bottom-nav__label">Menu/);
    assert.equal(nav.includes("Paramètres"), false);
    assert.equal(isBottomNavTabVisible(true, BOTTOM_NAV_TAB.SETTINGS), true);
    assert.equal(isBottomNavTabVisible(true, BOTTOM_NAV_TAB.HOME), false);
  });

  it("hors lobby → Accueil dans le catalogue, pas Menu", () => {
    assert.deepEqual([...resolveBottomNavTabs(false)], [
      "games",
      "results",
      "logo",
      "final",
      "home",
    ]);
  });

  it("goToEveningSettings en lobby pousse settings (pas de stack forcée game-select)", () => {
    const nav = src("js/screens/nav.js");
    const fn = nav.slice(
      nav.indexOf("export function goToEveningSettings"),
      nav.indexOf("export async function returnFromEveningProfile")
    );
    assert.match(fn, /navigate\("settings"\)/);
    assert.equal(fn.includes('navStack: ["game-select"'), false);
    assert.match(fn, /getCurrentScreen\(\) === "settings"/);
  });
});

describe("UX-NAV-SETTINGS - game-select sans doublon", () => {
  it("n’affiche plus Profil & paramètres ni Paramètres party ni card feedback", () => {
    const gs = src("js/screens/gameSelect.js");
    assert.equal(gs.includes("Profil & paramètres"), false);
    assert.equal(gs.includes("data-party-settings"), false);
    assert.equal(gs.includes("openPartySettings"), false);
    assert.equal(gs.includes("partySettingsButtonHtml"), false);
    assert.equal(gs.includes("feedbackPromptCardHtml"), false);
    assert.equal(gs.includes("bindFeedbackPrompt"), false);
    assert.match(gs, /Reprendre l'animation|data-claim-host/);
  });
});

describe("UX-NAV-SETTINGS - contenu écran", () => {
  it("profil / soirée / support en onglets ; soirée grisée hors lobby", () => {
    const settings = src("js/screens/settings.js");
    assert.match(settings, /Profil/);
    assert.match(settings, /Soirée/);
    assert.match(settings, /Support/);
    assert.match(settings, /settings-tabs__cursor/);
    assert.match(settings, /🎉/);
    assert.match(settings, /✨/);
    assert.match(settings, /💬/);
    assert.match(settings, /data-settings-tab="\$\{TAB_PERSONNALISATION\}"|data-settings-tab="personnalisation"/);
    assert.match(settings, /data-settings-tab="\$\{TAB_SOIREE\}"|data-settings-tab="soiree"/);
    assert.match(settings, /data-settings-tab="\$\{TAB_SUPPORT\}"|data-settings-tab="support"/);
    assert.match(settings, /TAB_PERSONNALISATION\s*=\s*"personnalisation"/);
    assert.match(settings, /TAB_SOIREE\s*=\s*"soiree"/);
    assert.match(settings, /TAB_SUPPORT\s*=\s*"support"/);
    assert.match(settings, /settings-tabs__btn--disabled/);
    assert.match(settings, /Emoji/);
    assert.match(settings, /Pseudo/);
    assert.match(settings, /Mot de passe/);
    assert.match(settings, /Aide/);
    assert.match(settings, /Dépannage/);
    assert.match(settings, /btn-settings-reset-app/);
    assert.match(settings, /resetAppToCleanHome/);
    assert.match(settings, /Légal/);
    assert.match(settings, /btn-save-name/);
    assert.match(settings, /updateProfileEmoji/);
    assert.match(settings, /changeEmailPassword/);
    assert.match(settings, /Partie en cours/);
    assert.match(settings, /Retour aux jeux/);
    assert.match(settings, /page-title">Menu/);
    assert.match(settings, /btn-settings-logout/);
    assert.match(settings, /profileLogoutSectionHtml/);
    assert.match(settings, /logout\(\)/);
    assert.match(settings, /Quitter la session/);
    assert.match(settings, /Se déconnecter/);
    assert.match(settings, /navigate\("home",\s*\{\s*reset:\s*true\s*\}\)/);
    assert.match(settings, /data-settings-party="leave"/);
    assert.match(settings, /data-settings-party="close"/);
    assert.match(settings, /data-settings-party="transfer"/);
    assert.match(settings, /data-settings-party="players"/);
    assert.match(settings, /confirmAndLeaveLobby/);
    assert.match(settings, /notifyVoluntaryLeaveFailure/);
    assert.match(settings, /transferLobbyHost/);
    assert.match(settings, /showLobbyPlayersManageDialog/);
    assert.equal(settings.includes("ensureLobbyHostOrOfferClaim"), false);
    assert.equal(settings.includes("openPartySettings"), false);
    assert.match(settings, /onLobbyBundleUpdated/);
    assert.match(settings, /createMountGuard/);
    assert.match(settings, /mount\.dispose/);
  });

  it("CSS hamburger menu bottom nav présent", () => {
    const css = src("style.css");
    assert.match(css, /\.bottom-nav__icon--menu/);
  });

  it("CSS onglets settings présents", () => {
    const css = src("style.css");
    assert.match(css, /\.settings-tabs\{/);
    assert.match(css, /\.settings-tabs__cursor/);
    assert.match(css, /\.settings-tabs__btn--disabled/);
    assert.match(css, /--settings-tab-index/);
  });

  it("rôle hôte / membre via lobbySettingsActionsForRole", () => {
    assert.deepEqual([...lobbySettingsActionsForRole("host")], [
      "transfer",
      "players",
      "close",
    ]);
    assert.deepEqual([...lobbySettingsActionsForRole("member")], ["leave"]);
    assert.equal(lobbySettingsActionsForRole("host").includes("leave"), false);
    assert.equal(lobbySettingsActionsForRole("member").includes("close"), false);
    const menu = src("js/core/partySettingsMenu.js");
    assert.match(menu, /export function lobbySettingsActionsForRole/);
    assert.equal(menu.includes("partySettingsActionsForRole"), false);
  });

  it("CSS morts game-select profile/party absents", () => {
    const css = src("style.css");
    const a11y = src("css/a11y.css");
    assert.equal(css.includes("game-select-profile"), false);
    assert.equal(css.includes("game-select-party-settings"), false);
    assert.equal(a11y.includes("game-select-profile"), false);
    assert.equal(a11y.includes("game-select-party-settings"), false);
  });
});

describe("UX-NAV-SETTINGS - modules morts retirés", () => {
  it("openPartySettings et showPartySettingsDialog absents", () => {
    const lobby = src("js/core/lobby.js");
    assert.equal(lobby.includes("export async function openPartySettings"), false);
    assert.equal(lobby.includes("showPartySettingsDialog"), false);
    const dialog = src("js/core/dialog.js");
    assert.equal(dialog.includes("showPartySettingsDialog"), false);
    assert.equal(dialog.includes("Paramètres de partie"), false);
  });
});
