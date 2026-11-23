import { useConsensusGame } from "../core/useConsensusGame.js";
import { getLobbyParticipants } from "../core/lobby.js";
import { getLocalDisplayName } from "../core/state.js";
import { showAppAlert } from "../core/dialog.js";
import { requireLobbyPlay } from "../core/gameGuard.js";
import { onGameSessionChange } from "../core/gameSync.js";
import {
  consensusLobbyWriteBlocked,
  releaseStaleConsensusWriteMarker,
} from "../core/consensusSession.js";
import { prepGuestFollowOnSession } from "../core/mpLaunch.js";
import { executePrepLaunch, prepLaunchSlotParams, DEFAULT_PREP_MIN_PLAYERS } from "../core/prepLaunch.js";
import { createPrepLobbyController } from "../core/usePrepLobby.js";
import { navigate } from "../core/router.js";
import { pageShell } from "../core/ui.js";
import { bindNav } from "./nav.js";
import { renderConsensusSetup } from "../consensus/ConsensusSetup.js";
import { bindPrepLaunchButtons } from "../core/prepScreen.js";

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

  /**
   * Audit Consensus n°1 : un envoi raté laissait un verrou qui rendait muets les
   * boutons de la préparation. On lève un verrou périmé, sinon on dit quoi faire.
   */
  async function ensureConsensusWritable() {
    if (!consensusLobbyWriteBlocked()) return true;
    const stale = releaseStaleConsensusWriteMarker({
      allowLegacy: true,
      includeSelfResuming: true,
      includeManual: true,
    });
    if (stale.released) return true;
    const seconds = Math.max(1, Math.ceil(stale.waitMs / 1000));
    await showAppAlert(
      `Le dernier envoi n'est pas encore confirmé. Réessaie dans ${seconds} s.`,
      { title: "Consensus", icon: "⏳" }
    );
    return false;
  }

  async function runPrepWrite(write) {
    if (!(await ensureConsensusWritable())) return;
    try {
      await write();
    } catch (err) {
      console.warn("Consensus prep:", err);
      await showAppAlert("Vérifie ta connexion réseau et réessaie", {
        title: "Consensus",
        icon: "📡",
      });
    }
  }

  async function onLaunch({ force = false } = {}) {
    if (!(await ensureConsensusWritable())) return;
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
    await executePrepLaunch({
      force,
      btn: app.querySelector(force ? "#btn-force-start-game" : "#btn-consensus-start"),
      getReadyMap: () => consensus.getSession().ready || {},
      minPlayers: DEFAULT_PREP_MIN_PLAYERS,
      gameTitle: "Consensus",
      gameScreen: "consensus",
      navStack: ["home", "lobby", "game-select", "consensus-prep", "consensus"],
      markStarted: () => consensus.startLobbyGame(),
      allReadyFn: () => consensus.allReady(),
    });
  }

  function bindEvents() {
    bindNav(app);

    app.querySelectorAll("[data-consensus-mode]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!consensus.isHost()) return;
        await runPrepWrite(() => consensus.setMode(btn.getAttribute("data-consensus-mode")));
        render();
      });
    });

    app.querySelectorAll("[data-consensus-count]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!consensus.isHost()) return;
        await runPrepWrite(() =>
          consensus.setQuestionCount(Number(btn.getAttribute("data-consensus-count")))
        );
        render();
      });
    });

    app.querySelector("#btn-consensus-ready")?.addEventListener("click", async () => {
      if (!(await ensureConsensusWritable())) return;
      void prepLobby.toggleReady({
        setReady: (name, ready) => consensus.setReady(name, ready),
        simulateReady: (cb) => consensus.simulateReady(cb),
        render,
      });
    });

    bindPrepLaunchButtons(app, {
      startButtonId: "btn-consensus-start",
      onLaunch,
    });
  }

  function render() {
    const session = consensus.getSession();
    const prep = consensus.getPrepSummary();
    const members = getLobbyParticipants();
    const launchSlot = prepLaunchSlotParams({
      readyMap: session.ready || {},
      allReady: consensus.allReady(),
      isHost: consensus.isHost(),
      minPlayers: DEFAULT_PREP_MIN_PLAYERS,
      launchLabel: "Lancer Consensus",
      startButtonId: "btn-consensus-start",
    });

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
        launchSlot,
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
