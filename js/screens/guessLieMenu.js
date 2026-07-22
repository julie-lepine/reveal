import {
  getGuessLieEntryScreen,
  hasLocalSubmission,
} from "../core/guessLieSession.js";
import { requireLobbyPlay } from "../core/gameGuard.js";
import { onGameSessionChange } from "../core/gameSync.js";
import { prepGuestFollowOnSession } from "../core/mpLaunch.js";
import { navigate } from "../core/router.js";
import { pageShell } from "../core/ui.js";
import { bindNav } from "./nav.js";

/**
 * Point d'entrée Guess The Lie : uniquement pour préparer ses affirmations.
 * Après soumission, tout le monde (hôte + invité) attend sur guesslie-wait.
 */
export function mountGuessLieMenu(app) {
  if (!requireLobbyPlay()) return null;

  if (hasLocalSubmission()) {
    navigate("guesslie-wait", { reset: true });
    return null;
  }

  app.innerHTML = pageShell({
    backTarget: "back",
    content: `
      <p class="label-upper label-upper--green">🕵️ Guess The Lie</p>
      <h2 class="screen-title">Prêt pour la partie ?</h2>

      <button type="button" class="card card--clickable card--highlight" data-nav="guesslie-setup">
        <div class="card-row">
          <span class="card-row__icon">🕵️</span>
          <div class="card-row__text">
            <p class="card-row__title">Préparer Guess The Lie</p>
            <p class="card-row__sub">2 vérités + 1 mensonge avant la partie</p>
          </div>
          <span class="card-row__chevron">›</span>
        </div>
      </button>

      <p class="hint">Commence par préparer tes affirmations.</p>
    `,
  });

  bindNav(app);

  const guestFollow = prepGuestFollowOnSession({
    prepScreen: "guesslie-menu",
    getEntryScreen: getGuessLieEntryScreen,
  });

  function onSessionUpdate() {
    if (hasLocalSubmission()) {
      navigate("guesslie-wait", { reset: true });
      return;
    }
    guestFollow();
  }

  const unsub = onGameSessionChange(onSessionUpdate);

  return () => {
    unsub();
  };
}
