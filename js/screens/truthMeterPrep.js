import {
  allTruthMeterReady,
  getTruthMeterEntryScreen,
  getTruthMeterSession,
  markTruthMeterLobbyStarted,
  setTruthMeterReady,
  simulateTruthMeterReady,
} from "../core/truthMeterSession.js";
import { getActivePlayerNames } from "../core/players.js";
import { getLobbyParticipants } from "../core/lobby.js";
import { getLocalDisplayName } from "../core/state.js";
import { requireLobbyPlay } from "../core/gameGuard.js";
import { rulesButtonHtml } from "../core/gameRulesUi.js";
import { isLobbyHost, onGameSessionChange } from "../core/gameSync.js";
import { prepGuestFollowOnSession } from "../core/mpLaunch.js";
import { executePrepLaunch } from "../core/prepLaunch.js";
import { createPrepLobbyController } from "../core/usePrepLobby.js";
import {
  playersReadySectionHtml,
  prepStartSlotHtml,
  refreshPrepReadyUi,
  updatePrepStartSlot,
  bindPrepLaunchButtons,
} from "../core/prepScreen.js";
import { prepLaunchSlotParams } from "../core/prepLaunch.js";
import { navigate } from "../core/router.js";
import { pageShell } from "../core/ui.js";
import { bindNav } from "./nav.js";
import { TRUTH_METER_MIN_PLAYERS } from "../../data/truthMeter.js";
import { showAppAlert } from "../core/dialog.js";

const TRUTH_METER_NAV = ["home", "lobby", "game-select", "truthmeter-prep", "truthmeter"];

export function mountTruthMeterPrep(app) {
  if (!requireLobbyPlay()) return null;

  const localName = getLocalDisplayName();
  const prepLobby = createPrepLobbyController({
    localKey: localName,
    getReadyMap: () => getTruthMeterSession().ready || {},
  });

  function minPlayersOk() {
    return getActivePlayerNames().length >= TRUTH_METER_MIN_PLAYERS;
  }

  function refreshReadySection() {
    const session = getTruthMeterSession();
    const members = getLobbyParticipants();
    const allReady = allTruthMeterReady();
    const ok = minPlayersOk();

    refreshPrepReadyUi(app, {
      playersSelector: "#truth-meter-players",
      readyBtnSelector: "#btn-ready",
      members,
      readyMap: session.ready || {},
      localReady: prepLobby.localReadyState(),
    });

    updatePrepStartSlot(
      app.querySelector("#truth-meter-start-slot"),
      truthMeterStartSlotHtml(allReady, ok),
      onLaunch
    );
  }

  function truthMeterStartSlotHtml(allReady, ok) {
    const session = getTruthMeterSession();
    return prepStartSlotHtml(
      prepLaunchSlotParams({
        readyMap: session.ready || {},
        allReady,
        isHost: isLobbyHost(),
        minPlayers: TRUTH_METER_MIN_PLAYERS,
        poolEmpty: !ok,
        poolEmptyLabel: `Il faut au moins ${TRUTH_METER_MIN_PLAYERS} joueurs`,
        launchLabel: "Lancer TruthMeter →",
      })
    );
  }

  async function onLaunch({ force = false } = {}) {
    const ok = minPlayersOk();
    try {
      await executePrepLaunch({
        force,
        btn: app.querySelector(force ? "#btn-force-start-game" : "#btn-start-game"),
        getReadyMap: () => getTruthMeterSession().ready || {},
        minPlayers: TRUTH_METER_MIN_PLAYERS,
        gameTitle: "TruthMeter",
        gameScreen: "truthmeter",
        navStack: TRUTH_METER_NAV,
        markStarted: markTruthMeterLobbyStarted,
        allReadyFn: allTruthMeterReady,
        poolEmpty: !ok,
      });
    } catch (e) {
      console.warn("REVEAL start TruthMeter:", e);
      await showAppAlert(e.message || "Impossible de lancer TruthMeter.", {
        title: "TruthMeter",
        icon: "⚠️",
      });
    }
  }

  function render() {
    const session = getTruthMeterSession();
    const members = getLobbyParticipants();
    const allReady = allTruthMeterReady();
    const localReady = prepLobby.localReadyState();
    const roundCount = getActivePlayerNames().length;
    const ok = minPlayersOk();

    app.innerHTML = pageShell({
      backTarget: "back",
      content: `
        <p class="label-upper label-upper--gold">📏 TruthMeter</p>
        <div class="screen-title-row">
          <h2 class="screen-title">Préparation</h2>
          ${rulesButtonHtml("truthmeter")}
        </div>
        <p class="game-intro">Chacun écrit une affirmation, les autres jugent avec un curseur Faux → Vrai.</p>

        <div class="card">
          <p class="card-heading">Déroulé</p>
          <p class="hint"><strong>${roundCount}</strong> manche${roundCount > 1 ? "s" : ""} - un auteur.</p>
          <p class="hint">0 = Faux · 100 = Vrai · Gros écart auteur/groupe = bonus bluff.</p>
        </div>

        <div class="card" id="truth-meter-players">
          ${playersReadySectionHtml(members, session.ready || {})}
        </div>

        <button type="button" class="btn btn-ready ${localReady ? "btn-ready--active" : ""}" id="btn-ready">
          ${localReady ? "Prêt ✓" : "Je suis prêt !"}
        </button>

        <div id="truth-meter-start-slot">
          ${truthMeterStartSlotHtml(allReady, ok)}
        </div>
      `,
    });

    bindNav(app);
    app.querySelector("#btn-ready")?.addEventListener("click", () => {
      void prepLobby.toggleReady({
        setReady: setTruthMeterReady,
        simulateReady: simulateTruthMeterReady,
        render: refreshReadySection,
      });
    });
    bindPrepLaunchButtons(app, { onLaunch });
  }

  render();

  const guestFollow = prepGuestFollowOnSession({
    prepScreen: "truthmeter-prep",
    getEntryScreen: getTruthMeterEntryScreen,
    buildNavStack: () => TRUTH_METER_NAV,
  });

  const unsub = onGameSessionChange(() => {
    if (guestFollow()) return;
    refreshReadySection();
  });

  return () => {
    prepLobby.dispose();
    unsub();
  };
}
