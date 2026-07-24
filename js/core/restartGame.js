import { GAMES } from "../../data/games.js";
import { getLastGame, getState, saveStatePatch } from "./state.js";
import { clearTraitrePrivateForLobby } from "./traitrePrivate.js";
import { snapshotStatePatch } from "./restartGameRollback.js";
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
import { defaultTriviaPrepSession } from "./triviaSession.js";
import { TRUTH_METER_MIN_PLAYERS } from "../../data/truthMeter.js";
import { defaultTruthMeterPrepSession } from "./truthMeterSession.js";
import { defaultConsensusPrepSession } from "./consensusSession.js";
import { defaultDilemmaPrepSession } from "./dilemmaSession.js";
import { showAppAlert } from "./dialog.js";
import { escapeHtml } from "./ui.js";
import { createTierNightRunId, finishedTierNightLiveRemote } from "./tierNightConfig.js";

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
  const { ensureLobbyHostOrOfferClaim } = await import("./hostClaimOffer.js");
  const access = await ensureLobbyHostOrOfferClaim({ reason: "launch" });
  return access.ok;
}

/**
 * MP : patch local puis startGameSession ; rollback du snapshot en cas d'échec.
 * Gardes hôte / joueurs doivent être passées avant l'appel.
 */
async function commitPrepSessionLaunch({
  statePatch,
  gameId,
  screen,
  remoteState,
  alertTitle,
  alertFallback,
  logLabel,
  afterSuccess,
}) {
  const patchKeys = Object.keys(statePatch);
  const previousPatch = snapshotStatePatch(getState(), patchKeys);
  saveStatePatch(statePatch);

  try {
    await startGameSession(gameId, screen, remoteState);
    if (afterSuccess) await afterSuccess();
  } catch (e) {
    console.warn(`REVEAL launch ${logLabel}:`, e);
    saveStatePatch(previousPatch);
    await showAppAlert(e.message || alertFallback, {
      title: alertTitle,
      icon: "⚠️",
    });
  }
}

export async function launchTraitrePrep() {
  const check = await requireMinLobbyPlayers(TRAITRE_MIN_PLAYERS, {
    gameTitle: "Spot the fake",
    icon: "🎭",
  });
  if (!check.ok) return;

  const tr = defaultTraitrePrepSession();

  if (!isGameSyncActive()) {
    saveStatePatch({ traitreGame: tr });
    navigate("traitre-prep");
    return;
  }

  if (!(await requireHostToLaunch())) return;

  const lobbyId = getState().lobby?.id;
  await commitPrepSessionLaunch({
    statePatch: { traitreGame: tr },
    gameId: "traitre",
    screen: "traitre-prep",
    remoteState: { traitre: traitreToRemote(tr) },
    alertTitle: "Spot the fake",
    alertFallback: "Impossible de lancer Spot the fake.",
    logLabel: "Traitre",
    afterSuccess: lobbyId ? () => clearTraitrePrivateForLobby(lobbyId) : undefined,
  });
}

export async function launchSpeedVotePrep() {
  const sv = defaultSpeedVotePrepSession();

  if (!isGameSyncActive()) {
    saveStatePatch({ speedVoteGame: sv });
    navigate("speedvote-prep");
    return;
  }

  if (!(await requireHostToLaunch())) return;

  await commitPrepSessionLaunch({
    statePatch: { speedVoteGame: sv },
    gameId: "speedvote",
    screen: "speedvote-prep",
    remoteState: { speedVote: speedVoteToRemote(sv) },
    alertTitle: "SpeedVote",
    alertFallback: "Impossible de lancer SpeedVote.",
    logLabel: "SpeedVote",
  });
}

export async function launchClutchPrep() {
  const rz = defaultClutchPrepSession();

  if (!isGameSyncActive()) {
    saveStatePatch({ clutchGame: rz });
    navigate("clutch-prep");
    return;
  }

  if (!(await requireHostToLaunch())) return;

  await commitPrepSessionLaunch({
    statePatch: { clutchGame: rz },
    gameId: "clutch",
    screen: "clutch-prep",
    remoteState: { clutch: clutchToRemote(rz) },
    alertTitle: "Clutch",
    alertFallback: "Impossible de lancer Clutch.",
    logLabel: "Clutch",
  });
}

export async function launchWrongAnswerPrep() {
  const wa = defaultWrongAnswerPrepSession();

  if (!isGameSyncActive()) {
    saveStatePatch({ wrongAnswerGame: wa });
    navigate("wronganswer-prep");
    return;
  }

  if (!(await requireHostToLaunch())) return;

  await commitPrepSessionLaunch({
    statePatch: { wrongAnswerGame: wa },
    gameId: "wronganswer",
    screen: "wronganswer-prep",
    remoteState: { wrongAnswer: wrongAnswerToRemote(wa) },
    alertTitle: "Wrong Answer Only",
    alertFallback: "Impossible de lancer Wrong Answer Only.",
    logLabel: "Wrong Answer Only",
  });
}

export async function launchPlaylistGuessPrep() {
  const check = await requireMinLobbyPlayers(PLAYLIST_GUESS_MIN_PLAYERS, {
    gameTitle: "VibeCheck",
    icon: "🎵",
  });
  if (!check.ok) return;

  const pg = defaultPlaylistGuessPrepSession();

  if (!isGameSyncActive()) {
    saveStatePatch({ playlistGuessGame: pg });
    navigate("playlistguess-prep");
    return;
  }

  if (!(await requireHostToLaunch())) return;

  await commitPrepSessionLaunch({
    statePatch: { playlistGuessGame: pg },
    gameId: "playlistguess",
    screen: "playlistguess-prep",
    remoteState: { playlistGuess: playlistGuessToRemote(pg) },
    alertTitle: "VibeCheck",
    alertFallback: "Impossible de lancer le jeu.",
    logLabel: "Playlist Guess",
  });
}

