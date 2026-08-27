import { APP_LOGO } from "../../data/branding.js";
import { hasActiveLobby, returnToEveningGames } from "./lobby.js";
import {
  BOTTOM_NAV_TAB,
  resolveBottomNavTabs,
} from "./bottomNavItems.js";
import { onScreenChange, getCurrentScreen } from "./router.js";
import { goToScores, isScoresNavLocked } from "./navAccess.js";
import {
  isGameSyncActive,
  isLobbyHost,
  isSessionInProgressPlay,
  returnToGameSelect,
} from "./gameSync.js";
import { exitGameToGameSelect } from "./exitGame.js";
import { goToEveningSettings } from "../screens/nav.js";
import { syncFriendsEntryBadges } from "./friendRequestNotice.js";

const TAB_HOME = BOTTOM_NAV_TAB.HOME;
const TAB_SETTINGS = BOTTOM_NAV_TAB.SETTINGS;
const TAB_GAMES = BOTTOM_NAV_TAB.GAMES;
const TAB_LOGO = BOTTOM_NAV_TAB.LOGO;
const TAB_RESULTS = BOTTOM_NAV_TAB.RESULTS;
const TAB_FINAL = BOTTOM_NAV_TAB.FINAL;

/** Écran courant → onglet actif (settings = onglet Menu en lobby). */
const SCREEN_TO_TAB = {
  home: TAB_HOME,
  lobby: TAB_LOGO,
  "game-select": TAB_GAMES,
  leaderboard: TAB_FINAL,
  results: TAB_RESULTS,
  settings: TAB_SETTINGS,
  "hottake-prep": TAB_GAMES,
  hottake: TAB_GAMES,
  "speedvote-prep": TAB_GAMES,
  speedvote: TAB_GAMES,
  "truthmeter-prep": TAB_GAMES,
  truthmeter: TAB_GAMES,
  "consensus-prep": TAB_GAMES,
  consensus: TAB_GAMES,
  "dilemma-prep": TAB_GAMES,
  dilemma: TAB_GAMES,
  "clutch-prep": TAB_GAMES,
  clutch: TAB_GAMES,
  "drawit-prep": TAB_GAMES,
  drawit: TAB_GAMES,
  "wronganswer-prep": TAB_GAMES,
  wronganswer: TAB_GAMES,
  "trivia-prep": TAB_GAMES,
  trivia: TAB_GAMES,
  "traitre-prep": TAB_GAMES,
  traitre: TAB_GAMES,
  guesslie: TAB_GAMES,
  "guesslie-menu": TAB_GAMES,
  "guesslie-setup": TAB_GAMES,
  "guesslie-wait": TAB_GAMES,
  "tiernight-select": TAB_GAMES,
  "tiernight-create": TAB_GAMES,
  tiernight: TAB_GAMES,
  "tiernight-live": TAB_GAMES,
  "tiernight-end": TAB_RESULTS,
};

async function goGames() {
  const screen = getCurrentScreen();
  // UX-VIBE-02 : depuis une partie, même contrat que ‹ / barre exit (pas un hub nu sans suppress).
  if (isGameSyncActive() && isSessionInProgressPlay(screen)) {
    if (isLobbyHost()) {
      await exitGameToGameSelect();
      return;
    }
    await returnToGameSelect();
    return;
  }
  await returnToEveningGames({ hubOnly: true });
}

function goResults() {
  goToScores("results");
}

function goFinal() {
  goToScores("leaderboard");
}

/** Onglet Menu → écran settings (plus de modale party). */
function goSettings() {
  if (!hasActiveLobby()) return;
  goToEveningSettings();
}

const TAB_ACTIONS = {
  [TAB_GAMES]: goGames,
  [TAB_RESULTS]: goResults,
  [TAB_FINAL]: goFinal,
  [TAB_SETTINGS]: goSettings,
};

