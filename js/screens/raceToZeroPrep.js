import {
  allRaceToZeroReady,
  getRaceToZeroPrepSummary,
  getRaceToZeroSession,
  getRaceToZeroEntryScreen,
  markRaceToZeroLobbyStarted,
  setRaceToZeroReady,
  setRaceToZeroRoundCount,
} from "../core/raceToZeroSession.js";
import { RACE_TO_ZERO_ROUND_PRESETS } from "../../data/raceToZero.js";
import { getLobbyParticipants } from "../core/lobby.js";
import { getLocalDisplayName } from "../core/state.js";
import { requireLobbyPlay } from "../core/gameGuard.js";
import { rulesButtonHtml } from "../core/gameRulesUi.js";
import { isLobbyHost, onGameSessionChange } from "../core/gameSync.js";
import { prepGuestFollowOnSession } from "../core/mpLaunch.js";
import { prepLaunchSlotParams, DEFAULT_PREP_MIN_PLAYERS, executePrepLaunch } from "../core/prepLaunch.js";
import { createPrepLobbyController } from "../core/usePrepLobby.js";
import {
  playersReadySectionHtml,
  prepStartSlotHtml,
  refreshPrepReadyUi,
  updatePrepStartSlot,
  bindPrepLaunchButtons,
} from "../core/prepScreen.js";
import { pageShell } from "../core/ui.js";
import { bindNav } from "./nav.js";

export function mountRaceToZeroPrep(app) {
  if (!requireLobbyPlay()) return null;

  const localName = getLocalDisplayName();
  const prepLobby = createPrepLobbyController({
    localKey: localName,
    getReadyMap: () => getRaceToZeroSession().ready || {},
  });

  function startSlotHtml(allReady) {
    const session = getRaceToZeroSession();
    return prepStartSlotHtml(
      prepLaunchSlotParams({
        readyMap: session.ready || {},
        allReady,
        isHost: isLobbyHost(),
        minPlayers: DEFAULT_PREP_MIN_PLAYERS,
        launchLabel: "Lancer Race to Zero →",
      })
    );
  }

  function refreshReadySection() {
    const session = getRaceToZeroSession();
    const members = getLobbyParticipants();
    const allReady = allRaceToZeroReady();

    refreshPrepReadyUi(app, {
      playersSelector: "#race-zero-players",
      readyBtnSelector: "#btn-ready",
      members,
      readyMap: session.ready || {},
      localReady: prepLobby.localReadyState(),
    });

    updatePrepStartSlot(
      app.querySelector("#race-zero-start-slot"),
      startSlotHtml(allReady),
      onLaunch
    );
  }

  function refreshRounds() {
    const session = getRaceToZeroSession();
    const roundCount = session.roundCount ?? 5;
    const isHost = isLobbyHost();
    app.querySelectorAll("[data-round]").forEach((btn) => {
      const value = Number(btn.getAttribute("data-round"));
      btn.classList.toggle("theme-chip--active", roundCount === value);
      btn.disabled = !isHost;
    });
  }

  function refreshFromSync() {
    refreshRounds();
    refreshReadySection();
  }

  async function onLaunch({ force = false } = {}) {
    await executePrepLaunch({
      force,
      btn: app.querySelector(force ? "#btn-force-start-game" : "#btn-start-game"),
      getReadyMap: () => getRaceToZeroSession().ready || {},
      minPlayers: DEFAULT_PREP_MIN_PLAYERS,
      gameTitle: "Race to Zero",
      gameScreen: "racetozero",
      navStack: ["home", "lobby", "game-select", "racetozero-prep", "racetozero"],
      markStarted: markRaceToZeroLobbyStarted,
      allReadyFn: allRaceToZeroReady,
    });
  }

  function bindEvents() {
    bindNav(app);

    app.querySelectorAll("[data-round]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!isLobbyHost() || btn.disabled) return;
        await setRaceToZeroRoundCount(Number(btn.getAttribute("data-round")));
        render();
      });
    });

    app.querySelector("#btn-ready")?.addEventListener("click", () => {
      void prepLobby.toggleReady({
        setReady: setRaceToZeroReady,
        render: refreshReadySection,
      });
    });

    bindPrepLaunchButtons(app, { onLaunch });
  }

  function render() {
    const session = getRaceToZeroSession();
    const members = getLobbyParticipants();
    const allReady = allRaceToZeroReady();
    const localReady = prepLobby.localReadyState();
    const roundCount = session.roundCount ?? 5;
    const isHost = isLobbyHost();
    const prep = getRaceToZeroPrepSummary();

    app.innerHTML = pageShell({
      backTarget: "back",
      content: `
        <p class="label-upper label-upper--gold">💥 Race to Zero</p>
        <div class="screen-title-row">
          <h2 class="screen-title">Préparation</h2>
          ${rulesButtonHtml("racetozero")}
        </div>
        <p class="game-intro">Un chrono caché part d'une cible (9 à 15 s). Tape ta cible pile au moment où il atteint 0. Le plus proche gagne.</p>

        <div class="card">
          <p class="card-heading">Nombre de manches</p>
          <div class="theme-chips theme-chips--rounds">
            ${RACE_TO_ZERO_ROUND_PRESETS.map(
              (value) => `
              <button type="button" class="theme-chip ${roundCount === value ? "theme-chip--active" : ""}"
                data-round="${value}" ${isHost ? "" : "disabled"}>
                ${value}
              </button>`
            ).join("")}
          </div>
          <p class="hot-take-duration">
            <strong>${prep.effective}</strong> manche${prep.effective > 1 ? "s" : ""}
          </p>
          ${!isHost ? `<p class="hint">Seul l'hôte peut modifier les réglages.</p>` : ""}
        </div>

        <div class="card" id="race-zero-players">
          ${playersReadySectionHtml(members, session.ready || {})}
        </div>

        <button type="button" class="btn btn-ready ${localReady ? "btn-ready--active" : ""}" id="btn-ready">
          ${localReady ? "Prêt ✓" : "Je suis prêt !"}
        </button>

        <div id="race-zero-start-slot">
          ${startSlotHtml(allReady)}
        </div>
      `,
    });

    bindEvents();
  }

  render();

  const guestFollow = prepGuestFollowOnSession({
    prepScreen: "racetozero-prep",
    getEntryScreen: getRaceToZeroEntryScreen,
    buildNavStack: (entry) => ["home", "lobby", "game-select", "racetozero-prep", entry],
  });

  const unsub = onGameSessionChange(() => {
    if (guestFollow()) return;
    refreshFromSync();
  });

  return () => {
    prepLobby.dispose();
    unsub();
  };
}
