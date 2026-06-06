import {
  allTruthMeterReady,
  getTruthMeterEntryScreen,
  getTruthMeterSession,
  isLocalTruthMeterHost,
  markTruthMeterLobbyStarted,
  setTruthMeterReady,
  simulateTruthMeterReady,
} from "../core/truthMeterSession.js";
import { getActivePlayerNames } from "../core/players.js";
import { getLobbyParticipants } from "../core/lobby.js";
import { getLocalDisplayName } from "../core/state.js";
import { requireLobbyPlay } from "../core/gameGuard.js";
import { rulesButtonHtml } from "../core/gameRulesUi.js";
import { isGameSyncActive, isLobbyHost, onGameSessionChange } from "../core/gameSync.js";
import { prepGuestFollowOnSession, runPrepGameLaunch } from "../core/mpLaunch.js";
import { navigate } from "../core/router.js";
import { escapeHtml, pageShell } from "../core/ui.js";
import { bindNav } from "./nav.js";
import { TRUTH_METER_MIN_PLAYERS } from "../../data/truthMeter.js";
import { showAppAlert } from "../core/dialog.js";

const TRUTH_METER_NAV = ["home", "lobby", "game-select", "truthmeter-prep", "truthmeter"];

export function mountTruthMeterPrep(app) {
  if (!requireLobbyPlay()) return null;

  let cleanupSim = null;
  let readyCommitInFlight = null;
  const localName = getLocalDisplayName();

  function localReadyState() {
    if (readyCommitInFlight !== null) return readyCommitInFlight;
    return Boolean(getTruthMeterSession().ready[localName]);
  }

  function refreshReadySection() {
    const session = getTruthMeterSession();
    const members = getLobbyParticipants();
    const allReady = allTruthMeterReady();
    const localReady = localReadyState();
    const roundCount = getActivePlayerNames().length;

    const playersCard = app.querySelector("#truth-meter-players");
    if (playersCard) {
      playersCard.innerHTML = `
        <p class="card-heading">Joueurs prêts</p>
        ${members
          .map(
            (m) => `
          <div class="lobby-player ${session.ready[m.name] ? "lobby-player--ready" : ""}">
            <span class="lobby-player__status">${session.ready[m.name] ? "✓" : "…"}</span>
            <span class="lobby-player__name">${escapeHtml(m.name)}</span>
          </div>`
          )
          .join("")}`;
    }

    const readyBtn = app.querySelector("#btn-ready");
    if (readyBtn) {
      readyBtn.classList.toggle("btn-ready--active", Boolean(localReady));
      readyBtn.textContent = localReady ? "Prêt ✓" : "Je suis prêt !";
    }

    const startSlot = app.querySelector("#truth-meter-start-slot");
    if (startSlot) {
      if (allReady && roundCount >= TRUTH_METER_MIN_PLAYERS && isLocalTruthMeterHost()) {
        startSlot.innerHTML = `<button type="button" class="btn btn-primary btn--spaced" id="btn-start-game">Lancer TruthMeter →</button>`;
        startSlot.querySelector("#btn-start-game")?.addEventListener("click", onStartGame);
      } else {
        startSlot.innerHTML = `<button type="button" class="btn btn-secondary btn--spaced" disabled>${
          roundCount < TRUTH_METER_MIN_PLAYERS
            ? `Il faut au moins ${TRUTH_METER_MIN_PLAYERS} joueurs`
            : "En attente des joueurs…"
        }</button>`;
      }
    }
  }

  async function onStartGame() {
    if (!isLobbyHost()) {
      await showAppAlert("Seul l'hôte peut lancer la partie.", {
        title: "TruthMeter",
        icon: "👑",
      });
      return;
    }
    try {
      await runPrepGameLaunch({
        btn: app.querySelector("#btn-start-game"),
        launch: markTruthMeterLobbyStarted,
        gameScreen: "truthmeter",
        navStack: TRUTH_METER_NAV,
      });
    } catch (e) {
      console.warn("REVEAL start TruthMeter:", e);
      await showAppAlert(e.message || "Impossible de lancer TruthMeter.", {
        title: "TruthMeter",
        icon: "⚠️",
      });
    }
  }

  function bindEvents() {
    bindNav(app);

    app.querySelector("#btn-ready")?.addEventListener("click", async () => {
      const nextReady = !localReadyState();
      readyCommitInFlight = nextReady;
      refreshReadySection();
      try {
        await setTruthMeterReady(localName, nextReady);
        if (!isGameSyncActive() && nextReady) {
          if (cleanupSim) cleanupSim();
          cleanupSim = simulateTruthMeterReady(refreshReadySection);
        }
        if (!isGameSyncActive() && !nextReady && cleanupSim) {
          cleanupSim();
          cleanupSim = null;
        }
      } finally {
        readyCommitInFlight = null;
        refreshReadySection();
      }
    });
  }

  function render() {
    const session = getTruthMeterSession();
    const members = getLobbyParticipants();
    const allReady = allTruthMeterReady();
    const localReady = localReadyState();
    const roundCount = getActivePlayerNames().length;

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
          <p class="card-heading">Joueurs prêts</p>
          ${members
            .map(
              (m) => `
            <div class="lobby-player ${session.ready[m.name] ? "lobby-player--ready" : ""}">
              <span class="lobby-player__status">${session.ready[m.name] ? "✓" : "…"}</span>
              <span class="lobby-player__name">${escapeHtml(m.name)}</span>
            </div>`
            )
            .join("")}
        </div>

        <button type="button" class="btn btn-ready ${localReady ? "btn-ready--active" : ""}" id="btn-ready">
          ${localReady ? "Prêt ✓" : "Je suis prêt !"}
        </button>

        <div id="truth-meter-start-slot">
        ${
          allReady && roundCount >= TRUTH_METER_MIN_PLAYERS && isLocalTruthMeterHost()
            ? `<button type="button" class="btn btn-primary btn--spaced" id="btn-start-game">Lancer TruthMeter →</button>`
            : `<button type="button" class="btn btn-secondary btn--spaced" disabled>${
                roundCount < TRUTH_METER_MIN_PLAYERS
                  ? `Il faut au moins ${TRUTH_METER_MIN_PLAYERS} joueurs`
                  : !isLocalTruthMeterHost()
                    ? "En attente de l'hôte…"
                    : "En attente des joueurs…"
              }</button>`
        }
        </div>
      `,
    });

    bindEvents();
    app.querySelector("#btn-start-game")?.addEventListener("click", onStartGame);
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
    if (cleanupSim) cleanupSim();
    unsub();
  };
}
