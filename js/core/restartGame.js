import { GAMES } from "../../data/games.js";
import { getLastGame, getState, saveStatePatch } from "./state.js";
import { clearTraitrePrivateForLobby } from "./traitrePrivate.js";
import {
  isGameSyncActive,
  isLobbyHost,
  getCachedGameSession,
  POST_GAME_SCREENS,
  startGameSession,
  hotTakeToRemote,
  traitreToRemote,
  speedVoteToRemote,
  clutchToRemote,
  wrongAnswerToRemote,
  triviaToRemote,
  truthMeterToRemote,
  consensusToRemote,
  dilemmaToRemote,
  guessLieToRemote,
  playlistGuessToRemote,
} from "./gameSync.js";
import { navigate } from "./router.js";
import { defaultTraitrePrepSession } from "./traitreSession.js";
import { TRAITRE_MIN_PLAYERS } from "../../data/traitre.js";
import { requireMinLobbyPlayers } from "./gameLaunchGuard.js";
import { defaultSpeedVotePrepSession } from "./speedVoteSession.js";
import { defaultClutchPrepSession } from "./clutchSession.js";
import { defaultWrongAnswerPrepSession } from "./wrongAnswerSession.js";
import { PLAYLIST_GUESS_MIN_PLAYERS } from "../../data/playlistGuess.js";
import { defaultPlaylistGuessPrepSession } from "./playlistGuessSession.js";
import { getLobbyParticipants } from "./lobby.js";
import { defaultTriviaPrepSession } from "./triviaSession.js";
import { TRUTH_METER_MIN_PLAYERS } from "../../data/truthMeter.js";
import { defaultTruthMeterPrepSession } from "./truthMeterSession.js";
import { defaultConsensusPrepSession } from "./consensusSession.js";
import { defaultDilemmaPrepSession } from "./dilemmaSession.js";
import { showAppAlert } from "./dialog.js";
import { escapeHtml } from "./ui.js";
import { finishedTierNightLiveRemote } from "./tierNightConfig.js";

