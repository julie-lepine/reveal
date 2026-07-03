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
import { isLobbyHost, onGameSessionChange, isGameSyncActive } from "../core/gameSync.js";
import { prepGuestFollowOnSession } from "../core/mpLaunch.js";
import { executePrepLaunch } from "../core/prepLaunch.js";
import { prepLaunchSlotParams } from "../core/prepLaunch.js";
import { createPrepLobbyController } from "../core/usePrepLobby.js";
import {
  playersReadySectionHtml,
  prepStartSlotHtml,
  updatePlayersReadyCard,
  updateReadyButton,
  updatePrepStartSlot,
  bindPrepLaunchButtons,
  syncPrepOnMount,
} from "../core/prepScreen.js";
import { navigate } from "../core/router.js";
import { pageShell } from "../core/ui.js";
import { bindNav } from "./nav.js";

function traitreMinPlayersCardHtml(playerCount) {
  const minPlayersMet = playerCount >= TRAITRE_MIN_PLAYERS;
  return `
    <div class="fil-rouge-setup__req ${minPlayersMet ? "fil-rouge-setup__req--ok" : "fil-rouge-setup__req--warn"}" role="status">
      <span class="fil-rouge-setup__req-icon" aria-hidden="true">👥</span>
      <div class="fil-rouge-setup__req-body">
        <p class="fil-rouge-setup__req-title">Minimum ${TRAITRE_MIN_PLAYERS} joueurs</p>
        <p class="fil-rouge-setup__req-detail">
          ${
            minPlayersMet
              ? `${playerCount} joueurs dans le lobby - c'est bon.`
              : `<strong>${playerCount} / ${TRAITRE_MIN_PLAYERS}</strong> joueurs - invite encore <strong>${TRAITRE_MIN_PLAYERS - playerCount}</strong> personne${TRAITRE_MIN_PLAYERS - playerCount > 1 ? "s" : ""}.`
          }
        </p>
      </div>
    </div>`;
}

export function mountTraitrePrep(app) {
  if (!requireLobbyPlay()) return null;

  const localName = getLocalDisplayName();
  const prepLobby = createPrepLobbyController({
    localKey: localName,
    getReadyMap: () => getTraitreSession().ready || {},
  });

  function traitreStartSlotHtml(allReady, check) {
    const session = getTraitreSession();
    return prepStartSlotHtml(
      prepLaunchSlotParams({
        readyMap: session.ready || {},
        allReady,
        isHost: isLobbyHost(),
        minPlayers: TRAITRE_MIN_PLAYERS,
        poolEmpty: !check.ok,
        poolEmptyLabel: `Il faut au moins ${TRAITRE_MIN_PLAYERS} joueurs`,
        launchLabel: "Lancer Spot the fake →",
      })
    );
  }

  async function onLaunch({ force = false } = {}) {
    const lobbyCheck = validateTraitreLaunch();
    await executePrepLaunch({
      force,
      btn: app.querySelector(force ? "#btn-force-start-game" : "#btn-start-game"),
      getReadyMap: () => getTraitreSession().ready || {},
      minPlayers: TRAITRE_MIN_PLAYERS,
      gameTitle: "Spot the fake",
      gameScreen: "traitre",
      navStack: ["home", "lobby", "game-select", "traitre-prep", "traitre"],
      markStarted: markTraitreLobbyStarted,
      allReadyFn: allTraitreReady,
      poolEmpty: !lobbyCheck.ok,
      validateBeforeLaunch: (roster) => {
        const check = validateTraitreLaunch(roster);
        if (!check.ok) {
          return {
            ok: false,
            message: `Spot the fake se joue à au moins ${TRAITRE_MIN_PLAYERS} : mot secret, indices oraux, vote d'élimination.`,
            icon: "👥",
          };
        }
        return { ok: true };
      },
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
          <span class="muted">${TRAITRE_MIN_PLAYERS} joueurs minimum.</span>
        </p>

        <div id="traitre-min-players">${traitreMinPlayersCardHtml(members.length)}</div>

        <div class="card" id="traitre-players">
          ${playersReadySectionHtml(members, session.ready || {})}
        </div>

        <button type="button" class="btn btn-secondary btn--spaced btn-ready ${localReady ? "btn-ready--active" : ""}" id="btn-ready">
          ${localReady ? "Prêt ✓" : "Je suis prêt !"}
        </button>

        <div id="traitre-start-slot">
          ${traitreStartSlotHtml(allReady, check)}
        </div>
      `,
    });

    bindNav(app);
    app.querySelector("#btn-ready")?.addEventListener("click", () => {
      void prepLobby.toggleReady({
        setReady: setTraitreReady,
        simulateReady: simulateTraitreReady,
        render: refreshReadySection,
      });
    });
    bindPrepLaunchButtons(app, { onLaunch });
  }

  function refreshReadySection() {
    const session = getTraitreSession();
    const members = getLobbyParticipants();
    updatePlayersReadyCard(app.querySelector("#traitre-players"), members, session.ready || {});
    updateReadyButton(app.querySelector("#btn-ready"), prepLobby.localReadyState());

    const minCard = app.querySelector("#traitre-min-players");
    if (minCard) {
      minCard.innerHTML = traitreMinPlayersCardHtml(members.length);
    }

    const allReady = allTraitreReady();
    const check = validateTraitreLaunch();
    updatePrepStartSlot(
      app.querySelector("#traitre-start-slot"),
      traitreStartSlotHtml(allReady, check),
      onLaunch
    );
  }

  const entry = getTraitreEntryScreen();
  if (entry !== "traitre-prep") {
    navigate(entry);
    return null;
  }

  const guestFollow = prepGuestFollowOnSession({
    prepScreen: "traitre-prep",
    getEntryScreen: getTraitreEntryScreen,
    buildNavStack: (screen) => ["home", "lobby", "game-select", "traitre-prep", screen],
  });

  const unsub = onGameSessionChange(() => {
    if (guestFollow()) return;
    if (getTraitreEntryScreen() === "traitre-prep") {
      refreshReadySection();
    }
  });

  render();
  syncPrepOnMount(refreshReadySection);

  return () => {
    prepLobby.dispose();
    unsub();
  };
}
