/**
 * Bouton 🎲 flottant (au-dessus du 💬) sur game-select : ouvre la roulette
 * « Jeu aléatoire » existante. Aucune logique de roulette ici : visibilité,
 * droits et lancement viennent de chatRandomGame.js.
 */
import {
  canOfferChatRouletteCta,
  isChatRouletteCtaEnabled,
  openChatRandomGameFromChat,
} from "./chatRandomGame.js";
import { isRouletteFabScreen } from "./chatFabScreens.js";
import { showAppAlert } from "./dialog.js";
import { onGameSessionChange } from "./gameSync.js";
import { getCurrentScreen, onScreenChange } from "./router.js";
import { onLobbyBundleUpdated } from "./supabaseLobby.js";

export const ROULETTE_FAB_GUEST_MESSAGE =
  "Seul l'hôte lance la roulette. Tu la verras tourner ici.";

let fabEl = null;

/**
 * @param {{ screenId: string|null, canOffer: boolean, enabled: boolean }} s
 * @returns {{ show: boolean, enabled: boolean }}
 */
export function rouletteFabState({ screenId, canOffer, enabled }) {
  const show = Boolean(canOffer) && isRouletteFabScreen(screenId);
  return { show, enabled: show && Boolean(enabled) };
}

function currentState() {
  return rouletteFabState({
    screenId: getCurrentScreen(),
    canOffer: canOfferChatRouletteCta(),
    enabled: isChatRouletteCtaEnabled(),
  });
}

function updateRouletteFab() {
  if (!fabEl) return;
  const { show, enabled } = currentState();
  fabEl.hidden = !show;
  // Laisse de la place en bas de page pour que 🎲 + 💬 ne cachent pas la dernière carte.
  document.body.classList.toggle("has-roulette-fab", show);
  fabEl.classList.toggle("roulette-fab--hidden", !show);
  fabEl.classList.toggle("roulette-fab--guest", show && !enabled);
  fabEl.setAttribute("aria-disabled", enabled ? "false" : "true");
  fabEl.setAttribute(
    "aria-label",
    enabled ? "Lancer un jeu au hasard" : "Jeu au hasard, réservé à l'hôte"
  );
}

function onRouletteFabClick() {
  const { show, enabled } = currentState();
  if (!show) return;
  if (!enabled) {
    void showAppAlert(ROULETTE_FAB_GUEST_MESSAGE, {
      title: "Jeu aléatoire",
      icon: "🎲",
    });
    return;
  }
  void openChatRandomGameFromChat();
}

export function initRouletteFab() {
  if (fabEl || typeof document === "undefined") return;
  fabEl = document.createElement("button");
  fabEl.type = "button";
  fabEl.id = "roulette-fab";
  fabEl.className = "roulette-fab roulette-fab--hidden";
  fabEl.hidden = true;
  fabEl.innerHTML = `<span class="roulette-fab__icon" aria-hidden="true">🎲</span>`;
  fabEl.addEventListener("click", onRouletteFabClick);
  document.body.appendChild(fabEl);

  onScreenChange(() => updateRouletteFab());
  onGameSessionChange(() => updateRouletteFab());
  onLobbyBundleUpdated(() => updateRouletteFab());
  updateRouletteFab();
}
