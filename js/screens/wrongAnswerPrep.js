import {
  allWrongAnswerReady,
  getWrongAnswerPrepSummary,
  getWrongAnswerSession,
  getWrongAnswerEntryScreen,
  markWrongAnswerLobbyStarted,
  setWrongAnswerReady,
  setWrongAnswerRoundCount,
} from "../core/wrongAnswerSession.js";
import { WRONG_ANSWER_ROUND_PRESETS } from "../../data/wrongAnswer.js";
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

export function mountWrongAnswerPrep(app) {
  if (!requireLobbyPlay()) return null;

  const localName = getLocalDisplayName();
  const prepLobby = createPrepLobbyController({
    localKey: localName,
    getReadyMap: () => getWrongAnswerSession().ready || {},
  });

  function startSlotHtml(allReady) {
    const session = getWrongAnswerSession();
    return prepStartSlotHtml(
      prepLaunchSlotParams({
        readyMap: session.ready || {},
        allReady,
        isHost: isLobbyHost(),
        minPlayers: DEFAULT_PREP_MIN_PLAYERS,
        launchLabel: "Lancer Wrong Answer Only →",
      })
    );
  }

  function refreshReadySection() {
    const session = getWrongAnswerSession();
    const members = getLobbyParticipants();
    const allReady = allWrongAnswerReady();

    refreshPrepReadyUi(app, {
      playersSelector: "#wronganswer-players",
      readyBtnSelector: "#btn-ready",
      members,
      readyMap: session.ready || {},
      localReady: prepLobby.localReadyState(),
    });

    updatePrepStartSlot(
      app.querySelector("#wronganswer-start-slot"),
      startSlotHtml(allReady),
      onLaunch
    );
  }

  function refreshRounds() {
    const session = getWrongAnswerSession();
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
      getReadyMap: () => getWrongAnswerSession().ready || {},
      minPlayers: DEFAULT_PREP_MIN_PLAYERS,
      gameTitle: "Wrong Answer Only",
      gameScreen: "wronganswer",
      navStack: ["home", "lobby", "game-select", "wronganswer-prep", "wronganswer"],
      markStarted: markWrongAnswerLobbyStarted,
      allReadyFn: allWrongAnswerReady,
    });
  }

  function bindEvents() {
    bindNav(app);

    app.querySelectorAll("[data-round]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!isLobbyHost() || btn.disabled) return;
        await setWrongAnswerRoundCount(Number(btn.getAttribute("data-round")));
        render();
      });
    });

    app.querySelector("#btn-ready")?.addEventListener("click", () => {
      void prepLobby.toggleReady({
        setReady: setWrongAnswerReady,
        render: refreshReadySection,
      });
    });

    bindPrepLaunchButtons(app, { onLaunch });
  }

  function render() {
    const session = getWrongAnswerSession();
    const members = getLobbyParticipants();
    const allReady = allWrongAnswerReady();
    const localReady = prepLobby.localReadyState();
    const roundCount = session.roundCount ?? 5;
    const isHost = isLobbyHost();
    const prep = getWrongAnswerPrepSummary();

    app.innerHTML = pageShell({
      backTarget: "back",
      content: `
        <p class="label-upper label-upper--pink">↩️ Wrong Answer Only</p>
        <div class="screen-title-row">
          <h2 class="screen-title">Préparation</h2>
          ${rulesButtonHtml("wronganswer")}
        </div>
        <p class="game-intro">À chaque manche, une question s'affiche. Donne la <strong>pire réponse possible</strong> en secret. Les réponses sont anonymisées, puis tout le monde vote pour la pire. Tu marques 3 points par vote reçu.</p>

        <div class="card">
          <p class="card-heading">Nombre de manches</p>
          <div class="theme-chips theme-chips--rounds">
            ${WRONG_ANSWER_ROUND_PRESETS.map(
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

        <div class="card" id="wronganswer-players">
          ${playersReadySectionHtml(members, session.ready || {})}
        </div>

        <button type="button" class="btn btn-ready ${localReady ? "btn-ready--active" : ""}" id="btn-ready">
          ${localReady ? "Prêt ✓" : "Je suis prêt !"}
        </button>

        <div id="wronganswer-start-slot">
          ${startSlotHtml(allReady)}
        </div>
      `,
    });

    bindEvents();
  }

  render();

  const guestFollow = prepGuestFollowOnSession({
    prepScreen: "wronganswer-prep",
    getEntryScreen: getWrongAnswerEntryScreen,
    buildNavStack: (entry) => ["home", "lobby", "game-select", "wronganswer-prep", entry],
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