export async function launchDilemmaPrep() {
  const dm = defaultDilemmaPrepSession();

  if (!isGameSyncActive()) {
    saveStatePatch({ dilemmaGame: dm });
    navigate("dilemma-prep");
    return;
  }

  if (!(await requireHostToLaunch())) return;

  await commitPrepSessionLaunch({
    statePatch: { dilemmaGame: dm },
    gameId: "dilemma",
    screen: "dilemma-prep",
    remoteState: { dilemma: dilemmaToRemote(dm) },
    alertTitle: "Dilemma",
    alertFallback: "Impossible de lancer Dilemma.",
    logLabel: "Dilemma",
  });
}

export async function launchTriviaPrep() {
  const trivia = defaultTriviaPrepSession();

  if (!isGameSyncActive()) {
    saveStatePatch({ triviaGame: trivia });
    navigate("trivia-prep");
    return;
  }

  if (!(await requireHostToLaunch())) return;

  await commitPrepSessionLaunch({
    statePatch: { triviaGame: trivia },
    gameId: "trivia",
    screen: "trivia-prep",
    remoteState: { trivia: triviaToRemote(trivia) },
    alertTitle: "Trivia",
    alertFallback: "Impossible de lancer Trivia.",
    logLabel: "Trivia",
  });
}

export async function launchTruthMeterPrep() {
  const check = await requireMinLobbyPlayers(TRUTH_METER_MIN_PLAYERS, {
    gameTitle: "TruthMeter",
    icon: "📊",
  });
  if (!check.ok) return;

  const tm = defaultTruthMeterPrepSession();

  if (!isGameSyncActive()) {
    saveStatePatch({ truthMeterGame: tm });
    navigate("truthmeter-prep");
    return;
  }

  if (!(await requireHostToLaunch())) return;

  await commitPrepSessionLaunch({
    statePatch: { truthMeterGame: tm },
    gameId: "truthmeter",
    screen: "truthmeter-prep",
    remoteState: { truthMeter: truthMeterToRemote(tm) },
    alertTitle: "TruthMeter",
    alertFallback: "Impossible de lancer TruthMeter.",
    logLabel: "TruthMeter",
  });
}

export async function launchConsensusPrep() {
  const consensus = defaultConsensusPrepSession();

  if (!isGameSyncActive()) {
    saveStatePatch({ consensusGame: consensus });
    navigate("consensus-prep");
    return;
  }

  if (!(await requireHostToLaunch())) return;

  await commitPrepSessionLaunch({
    statePatch: { consensusGame: consensus },
    gameId: "consensus",
    screen: "consensus-prep",
    remoteState: { consensus: consensusToRemote(consensus) },
    alertTitle: "Consensus",
    alertFallback: "Impossible de lancer Consensus.",
    logLabel: "Consensus",
  });
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

  if (!isGameSyncActive()) {
    saveStatePatch({ hotTakeGame: ht });
    navigate("hottake-prep");
    return;
  }

  if (!(await requireHostToLaunch())) return;

  await commitPrepSessionLaunch({
    statePatch: { hotTakeGame: ht },
    gameId: "hottake",
    screen: "hottake-prep",
    remoteState: { hotTake: hotTakeToRemote(ht) },
    alertTitle: "Hot Take",
    alertFallback: "Impossible de lancer Hot Take.",
    logLabel: "Hot Take",
  });
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

  if (!isGameSyncActive()) {
    saveStatePatch({ guessLie: gl });
    navigate("guesslie-menu");
    return;
  }

  if (!(await requireHostToLaunch())) return;

  await commitPrepSessionLaunch({
    statePatch: { guessLie: gl },
    gameId: "guesslie",
    screen: "guesslie-menu",
    remoteState: { guessLie: guessLieToRemote(gl) },
    alertTitle: "Guess The Lie",
    alertFallback: "Impossible de lancer Guess The Lie.",
    logLabel: "Guess The Lie",
  });
}

export async function launchTierNightSelect() {
  const runId = createTierNightRunId();
  const tierNightReset = { runId, recaps: [], topicId: null, listName: "", controversialItem: null };
  const tierNightLiveReset = {
    runId,
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
  const statePatch = {
    tierNightTopicId: null,
    tierNightMode: "consensus",
    tierNightModifier: "normal",
    tierNightGame: tierNightReset,
    tierNightLiveGame: tierNightLiveReset,
  };

  if (!isGameSyncActive()) {
    saveStatePatch(statePatch);
    navigate("tiernight-select");
    return;
  }

  if (!(await requireHostToLaunch())) return;

  await commitPrepSessionLaunch({
    statePatch,
    gameId: "tiernight",
    screen: "tiernight-select",
    remoteState: {
      tierNight: {
        runId,
        topicId: null,
        mode: "consensus",
        modifier: "normal",
        lobbyStarted: false,
        placements: {},
        finished: {},
        game: null,
        recap: null,
      },
      tierNightLive: finishedTierNightLiveRemote({ runId }),
    },
    alertTitle: "TierNight",
    alertFallback: "Impossible de lancer TierNight.",
    logLabel: "TierNight",
  });
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
  if (isGameSyncActive() && !isLobbyHost()) return "";
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
