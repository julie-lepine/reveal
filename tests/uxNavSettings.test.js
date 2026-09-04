/**
 * UX-NAV-SETTINGS - écran Menu unique (profil + soirée + forfaits).
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
import { SETTINGS_TAB } from "../js/config/settingsTabs.js";

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
  it("profil / soirée / forfaits en onglets ; soirée grisée hors lobby", () => {
    const settings = src("js/screens/settings.js");
    assert.match(settings, /Profil/);
    assert.match(settings, /Soirée/);
    assert.match(settings, /Forfaits/);
    assert.equal(settings.includes("data-settings-tab=\"${TAB_SUPPORT}\""), false);
    assert.doesNotMatch(settings, /TAB_SUPPORT/);
    assert.match(settings, /settings-tabs__cursor/);
    assert.match(settings, /🎉/);
    assert.match(settings, /✨/);
    assert.match(settings, /⭐/);
    assert.equal(settings.includes("💬"), false);
    assert.match(settings, /data-settings-tab="\$\{TAB_PERSONNALISATION\}"|data-settings-tab="personnalisation"/);
    assert.match(settings, /data-settings-tab="\$\{TAB_SOIREE\}"|data-settings-tab="soiree"/);
    assert.match(settings, /data-settings-tab="\$\{TAB_FORFAITS\}"|data-settings-tab="forfaits"/);
    assert.match(settings, /TAB_PERSONNALISATION\s*=\s*SETTINGS_TAB\.PERSONNALISATION/);
    assert.match(settings, /TAB_SOIREE\s*=\s*SETTINGS_TAB\.SOIREE/);
    assert.match(settings, /TAB_FORFAITS\s*=\s*SETTINGS_TAB\.FORFAITS/);
    assert.match(settings, /settings-tabs__btn--disabled/);
    assert.match(settings, /function forfaitsPanelHtml/);
    assert.match(settings, /data-settings-goto="\$\{TAB_FORFAITS\}"/);
    assert.match(settings, /data-settings-goto="\$\{TAB_PERSONNALISATION\}"/);
    assert.match(settings, /FRIENDS_SCREEN_ID/);
    assert.match(settings, /HELP_LEGAL_SCREEN_ID/);
    assert.match(settings, /HELP_LEGAL_LABEL/);
    assert.match(settings, /Emoji/);
    assert.match(settings, /Pseudo/);
    assert.match(settings, /Mot de passe/);
    assert.equal(settings.includes("btn-settings-reset-app"), false);
    assert.equal(settings.includes("resetAppToCleanHome"), false);
    assert.equal(settings.includes("btn-delete-account"), false);
    assert.match(settings, /btn-save-name/);
    assert.match(settings, /updateProfileEmoji/);
    assert.match(settings, /changeEmailPassword/);
    assert.match(settings, /Partie en cours/);
    assert.match(settings, /Retour aux jeux/);
    assert.match(settings, /page-title">Menu/);
    assert.match(settings, /btn-settings-logout/);
    assert.match(settings, /profileLogoutSectionHtml/);
    const logoutHtml = settings.slice(
      settings.indexOf("function profileLogoutSectionHtml"),
      settings.indexOf("function personnalisationPanelHtml")
    );
    assert.equal(logoutHtml.includes("settings-party__danger"), false);
    assert.equal(logoutHtml.includes("class=\"card"), false);
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

  it("Mes amis est une ligne du Profil, pas un onglet", () => {
    const tabs = src("js/config/settingsTabs.js");
    const settings = src("js/screens/settings.js");
    assert.doesNotMatch(tabs, /AMIS|FRIENDS|amis/);
    assert.deepEqual(Object.values(SETTINGS_TAB), ["soiree", "personnalisation", "forfaits"]);
    const tabsHtml = settings.slice(
      settings.indexOf("function settingsTabsHtml"),
      settings.indexOf("function partySectionHtml")
    );
    assert.doesNotMatch(tabsHtml, /FRIENDS_SCREEN_ID/);
    assert.doesNotMatch(tabsHtml, /Mes amis/);
    const perso = settings.slice(settings.indexOf("function personnalisationPanelHtml"));
    assert.match(perso, /settings-link-row/);
    assert.match(perso, /FRIEND_LABEL\.entrySettings/);
    assert.match(src("style.css"), /\.settings-link-row\{/);
  });

  it("retour Amis / Aide & légal rouvre l’onglet Profil", () => {
    const nav = src("js/screens/nav.js");
    const back = nav.slice(
      nav.indexOf("function goBackFromMenuSubpage"),
      nav.indexOf("async function handleBackNavigation")
    );
    assert.match(back, /prev === "settings"/);
    assert.match(back, /SETTINGS_TAB\.PERSONNALISATION/);
    const handle = nav.slice(nav.indexOf("async function handleBackNavigation"));
    assert.match(handle, /getCurrentScreen\(\) === "friends"/);
    assert.match(handle, /HELP_LEGAL_SCREEN_ID/);
    assert.match(handle, /goBackFromMenuSubpage\(\)/);
  });

  it("Aide & légal est une page, pas un onglet", () => {
    const help = src("js/screens/helpLegal.js");
    const nav = src("js/screens/nav.js");
    const main = src("js/main.js");
    const settings = src("js/screens/settings.js");
    const tabs = src("js/config/settingsTabs.js");
    assert.match(src("js/config/helpLegal.js"), /HELP_LEGAL_SCREEN_ID = "help-legal"/);
    assert.match(src("js/config/helpLegal.js"), /Aide & légal/);
    assert.match(main, /registerScreen\(HELP_LEGAL_SCREEN_ID/);
    assert.match(nav, /export function goToHelpLegal/);
    assert.match(nav, /target === HELP_LEGAL_SCREEN_ID/);
    assert.match(settings, /data-nav="\$\{HELP_LEGAL_SCREEN_ID\}"/);
    const perso = settings.slice(settings.indexOf("function personnalisationPanelHtml"));
    assert.ok(perso.indexOf("HELP_LEGAL_SCREEN_ID") < perso.indexOf("profileLogoutSectionHtml"));
    assert.doesNotMatch(tabs, /SUPPORT/);
    assert.match(help, /id="btn-delete-account"/);
    assert.match(help, /btn-settings-reset-app/);
    assert.match(help, /resetAppToCleanHome/);
    assert.match(help, /data-nav="privacy"/);
    assert.match(help, /Dépannage/);
    assert.match(src("js/core/bottomNav.js"), /"help-legal":\s*TAB_SETTINGS/);
    assert.match(src("js/core/gameSync.js"), /screen === "help-legal"/);
    assert.match(src("js/screens/privacy.js"), /backTarget:\s*"back"/);
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
    assert.match(css, /--settings-tabs-count/);
  });

  it("rôle hôte / membre via lobbySettingsActionsForRole", () => {
    assert.deepEqual([...lobbySettingsActionsForRole("host")], [
      "transfer",
      "players",
      "close",
    ]);
    assert.deepEqual([...lobbySettingsActionsForRole("member")], ["leave"]);
    assert.deepEqual(
      [...lobbySettingsActionsForRole("member", { localIsRegistered: true })],
      ["players", "leave"]
    );
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
