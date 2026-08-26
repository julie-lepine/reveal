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
import { executePrepLaunch, prepLaunchSlotParams } from "../core/prepLaunch.js";
import { createPrepLobbyController } from "../core/usePrepLobby.js";
import {
  playersReadySectionHtml,
  prepStartSlotHtml,
  refreshPrepReadyUi,
  updatePrepStartSlot,
  bindPrepLaunchButtons,
} from "../core/prepScreen.js";
import { navigate } from "../core/router.js";
import { pageShell, escapeHtml } from "../core/ui.js";
import { bindNav } from "./nav.js";
import { showAppAlert } from "../core/dialog.js";
import { estimateTruthMeterDuration } from "../core/truthMeterDuration.js";

const TRUTH_METER_NAV = ["home", "lobby", "game-select", "truthmeter-prep", "truthmeter"];

export function mountTruthMeterPrep(app) {
  if (!requireLobbyPlay()) return null;

  const entry = getTruthMeterEntryScreen();
  if (entry !== "truthmeter-prep") {
    navigate(entry);
    return null;
  }

  const localName = getLocalDisplayName();
  const prepLobby = createPrepLobbyController({
    localKey: localName,
    getReadyMap: () => getTruthMeterSession().ready || {},
  });

  function refreshReadySection() {
    const session = getTruthMeterSession();
    const members = getLobbyParticipants();
    const allReady = allTruthMeterReady();
    const roundCount = getActivePlayerNames().length;
    const duration = estimateTruthMeterDuration(roundCount);

    refreshPrepReadyUi(app, {
      playersSelector: "#truth-meter-players",
      readyBtnSelector: "#btn-ready",
      members,
      readyMap: session.ready || {},
      localReady: prepLobby.localReadyState(),
    });

    const dur = app.querySelector("#truth-meter-duration");
    if (dur) {
      dur.innerHTML = `
        <strong>${roundCount}</strong> manche${roundCount > 1 ? "s" : ""} - un auteur
        · ${escapeHtml(duration.label)}
        <span class="muted"> (estimation)</span>`;
    }

    updatePrepStartSlot(
      app.querySelector("#truth-meter-start-slot"),
      truthMeterStartSlotHtml(allReady),
      onLaunch
    );
  }

  function truthMeterStartSlotHtml(allReady) {
    const session = getTruthMeterSession();
    return prepStartSlotHtml(
      prepLaunchSlotParams({
        readyMap: session.ready || {},
        allReady,
        isHost: isLobbyHost(),
        minPlayers: 1,
        launchLabel: "Lancer TruthMeter →",
      })
    );
  }

  async function onLaunch({ force = false } = {}) {
    try {
      await executePrepLaunch({
        force,
        btn: app.querySelector(force ? "#btn-force-start-game" : "#btn-start-game"),
        getReadyMap: () => getTruthMeterSession().ready || {},
        minPlayers: 1,
        gameTitle: "TruthMeter",
        gameScreen: "truthmeter",
        navStack: TRUTH_METER_NAV,
        markStarted: markTruthMeterLobbyStarted,
        allReadyFn: allTruthMeterReady,
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
    const duration = estimateTruthMeterDuration(roundCount);

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
          <p class="hint" id="truth-meter-duration">
            <strong>${roundCount}</strong> manche${roundCount > 1 ? "s" : ""} - un auteur
            · ${escapeHtml(duration.label)}
            <span class="muted"> (estimation)</span>
          </p>
          <p class="hint">0 = Faux · 100 = Vrai · Gros écart auteur/groupe = bonus bluff.</p>
        </div>

        <div class="card" id="truth-meter-players">
          ${playersReadySectionHtml(members, session.ready || {})}
        </div>

        <button type="button" class="btn btn-ready ${localReady ? "btn-ready--active" : ""}" id="btn-ready">
          ${localReady ? "Prêt ✓" : "Je suis prêt !"}
        </button>

        <div id="truth-meter-start-slot">
          ${truthMeterStartSlotHtml(allReady)}
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
