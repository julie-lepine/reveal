import {
  allLobbySubmitted,
  hasLocalSubmission,
} from "../core/guessLieSession.js";
import { requireLobbyPlay } from "../core/gameGuard.js";
import { isGameSyncActive, isLobbyHost } from "../core/gameSync.js";
import { handleGuessLieLaunch, navigateToGuessLiePlay } from "../core/guessLieSession.js";
import { pageShell } from "../core/ui.js";
import { bindNav } from "./nav.js";

export function mountGuessLieMenu(app) {
  if (!requireLobbyPlay()) return null;

  const ready = hasLocalSubmission();
  const lobbyFull = allLobbySubmitted();

  app.innerHTML = pageShell({
    backTarget: "back",
    content: `
      <p class="label-upper label-upper--green">🕵️ Guess The Lie</p>
      <h2 class="screen-title">Prêt pour la partie ?</h2>

      ${
        !ready
          ? `<button type="button" class="card card--clickable card--highlight" data-nav="guesslie-setup">
        <div class="card-row">
          <span class="card-row__icon">🕵️</span>
          <div class="card-row__text">
            <p class="card-row__title">Préparer Guess The Lie</p>
            <p class="card-row__sub">2 vérités + 1 mensonge avant la partie</p>
          </div>
          <span class="card-row__chevron">›</span>
        </div>
      </button>`
          : ""
      }

      ${
        ready && !lobbyFull
          ? `<button type="button" class="btn btn-primary btn--spaced" data-nav="guesslie-wait">
          Salon d'attente du lobby →
        </button>`
          : ""
      }

      ${
        ready && lobbyFull
          ? `<button type="button" class="btn btn-primary btn--spaced" id="btn-play">
          Lancer la partie →
        </button>`
          : ""
      }

      ${
        ready
          ? `<p class="hint">${lobbyFull ? "Tout le lobby est prêt." : "En attente des autres joueurs…"}</p>`
          : `<p class="hint">Commence par préparer tes affirmations.</p>`
      }
    `,
  });

  bindNav(app);

  app.querySelector("#btn-play")?.addEventListener("click", async () => {
    if (isGameSyncActive() && !isLobbyHost()) return;
    const btn = app.querySelector("#btn-play");
    try {
      await handleGuessLieLaunch(btn);
      navigateToGuessLiePlay();
    } catch (err) {
      console.warn("Guess The Lie launch:", err);
      const { showAppAlert } = await import("../core/dialog.js");
      await showAppAlert(err?.message || "Impossible de lancer la partie.", {
        title: "Guess The Lie",
        icon: "⚠️",
      });
    }
  });

  return null;
}
