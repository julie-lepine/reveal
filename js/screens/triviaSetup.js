import { useTriviaGame } from "../core/useTriviaGame.js";
import { getLobbyParticipants } from "../core/lobby.js";
import { getLocalDisplayName } from "../core/state.js";
import { showAppAlert } from "../core/dialog.js";
import { requireLobbyPlay } from "../core/gameGuard.js";
import { isLobbyHost, onGameSessionChange } from "../core/gameSync.js";
import { prepGuestFollowOnSession } from "../core/mpLaunch.js";
import { executePrepLaunch, prepLaunchSlotParams, DEFAULT_PREP_MIN_PLAYERS } from "../core/prepLaunch.js";
import { createPrepLobbyController } from "../core/usePrepLobby.js";
import { navigate } from "../core/router.js";
import { pageShell } from "../core/ui.js";
import { bindNav } from "./nav.js";
import { renderTriviaSetup } from "../trivia/TriviaSetup.js";
import { bindPrepLaunchButtons } from "../core/prepScreen.js";

export function mountTriviaSetup(app) {
  if (!requireLobbyPlay()) return null;

  const trivia = useTriviaGame();
  if (trivia.getEntryScreen() !== "trivia-prep") {
    navigate(trivia.getEntryScreen());
    return null;
  }

  const localName = getLocalDisplayName();
  const prepLobby = createPrepLobbyController({
    localKey: localName,
    getReadyMap: () => trivia.getSession().ready || {},
  });

  async function onLaunch({ force = false } = {}) {
    const validation = trivia.validateLaunchConfig();
    if (!validation.ok) {
      await showAppAlert(
        `Il manque ${validation.missing} question(s) pour lancer ${validation.requested} manche(s) sur le theme ${validation.themeLabel}.`,
        {
          title: "Banque insuffisante",
          icon: "🧠",
        }
      );
      return;
    }
    await executePrepLaunch({
      force,
      btn: app.querySelector(force ? "#btn-force-start-game" : "#btn-trivia-start"),
      getReadyMap: () => trivia.getSession().ready || {},
      minPlayers: DEFAULT_PREP_MIN_PLAYERS,
      gameTitle: "Trivia",
      gameScreen: "trivia",
      navStack: ["home", "lobby", "game-select", "trivia-prep", "trivia"],
      markStarted: () => trivia.startLobbyGame(),
      allReadyFn: () => trivia.allReady(),
    });
  }

  function bindEvents() {
    bindNav(app);

    app.querySelectorAll("[data-trivia-theme]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!trivia.isHost()) return;
        await trivia.setTheme(btn.getAttribute("data-trivia-theme"));
        render();
      });
    });

    app.querySelectorAll("[data-trivia-count]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!trivia.isHost()) return;
        await trivia.setQuestionCount(Number(btn.getAttribute("data-trivia-count")));
        render();
      });
    });

    app.querySelector("#btn-trivia-ready")?.addEventListener("click", () => {
      void prepLobby.toggleReady({
        setReady: (name, ready) => trivia.setReady(name, ready),
        simulateReady: (cb) => trivia.simulateReady(cb),
        render,
      });
    });

    bindPrepLaunchButtons(app, {
      startButtonId: "btn-trivia-start",
      onLaunch,
    });
  }

  function render() {
    const session = trivia.getSession();
    const prep = trivia.getPrepSummary();
    const members = getLobbyParticipants();
    const launchSlot = prepLaunchSlotParams({
      readyMap: session.ready || {},
      allReady: trivia.allReady(),
      isHost: isLobbyHost(),
      minPlayers: DEFAULT_PREP_MIN_PLAYERS,
      launchLabel: "Lancer le quiz",
      startButtonId: "btn-trivia-start",
    });

    app.innerHTML = pageShell({
      backTarget: "back",
      content: renderTriviaSetup({
        themeId: session.selectedThemeId,
        themes: trivia.getThemes(),
        questionCount: session.questionCount,
        countPresets: trivia.getQuestionCountPresets(),
        isHost: isLobbyHost(),
        prep,
        members,
        readyMap: session.ready || {},
        localReady: prepLobby.localReadyState(),
        allReady: trivia.allReady(),
        launchSlot,
      }),
    });

    bindEvents();
  }

  render();

  const guestFollow = prepGuestFollowOnSession({
    prepScreen: "trivia-prep",
    getEntryScreen: () => trivia.getEntryScreen(),
    buildNavStack: (entry) => ["home", "lobby", "game-select", "trivia-prep", entry],
  });

  const unsub = onGameSessionChange(() => {
    if (guestFollow()) return;
    render();
  });

  return () => {
    prepLobby.dispose();
    unsub();
  };
}