const GAME_ID_TO_TILE = {
  traitre: "traitre-prep",
  hottake: "hottake-prep",
  speedvote: "speedvote-prep",
  clutch: "clutch-prep",
  wronganswer: "wronganswer-prep",
  trivia: "trivia-prep",
  truthmeter: "truthmeter-prep",
  consensus: "consensus-prep",
  dilemma: "dilemma-prep",
  guesslie: "guesslie",
  playlistguess: "playlistguess-prep",
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

export async function launchTraitrePrep() {
  const check = await requireMinLobbyPlayers(TRAITRE_MIN_PLAYERS, {
    gameTitle: "Spot the fake",
    icon: "🎭",
  });
  if (!check.ok) return;

  const tr = defaultTraitrePrepSession();
  saveStatePatch({ traitreGame: tr });

  if (isGameSyncActive()) {
    if (!(await requireHostToLaunch())) return;
    const lobbyId = getState().lobby?.id;
    if (lobbyId) {
      await clearTraitrePrivateForLobby(lobbyId);
    }
    try {
      await startGameSession("traitre", "traitre-prep", {
        traitre: traitreToRemote(tr),
      });
    } catch (e) {
      console.warn("REVEAL launch Traitre:", e);
      await showAppAlert(e.message || "Impossible de lancer Spot the fake.", {
        title: "Spot the fake",
        icon: "⚠️",
      });
    }
    return;
  }

  navigate("traitre-prep");
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

export async function launchClutchPrep() {
  const rz = defaultClutchPrepSession();
  saveStatePatch({ clutchGame: rz });

  if (isGameSyncActive()) {
    if (!(await requireHostToLaunch())) return;
    try {
      await startGameSession("clutch", "clutch-prep", {
        clutch: clutchToRemote(rz),
      });
    } catch (e) {
      console.warn("REVEAL launch Clutch:", e);
      await showAppAlert(e.message || "Impossible de lancer Clutch.", {
        title: "Clutch",
        icon: "⚠️",
      });
    }
    return;
  }

  navigate("clutch-prep");
}

export async function launchWrongAnswerPrep() {
  const wa = defaultWrongAnswerPrepSession();
  saveStatePatch({ wrongAnswerGame: wa });

  if (isGameSyncActive()) {
    if (!(await requireHostToLaunch())) return;
    try {
      await startGameSession("wronganswer", "wronganswer-prep", {
        wrongAnswer: wrongAnswerToRemote(wa),
      });
    } catch (e) {
      console.warn("REVEAL launch Wrong Answer Only:", e);
      await showAppAlert(e.message || "Impossible de lancer Wrong Answer Only.", {
        title: "Wrong Answer Only",
        icon: "⚠️",
      });
    }
    return;
  }

  navigate("wronganswer-prep");
}

export async function launchPlaylistGuessPrep() {
  const check = await requireMinLobbyPlayers(PLAYLIST_GUESS_MIN_PLAYERS, {
    gameTitle: "VibeCheck",
    icon: "🎵",
  });
  if (!check.ok) return;

  const pg = defaultPlaylistGuessPrepSession();
  saveStatePatch({ playlistGuessGame: pg });

  if (isGameSyncActive()) {
    if (!(await requireHostToLaunch())) return;
    try {
      await startGameSession("playlistguess", "playlistguess-prep", {
        playlistGuess: playlistGuessToRemote(pg),
      });
    } catch (e) {
      console.warn("REVEAL launch Playlist Guess:", e);
      await showAppAlert(e.message || "Impossible de lancer le jeu.", {
        title: "VibeCheck",
        icon: "⚠️",
      });
    }
    return;
  }

  navigate("playlistguess-prep");
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
  const check = await requireMinLobbyPlayers(TRUTH_METER_MIN_PLAYERS, {
    gameTitle: "TruthMeter",
    icon: "📊",
  });
  if (!check.ok) return;

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
  const tierNightReset = { recaps: [], topicId: null, listName: "", controversialItem: null };
  const tierNightLiveReset = {
    lobbyStarted: false,
    topicId: null,
    listName: "",
    deck: null,
    roundIdx: 0,
    phase: null,
    votes: {},
    placements: {},
    finished: false,
  };
  const resetTierNightForLaunch = () => saveStatePatch({
    tierNightTopicId: null,
    tierNightMode: "consensus",
    tierNightModifier: "normal",
    tierNightGame: tierNightReset,
    tierNightLiveGame: tierNightLiveReset,
  });

  if (isGameSyncActive()) {
    if (!(await requireHostToLaunch())) return;
    resetTierNightForLaunch();
    try {
      await startGameSession("tiernight", "tiernight-select", {
        tierNight: {
          topicId: null,
          mode: "consensus",
          modifier: "normal",
          lobbyStarted: false,
          placements: {},
          finished: {},
          game: null,
          recap: null,
        },
        tierNightLive: finishedTierNightLiveRemote(),
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

  resetTierNightForLaunch();
  navigate("tiernight-select");
}

const RESTART_HANDLERS = {
  traitre: launchTraitrePrep,
  hottake: launchHotTakePrep,
  speedvote: launchSpeedVotePrep,
  clutch: launchClutchPrep,
  wronganswer: launchWrongAnswerPrep,
  trivia: launchTriviaPrep,
  truthmeter: launchTruthMeterPrep,
  consensus: launchConsensusPrep,
  dilemma: launchDilemmaPrep,
  guesslie: launchGuessLieMenu,
  playlistguess: launchPlaylistGuessPrep,
  tiernight: launchTierNightSelect,
};

export async function restartGame(gameId) {
  const fn = RESTART_HANDLERS[gameId];
  if (!fn) return;
  await fn();
}

/** lastGame local + filet session multijoueur (game_id sur écran résultats). */
export function resolveLastGameForRestart() {
  const last = getLastGame();
  if (!isGameSyncActive()) return last;

  const row = getCachedGameSession();
  const sessionGameId = row?.game_id;
  if (
    !sessionGameId ||
    !RESTART_HANDLERS[sessionGameId] ||
    !row.screen ||
    !POST_GAME_SCREENS.has(row.screen)
  ) {
    return last;
  }

  if (!last || last.gameId !== sessionGameId) {
    return {
      gameId: sessionGameId,
      title: getRestartableGameTitle(sessionGameId),
      summary: last?.gameId === sessionGameId ? last.summary || "" : "",
    };
  }

  return last;
}

export function eveningRecapRestartButtonHtml(lastGame = resolveLastGameForRestart()) {
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
