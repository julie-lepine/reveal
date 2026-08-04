import {
  catalogTitleForSessionGameId,
} from "./gameCatalogTitle.js";
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
} from "./gameSync.js";
import { navigate } from "./router.js";
import { defaultTraitrePrepSession } from "./traitreSession.js";
import { TRAITRE_MIN_PLAYERS } from "../../data/traitre.js";
import { requireMinLobbyPlayers } from "./gameLaunchGuard.js";
import { defaultSpeedVotePrepSession } from "./speedVoteSession.js";
import { defaultClutchPrepSession } from "./clutchSession.js";
import { defaultWrongAnswerPrepSession } from "./wrongAnswerSession.js";
import { defaultTriviaPrepSession } from "./triviaSession.js";
import { TRUTH_METER_MIN_PLAYERS } from "../../data/truthMeter.js";
import { defaultTruthMeterPrepSession } from "./truthMeterSession.js";
import { defaultConsensusPrepSession } from "./consensusSession.js";
import { defaultDilemmaPrepSession } from "./dilemmaSession.js";
import { showAppAlert } from "./dialog.js";
import { escapeHtml } from "./ui.js";
import { createTierNightRunId, finishedTierNightLiveRemote } from "./tierNightConfig.js";
import { createActionLock } from "./actionLock.js";
import {
  CHAT_ROULETTE_STATE_KEY,
  isChatRouletteBlockingLaunch,
  normalizeChatRouletteEvent,
  observeChatRouletteActivity,
  chatRouletteMonotonicNow,
  parseSessionUpdatedAtMs,
} from "./chatRandomGameLogic.js";
import {
  TILE_ID_TO_SESSION_GAME_ID,
} from "./gameCatalogTitle.js";

/** ARCH-06 : exclusivité logique (survit au re-bind des boutons Recommencer). */
const restartLock = createActionLock();

/**
 * Permit ponctuel pour lancer LE jeu tiré par LA roulette active.
 * Forme : `{ rouletteId, tileId }` - nettoyé dans `finally`.
 * Impossible de réutiliser pour un autre jeu / une autre roulette.
 * @type {{ rouletteId: string, tileId: string }|null}
 */
let chatRouletteLaunchPermit = null;

/**
 * @param {{ rouletteId: string, tileId: string }} permit
 * @param {() => Promise<unknown>} fn
 */
export async function runWithChatRouletteLaunchPermit(permit, fn) {
  if (!permit?.rouletteId || !permit?.tileId) {
    throw new Error("Permit roulette invalide.");
  }
  chatRouletteLaunchPermit = {
    rouletteId: String(permit.rouletteId),
    tileId: String(permit.tileId),
  };
  try {
    return await fn();
  } finally {
    chatRouletteLaunchPermit = null;
  }
}

/** @deprecated - utiliser runWithChatRouletteLaunchPermit */
export async function runWithChatRouletteLaunchBypass(fn) {
  return fn();
}

/**
 * Bloque uniquement une roulette **active** (TTL hybride centralisé).
 * Autorise le lancement si un permit cible exactement cette roulette + tile
 * et que `sessionGameId` correspond au tile permis.
 * @param {{ sessionGameId?: string|null }} [opts]
 */
async function assertNoActiveChatRoulette({ sessionGameId = null } = {}) {
  if (!isGameSyncActive()) return true;
  const row = getCachedGameSession();
  const raw = row?.state?.[CHAT_ROULETTE_STATE_KEY];
  const sessionTs = parseSessionUpdatedAtMs(row?.updated_at);
  const mono = chatRouletteMonotonicNow();
  const obs = observeChatRouletteActivity(raw, {
    nowMonotonic: mono,
    sessionUpdatedAtMs: sessionTs,
  });
  const ev = normalizeChatRouletteEvent(raw);
  if (
    !isChatRouletteBlockingLaunch({
      chatRoulette: raw,
      localObservation: obs,
      nowWallClock: Date.now(),
      nowMonotonic: chatRouletteMonotonicNow(),
      sessionUpdatedAtMs: sessionTs,
    })
  ) {
    return true;
  }

  const permit = chatRouletteLaunchPermit;
  if (
    permit &&
    ev &&
    permit.rouletteId === ev.rouletteId &&
    permit.tileId === ev.selectedTileId
  ) {
    const permittedSession = TILE_ID_TO_SESSION_GAME_ID[permit.tileId];
    if (
      permittedSession &&
      (!sessionGameId || sessionGameId === permittedSession)
    ) {
      return true;
    }
  }

  await showAppAlert(
    "Une roulette « Jeu aléatoire » est en cours. Termine-la ou annule-la avant de lancer un autre jeu.",
    { title: "Jeu aléatoire", icon: "🎲" }
  );
  return false;
}

export function getRestartableGameTitle(gameId, fallbackTitle) {
  return (
    catalogTitleForSessionGameId(gameId) ||
    fallbackTitle ||
    gameId ||
    "Jeu"
  );
}

async function requireHostToLaunch(sessionGameId = null) {
  if (!(await assertNoActiveChatRoulette({ sessionGameId }))) return false;
  if (!isGameSyncActive()) return true;
  if (isLobbyHost()) return true;
  const { ensureLobbyHostOrOfferClaim } = await import("./hostClaimOffer.js");
  const access = await ensureLobbyHostOrOfferClaim({ reason: "launch" });
  return access.ok;
}

/**
 * UX-CHAT-01 : une seule tentative après engagement prep réussi (hôte).
 * Import dynamique pour éviter cycles.
 */
function fireGamePreparationChatAnnounce(gameId) {
  void import("./announceGameStartedInChat.js")
    .then(({ announceGamePreparationInChat }) =>
      announceGamePreparationInChat(gameId)
    )
    .catch((err) => {
      console.warn("[UX-CHAT-01] announce fire rejected", {
        gameId: gameId || null,
        message: err?.message || String(err),
      });
    });
}

