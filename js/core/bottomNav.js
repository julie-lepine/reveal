import { APP_LOGO } from "../../data/branding.js";
import { hasActiveLobby, returnToEveningGames } from "./lobby.js";
import { onScreenChange, getCurrentScreen } from "./router.js";
import { goToEveningHome } from "../screens/nav.js";
import { goToScores, isScoresNavLocked } from "./navAccess.js";

const TAB_HOME = "home";
const TAB_GAMES = "games";
const TAB_LOGO = "logo";
const TAB_RESULTS = "results";
const TAB_FINAL = "final";

/** Écran courant → onglet actif */
const SCREEN_TO_TAB = {
  home: TAB_HOME,
  lobby: TAB_LOGO,
  "game-select": TAB_GAMES,
  leaderboard: TAB_FINAL,
  results: TAB_RESULTS,
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
  guesslie: TAB_GAMES,
  "guesslie-menu": TAB_GAMES,
  "guesslie-setup": TAB_GAMES,
  "guesslie-wait": TAB_GAMES,
  "tiernight-select": TAB_GAMES,
  "tiernight-create": TAB_GAMES,
  tiernight: TAB_GAMES,
  "tiernight-end": TAB_RESULTS,
  settings: TAB_HOME,
};

function goHome() {
  goToEveningHome();
}

async function goGames() {
  await returnToEveningGames({ hubOnly: true });
}

function goResults() {
  goToScores("results");
}

function goFinal() {
  goToScores("leaderboard");
}

const TAB_ACTIONS = {
  [TAB_HOME]: goHome,
  [TAB_GAMES]: goGames,
  [TAB_RESULTS]: goResults,
  [TAB_FINAL]: goFinal,
};

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

  const show = hasActiveLobby() && !SCREENS_WITHOUT_NAV.has(screenId);
  nav.classList.toggle("bottom-nav--hidden", !show);
  nav.hidden = !show;
  document.body.classList.toggle("has-bottom-nav", show);
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

  nav.innerHTML = `
    <button type="button" class="bottom-nav__item" data-tab="${TAB_HOME}" data-tab-nav="${TAB_HOME}" aria-label="Accueil">
      <span class="bottom-nav__icon-wrap"><span class="bottom-nav__icon" aria-hidden="true">🏠</span></span>
      <span class="bottom-nav__label">Accueil</span>
    </button>
    <button type="button" class="bottom-nav__item" data-tab="${TAB_GAMES}" data-tab-nav="${TAB_GAMES}" aria-label="Jeux">
      <span class="bottom-nav__icon-wrap"><span class="bottom-nav__icon" aria-hidden="true">🎮</span></span>
      <span class="bottom-nav__label">Jeux</span>
    </button>
    <div class="bottom-nav__item bottom-nav__item--logo" data-tab="${TAB_LOGO}" aria-hidden="true">
      <span class="bottom-nav__logo-wrap">
        <img src="${APP_LOGO}" alt="REVEAL" class="bottom-nav__logo" />
      </span>
    </div>
    <button type="button" class="bottom-nav__item" data-tab="${TAB_RESULTS}" data-tab-nav="${TAB_RESULTS}" aria-label="Résultats">
      <span class="bottom-nav__icon-wrap"><span class="bottom-nav__icon" aria-hidden="true">📊</span></span>
      <span class="bottom-nav__label">Résultats</span>
    </button>
    <button type="button" class="bottom-nav__item" data-tab="${TAB_FINAL}" data-tab-nav="${TAB_FINAL}" aria-label="Classement">
      <span class="bottom-nav__icon-wrap"><span class="bottom-nav__icon" aria-hidden="true">🏆</span></span>
      <span class="bottom-nav__label">Classement</span>
    </button>
  `;

  nav.querySelectorAll("[data-tab-nav]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.classList.contains("bottom-nav__item--disabled")) return;
      const tab = btn.getAttribute("data-tab-nav");
      TAB_ACTIONS[tab]?.();
    });
  });

  onScreenChange(handleScreenChange);
  handleScreenChange(getCurrentScreen());
}
