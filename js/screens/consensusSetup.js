import { useConsensusGame } from "../core/useConsensusGame.js";
import { getLobbyParticipants } from "../core/lobby.js";
import { getLocalDisplayName } from "../core/state.js";
import { showAppAlert } from "../core/dialog.js";
import { requireLobbyPlay } from "../core/gameGuard.js";
import { isLobbyHost, onGameSessionChange } from "../core/gameSync.js";
import { prepGuestFollowOnSession, runPrepGameLaunch } from "../core/mpLaunch.js";
import { createPrepLobbyController } from "../core/usePrepLobby.js";
import { navigate } from "../core/router.js";
import { pageShell } from "../core/ui.js";
import { bindNav } from "./nav.js";
import { renderConsensusSetup } from "../consensus/ConsensusSetup.js";

export function mountConsensusSetup(app) {
  if (!requireLobbyPlay()) return null;

  const consensus = useConsensusGame();
  if (consensus.getEntryScreen() !== "consensus-prep") {
    navigate(consensus.getEntryScreen());
    return null;
  }

  const localName = getLocalDisplayName();
  const prepLobby = createPrepLobbyController({
    localKey: localName,
    getReadyMap: () => consensus.getSession().ready || {},
  });

  async function onStartGame() {
    if (!isLobbyHost()) return;
    const validation = consensus.validateLaunchConfig();
    if (!validation.ok) {
      await showAppAlert(
        `Il manque ${validation.missing} question(s) pour lancer ${validation.requested} manche(s).`,
        {
          title: "Banque insuffisante",
          icon: "🤝",
        }
      );
      return;
    }
    await runPrepGameLaunch({
      btn: app.querySelector("#btn-consensus-start"),
      launch: () => consensus.startLobbyGame(),
      gameScreen: "consensus",
      navStack: ["home", "lobby", "game-select", "consensus-prep", "consensus"],
    });
  }

  function bindEvents() {
    bindNav(app);

    app.querySelectorAll("[data-consensus-mode]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!consensus.isHost()) return;
        await consensus.setMode(btn.getAttribute("data-consensus-mode"));
        render();
      });
    });

    app.querySelectorAll("[data-consensus-count]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!consensus.isHost()) return;
        await consensus.setQuestionCount(Number(btn.getAttribute("data-consensus-count")));
        render();
      });
    });

    app.querySelector("#btn-consensus-ready")?.addEventListener("click", () => {
      void prepLobby.toggleReady({
        setReady: (name, ready) => consensus.setReady(name, ready),
        simulateReady: (cb) => consensus.simulateReady(cb),
        render,
      });
    });

    app.querySelector("#btn-consensus-start")?.addEventListener("click", () => {
      void onStartGame();
    });
  }

  function render() {
    const session = consensus.getSession();
    const prep = consensus.getPrepSummary();
    const members = getLobbyParticipants();

    app.innerHTML = pageShell({
      backTarget: "back",
      content: renderConsensusSetup({
        modeId: session.selectedModeId,
        modes: consensus.getModes(),
        questionCount: session.questionCount,
        countPresets: consensus.getQuestionCountPresets(),
        isHost: consensus.isHost(),
        prep,
        members,
        readyMap: session.ready || {},
        localReady: prepLobby.localReadyState(),
        allReady: consensus.allReady(),
      }),
    });

    bindEvents();
  }

  render();

  const guestFollow = prepGuestFollowOnSession({
    prepScreen: "consensus-prep",
    getEntryScreen: () => consensus.getEntryScreen(),
    buildNavStack: (entry) => ["home", "lobby", "game-select", "consensus-prep", entry],
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
