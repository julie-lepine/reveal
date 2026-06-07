import { TRAITRE_MIN_PLAYERS } from "../../data/traitre.js";
import {
  allTraitreReady,
  getTraitreEntryScreen,
  getTraitreSession,
  markTraitreLobbyStarted,
  setTraitreReady,
  simulateTraitreReady,
  validateTraitreLaunch,
} from "../core/traitreSession.js";
import { getLobbyParticipants } from "../core/lobby.js";
import { getLocalDisplayName } from "../core/state.js";
import { requireLobbyPlay } from "../core/gameGuard.js";
import { rulesButtonHtml } from "../core/gameRulesUi.js";
import { isLobbyHost, onGameSessionChange } from "../core/gameSync.js";
import { prepGuestFollowOnSession, runPrepGameLaunch } from "../core/mpLaunch.js";
import { createPrepLobbyController } from "../core/usePrepLobby.js";
import {
  playersReadySectionHtml,
  prepStartSlotHtml,
  updatePlayersReadyCard,
  updateReadyButton,
  updatePrepStartSlot,
} from "../core/prepScreen.js";
import { navigate } from "../core/router.js";
import { pageShell } from "../core/ui.js";
import { bindNav } from "./nav.js";

export function mountTraitrePrep(app) {
  if (!requireLobbyPlay()) return null;

  const localName = getLocalDisplayName();
  const prepLobby = createPrepLobbyController({
    localKey: localName,
    getReadyMap: () => getTraitreSession().ready || {},
  });

  async function onStartGame() {
    const check = validateTraitreLaunch();
    if (!check.ok) {
      const { showAppAlert } = await import("../core/dialog.js");
      await showAppAlert(`Spot the fake nécessite au moins ${TRAITRE_MIN_PLAYERS} joueurs (${check.count} présents).`, {
        title: "Spot the fake",
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
    const localReady = prepLobby.localReadyState();
    const isHost = isLobbyHost();
    const check = validateTraitreLaunch();

    app.innerHTML = pageShell({
      backTarget: "back",
      content: `
        <p class="label-upper label-upper--gold">🎭 Spot the fake</p>
        <div class="screen-title-row">
          <h2 class="screen-title">Préparation</h2>
          ${rulesButtonHtml("traitre")}
        </div>
        <p class="game-intro">
          Mot secret pour tous… sauf un. Indices oraux, votes d'élimination, démasque le fake avant le duo final.
        </p>
        <p class="hint">${check.ok ? `${check.count} joueur(s) prêts à jouer.` : `Minimum ${TRAITRE_MIN_PLAYERS} joueurs requis (${check.count} présents).`}</p>

        <div class="card" id="traitre-players">
          ${playersReadySectionHtml(members, session.ready || {})}
        </div>

        <button type="button" class="btn btn-secondary btn--spaced btn-ready ${localReady ? "btn-ready--active" : ""}" id="btn-ready">
          ${localReady ? "Prêt ✓" : "Je suis prêt !"}
        </button>

        <div id="traitre-start-slot">
          ${prepStartSlotHtml({
            poolEmpty: !check.ok,
            poolEmptyLabel: `Minimum ${TRAITRE_MIN_PLAYERS} joueurs`,
            allReady,
            isHost,
            launchLabel: "Lancer Spot the fake →",
          })}
        </div>
      `,
    });

    bindNav(app);
    app.querySelector("#btn-ready")?.addEventListener("click", () => {
      void prepLobby.toggleReady({
        setReady: setTraitreReady,
        simulateReady: simulateTraitreReady,
        render,
      });
    });
    app.querySelector("#btn-start-game")?.addEventListener("click", () => {
      void onStartGame();
    });
  }

  function refreshReadySection() {
    const session = getTraitreSession();
    const members = getLobbyParticipants();
    updatePlayersReadyCard(app.querySelector("#traitre-players"), members, session.ready || {});
    updateReadyButton(app.querySelector("#btn-ready"), prepLobby.localReadyState());
    const allReady = allTraitreReady();
    const check = validateTraitreLaunch();
    updatePrepStartSlot(
      app.querySelector("#traitre-start-slot"),
      prepStartSlotHtml({
        poolEmpty: !check.ok,
        poolEmptyLabel: `Minimum ${TRAITRE_MIN_PLAYERS} joueurs`,
        allReady,
        isHost: isLobbyHost(),
        launchLabel: "Lancer Spot the fake →",
      }),
      onStartGame
    );
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
    if (getTraitreEntryScreen() === "traitre-prep") {
      refreshReadySection();
    }
  });

  render();

  return () => {
    prepLobby.dispose();
    unsub();
  };
}