function tabButtonHtml(tabId) {
  if (tabId === TAB_SETTINGS) {
    return `
    <button type="button" class="bottom-nav__item" data-tab="${TAB_SETTINGS}" data-tab-nav="${TAB_SETTINGS}" aria-label="Menu">
      <span class="bottom-nav__icon-wrap"><span class="bottom-nav__icon bottom-nav__icon--menu" aria-hidden="true"></span><span class="friends-badge" data-friends-badge hidden aria-hidden="true"></span></span>
      <span class="bottom-nav__label">Menu</span>
    </button>`;
  }
  if (tabId === TAB_HOME) {
    return `
    <button type="button" class="bottom-nav__item" data-tab="${TAB_HOME}" data-tab-nav="${TAB_HOME}" aria-label="Accueil">
      <span class="bottom-nav__icon-wrap"><span class="bottom-nav__icon" aria-hidden="true">🏠</span></span>
      <span class="bottom-nav__label">Accueil</span>
    </button>`;
  }
  if (tabId === TAB_GAMES) {
    return `
    <button type="button" class="bottom-nav__item" data-tab="${TAB_GAMES}" data-tab-nav="${TAB_GAMES}" aria-label="Jeux">
      <span class="bottom-nav__icon-wrap"><span class="bottom-nav__icon" aria-hidden="true">🎮</span></span>
      <span class="bottom-nav__label">Jeux</span>
    </button>`;
  }
  if (tabId === TAB_LOGO) {
    return `
    <div class="bottom-nav__item bottom-nav__item--logo" data-tab="${TAB_LOGO}" aria-hidden="true">
      <span class="bottom-nav__logo-wrap">
        <img src="${APP_LOGO}" alt="REVEAL" class="bottom-nav__logo" />
      </span>
    </div>`;
  }
  if (tabId === TAB_RESULTS) {
    return `
    <button type="button" class="bottom-nav__item" data-tab="${TAB_RESULTS}" data-tab-nav="${TAB_RESULTS}" aria-label="Résultats">
      <span class="bottom-nav__icon-wrap"><span class="bottom-nav__icon" aria-hidden="true">📊</span></span>
      <span class="bottom-nav__label">Résultats</span>
    </button>`;
  }
  if (tabId === TAB_FINAL) {
    return `
    <button type="button" class="bottom-nav__item" data-tab="${TAB_FINAL}" data-tab-nav="${TAB_FINAL}" aria-label="Classement">
      <span class="bottom-nav__icon-wrap"><span class="bottom-nav__icon" aria-hidden="true">🏆</span></span>
      <span class="bottom-nav__label">Classement</span>
    </button>`;
  }
  return "";
}

function bindNavClicks(nav) {
  nav.querySelectorAll("[data-tab-nav]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.classList.contains("bottom-nav__item--disabled")) return;
      const tab = btn.getAttribute("data-tab-nav");
      void TAB_ACTIONS[tab]?.();
    });
  });
}

function renderNavItems(nav) {
  const inLobby = hasActiveLobby();
  const tabs = resolveBottomNavTabs(inLobby);
  nav.innerHTML = tabs.map((id) => tabButtonHtml(id)).join("");
  bindNavClicks(nav);
  syncFriendsEntryBadges(nav);
}

function setActiveTab(tabId) {
  const nav = document.getElementById("bottom-nav");
  if (!nav) return;
  nav.querySelectorAll("[data-tab]").forEach((el) => {
    el.classList.toggle("bottom-nav__item--active", el.getAttribute("data-tab") === tabId);
  });
}

function syncActiveTab(screenId) {
  const tab = SCREEN_TO_TAB[screenId] || null;
  if (tab) setActiveTab(tab);
  else setActiveTab(null);
}

/** Grise/verrouille Résultats + Classement quand le joueur est en prépa / en jeu. */
function syncScoreTabsLock(screenId) {
  const nav = document.getElementById("bottom-nav");
  if (!nav) return;
  const locked = isScoresNavLocked(screenId);
  [TAB_RESULTS, TAB_FINAL].forEach((tab) => {
    const el = nav.querySelector(`[data-tab="${tab}"]`);
    if (!el) return;
    el.classList.toggle("bottom-nav__item--disabled", locked);
    el.setAttribute("aria-disabled", locked ? "true" : "false");
    if (locked) el.setAttribute("tabindex", "-1");
    else el.removeAttribute("tabindex");
  });
}

/** Masqué uniquement sur le lobby d’attente (avant « Commencer »). */
const SCREENS_WITHOUT_NAV = new Set(["lobby"]);

function updateNavVisibility(screenId) {
  const nav = document.getElementById("bottom-nav");
  if (!nav) return;

  const inLobby = hasActiveLobby();
  const show = inLobby && !SCREENS_WITHOUT_NAV.has(screenId);
  nav.classList.toggle("bottom-nav--hidden", !show);
  nav.hidden = !show;
  document.body.classList.toggle("has-bottom-nav", show);

  // Catalogue selon membership réelle (Accueil hors lobby / Menu en lobby).
  const want = resolveBottomNavTabs(inLobby).join("|");
  const have = [...nav.querySelectorAll("[data-tab]")]
    .map((el) => el.getAttribute("data-tab"))
    .join("|");
  if (want !== have) {
    renderNavItems(nav);
  }
}

function handleScreenChange(screenId) {
  updateNavVisibility(screenId);
  syncActiveTab(screenId);
  syncScoreTabsLock(screenId);
}

export function initBottomNav() {
  const nav = document.getElementById("bottom-nav");
  if (!nav) return;

  nav.classList.add("bottom-nav--hidden");
  nav.hidden = true;
  renderNavItems(nav);

  onScreenChange(handleScreenChange);
  handleScreenChange(getCurrentScreen());
}

export { resolveBottomNavTabs, isBottomNavTabVisible } from "./bottomNavItems.js";