/**
 * MP : patch local puis startGameSession ; rollback du snapshot en cas d'échec.
 * Gardes hôte / joueurs doivent être passées avant l'appel.
 * Annonce chat après succès uniquement (pas catch-up invité, pas play).
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
    fireGamePreparationChatAnnounce(gameId);
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
  if (!(await assertNoActiveChatRoulette({ sessionGameId: "traitre" }))) return;
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

  if (!(await requireHostToLaunch("traitre"))) return;

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
  if (!(await assertNoActiveChatRoulette({ sessionGameId: "speedvote" }))) return;
  const sv = defaultSpeedVotePrepSession();

  if (!isGameSyncActive()) {
    saveStatePatch({ speedVoteGame: sv });
    navigate("speedvote-prep");
    return;
  }

  if (!(await requireHostToLaunch("speedvote"))) return;

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
  if (!(await assertNoActiveChatRoulette({ sessionGameId: "clutch" }))) return;
  const rz = defaultClutchPrepSession();

  if (!isGameSyncActive()) {
    saveStatePatch({ clutchGame: rz });
    navigate("clutch-prep");
    return;
  }

  if (!(await requireHostToLaunch("clutch"))) return;

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
  if (!(await assertNoActiveChatRoulette({ sessionGameId: "wronganswer" }))) return;
  const wa = defaultWrongAnswerPrepSession();

  if (!isGameSyncActive()) {
    saveStatePatch({ wrongAnswerGame: wa });
    navigate("wronganswer-prep");
    return;
  }

  if (!(await requireHostToLaunch("wronganswer"))) return;

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

export async function launchDilemmaPrep() {
  if (!(await assertNoActiveChatRoulette({ sessionGameId: "dilemma" }))) return;
  const dm = defaultDilemmaPrepSession();

  if (!isGameSyncActive()) {
    saveStatePatch({ dilemmaGame: dm });
    navigate("dilemma-prep");
    return;
  }

  if (!(await requireHostToLaunch("dilemma"))) return;

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
  if (!(await assertNoActiveChatRoulette({ sessionGameId: "trivia" }))) return;
  const trivia = defaultTriviaPrepSession();

  if (!isGameSyncActive()) {
    saveStatePatch({ triviaGame: trivia });
    navigate("trivia-prep");
    return;
  }

  if (!(await requireHostToLaunch("trivia"))) return;

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
  if (!(await assertNoActiveChatRoulette({ sessionGameId: "truthmeter" }))) return;
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

  if (!(await requireHostToLaunch("truthmeter"))) return;

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
  if (!(await assertNoActiveChatRoulette({ sessionGameId: "consensus" }))) return;
  const consensus = defaultConsensusPrepSession();

  if (!isGameSyncActive()) {
    saveStatePatch({ consensusGame: consensus });
    navigate("consensus-prep");
    return;
  }

  if (!(await requireHostToLaunch("consensus"))) return;

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
  if (!(await assertNoActiveChatRoulette({ sessionGameId: "hottake" }))) return;
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

  if (!(await requireHostToLaunch("hottake"))) return;

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
  if (!(await assertNoActiveChatRoulette({ sessionGameId: "guesslie" }))) return;
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

  if (!(await requireHostToLaunch("guesslie"))) return;

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
  if (!(await assertNoActiveChatRoulette({ sessionGameId: "tiernight" }))) return;
  const runId = createTierNightRunId();
  const tierNightReset = {
    runId,
    recaps: [],
    topicId: null,
    listName: "",
    topicEmoji: "",
    controversialItem: null,
  };
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
    tierNightMode: "roster",
    tierNightModifier: "normal",
    tierNightGame: tierNightReset,
    tierNightLiveGame: tierNightLiveReset,
  };

  if (!isGameSyncActive()) {
    saveStatePatch(statePatch);
    navigate("tiernight-select");
    return;
  }

  if (!(await requireHostToLaunch("tiernight"))) return;

  await commitPrepSessionLaunch({
    statePatch,
    gameId: "tiernight",
    screen: "tiernight-select",
    remoteState: {
      tierNight: {
        runId,
        topicId: null,
        mode: "roster",
        modifier: "normal",
        lobbyStarted: false,
        listName: "",
        topicEmoji: "",
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
  tiernight: launchTierNightSelect,
};

export async function restartGame(gameId) {
  const fn = RESTART_HANDLERS[gameId];
  if (!fn) return;
  if (!(await assertNoActiveChatRoulette({ sessionGameId: gameId }))) return;
  const outcome = await restartLock.run(() => fn());
  return outcome.ok ? outcome.value : undefined;
}

/**
 * FEATURE-CHAT-03 - lance un jeu depuis un id catalogue (tile),
 * sans passer par game-select. Réutilise `restartGame` / launchers existants.
 * @param {string} tileId
 */
export async function launchCatalogGame(tileId) {
  const sessionId = TILE_ID_TO_SESSION_GAME_ID[tileId];
  if (!sessionId) {
    await showAppAlert("Jeu inconnu.", { title: "Jeu aléatoire", icon: "🎲" });
    return;
  }
  return restartGame(sessionId);
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

/**
 * Bind « Recommencer une partie de X ».
 * L'exclusivité est dans `restartGame` (verrou logique), pas sur le nœud -
 * un re-render peut re-créer le bouton pendant l'await.
 */
export function bindRestartGameButtons(root) {
  root.querySelectorAll("[data-restart-game]").forEach((el) => {
    el.addEventListener("click", () => {
      const id = el.getAttribute("data-restart-game");
      void restartGame(id);
    });
  });
}
