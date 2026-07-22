import {
  allClutchReady,
  getClutchPrepSummary,
  getClutchSession,
  getClutchEntryScreen,
  markClutchLobbyStarted,
  setClutchReady,
  setClutchRoundCount,
} from "../core/clutchSession.js";
import { CLUTCH_ROUND_PRESETS } from "../../data/clutch.js";
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

export function mountClutchPrep(app) {
  if (!requireLobbyPlay()) return null;

  const localName = getLocalDisplayName();
  const prepLobby = createPrepLobbyController({
    localKey: localName,
    getReadyMap: () => getClutchSession().ready || {},
  });

  function startSlotHtml(allReady) {
    const session = getClutchSession();
    return prepStartSlotHtml(
      prepLaunchSlotParams({
        readyMap: session.ready || {},
        allReady,
        isHost: isLobbyHost(),
        minPlayers: DEFAULT_PREP_MIN_PLAYERS,
        launchLabel: "Lancer Clutch →",
      })
    );
  }

  function refreshReadySection() {
    const session = getClutchSession();
    const members = getLobbyParticipants();
    const allReady = allClutchReady();

    refreshPrepReadyUi(app, {
      playersSelector: "#clutch-players",
      readyBtnSelector: "#btn-ready",
      members,
      readyMap: session.ready || {},
      localReady: prepLobby.localReadyState(),
    });

    updatePrepStartSlot(
      app.querySelector("#clutch-start-slot"),
      startSlotHtml(allReady),
      onLaunch
    );
  }

  function refreshRounds() {
    const session = getClutchSession();
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
      getReadyMap: () => getClutchSession().ready || {},
      minPlayers: DEFAULT_PREP_MIN_PLAYERS,
      gameTitle: "Clutch",
      gameScreen: "clutch",
      navStack: ["home", "lobby", "game-select", "clutch-prep", "clutch"],
      markStarted: markClutchLobbyStarted,
      allReadyFn: allClutchReady,
    });
  }

  function bindEvents() {
    bindNav(app);

    app.querySelectorAll("[data-round]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!isLobbyHost() || btn.disabled) return;
        await setClutchRoundCount(Number(btn.getAttribute("data-round")));
        render();
      });
    });

    app.querySelector("#btn-ready")?.addEventListener("click", () => {
      void prepLobby.toggleReady({
        setReady: setClutchReady,
        render: refreshReadySection,
      });
    });

    bindPrepLaunchButtons(app, { onLaunch });
  }

  function render() {
    const session = getClutchSession();
    const members = getLobbyParticipants();
    const allReady = allClutchReady();
    const localReady = prepLobby.localReadyState();
    const roundCount = session.roundCount ?? 5;
    const isHost = isLobbyHost();
    const prep = getClutchPrepSummary();

    app.innerHTML = pageShell({
      backTarget: "back",
      content: `
        <p class="label-upper label-upper--gold">💥 Clutch</p>
        <div class="screen-title-row">
          <h2 class="screen-title">Préparation</h2>
          ${rulesButtonHtml("clutch")}
        </div>
        <p class="game-intro">Un chrono part de 0 et monte vers une cible (7 à 15 s). Il disparaît un peu avant la cible - un délai différent à chaque manche : tape à l'instinct, au plus proche. Le plus précis gagne.</p>

        <div class="card">
          <p class="card-heading">Nombre de manches</p>
          <div class="theme-chips theme-chips--rounds">
            ${CLUTCH_ROUND_PRESETS.map(
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

        <div class="card" id="clutch-players">
          ${playersReadySectionHtml(members, session.ready || {})}
        </div>

        <button type="button" class="btn btn-ready ${localReady ? "btn-ready--active" : ""}" id="btn-ready">
          ${localReady ? "Prêt ✓" : "Je suis prêt !"}
        </button>

        <div id="clutch-start-slot">
          ${startSlotHtml(allReady)}
        </div>
      `,
    });

    bindEvents();
  }

  render();

  const guestFollow = prepGuestFollowOnSession({
    prepScreen: "clutch-prep",
    getEntryScreen: getClutchEntryScreen,
    buildNavStack: (entry) => ["home", "lobby", "game-select", "clutch-prep", entry],
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
