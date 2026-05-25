import { GAMES } from "../../data/games.js";
import { getLastGame, getState, saveStatePatch } from "./state.js";
import {
  isGameSyncActive,
  isLobbyHost,
  startGameSession,
  hotTakeToRemote,
  speedVoteToRemote,
  triviaToRemote,
  truthMeterToRemote,
  consensusToRemote,
  dilemmaToRemote,
  guessLieToRemote,
} from "./gameSync.js";
import { navigate } from "./router.js";
import { defaultSpeedVotePrepSession } from "./speedVoteSession.js";
import { defaultTriviaPrepSession } from "./triviaSession.js";
import { defaultTruthMeterPrepSession } from "./truthMeterSession.js";
import { defaultConsensusPrepSession } from "./consensusSession.js";
import { defaultDilemmaPrepSession } from "./dilemmaSession.js";
import { showAppAlert } from "./dialog.js";
import { escapeHtml } from "./ui.js";

const GAME_ID_TO_TILE = {
  hottake: "hottake-prep",
  speedvote: "speedvote-prep",
  trivia: "trivia-prep",
  truthmeter: "truthmeter-prep",
  consensus: "consensus-prep",
  dilemma: "dilemma-prep",
  guesslie: "guesslie",
  tiernight: "tiernight-select",
};

export function getRestartableGameTitle(gameId, fallbackTitle) {
  const tileId = GAME_ID_TO_TILE[gameId];
  const catalog = GAMES.find((g) => g.id === tileId);
  return catalog?.title || fallbackTitle || gameId || "Jeu";
}

async function requireHostToLaunch() {
  if (!isGameSyncActive()) return true;
  if (isLobbyHost()) return true;
  await showAppAlert("Seul l'hôte peut lancer une partie.", {
    title: "Action réservée",
    icon: "👑",
  });
  return false;
}

export async function launchSpeedVotePrep() {
  const sv = defaultSpeedVotePrepSession();
  saveStatePatch({ speedVoteGame: sv });

  if (isGameSyncActive()) {
    if (!(await requireHostToLaunch())) return;
    try {
      await startGameSession("speedvote", "speedvote-prep", {
        speedVote: speedVoteToRemote(sv),
      });
    } catch (e) {
      console.warn("REVEAL launch SpeedVote:", e);
      await showAppAlert(e.message || "Impossible de lancer SpeedVote.", {
        title: "SpeedVote",
        icon: "⚠️",
      });
    }
    return;
  }

  navigate("speedvote-prep");
}

export async function launchDilemmaPrep() {
  const dm = defaultDilemmaPrepSession();
  saveStatePatch({ dilemmaGame: dm });

  if (isGameSyncActive()) {
    if (!(await requireHostToLaunch())) return;
    try {
      await startGameSession("dilemma", "dilemma-prep", {
        dilemma: dilemmaToRemote(dm),
      });
    } catch (e) {
      console.warn("REVEAL launch Dilemma:", e);
      await showAppAlert(e.message || "Impossible de lancer Dilemma.", {
        title: "Dilemma",
        icon: "⚠️",
      });
    }
    return;
  }

  navigate("dilemma-prep");
}

export async function launchTriviaPrep() {
  const trivia = defaultTriviaPrepSession();
  saveStatePatch({ triviaGame: trivia });

  if (isGameSyncActive()) {
    if (!(await requireHostToLaunch())) return;
    try {
      await startGameSession("trivia", "trivia-prep", {
        trivia: triviaToRemote(trivia),
      });
    } catch (e) {
      console.warn("REVEAL launch Trivia:", e);
      await showAppAlert(e.message || "Impossible de lancer Trivia.", {
        title: "Trivia",
        icon: "⚠️",
      });
    }
    return;
  }

  navigate("trivia-prep");
}

export async function launchTruthMeterPrep() {
  const tm = defaultTruthMeterPrepSession();
  saveStatePatch({ truthMeterGame: tm });

  if (isGameSyncActive()) {
    if (!(await requireHostToLaunch())) return;
    try {
      await startGameSession("truthmeter", "truthmeter-prep", {
        truthMeter: truthMeterToRemote(tm),
      });
    } catch (e) {
      console.warn("REVEAL launch TruthMeter:", e);
      await showAppAlert(e.message || "Impossible de lancer TruthMeter.", {
        title: "TruthMeter",
        icon: "⚠️",
      });
    }
    return;
  }

  navigate("truthmeter-prep");
}

