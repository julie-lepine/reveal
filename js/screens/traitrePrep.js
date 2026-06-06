import { TRAITRE_MIN_PLAYERS } from "../../data/traitre.js";
import {
  allTraitreReady,
  getTraitreEntryScreen,
  getTraitreSession,
  isLocalTraitreHost,
  markTraitreLobbyStarted,
  setTraitreReady,
  simulateTraitreReady,
  validateTraitreLaunch,
} from "../core/traitreSession.js";
import { getLobbyParticipants } from "../core/lobby.js";
import { getLocalDisplayName } from "../core/state.js";
import { requireLobbyPlay } from "../core/gameGuard.js";
import { rulesButtonHtml } from "../core/gameRulesUi.js";
import { isGameSyncActive, onGameSessionChange } from "../core/gameSync.js";
import { prepGuestFollowOnSession, runPrepGameLaunch } from "../core/mpLaunch.js";
import { navigate } from "../core/router.js";
import { escapeHtml, pageShell } from "../core/ui.js";
import { bindNav } from "./nav.js";

export function mountTraitrePrep(app) {
  if (!requireLobbyPlay()) return null;

  let cleanupSim = null;
  let readyCommitInFlight = null;
  const localName = getLocalDisplayName();

  function localReadyState() {
    if (readyCommitInFlight !== null) return readyCommitInFlight;
    return Boolean(getTraitreSession().ready?.[localName]);
  }

  async function onStartGame() {
    const check = validateTraitreLaunch();
    if (!check.ok) {
      const { showAppAlert } = await import("../core/dialog.js");
      await showAppAlert(`Le Traître nécessite au moins ${TRAITRE_MIN_PLAYERS} joueurs (${check.count} présents).`, {
        title: "Le Traître",
        icon: "🎭",
      });
      return;
    }
    await runPrepGameLaunch({
      btn: app.querySelector("#btn-start-game"),
      launch: markTraitreLobbyStarted,
      gameScreen: "traitre",
      navStack: ["home", "lobby", "game-select", "traitre-prep", "traitre"],
    });
  }

  function render() {
    const session = getTraitreSession();
    const members = getLobbyParticipants();
    const allReady = allTraitreReady();
    const localReady = localReadyState();
    const isHost = isLocalTraitreHost();
    const check = validateTraitreLaunch();

    app.innerHTML = pageShell({
      backTarget: "back",
      content: `
        <p class="label-upper label-upper--gold">🎭 Le Traître</p>
        <div class="screen-title-row">
          <h2 class="screen-title">Préparation</h2>
          ${rulesButtonHtml("traitre")}
        </div>
        <p class="game-intro">
          Mot secret pour tous… sauf un. Indices oraux, votes d'élimination, démasque le traître avant le duo final.
        </p>
        <p class="hint">${check.ok ? `${check.count} joueur(s) prêts à jouer.` : `Minimum ${TRAITRE_MIN_PLAYERS} joueurs requis (${check.count} présents).`}</p>

        <div class="card" id="traitre-players">
          <p class="card-heading">Joueurs prêts</p>
          ${members
            .map(
              (m) => `
            <div class="lobby-player ${session.ready?.[m.name] ? "lobby-player--ready" : ""}">
              <span class="lobby-player__status">${session.ready?.[m.name] ? "✓" : "…"}</span>
              <span class="lobby-player__name">${escapeHtml(m.name)}</span>
            </div>`
            )
            .join("")}
        </div>

        <button type="button" class="btn btn-secondary btn--spaced btn-ready ${localReady ? "btn-ready--active" : ""}" id="btn-ready">
          ${localReady ? "Prêt ✓" : "Je suis prêt !"}
        </button>

        <div id="traitre-start-slot">
          ${
            allReady && check.ok && isHost
              ? `<button type="button" class="btn btn-primary btn--spaced" id="btn-start-game">Lancer Le Traître →</button>`
              : `<button type="button" class="btn btn-secondary btn--spaced" disabled>${
                  !check.ok
                    ? `Minimum ${TRAITRE_MIN_PLAYERS} joueurs`
                    : "En attente des joueurs…"
                }</button>`
          }
        </div>
      `,
    });

    bindNav(app);
    app.querySelector("#btn-ready")?.addEventListener("click", async () => {
      const nextReady = !localReadyState();
      readyCommitInFlight = nextReady;
      render();
      try {
        await setTraitreReady(localName, nextReady);
        if (!isGameSyncActive() && nextReady) {
          if (cleanupSim) cleanupSim();
          cleanupSim = simulateTraitreReady(render);
        }
      } finally {
        readyCommitInFlight = null;
        render();
      }
    });
    app.querySelector("#btn-start-game")?.addEventListener("click", () => {
      void onStartGame();
    });
  }

  const entry = getTraitreEntryScreen();
  if (entry !== "traitre-prep") {
    navigate(entry);
    return null;
  }

  const unsub = onGameSessionChange(() => {
    prepGuestFollowOnSession({
      prepScreen: "traitre-prep",
      getEntryScreen: getTraitreEntryScreen,
      buildNavStack: (screen) => ["home", "lobby", "game-select", "traitre-prep", screen],
    });
    render();
  });

  render();

  return () => {
    if (cleanupSim) cleanupSim();
    unsub();
  };
}