export async function launchConsensusPrep() {
  const consensus = defaultConsensusPrepSession();
  saveStatePatch({ consensusGame: consensus });

  if (isGameSyncActive()) {
    if (!(await requireHostToLaunch())) return;
    try {
      await startGameSession("consensus", "consensus-prep", {
        consensus: consensusToRemote(consensus),
      });
    } catch (e) {
      console.warn("REVEAL launch Consensus:", e);
      await showAppAlert(e.message || "Impossible de lancer Consensus.", {
        title: "Consensus",
        icon: "⚠️",
      });
    }
    return;
  }

  navigate("consensus-prep");
}

export async function launchHotTakePrep() {
  const ht = {
    customTakes: [],
    ready: {},
    lobbyStarted: false,
    pausedBy: null,
    selectedThemeId: "catalog",
    roundCount: 5,
    deck: null,
    takeIdx: 0,
    phase: null,
    votes: {},
    voteEndsAt: null,
    intermissionEndsAt: null,
    takeScored: false,
  };
  saveStatePatch({ hotTakeGame: ht });

  if (isGameSyncActive()) {
    if (!(await requireHostToLaunch())) return;
    try {
      await startGameSession("hottake", "hottake-prep", { hotTake: hotTakeToRemote(ht) });
    } catch (e) {
      console.warn("REVEAL launch Hot Take:", e);
      await showAppAlert(e.message || "Impossible de lancer Hot Take.", {
        title: "Hot Take",
        icon: "⚠️",
      });
    }
    return;
  }

  navigate("hottake-prep");
}

export async function launchGuessLieMenu() {
  const gl = {
    sessionId: getState().lobbyCode,
    submissions: {},
    lobbyComplete: false,
    roundIdx: 0,
    phase: null,
    votes: {},
    roundScored: false,
  };
  saveStatePatch({ guessLie: gl });

  if (isGameSyncActive()) {
    if (!(await requireHostToLaunch())) return;
    try {
      await startGameSession("guesslie", "guesslie-menu", { guessLie: guessLieToRemote(gl) });
    } catch (e) {
      console.warn("REVEAL launch Guess The Lie:", e);
      await showAppAlert(e.message || "Impossible de lancer Guess The Lie.", {
        title: "Guess The Lie",
        icon: "⚠️",
      });
    }
    return;
  }

  navigate("guesslie-menu");
}

export async function launchTierNightSelect() {
  if (isGameSyncActive()) {
    if (!(await requireHostToLaunch())) return;
    try {
      await startGameSession("tiernight", "tiernight-select", {
        tierNight: { topicId: null, game: null, placements: {}, finished: {} },
      });
    } catch (e) {
      console.warn("REVEAL launch TierNight:", e);
      await showAppAlert(e.message || "Impossible de lancer TierNight.", {
        title: "TierNight",
        icon: "⚠️",
      });
    }
    return;
  }

  navigate("tiernight-select");
}

const RESTART_HANDLERS = {
  hottake: launchHotTakePrep,
  speedvote: launchSpeedVotePrep,
  trivia: launchTriviaPrep,
  truthmeter: launchTruthMeterPrep,
  consensus: launchConsensusPrep,
  dilemma: launchDilemmaPrep,
  guesslie: launchGuessLieMenu,
  tiernight: launchTierNightSelect,
};

export async function restartGame(gameId) {
  const fn = RESTART_HANDLERS[gameId];
  if (!fn) return;
  await fn();
}

export function eveningRecapRestartButtonHtml(lastGame = getLastGame()) {
  if (!lastGame?.gameId || !RESTART_HANDLERS[lastGame.gameId]) return "";
  const title = getRestartableGameTitle(lastGame.gameId, lastGame.title);
  return `<button type="button" class="btn btn-secondary evening-recap__restart" data-restart-game="${escapeHtml(lastGame.gameId)}">Recommencer une partie de ${escapeHtml(title)}</button>`;
}

export function bindRestartGameButtons(root) {
  root.querySelectorAll("[data-restart-game]").forEach((el) => {
    el.addEventListener("click", () => {
      const id = el.getAttribute("data-restart-game");
      void restartGame(id);
    });
  });
}
