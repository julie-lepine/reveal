import { isSupabaseConfigured } from "./supabaseClient.js";
import { getSupabaseUserId } from "./supabaseAuth.js";
import { resolveActingHostUserId } from "./hostPresence.js";
import {
  getLocalDisplayName,
  getState,
  saveStatePatch,
  setLastGame,
  mergeLastGameRecord,
  mergeEveningGamesRecorded,
  normalizeEveningGamesRecorded,
  recordTierNightPlayed,
  resetGameSessionsOnly,
  defaultEveningStats,
} from "./state.js";
import { GAMES } from "../../data/games.js";
import { navigate, getCurrentScreen } from "./router.js";
import { getLobbyParticipants, getLobbyStatus, getLobbyGameId, isLobbyEveningStarted } from "./lobby.js";
import { getActivePlayerNames, getActivePlayers } from "./players.js";
import { mergeMatchScoresLocal } from "./gameScores.js";
import {
  applyRemotePlayerStats,
  playerStatsToRemote,
} from "./playerStatsSync.js";
import {
  mergeReadyMapsLocal,
  mergeDilemmaCustomDilemmas,
  mergeHotTakeCustomTakes,
  mergeDilemmaPatchState,
  mergeHotTakePatchState,
  mergeConsensusPatchState,
  mergeTriviaPatchState,
  mergeTraitrePatchState,
  mergeSpeedVotePatchState,
  mergeClutchPatchState,
  mergeClutchPhase,
  isNewClutchRound,
  mergeWrongAnswerPatchState,
  mergeWrongAnswerPhase,
  isNewWrongAnswerRound,
  mergeTruthMeterPatchState,
  mergeTruthMeterPhase,
  mergeForwardGamePhase,
  mergeTraitrePhase,
  mergeHotTakePhase,
  mergeDilemmaPhase,
  mergeSpeedVotePhase,
  isNewHotTakeVoteRound,
  isNewDilemmaVoteRound,
  isNewSpeedVoteVoteRound,
  isNewTraitreVoteRound,
  isNewTraitreGame,
  isStaleTraitreVotePatch,
  isTraitreVoteResetAfterTie,
  isSubmissionsOnlyGamePatch,
  isVotesOnlyGamePatch,
  isAnswersOnlyGamePatch,
  mergeGuessLieSubmissions,
  isGuessLieLobbyReset,
  shouldApplyGuessLieLobbyReset,
  mergeGuessLieLobbyComplete,
  isGuessLieInPrep,
  mergeConsensusPhase,
  mergeTriviaAnswersUid,
  normalizeTriviaAnswersMap,
  isNewConsensusQuestionRound,
  isNewConsensusGame,
  mergeCustomGameDeck,
  normalizePlayerKeyedMap,
  normalizeKeyedVotes,
} from "./sessionMerge.js";
import { buildRecapsFromPlacements, getTierNightSession } from "./tierNightSession.js";
import {
  fetchGameSessionByLobby,
  fetchGameSessionMeta,
  upsertGameSession,
  updateGameSession,
  deleteGameSession,
} from "./supabaseGame.js";
import {
  dehydrateConsensusDeck,
  rehydrateConsensusDeck,
  dehydrateTriviaDeck,
  rehydrateTriviaDeck,
  dehydrateDilemmaDeck,
  rehydrateDilemmaDeck,
  dehydratePlaylistGuessDeck,
  rehydratePlaylistGuessDeck,
} from "./deckCodec.js";
import { scalePollIntervalMs, SYNC_PATCH_TIMEOUT_MS } from "../config/syncConfig.js";
import { FIL_ROUGE_ENABLED } from "../../data/filRouge.js";
import { GUESS_LIE_SYNC_PATCH_TIMEOUT_MS } from "../../data/guessLies.js";
import { pickRemotePlayFields } from "./playPatch.js";
import { pickLatestConsensusAnswer } from "./consensusAnswerUtils.js";
import {
  finishedTierNightLiveRemote,
  shouldPreferTierNightEndRoute,
  tierNightConfigPatchFromRemoteState,
} from "./tierNightConfig.js";

export { pickRemotePlayFields, PLAY_PATCH_EXCLUDE } from "./playPatch.js";

let cachedRow = null;
let lastSessionSig = "";
/** Dernier updated_at connu de game_sessions : pour le polling conditionnel. */
let lastSessionUpdatedAt = "";
const listeners = new Set();
let routing = false;
let pollTimer = null;
let syncTickInFlight = false;

// --- DIAGNOSTIC TEMPORAIRE : détection de boucle d'écriture sur game_sessions ---
// Sonde NON bloquante : elle ne fait que logger une pile d'appel quand un pic
// d'écritures est détecté. Elle ne suspend JAMAIS les écritures (sinon une manche
// normale resterait coincée). À retirer une fois la boucle corrigée et validée.
const __writeTimes = [];
let __loopTraced = false;
function __trackSessionWrite(label, info) {
  const now = Date.now();
  __writeTimes.push(now);
  while (__writeTimes.length && now - __writeTimes[0] > 3000) __writeTimes.shift();
  const count = __writeTimes.length;

  // Détection : au-delà de 12 écritures / 3 s, on logge la pile UNE fois (anti-spam 5 s).
  if (count >= 12 && !__loopTraced) {
    __loopTraced = true;
    console.warn(
      `[REVEAL-LOOP] ${count} écritures game_sessions en 3 s — label=${label}`,
      info
    );
    console.trace("[REVEAL-LOOP] pile d'appel de l'écriture");
    setTimeout(() => {
      __loopTraced = false;
    }, 5000);
  }
  return false;
}
// --- FIN DIAGNOSTIC TEMPORAIRE ---

function mergeTruthy(localVal, remoteVal) {
  return Boolean(localVal) || Boolean(remoteVal);
}

/**
 * Drapeaux « manche déjà traitée » (roundScored, questionScored, takeScored…).
 * mergeTruthy(true, false) resterait true et bloque la manche suivante - utiliser
 * mergeRoundFlag avec isNew*Round (nouvelle manche / question / vote).
 */
function mergeRoundFlag(localVal, remoteVal, isNewRound) {
  return isNewRound ? Boolean(remoteVal) : mergeTruthy(localVal, remoteVal);
}

function mergeEveningStats(localStats = {}, remoteStats = {}) {
  const merged = { ...localStats };
  for (const key of Object.keys(defaultEveningStats())) {
    const localVal = Number(localStats[key]) || 0;
    const remoteVal = remoteStats[key];
    if (remoteVal != null) {
      merged[key] = Math.max(localVal, Number(remoteVal) || 0);
    }
  }
  return merged;
}

function mergeMaxIndex(localIdx, remoteIdx) {
  return Math.max(localIdx ?? -1, remoteIdx ?? -1);
}
let pollIntervalMs = 4000;
let pollUnchangedStreak = 0;
let lastGameSessionRealtimeAt = 0;
let syncVisibilityInit = false;
let syncPausedByHidden = false;
const POLL_MS_MIN = 3000;
const POLL_MS_MAX = 12000;
const POLL_MS_DEFAULT = 4000;
/** Soirée active, invité en attente sur un hub/menu : plafond de backoff plus bas pour
 *  rattraper vite un lancement raté par le Realtime (sans atteindre les 12 s). */
const POLL_MS_HUB_WAIT_MIN = 1000;
const POLL_MS_HUB_WAIT_MAX = 1500;
/** Secours si Realtime silencieux en partie active. */
const POLL_MS_ACTIVE = 2000;
/** Realtime récent : on espace le polling (egress) sans sacrifier la réactivité perçue. */
const POLL_MS_ACTIVE_RELAXED = 4000;
const REALTIME_RECENT_MS = 10000;
/** Évite de forcer l’écran de prep quand l’invité revient au menu manuellement. */
let suppressSessionRouteUntil = 0;
/** Écran de session ignoré pendant la suppression (retour invité au menu jeux). */
let suppressSessionScreen = null;
let suppressSessionSig = "";

/**
 * Invariant : invité encore dans le lobby + cible prep/play + écran local différent
 * → suivi automatique (results, leaderboard, home, game-select…).
 */
function guestMustFollowSession(targetScreen, currentScreen = getCurrentScreen()) {
  if (!targetScreen) return false;
  if (isLobbyHost()) return false;
  if (!isGameSyncActive()) return false;
  if (!getState().inLobby || !getState().lobby?.id) return false;
  if (!shouldForceGuestFollowSession(targetScreen)) return false;
  if (currentScreen === targetScreen) return false;
  return true;
}

const MENU_SCREENS = new Set(["home", "lobby", "game-select", "settings"]);
export const POST_GAME_SCREENS = new Set(["results", "leaderboard"]);
export const DEFAULT_SYNC_PATCH_TIMEOUT_MS = SYNC_PATCH_TIMEOUT_MS;

const RESTARTABLE_SESSION_GAME_IDS = new Set([
  "traitre",
  "hottake",
  "speedvote",
  "trivia",
  "truthmeter",
  "consensus",
  "dilemma",
  "guesslie",
  "playlistguess",
  "tiernight",
  "clutch",
  "wronganswer",
]);

const SESSION_GAME_ID_TO_TILE = {
  traitre: "traitre-prep",
  hottake: "hottake-prep",
  speedvote: "speedvote-prep",
  trivia: "trivia-prep",
  truthmeter: "truthmeter-prep",
  consensus: "consensus-prep",
  dilemma: "dilemma-prep",
  guesslie: "guesslie",
  playlistguess: "playlistguess-prep",
  tiernight: "tiernight-select",
  clutch: "clutch-prep",
  wronganswer: "wronganswer-prep",
};

function titleForSessionGameId(gameId) {
  const tileId = SESSION_GAME_ID_TO_TILE[gameId];
  const catalog = GAMES.find((g) => g.id === tileId);
  return catalog?.title || gameId;
}

/** Filet : écran résultats + game_id session si lastGame distant est obsolète. */
function syncLastGameFromSessionRow(row) {
  const gameId = row?.game_id;
  if (!gameId || !RESTARTABLE_SESSION_GAME_IDS.has(gameId)) return;
  if (!row.screen || !POST_GAME_SCREENS.has(row.screen)) return;

  const remoteLast = row.state?.lastGame;
  const local = getState().lastGame;
  if (remoteLast?.gameId === gameId) return;

  if (!local || local.gameId !== gameId) {
    setLastGame({
      gameId,
      title: titleForSessionGameId(gameId),
      summary: remoteLast?.gameId === gameId ? remoteLast.summary || "" : "",
    });
  }
}

export function withPatchTimeout(promise, ms = DEFAULT_SYNC_PATCH_TIMEOUT_MS, message) {
  if (!ms || ms <= 0) return promise;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(
        () => reject(new Error(message || "Synchronisation trop longue.")),
        ms
      );
    }),
  ]);
}

/**
 * Retour forcé vers le jeu qu'un invité a volontairement quitté (suppress actif).
 * Critère = famille d'écran (même screen / prep-jeu compatible), pas le blob state :
 * votes, soumissions, timers ne doivent pas lever le suppress.
 */
function isSuppressedGameReturn(targetScreen) {
  if (Date.now() >= suppressSessionRouteUntil || !suppressSessionScreen || !targetScreen) {
    return false;
  }
  if (targetScreen === suppressSessionScreen) return true;
  /**
   * Ne pas réutiliser isCompatibleSessionScreen(hub, prep) : cette API signifie
   * « ne pas ramener de la prep vers le hub », pas « la prep est le même retour
   * volontaire ». Limiter aux familles prep/jeu réellement compatibles
   * (ex. Guess Lie menu/setup/wait).
   */
  if (
    shouldForceGuestFollowSession(suppressSessionScreen) &&
    shouldForceGuestFollowSession(targetScreen) &&
    isCompatibleSessionScreen(suppressSessionScreen, targetScreen)
  ) {
    return true;
  }
  return false;
}

/**
 * L'hôte a avancé la soirée : l'invité doit suivre malgré suppress.
 * Avancée = autre jeu / hors famille d'écran — pas une mutation de state
 * sur le même screen (ni une transition compatible type Guess Lie).
 * Prep → play du même jeu n'est pas « compatible » ici : branche
 * force_follow_from_other_active (suppress levé, invité suit).
 */
function isSessionAdvancedFromSuppress(targetScreen) {
  const forceFollow = shouldForceGuestFollowSession(targetScreen);
  const suppressFromHubOrPost =
    suppressSessionScreen === "game-select" ||
    suppressSessionScreen === "lobby" ||
    POST_GAME_SCREENS.has(suppressSessionScreen);
  const sameScreen = Boolean(
    suppressSessionScreen && targetScreen && targetScreen === suppressSessionScreen
  );
  const compatible = Boolean(
    suppressSessionScreen &&
      targetScreen &&
      isCompatibleSessionScreen(suppressSessionScreen, targetScreen)
  );

  let result = false;
  let branch = "default_false";

  if (!targetScreen) {
    result = false;
    branch = "missing_target";
  } else if (!suppressSessionScreen) {
    /**
     * Suppress actif (timer) mais baseline perdue (écran/sig null) : ne jamais
     * bloquer un vrai forceFollow. Une row post-partie seule reste false.
     */
    result = forceFollow;
    branch = forceFollow
      ? "force_follow_without_suppress_baseline"
      : "no_baseline_non_force_follow";
  } else if (sameScreen) {
    result = false;
    branch = "same_suppress_screen";
  } else if (forceFollow && (!suppressSessionSig || suppressFromHubOrPost)) {
    result = true;
    branch = "force_follow_from_hub_or_empty_sig";
  } else if (compatible) {
    result = false;
    branch = "compatible_not_advanced";
  } else if (forceFollow && shouldForceGuestFollowSession(suppressSessionScreen)) {
    result = true;
    branch = "force_follow_from_other_active";
  } else {
    result = true;
    branch = "fallback_advanced";
  }

  return result;
}

/** L'invité sur le menu jeux / lobby / post-partie suit l'hôte qui lance prep ou partie. */
function shouldFollowHostGameLaunch(current, targetScreen) {
  if (!targetScreen) return false;
  if (current === "home" || current === "settings") return false;
  if (isSuppressedGameReturn(targetScreen)) return false;

  if (POST_GAME_SCREENS.has(current) && isSessionRouteSuppressed()) {
    return isSessionAdvancedFromSuppress(targetScreen);
  }

  const fromHubOrPostGame =
    current === "game-select" ||
    current === "lobby" ||
    POST_GAME_SCREENS.has(current);

  if (!fromHubOrPostGame) return false;
  if (isOnGameSetupScreen(targetScreen)) return true;
  return isInProgressPlayScreen(targetScreen);
}

/** Consultation volontaire des scores : ne pas rerouter vers prep/partie en cours. */
function isBrowsingScoresWithRouteSuppress(screen = getCurrentScreen()) {
  return POST_GAME_SCREENS.has(screen) && isSessionRouteSuppressed();
}

function shouldApplySessionRoute(row, { fromScreen = null, debugSource = null } = {}) {
  const source = debugSource || "shouldApplySessionRoute";
  const screen = getEffectiveSessionScreen(row);
  const current = getCurrentScreen();
  const routeLog = (allowed, _reason, _extra = {}) => allowed;

  if (!screen) return routeLog(false, "no_effective_screen");
  if (screen === "tiernight-end" && !canRouteToTierNightEnd(row)) {
    warnBlockedTierNightEndRoute(row, "shouldApplySessionRoute");
    return routeLog(false, "tiernight_end_not_ready");
  }
  if (screen === "game-select" && !isLobbyEveningStarted()) {
    return routeLog(false, "game_select_evening_not_started");
  }
  if (screen === current) return routeLog(false, "already_on_target_screen");
  if (isCompatibleSessionScreen(screen, current)) {
    return routeLog(false, "compatible_session_screen_no_nav");
  }

  // Sortie volontaire (returnToGameSelect) : prioritaire sur guest_must_follow /
  // force_follow tant que l'invité est sur un hub et que la session n'a pas avancé
  // vers un autre écran (isSuppressedGameReturn false si autre jeu / autre prep).
  const onVoluntaryExitHub =
    current === "game-select" ||
    current === "home" ||
    current === "lobby" ||
    current === "settings";
  if (onVoluntaryExitHub && isSuppressedGameReturn(screen)) {
    return routeLog(false, "voluntary_exit_suppress_hub");
  }

  // Invariant générique invité : prep/play distante + écran local différent → suivre.
  // La consultation scores ne bloque que si la session n'a PAS avancé depuis le suppress.
  const mustFollow = guestMustFollowSession(screen, current);
  if (mustFollow) {
    if (isBrowsingScoresWithRouteSuppress(current) && !isSessionAdvancedFromSuppress(screen)) {
      return routeLog(false, "scores_suppress_blocks_must_follow", { mustFollow: true });
    }
    return routeLog(true, "guest_must_follow", { mustFollow: true });
  }

  if (isBrowsingScoresWithRouteSuppress(current)) {
    const advancedFromSuppress = isSessionAdvancedFromSuppress(screen);
    if (advancedFromSuppress) {
      return routeLog(true, "scores_suppress_bypass_session_advanced", {
        advancedFromSuppress,
      });
    }
    if (POST_GAME_SCREENS.has(screen)) {
      return routeLog(false, "scores_suppress_stay_post_game", {
        advancedFromSuppress,
      });
    }
    if (shouldForceGuestFollowSession(screen)) {
      return routeLog(false, "scores_suppress_blocks_force_follow", {
        advancedFromSuppress,
        suppressScreen: suppressSessionScreen,
        suppressSig: suppressSessionSig || null,
      });
    }
    return routeLog(false, "scores_suppress_blocks", {
      advancedFromSuppress,
      suppressScreen: suppressSessionScreen,
      suppressSig: suppressSessionSig || null,
    });
  }

  // Hub / post-partie : les invités restent libres (home, settings, classement…).
  if (isSessionHubScreen(screen)) {
    if (
      screen === "game-select" &&
      isLobbyEveningStarted() &&
      (current === "home" || current === "lobby" || current === "settings")
    ) {
      return routeLog(true, "hub_game_select_from_passive");
    }
    return routeLog(false, "session_hub_screen_guest_free");
  }

  // Sortie volontaire d'une prépa : l'invité a quitté CE jeu (suppression ciblée sur cet
  // écran). On ne le force pas à y revenir tant que la session reste sur la même prépa,
  // sinon il boucle dessus. Il suit quand même l'hôte vers un AUTRE écran (screen
  // différent → isSuppressedGameReturn false), y compris une autre prépa.
  const routingSuppressed = Date.now() < suppressSessionRouteUntil;
  if (routingSuppressed && isOnGameSetupScreen(screen) && isSuppressedGameReturn(screen)) {
    return routeLog(false, "voluntary_prep_exit_suppress");
  }

  // Paramétrage ou partie en cours : suivi obligatoire (ignore suppressSessionRoute).
  if (shouldForceGuestFollowSession(screen)) {
    if (isBrowsingScoresWithRouteSuppress(current)) {
      return routeLog(
        isSessionAdvancedFromSuppress(screen),
        "force_follow_under_scores_suppress"
      );
    }
    return routeLog(true, "force_follow_prep_or_play", {
      localScreenMismatch: current !== screen,
      sigMatchesLast: sessionSignature(row) === lastSessionSig,
    });
  }

  if (routingSuppressed && isSuppressedGameReturn(screen)) {
    return routeLog(false, "suppressed_game_return");
  }

  const hostLaunchedFromMenu = fromScreen === "game-select" && screen !== "game-select";
  const sessionAdvanced = isSessionAdvancedFromSuppress(screen);

  if (routingSuppressed) {
    if (current === "home" || current === "settings") {
      return routeLog(false, "routing_suppressed_passive_menu");
    }
    if (sessionAdvanced || hostLaunchedFromMenu || shouldFollowHostGameLaunch(current, screen)) {
      return routeLog(true, "routing_suppressed_bypass");
    }
    return routeLog(false, "routing_suppressed");
  }
  return routeLog(true, "allow");
}

function sessionSignature(row) {
  if (!row) return "";
  return `${row.screen}|${JSON.stringify(row.state || {})}`;
}

function isOlderSessionRow(row) {
  if (!row?.updated_at || !lastSessionUpdatedAt) return false;
  const incoming = Date.parse(row.updated_at);
  const current = Date.parse(lastSessionUpdatedAt);
  if (!Number.isFinite(incoming) || !Number.isFinite(current)) return false;
  return incoming < current;
}

export function isGameSyncActive() {
  return isSupabaseConfigured() && Boolean(getState().lobby?.id);
}

export function isLobbyHost() {
  const uid = getSupabaseUserId();
  const hostId = getState().lobby?.hostId;
  if (uid && hostId) return uid === hostId;
  const local = getState().lobby?.participants?.find((p) => p.isLocal);
  return Boolean(local?.isHost);
}

/**
 * Hôte effectif pour les contrôles de manche (révéler / manche suivante).
 * Les contrôles host-only (lancement, scores de soirée) restent réservés au vrai hôte.
 */
export function getActingHostUserId() {
  const lobby = getState().lobby;
  return resolveActingHostUserId(lobby?.participants || [], lobby?.hostId || null);
}

/** Peut piloter les contrôles de manche : vrai hôte, ou repli si l'hôte est absent. */
export function canActAsHost() {
  if (isLobbyHost()) return true;
  const uid = getSupabaseUserId();
  if (!uid) return false;
  return uid === getActingHostUserId();
}

/** Écrans de préparation (jeu choisi mais pas encore lancé). */
const GAME_SETUP_SCREENS = new Set([
  "traitre-prep",
  "hottake-prep",
  "speedvote-prep",
  "trivia-prep",
  "truthmeter-prep",
  "consensus-prep",
  "dilemma-prep",
  "playlistguess-prep",
  "clutch-prep",
  "wronganswer-prep",
  "guesslie-menu",
  "guesslie-setup",
  "guesslie-wait",
  "tiernight-select",
  "tiernight-create",
]);

/** Guess The Lie : préparation par joueur - la session reste sur guesslie-menu. */
const GUESS_LIE_PREP_SCREENS = new Set(["guesslie-menu", "guesslie-setup", "guesslie-wait"]);

/** Tier Night : création locale possible depuis tiernight-select. */
const TIER_NIGHT_PREP_SCREENS = new Set(["tiernight-select", "tiernight-create"]);

function hasLocalTierNightRecap() {
  const local = getState().tierNightGame;
  if (!local?.recaps?.length) return false;
  const remote = getCachedGameSession()?.state?.tierNight;
  if (remote?.lobbyStarted) return false;
  const localRunId = local.runId || null;
  const remoteRunId = remote?.runId || null;
  if (localRunId && remoteRunId && localRunId !== remoteRunId) return false;
  return true;
}

export function canRouteToTierNightEnd(row) {
  const tn = row?.state?.tierNight;
  if (!tn || typeof tn !== "object") return false;
  if (tn.lobbyStarted) return false;
  const recap = tn.recap;
  if (!recap?.recaps?.some((r) => tierNightPlacedItemsCount(r.placed || {}) > 0)) {
    return false;
  }
  const runId = tn.runId || null;
  const recapRunId = recap.runId || null;
  return !runId || !recapRunId || runId === recapRunId;
}

function warnBlockedTierNightEndRoute(row, source) {
  console.warn("[TierNight Route Blocked]", {
    source,
    screen: row?.screen,
    current: getCurrentScreen(),
    lobbyStarted: Boolean(row?.state?.tierNight?.lobbyStarted),
    runId: row?.state?.tierNight?.runId || null,
    recapRunId: row?.state?.tierNight?.recap?.runId || null,
    hasRecap: Boolean(row?.state?.tierNight?.recap?.recaps?.length),
  });
}

export function isCompatibleSessionScreen(sessionScreen, localScreen) {
  if (sessionScreen === localScreen) return true;
  /** Guess The Lie : prep par joueur (menu / setup / wait) - pas de traction entre ces écrans. */
  if (GUESS_LIE_PREP_SCREENS.has(sessionScreen) && GUESS_LIE_PREP_SCREENS.has(localScreen)) {
    return true;
  }
  if (sessionScreen === "tiernight-select" && TIER_NIGHT_PREP_SCREENS.has(localScreen)) return true;
  /** Résultats ↔ classement : navigation locale sans forcer le retour via la session. */
  if (
    (sessionScreen === "results" && localScreen === "leaderboard") ||
    (sessionScreen === "leaderboard" && localScreen === "results")
  ) {
    return true;
  }
  /** Scores depuis le menu jeux / lobby en soirée : navigation locale libre. */
  if (
    (localScreen === "results" || localScreen === "leaderboard") &&
    (sessionScreen === "game-select" ||
      sessionScreen === "lobby" ||
      POST_GAME_SCREENS.has(sessionScreen))
  ) {
    return true;
  }
  /** Consulter le classement depuis le menu jeux / lobby (soirée en attente uniquement). */
  if (
    localScreen === "leaderboard" &&
    (sessionScreen === "game-select" || sessionScreen === "lobby")
  ) {
    if (isLobbyEveningStarted()) return false;
    return true;
  }
  /** Retour lobby volontaire depuis le menu jeux (suppress actif). */
  if (
    sessionScreen === "game-select" &&
    localScreen === "lobby" &&
    Date.now() < suppressSessionRouteUntil
  ) {
    return true;
  }
  // FIL_ROUGE (Mot interdit) - écrans désactivés
  // if (
  //   sessionScreen === "game-select" &&
  //   (localScreen === "filrouge-setup" || localScreen === "filrouge-mission")
  // ) {
  //   return true;
  // }
  /**
   * Hub soirée (screen DB = game-select) + Fil Rouge ou mini-jeu en parallèle :
   * ne pas renvoyer vers le menu quand l'utilisateur est déjà en prep ou en partie.
   */
  if (sessionScreen === "game-select") {
    if (isOnGameSetupScreen(localScreen) || isActiveGameSessionScreen(localScreen)) {
      return true;
    }
  }
  /** Accueil / paramètres : libre si pas de partie en cours ; sinon rattrapage vers le jeu. */
  if (getState().inLobby && getState().lobby?.id) {
    if (localScreen === "settings" || localScreen === "home") {
      if (isActiveGameSessionScreen(sessionScreen)) return false;
      return true;
    }
  }
  return false;
}

export function isOnGameSetupScreen(screen = getCurrentScreen()) {
  return GAME_SETUP_SCREENS.has(screen);
}

/** Hub soirée : pas de traction automatique des invités. */
function isSessionHubScreen(screen) {
  if (!screen) return false;
  if (screen === "game-select" || screen === "lobby") return true;
  if (POST_GAME_SCREENS.has(screen)) {
    // Invité en partie ou en prépa : suit l'hôte vers résultats / classement.
    if (
      isGameSyncActive() &&
      !isLobbyHost() &&
      (isActiveGameSessionScreen(getCurrentScreen()) ||
        isOnGameSetupScreen(getCurrentScreen()))
    ) {
      return false;
    }
    return true;
  }
  return false;
}

/** Paramétrage ou partie active : l'invité doit suivre l'hôte. */
function shouldForceGuestFollowSession(screen) {
  if (!screen) return false;
  return isOnGameSetupScreen(screen) || isActiveGameSessionScreen(screen);
}

/** Filet pour écrans passifs (results, home…) : suit l'hôte vers résultats en fin de partie. */
export function tryFollowHostGameSession(row) {
  if (!isGameSyncActive() || isLobbyHost()) return false;
  if (!row) return false;
  const declared = row.screen;
  if (!declared || !POST_GAME_SCREENS.has(declared)) return false;
  const local = getCurrentScreen();
  if (!isActiveGameSessionScreen(local) && !isOnGameSetupScreen(local)) return false;
  handleSessionRoute(row);
  return true;
}

function maybeRouteToSessionScreen(row) {
  const local = getCurrentScreen();
  const effective = getEffectiveSessionScreen(row);
  if (!effective || local === effective) return;
  if (isBrowsingScoresWithRouteSuppress(local) && !isSessionAdvancedFromSuppress(effective)) {
    return;
  }
  handleSessionRoute(row);
}

function clearSuppressIfFollowingHost(screen, current) {
  if (
    shouldForceGuestFollowSession(screen) ||
    isSessionAdvancedFromSuppress(screen) ||
    shouldFollowHostGameLaunch(current, screen)
  ) {
    clearSessionRouteSuppress();
  }
}

export function getCachedGameSession() {
  return cachedRow;
}

export function onGameSessionChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

let notifying = false;
let pendingNotifyRow = null;
let hasPendingNotify = false;
/** Garde-fou : borne le drain anti-réentrance (ne devrait jamais s'enchaîner autant). */
const NOTIFY_MAX_DRAIN = 25;

/**
 * Exécute les listeners sur une COPIE du Set : un listener peut (dé)monter un écran,
 * donc muter `listeners` en pleine itération. Sans la copie, un listener ajouté pendant
 * la passe était revisité dans la même boucle → re-navigation/re-rendu en cascade
 * (freeze Firefox / OOM invité). On gère aussi les listeners async pour ne pas laisser
 * fuiter de rejets (`Uncaught (in promise): Failed to fetch`).
 */
function runNotify(row) {
  for (const fn of [...listeners]) {
    try {
      const ret = fn(row);
      if (ret && typeof ret.then === "function") {
        ret.catch((e) => console.warn("gameSync listener:", e?.message || e));
      }
    } catch (e) {
      console.warn("gameSync listener:", e?.message || e);
    }
  }
}

/**
 * Anti-réentrance : si un listener relance une notification synchrone (via navigate →
 * mount → refresh), on ne récurse pas — on mémorise la dernière `row` et on la traite
 * après la passe courante. Coupe l'emballement synchrone à la racine.
 */
function notify(row) {
  if (notifying) {
    pendingNotifyRow = row;
    hasPendingNotify = true;
    return;
  }
  notifying = true;
  try {
    runNotify(row);
    let drain = 0;
    while (hasPendingNotify && drain < NOTIFY_MAX_DRAIN) {
      hasPendingNotify = false;
      const next = pendingNotifyRow;
      pendingNotifyRow = null;
      runNotify(next);
      drain += 1;
    }
    hasPendingNotify = false;
    pendingNotifyRow = null;
  } finally {
    notifying = false;
  }
}

export function userIdForName(name) {
  const p = getState().lobby?.participants?.find((x) => x.name === name);
  if (p?.userId) return p.userId;
  if (name && name === getLocalDisplayName()) return getSupabaseUserId();
  return null;
}

export function getLocalParticipantUid() {
  const local = getState().lobby?.participants?.find((p) => p.isLocal && p.userId);
  if (local?.userId) return local.userId;
  return getSupabaseUserId();
}

export function requireLocalParticipantUid() {
  const uid = getLocalParticipantUid();
  if (uid) return uid;
  throw new Error("Synchronisation du joueur en cours. Réessaie dans un instant.");
}

export function requirePlayerUid(name) {
  const uid = userIdForName(name);
  if (uid) return uid;
  throw new Error("Synchronisation des joueurs en cours. Réessaie dans un instant.");
}

export function nameForUserId(uid) {
  if (uid == null || uid === "") return null;
  const key = String(uid);
  const p = getState().lobby?.participants?.find((x) => x.userId === key);
  if (p?.name) return p.name;
  const localUid = getSupabaseUserId();
  if (localUid && localUid === key) return getLocalDisplayName();
  const byName = getState().lobby?.participants?.find((x) => x.name === key);
  if (byName) return key;
  return null;
}

/** Clé answer/vote/score (uid ou pseudo) → pseudo affiché. */
export function playerKeyToDisplayName(key) {
  return nameForUserId(key) || null;
}

/** Votes / réponses indexés par uid ou pseudo → clés = pseudos actifs. */
export function normalizePlayerVotesMap(votes = {}, playerNames = getActivePlayerNames()) {
  return normalizePlayerKeyedMap(votes, playerNames, (key) => {
    const mapped = playerKeyToDisplayName(key);
    if (mapped) return mapped;
    return playerNames.includes(String(key)) ? String(key) : null;
  });
}

function mapReadyByName(readyByUid = {}) {
  const out = {};
  Object.entries(readyByUid).forEach(([uid, val]) => {
    const name = nameForUserId(uid) || uid;
    out[name] = Boolean(val);
  });
  return out;
}

function mapReadyByUid(readyByName = {}) {
  const out = {};
  Object.entries(readyByName).forEach(([name, val]) => {
    const uid = playerKeyToRemoteUid(name);
    if (!uid) return;
    out[uid] = Boolean(val);
  });
  return out;
}

function mapVotesByName(votesByUid = {}) {
  return normalizePlayerVotesMap(votesByUid);
}

function mapVotesByUid(votesByName = {}) {
  const out = {};
  Object.entries(votesByName).forEach(([name, val]) => {
    const uid = playerKeyToRemoteUid(name);
    if (!uid) return;
    if (val != null) out[uid] = val;
  });
  return out;
}

function playerKeyToRemoteUid(key) {
  if (key == null || key === "") return null;
  const raw = String(key);
  if (getState().lobby?.participants?.some((p) => p.userId === raw)) return raw;
  if (getSupabaseUserId() === raw) return raw;
  return userIdForName(raw);
}

function playerNamesToUids(names = []) {
  return (names || []).map((name) => playerKeyToRemoteUid(name)).filter(Boolean);
}

function mapTargetVotesByUid(votesByName = {}) {
  const out = {};
  Object.entries(votesByName || {}).forEach(([voter, target]) => {
    if (target == null) return;
    const voterUid = playerKeyToRemoteUid(voter);
    const targetUid = playerKeyToRemoteUid(target);
    if (voterUid && targetUid) out[voterUid] = targetUid;
  });
  return out;
}

function mapValuesByUid(valuesByName = {}, normalizeValue = (val) => val) {
  const out = {};
  Object.entries(valuesByName || {}).forEach(([name, val]) => {
    const uid = playerKeyToRemoteUid(name);
    if (!uid) return;
    const normalized = normalizeValue(val, name);
    if (normalized != null) out[uid] = normalized;
  });
  return out;
}

function normalizeTriviaAnswersForPlayers(answers = {}) {
  const players = getActivePlayerNames();
  return normalizeTriviaAnswersMap(answers, players, (key) => {
    const mapped = playerKeyToDisplayName(key);
    if (mapped) return mapped;
    return players.includes(String(key)) ? String(key) : null;
  });
}

function mapTriviaAnswersByName(answersByUid = {}) {
  return normalizeTriviaAnswersForPlayers(
    Object.fromEntries(
      Object.entries(answersByUid).filter(
        ([, val]) => val && Number.isInteger(val.answerIndex)
      )
    )
  );
}

function mapTriviaAnswersByUid(answersByName = {}) {
  const out = {};
  Object.entries(answersByName).forEach(([name, val]) => {
    const uid = playerKeyToRemoteUid(name);
    if (!uid) return;
    if (val && Number.isInteger(val.answerIndex)) {
      out[uid] = {
        answerIndex: val.answerIndex,
        answeredAt: val.answeredAt || null,
      };
    }
  });
  return out;
}

function mapConsensusAnswersByName(answersByUid = {}) {
  const out = {};
  Object.entries(answersByUid).forEach(([uid, val]) => {
    const name = playerKeyToDisplayName(uid);
    if (!name || !val || !Number.isFinite(val.value)) return;
    const prev = out[name];
    const next = {
      value: val.value,
      timestamp: val.timestamp || 0,
      submittedAt: val.submittedAt || null,
      questionIdx: val.questionIdx ?? null,
      imputed: Boolean(val.imputed),
    };
    if (!prev) {
      out[name] = next;
      return;
    }
    out[name] = pickLatestConsensusAnswer(prev, next);
  });
  return out;
}

function mapConsensusAnswersByUid(answersByName = {}) {
  const out = {};
  Object.entries(answersByName).forEach(([name, val]) => {
    const uid = playerKeyToRemoteUid(name);
    if (!uid) return;
    if (val && Number.isFinite(val.value)) {
      out[uid] = {
        value: val.value,
        timestamp: val.timestamp || 0,
        submittedAt: val.submittedAt || null,
        questionIdx: val.questionIdx ?? null,
        imputed: Boolean(val.imputed),
      };
    }
  });
  return out;
}

function mapSubmissionsByName(subsByUid = {}) {
  const out = {};
  Object.entries(subsByUid).forEach(([uid, val]) => {
    const name = nameForUserId(uid) || uid;
    if (val) out[name] = val;
  });
  return out;
}

function mapSubmissionsByUid(subsByName = {}) {
  const out = {};
  Object.entries(subsByName).forEach(([name, val]) => {
    const uid = playerKeyToRemoteUid(name);
    if (!uid) return;
    if (val) out[uid] = val;
  });
  return out;
}

function mapPlacementsByName(placementsByUid = {}) {
  const out = {};
  Object.entries(placementsByUid).forEach(([uid, val]) => {
    const name = nameForUserId(uid) || uid;
    if (val) out[name] = val;
  });
  return out;
}

function mapPlacementsByUid(placementsByName = {}) {
  const out = {};
  Object.entries(placementsByName).forEach(([name, val]) => {
    const uid = playerKeyToRemoteUid(name);
    if (!uid) return;
    if (val) out[uid] = val;
  });
  return out;
}

export function hotTakeToRemote(session) {
  return {
    customTakes: session.customTakes || [],
    ready: mapReadyByUid(session.ready || {}),
    lobbyStarted: Boolean(session.lobbyStarted),
    pausedBy: session.pausedBy ? userIdForName(session.pausedBy) : null,
    selectedThemeId: session.selectedThemeId || "catalog",
    roundCount: session.roundCount ?? 5,
    deck: session.deck || null,
    takeIdx: session.takeIdx ?? 0,
    phase: session.phase || null,
    votes: mapVotesByUid(session.votes || {}),
    voteEndsAt: session.voteEndsAt || null,
    voteTimerRemaining:
      session.voteTimerRemaining != null ? session.voteTimerRemaining : null,
    intermissionEndsAt: session.intermissionEndsAt || null,
    takeScored: Boolean(session.takeScored),
    matchScores: scoresToRemote(session.matchScores || {}),
    lastRound: session.lastRound
      ? {
          ...session.lastRound,
          deltas: scoresToRemote(session.lastRound.deltas || {}),
        }
      : null,
  };
}

export function hotTakeFromRemote(remote) {
  if (!remote) return null;
  return {
    customTakes: remote.customTakes || [],
    ready: mapReadyByName(remote.ready || {}),
    lobbyStarted: Boolean(remote.lobbyStarted),
    pausedBy: remote.pausedBy ? nameForUserId(remote.pausedBy) || remote.pausedBy : null,
    selectedThemeId: remote.selectedThemeId || "catalog",
    roundCount: remote.roundCount ?? 5,
    deck: remote.deck || null,
    takeIdx: remote.takeIdx ?? 0,
    phase: remote.phase || null,
    votes: mapVotesByName(remote.votes || {}),
    voteEndsAt: remote.voteEndsAt || null,
    voteTimerRemaining:
      remote.voteTimerRemaining != null ? remote.voteTimerRemaining : null,
    intermissionEndsAt: remote.intermissionEndsAt || null,
    takeScored: Boolean(remote.takeScored),
    matchScores: scoresFromRemote(remote.matchScores || {}),
    lastRound: remote.lastRound
      ? {
          ...remote.lastRound,
          deltas: scoresFromRemote(remote.lastRound.deltas || {}),
        }
      : null,
  };
}

/** Fusion des votes uid (écriture patch) - évite d’écraser les votes des autres joueurs. */
function mergeRemoteHotTakeVotesUid(cur, inc) {
  const curVotes = cur?.votes || {};
  const incVotes = inc?.votes || {};
  if (isNewHotTakeVoteRound(cur, inc)) return incVotes;
  if (
    (inc?.phase === "voting" && cur?.phase === "voting") ||
    inc?.phase === "reveal" ||
    cur?.phase === "reveal"
  ) {
    return { ...curVotes, ...incVotes };
  }
  return incVotes;
}

/** Fusion des « prêt » uid (écriture patch). */
function mergeRemoteReadyUid(cur, inc) {
  return { ...(cur?.ready || {}), ...(inc?.ready || {}) };
}

/** Fusion locale à l’application d’une session distante. */
function mergeHotTakeGameLocal(local, remote) {
  if (!remote) return local;
  if (!local) return remote;
  const newVoteRound = isNewHotTakeVoteRound(local, remote);
  const me = getLocalDisplayName();
  const remoteVotes = remote.votes || {};
  const localVotes = local.votes || {};
  let votes = remoteVotes;
  if (newVoteRound) {
    votes = remoteVotes;
  } else if (remote.phase === "voting") {
    votes = { ...remoteVotes, ...localVotes };
  } else if (remote.phase === "reveal" || local.phase === "reveal") {
    votes = { ...remoteVotes, ...localVotes };
  }
  votes = normalizePlayerVotesMap(votes);
  const ready =
    !remote.lobbyStarted && !local.lobbyStarted
      ? mergeReadyMapsLocal(local.ready || {}, remote.ready || {}, getActivePlayerNames(), getLocalDisplayName())
      : remote.ready || {};
  const customTakes = mergeHotTakeCustomTakes(
    local.customTakes || [],
    remote.customTakes || [],
    me
  );
  return {
    ...local,
    ...remote,
    phase: mergeHotTakePhase(local, remote),
    votes,
    ready,
    customTakes,
    deck: mergeCustomGameDeck(local, remote),
    takeScored: mergeRoundFlag(local.takeScored, remote.takeScored, newVoteRound),
    matchScores: mergeMatchScoresLocal(local.matchScores || {}, remote.matchScores || {}),
    lastRound: remote.lastRound ?? local.lastRound ?? null,
  };
}

function isNewHotTakeVoteRoundUid(cur, inc) {
  return isNewHotTakeVoteRound(cur, inc);
}

function mergeRemoteSpeedVoteVotesUid(cur, inc) {
  const curVotes = cur?.votes || {};
  const incVotes = inc?.votes || {};
  if (isNewSpeedVoteVoteRound(cur, inc)) return incVotes;
  if (
    (inc?.phase === "voting" && cur?.phase === "voting") ||
    inc?.phase === "reveal" ||
    cur?.phase === "reveal"
  ) {
    return { ...curVotes, ...incVotes };
  }
  return incVotes;
}

function mergeSpeedVoteGameLocal(local, remote) {
  if (!remote) return local;
  if (!local) return remote;
  const newVoteRound = isNewSpeedVoteVoteRound(local, remote);
  const remoteVotes = remote.votes || {};
  const localVotes = local.votes || {};
  let votes = remoteVotes;
  if (newVoteRound) {
    votes = remoteVotes;
  } else if (remote.phase === "voting") {
    votes = { ...remoteVotes, ...localVotes };
  } else if (remote.phase === "reveal" || local.phase === "reveal") {
    votes = { ...remoteVotes, ...localVotes };
  }
  votes = normalizePlayerVotesMap(votes);
  const ready =
    !remote.lobbyStarted && !local.lobbyStarted
      ? mergeReadyMapsLocal(local.ready || {}, remote.ready || {}, getActivePlayerNames(), getLocalDisplayName())
      : remote.ready || {};
  return {
    ...local,
    ...remote,
    phase: mergeSpeedVotePhase(local, remote),
    votes,
    ready,
    roundScored: mergeRoundFlag(local.roundScored, remote.roundScored, newVoteRound),
    matchScores: mergeMatchScoresLocal(local.matchScores || {}, remote.matchScores || {}),
  };
}

function isNewClutchRoundUid(cur, inc) {
  return isNewClutchRound(cur, inc);
}

/** Taps Clutch (clé uid ou pseudo, valeur { ms, at }) → clés = pseudos actifs. */
function normalizeClutchTaps(taps = {}) {
  const names = getActivePlayerNames();
  return normalizePlayerKeyedMap(taps, names, (key) => {
    const mapped = playerKeyToDisplayName(key);
    if (mapped) return mapped;
    return names.includes(String(key)) ? String(key) : null;
  });
}

function mergeRemoteClutchTapsUid(cur, inc) {
  const curTaps = cur?.taps || {};
  const incTaps = inc?.taps || {};
  if (isNewClutchRound(cur, inc)) return incTaps;
  if (inc?.phase === "active" || inc?.phase === "reveal" || cur?.phase === "reveal") {
    return { ...curTaps, ...incTaps };
  }
  return incTaps;
}

function mergeClutchGameLocal(local, remote) {
  if (!remote) return local;
  if (!local) return remote;
  const newRound = isNewClutchRound(local, remote);
  const remoteTaps = remote.taps || {};
  const localTaps = local.taps || {};
  let taps = remoteTaps;
  if (newRound) {
    taps = remoteTaps;
  } else if (remote.phase === "active" || remote.phase === "reveal" || local.phase === "reveal") {
    taps = { ...remoteTaps, ...localTaps };
  }
  taps = normalizeClutchTaps(taps);
  const ready =
    !remote.lobbyStarted && !local.lobbyStarted
      ? mergeReadyMapsLocal(local.ready || {}, remote.ready || {}, getActivePlayerNames(), getLocalDisplayName())
      : remote.ready || {};
  return {
    ...local,
    ...remote,
    phase: mergeClutchPhase(local, remote),
    taps,
    ready,
    roundScored: mergeRoundFlag(local.roundScored, remote.roundScored, newRound),
    matchScores: mergeMatchScoresLocal(local.matchScores || {}, remote.matchScores || {}),
    lastRound: remote.lastRound ?? local.lastRound ?? null,
  };
}

function isNewWrongAnswerRoundUid(cur, inc) {
  return isNewWrongAnswerRound(cur, inc);
}

/** Réponses texte Wrong Answer Only (clé uid ou pseudo) → clés = pseudos actifs. */
function normalizeWrongAnswerAnswers(answers = {}) {
  const names = getActivePlayerNames();
  return normalizePlayerKeyedMap(answers, names, (key) => {
    const mapped = playerKeyToDisplayName(key);
    if (mapped) return mapped;
    return names.includes(String(key)) ? String(key) : null;
  });
}

function mergeRemoteWrongAnswerAnswersUid(cur, inc) {
  const curAnswers = cur?.answers || {};
  const incAnswers = inc?.answers || {};
  if (isNewWrongAnswerRound(cur, inc)) return incAnswers;
  return { ...curAnswers, ...incAnswers };
}

/** Votes Wrong Answer Only (clé uid ou pseudo, valeur = uid/pseudo auteur voté). */
function normalizeWrongAnswerVotes(votes = {}) {
  return normalizePlayerVotesMap(votes);
}

function mergeRemoteWrongAnswerVotesUid(cur, inc) {
  const curVotes = cur?.votes || {};
  const incVotes = inc?.votes || {};
  if (isNewWrongAnswerRound(cur, inc)) return incVotes;
  return { ...curVotes, ...incVotes };
}

function mergeWrongAnswerGameLocal(local, remote) {
  if (!remote) return local;
  if (!local) return remote;
  const newRound = isNewWrongAnswerRound(local, remote);
  const remoteAnswers = remote.answers || {};
  const localAnswers = local.answers || {};
  const remoteVotes = remote.votes || {};
  const localVotes = local.votes || {};
  const answers = normalizeWrongAnswerAnswers(
    newRound ? remoteAnswers : { ...remoteAnswers, ...localAnswers }
  );
  const votes = normalizeWrongAnswerVotes(
    newRound ? remoteVotes : { ...remoteVotes, ...localVotes }
  );
  const ready =
    !remote.lobbyStarted && !local.lobbyStarted
      ? mergeReadyMapsLocal(local.ready || {}, remote.ready || {}, getActivePlayerNames(), getLocalDisplayName())
      : remote.ready || {};
  return {
    ...local,
    ...remote,
    phase: mergeWrongAnswerPhase(local, remote, { newRound }),
    answers,
    votes,
    ready,
    roundScored: mergeRoundFlag(local.roundScored, remote.roundScored, newRound),
    matchScores: mergeMatchScoresLocal(local.matchScores || {}, remote.matchScores || {}),
    lastRound: newRound ? remote.lastRound ?? null : remote.lastRound ?? local.lastRound ?? null,
  };
}

function isNewTraitreVoteRoundUid(cur, inc) {
  return isNewTraitreVoteRound(cur, inc);
}

function mergeRemoteTraitreVotesUid(cur, inc) {
  const curVotes = cur?.votes || {};
  const incVotes = inc?.votes || {};
  if (isNewTraitreVoteRound(cur, inc) || isTraitreVoteResetAfterTie(cur, inc)) return incVotes;
  if (inc?.phase === "vote" || cur?.phase === "vote") {
    return { ...curVotes, ...incVotes };
  }
  return incVotes;
}

/** Votes Spot the fake : uid ou pseudo → clés = survivants (`alive`). */
function normalizeTraitreVotesMap(votes = {}, alive = []) {
  const activeNames = getActivePlayerNames();
  return normalizeKeyedVotes(votes, alive, (key) => {
    const mapped = nameForUserId(key);
    if (mapped) return mapped;
    const s = String(key);
    if (alive.includes(s)) return s;
    if (activeNames.includes(s)) return s;
    return null;
  });
}

function mergeTraitreGameLocal(local, remote) {
  if (!remote) return local;
  if (!local) return remote;
  if (isNewTraitreGame(local, remote)) {
    return {
      ...remote,
      pairId: remote.pairId ?? null,
      impostorName: remote.impostorRevealed ? remote.impostorName ?? null : null,
      isLocalImpostor: false,
      privateRoleSynced: false,
    };
  }
  const newVoteRound = isNewTraitreVoteRound(local, remote);
  const tieVoteReset = isTraitreVoteResetAfterTie(local, remote);
  const remoteVotes = remote.votes || {};
  const localVotes = local.votes || {};
  const aliveList = remote.alive?.length
    ? [...remote.alive]
    : [...(local.alive || getActivePlayerNames())];
  let votes = remoteVotes;
  if (newVoteRound || tieVoteReset) {
    votes = remoteVotes;
  } else if (remote.phase === "vote" || local.phase === "vote") {
    votes = { ...remoteVotes, ...localVotes };
  } else if (remote.phase === "final" || local.phase === "final") {
    votes = { ...remoteVotes, ...localVotes };
  }
  if (
    remote.phase === "vote" ||
    local.phase === "vote" ||
    remote.phase === "final" ||
    local.phase === "final"
  ) {
    votes = normalizeTraitreVotesMap(votes, aliveList);
  }
  const remoteAcks = remote.dealAcks || {};
  const localAcks = local.dealAcks || {};
  const dealAcks = { ...remoteAcks, ...localAcks };
  const ready =
    !remote.lobbyStarted && !local.lobbyStarted
      ? mergeReadyMapsLocal(local.ready || {}, remote.ready || {}, getActivePlayerNames(), getLocalDisplayName())
      : remote.ready || {};
  return {
    ...local,
    ...remote,
    phase: mergeTraitrePhase(local.phase, remote.phase, {
      newVoteRound,
      staleVotePatch: isStaleTraitreVotePatch(local, remote),
    }),
    pairId: remote.pairId || local.pairId || null,
    impostorName: (() => {
      if (isLobbyHost() && local.impostorName) return local.impostorName;
      if (remote.impostorRevealed && remote.impostorName) return remote.impostorName;
      if (local.isLocalImpostor) return getLocalDisplayName();
      return null;
    })(),
    isLocalImpostor: local.isLocalImpostor ?? remote.isLocalImpostor ?? false,
    privateRoleSynced: local.privateRoleSynced ?? remote.privateRoleSynced ?? false,
    votes,
    dealAcks,
    ready,
    tieAfterVote: tieVoteReset ? true : Boolean(remote.tieAfterVote),
  };
}

function isNewSpeedVoteVoteRoundUid(cur, inc) {
  return isNewSpeedVoteVoteRound(cur, inc);
}

function isNewTriviaQuestionRound(cur, inc) {
  if (!inc) return false;
  return (
    inc.phase === "question" &&
    inc.questionIdx != null &&
    cur?.questionIdx != null &&
    inc.questionIdx !== cur.questionIdx &&
    Object.keys(inc.answers || {}).length === 0
  );
}

function mergeRemoteTriviaAnswersUid(cur, inc) {
  const curAnswers = cur?.answers || {};
  const incAnswers = inc?.answers || {};
  if (isNewTriviaQuestionRound(cur, inc)) return incAnswers;
  if (
    (inc?.phase === "question" && cur?.phase === "question") ||
    inc?.phase === "reveal" ||
    cur?.phase === "reveal" ||
    inc?.phase === "final" ||
    cur?.phase === "final"
  ) {
    return mergeTriviaAnswersUid(curAnswers, incAnswers);
  }
  return incAnswers;
}

function mergeTriviaGameLocal(local, remote) {
  if (!remote) return local;
  if (!local) return remote;
  const newQuestionRound = isNewTriviaQuestionRound(local, remote);
  const remoteAnswers = remote.answers || {};
  const localAnswers = local.answers || {};
  let answers = remoteAnswers;
  if (newQuestionRound) {
    answers = remoteAnswers;
  } else if (
    remote.phase === "question" ||
    remote.phase === "reveal" ||
    remote.phase === "final"
  ) {
    answers = normalizeTriviaAnswersForPlayers({ ...localAnswers, ...remoteAnswers });
  }
  const ready =
    !remote.lobbyStarted && !local.lobbyStarted
      ? mergeReadyMapsLocal(local.ready || {}, remote.ready || {}, getActivePlayerNames(), getLocalDisplayName())
      : remote.ready || {};
  return {
    ...local,
    ...remote,
    ready,
    answers,
    matchScores: { ...(remote.matchScores || {}) },
    questionScored: mergeRoundFlag(local.questionScored, remote.questionScored, newQuestionRound),
    podiumApplied: mergeRoundFlag(local.podiumApplied, remote.podiumApplied, newQuestionRound),
  };
}

function isNewTriviaQuestionRoundUid(cur, inc) {
  return isNewTriviaQuestionRound(cur, inc);
}

function mergeRemoteConsensusAnswersUid(cur, inc) {
  const curAnswers = cur?.answers || {};
  const incAnswers = inc?.answers || {};
  if (isNewConsensusQuestionRound(cur, inc)) return incAnswers;
  const merged = { ...curAnswers };
  Object.entries(incAnswers).forEach(([uid, incoming]) => {
    const current = merged[uid];
    merged[uid] = pickLatestConsensusAnswer(current, incoming);
  });
  return merged;
}

function mergeConsensusGameLocal(local, remote) {
  if (!remote) return local;
  if (!local) return remote;
  const newGame = isNewConsensusGame(local, remote);
  if (newGame) {
    const ready = mergeReadyMapsLocal(
      {},
      remote.ready || {},
      getActivePlayerNames(),
      getLocalDisplayName()
    );
    return { ...remote, ready };
  }
  const newQuestionRound = isNewConsensusQuestionRound(local, remote);
  const remoteAnswers = remote.answers || {};
  const localAnswers = local.answers || {};
  let answers = remoteAnswers;
  if (newQuestionRound) {
    answers = remoteAnswers;
  } else if (
    remote.phase === "question" ||
    remote.phase === "reveal-pending" ||
    remote.phase === "reveal" ||
    remote.phase === "final"
  ) {
    answers = { ...remoteAnswers };
    const me = getLocalDisplayName();
    const mergedLocal = pickLatestConsensusAnswer(localAnswers[me], remoteAnswers[me]);
    if (mergedLocal) answers[me] = mergedLocal;
  }
  const ready =
    !remote.lobbyStarted && !local.lobbyStarted
      ? mergeReadyMapsLocal(local.ready || {}, remote.ready || {}, getActivePlayerNames(), getLocalDisplayName())
      : remote.ready || {};
  return {
    ...local,
    ...remote,
    ready,
    phase: mergeConsensusPhase(local.phase, remote.phase, { newQuestionRound, newGame }),
    answers,
    matchScores: scoresFromRemote({
      ...scoresToRemote(local.matchScores || {}),
      ...scoresToRemote(remote.matchScores || {}),
    }),
    roundScored: mergeRoundFlag(local.roundScored, remote.roundScored, newQuestionRound),
    lastRound: newQuestionRound
      ? remote.lastRound ?? null
      : normalizeConsensusLastRoundRemote(remote.lastRound ?? local.lastRound),
    podiumApplied: mergeRoundFlag(local.podiumApplied, remote.podiumApplied, newQuestionRound),
  };
}

function normalizeConsensusPlayerList(list = []) {
  const names = new Set();
  list.forEach((id) => {
    const name = playerKeyToDisplayName(id);
    if (name && getActivePlayerNames().includes(name)) names.add(name);
  });
  return [...names];
}

function normalizeConsensusLastRoundRemote(lastRound) {
  if (!lastRound) return null;
  return {
    ...lastRound,
    deltas: scoresFromRemote(lastRound.deltas || {}),
    precisionPlayers: normalizeConsensusPlayerList(lastRound.precisionPlayers),
    closestPlayers: normalizeConsensusPlayerList(lastRound.closestPlayers),
    intuitionPlayers: normalizeConsensusPlayerList(lastRound.intuitionPlayers),
    consensusPlayers: normalizeConsensusPlayerList(lastRound.consensusPlayers),
  };
}

function isNewConsensusQuestionRoundUid(cur, inc) {
  return isNewConsensusQuestionRound(cur, inc);
}

function isNewDilemmaVoteRoundUid(cur, inc) {
  return isNewDilemmaVoteRound(cur, inc);
}

function mergeRemoteDilemmaVotes(cur, inc) {
  const curVotes = cur?.votes || {};
  const incVotes = inc?.votes || {};
  if (isNewDilemmaVoteRound(cur, inc)) return incVotes;
  if (
    (inc?.phase === "voting" && cur?.phase === "voting") ||
    inc?.phase === "reveal" ||
    cur?.phase === "reveal"
  ) {
    return { ...curVotes, ...incVotes };
  }
  return incVotes;
}

function isNewGuessLieVoteRound(cur, inc) {
  return inc?.roundIdx != null && inc.roundIdx !== cur?.roundIdx;
}

function mergeRemoteGuessLieVotes(cur, inc) {
  const curVotes = cur?.votes || {};
  const incVotes = inc?.votes || {};
  if (isNewGuessLieVoteRound(cur, inc)) return incVotes;
  if (inc?.votes !== undefined) {
    return { ...curVotes, ...incVotes };
  }
  if (
    (inc?.phase === "voting" && cur?.phase === "voting") ||
    inc?.phase === "reveal" ||
    cur?.phase === "reveal"
  ) {
    return { ...curVotes, ...incVotes };
  }
  return curVotes;
}

function mergeGuessLieGameLocal(local, remote) {
  if (!remote) return local;
  if (!local) return remote;
  const newVoteRound = isNewGuessLieVoteRound(local, remote);
  const lobbyReset = shouldApplyGuessLieLobbyReset(local, remote);
  const inPrep = isGuessLieInPrep(local, remote);
  const remoteVotes = remote.votes || {};
  const localVotes = local.votes || {};
  let votes = remoteVotes;
  if (newVoteRound) {
    votes = remoteVotes;
  } else {
    votes = { ...remoteVotes, ...localVotes };
    const name = getLocalDisplayName();
    if (localVotes[name] != null) votes[name] = localVotes[name];
  }
  return {
    ...local,
    ...remote,
    sessionId: remote.sessionId ?? local.sessionId ?? getState().lobbyCode ?? null,
    submissions: mergeGuessLieSubmissions(local.submissions, remote.submissions, {
      reset: lobbyReset,
      prepPhase: inPrep && !lobbyReset,
      localName: getLocalDisplayName(),
    }),
    phase: newVoteRound
      ? (remote.phase ?? local.phase)
      : mergeForwardGamePhase(local.phase, remote.phase),
    votes,
    roundScored: mergeRoundFlag(local.roundScored, remote.roundScored, newVoteRound),
    statsRecordedRoundIdx: mergeMaxIndex(local.statsRecordedRoundIdx, remote.statsRecordedRoundIdx),
    lobbyComplete: mergeGuessLieLobbyComplete(local, remote, { lobbyReset }),
  };
}

function mergeDilemmaGameLocal(local, remote) {
  if (!remote) return local;
  if (!local) return remote;
  const newVoteRound = isNewDilemmaVoteRound(local, remote);
  const me = getLocalDisplayName();
  const ready = mergeReadyMapsLocal(
    local.ready || {},
    remote.ready || {},
    getActivePlayerNames(),
    me
  );
  const customDilemmas =
    remote.lobbyStarted || local.lobbyStarted
      ? remote.customDilemmas || []
      : mergeDilemmaCustomDilemmas(
          local.customDilemmas || [],
          remote.customDilemmas || [],
          me
        );
  const remoteVotes = remote.votes || {};
  const localVotes = local.votes || {};
  let votes = remoteVotes;
  if (newVoteRound) {
    votes = remoteVotes;
  } else if (remote.phase === "voting") {
    votes = { ...remoteVotes, ...localVotes };
  } else if (remote.phase === "reveal" || local.phase === "reveal") {
    votes = { ...remoteVotes, ...localVotes };
  }
  votes = normalizePlayerVotesMap(votes);
  return {
    ...local,
    ...remote,
    phase: mergeDilemmaPhase(local, remote),
    ready,
    votes,
    customDilemmas,
    deck: mergeCustomGameDeck(local, remote),
    roundScored: mergeRoundFlag(local.roundScored, remote.roundScored, newVoteRound),
    matchScores: mergeMatchScoresLocal(local.matchScores || {}, remote.matchScores || {}),
    lastRound: remote.lastRound ?? local.lastRound ?? null,
  };
}

function isNewTruthMeterRound(cur, inc) {
  if (!inc || inc.roundIdx == null) return false;
  const curIdx = cur?.roundIdx ?? 0;
  return inc.roundIdx > curIdx;
}

function isNewTruthMeterVoteRound(cur, inc) {
  if (!inc) return false;
  if (
    inc.phase === "voting" &&
    inc.roundIdx != null &&
    cur?.roundIdx != null &&
    inc.roundIdx !== cur.roundIdx &&
    Object.keys(inc.votes || {}).length === 0
  ) {
    return true;
  }
  return (
    inc.phase === "voting" &&
    inc.voteEndsAt &&
    inc.voteEndsAt !== cur?.voteEndsAt &&
    Object.keys(inc.votes || {}).length === 0
  );
}

function mergeRemoteTruthMeterVotesUid(cur, inc) {
  const curVotes = cur?.votes || {};
  const incVotes = inc?.votes || {};
  if (isNewTruthMeterVoteRound(cur, inc)) return incVotes;
  if (
    (inc?.phase === "voting" && cur?.phase === "voting") ||
    inc?.phase === "reveal" ||
    inc?.phase === "reveal-pending" ||
    cur?.phase === "reveal" ||
    cur?.phase === "reveal-pending"
  ) {
    return { ...curVotes, ...incVotes };
  }
  return incVotes;
}

function mergeTruthMeterGameLocal(local, remote) {
  if (!remote) return local;
  if (!local) return remote;
  const newVoteRound = isNewTruthMeterVoteRound(local, remote);
  const newRound = isNewTruthMeterRound(local, remote);
  const remoteVotes = remote.votes || {};
  const localVotes = local.votes || {};
  let votes = remoteVotes;
  if (newVoteRound) {
    votes = remoteVotes;
  } else if (remote.phase === "voting" || local.phase === "voting") {
    votes = { ...remoteVotes, ...localVotes };
  } else if (
    remote.phase === "reveal" ||
    remote.phase === "reveal-pending" ||
    local.phase === "reveal" ||
    local.phase === "reveal-pending"
  ) {
    votes = { ...remoteVotes, ...localVotes };
  }
  votes = normalizePlayerVotesMap(votes);
  const ready =
    !remote.lobbyStarted && !local.lobbyStarted
      ? mergeReadyMapsLocal(local.ready || {}, remote.ready || {}, getActivePlayerNames(), getLocalDisplayName())
      : remote.ready || {};
  return {
    ...local,
    ...remote,
    phase: mergeTruthMeterPhase(local.phase, remote.phase, {
      newRound: newVoteRound || newRound,
    }),
    votes,
    ready,
    roundScored: mergeRoundFlag(local.roundScored, remote.roundScored, newVoteRound),
    matchScores: mergeMatchScoresLocal(local.matchScores || {}, remote.matchScores || {}),
    lastRound: remote.lastRound ?? local.lastRound ?? null,
  };
}

export function truthMeterToRemote(session) {
  return {
    ready: mapReadyByUid(session.ready || {}),
    lobbyStarted: Boolean(session.lobbyStarted),
    authorOrder: session.authorOrder || [],
    roundIdx: session.roundIdx ?? 0,
    phase: session.phase || null,
    affirmation: session.affirmation || null,
    authorEstimate:
      session.authorEstimate != null && Number.isFinite(session.authorEstimate)
        ? session.authorEstimate
        : null,
    votes: mapVotesByUid(session.votes || {}),
    voteEndsAt: session.voteEndsAt || null,
    roundScored: Boolean(session.roundScored),
    matchScores: scoresToRemote(session.matchScores || {}),
    lastRound: session.lastRound
      ? {
          ...session.lastRound,
          deltas: scoresToRemote(session.lastRound.deltas || {}),
        }
      : null,
  };
}

export function truthMeterFromRemote(remote) {
  if (!remote) return null;
  return {
    ready: mapReadyByName(remote.ready || {}),
    lobbyStarted: Boolean(remote.lobbyStarted),
    authorOrder: remote.authorOrder || [],
    roundIdx: remote.roundIdx ?? 0,
    phase: remote.phase || null,
    affirmation: remote.affirmation || null,
    authorEstimate:
      remote.authorEstimate != null && Number.isFinite(remote.authorEstimate)
        ? remote.authorEstimate
        : null,
    votes: mapVotesByName(remote.votes || {}),
    voteEndsAt: remote.voteEndsAt || null,
    roundScored: Boolean(remote.roundScored),
    matchScores: scoresFromRemote(remote.matchScores || {}),
    lastRound: remote.lastRound
      ? {
          ...remote.lastRound,
          deltas: scoresFromRemote(remote.lastRound.deltas || {}),
        }
      : null,
  };
}

export function consensusToRemote(session) {
  return {
    ready: mapReadyByUid(session.ready || {}),
    lobbyStarted: Boolean(session.lobbyStarted),
    selectedModeId: session.selectedModeId || "standard",
    questionCount: session.questionCount ?? 5,
    deck: session.deck ? dehydrateConsensusDeck(session.deck) : null,
    questionIdx: session.questionIdx ?? 0,
    phase: session.phase || null,
    currentQuestion: session.currentQuestion || null,
    answers: mapConsensusAnswersByUid(session.answers || {}),
    roundScored: Boolean(session.roundScored),
    matchScores: scoresToRemote(session.matchScores || {}),
    lastRound: session.lastRound
      ? {
          ...session.lastRound,
          deltas: scoresToRemote(session.lastRound.deltas || {}),
          precisionPlayers: playerNamesToUids(session.lastRound.precisionPlayers || []),
          closestPlayers: playerNamesToUids(session.lastRound.closestPlayers || []),
          intuitionPlayers: playerNamesToUids(session.lastRound.intuitionPlayers || []),
          consensusPlayers: playerNamesToUids(session.lastRound.consensusPlayers || []),
        }
      : null,
    podiumApplied: Boolean(session.podiumApplied),
  };
}

/** Patch léger révélation : pas de re-envoi du deck / prep. */
export function consensusRevealToRemote(session) {
  const remote = consensusToRemote(session);
  return {
    phase: remote.phase,
    questionIdx: remote.questionIdx,
    currentQuestion: remote.currentQuestion,
    answers: remote.answers,
    matchScores: remote.matchScores,
    roundScored: remote.roundScored,
    lastRound: remote.lastRound,
  };
}

export function consensusFromRemote(remote) {
  if (!remote) return null;
  return {
    ready: mapReadyByName(remote.ready || {}),
    lobbyStarted: Boolean(remote.lobbyStarted),
    selectedModeId: remote.selectedModeId || "standard",
    questionCount: remote.questionCount ?? 5,
    deck: remote.deck ? rehydrateConsensusDeck(remote.deck) : null,
    questionIdx: remote.questionIdx ?? 0,
    phase: remote.phase || null,
    currentQuestion: remote.currentQuestion || null,
    answers: mapConsensusAnswersByName(remote.answers || {}),
    roundScored: Boolean(remote.roundScored),
    matchScores: scoresFromRemote(remote.matchScores || {}),
    lastRound: remote.lastRound
      ? {
          ...remote.lastRound,
          deltas: scoresFromRemote(remote.lastRound.deltas || {}),
          precisionPlayers: (remote.lastRound.precisionPlayers || []).map(
            (uid) => nameForUserId(uid) || uid
          ),
          closestPlayers: (remote.lastRound.closestPlayers || []).map(
            (uid) => nameForUserId(uid) || uid
          ),
          intuitionPlayers: (remote.lastRound.intuitionPlayers || []).map(
            (uid) => nameForUserId(uid) || uid
          ),
          consensusPlayers: (remote.lastRound.consensusPlayers || []).map(
            (uid) => nameForUserId(uid) || uid
          ),
        }
      : null,
    podiumApplied: Boolean(remote.podiumApplied),
  };
}

export function triviaToRemote(session) {
  return {
    ready: mapReadyByUid(session.ready || {}),
    lobbyStarted: Boolean(session.lobbyStarted),
    selectedThemeId: session.selectedThemeId || "random",
    questionCount: session.questionCount ?? 5,
    deck: session.deck ? dehydrateTriviaDeck(session.deck) : null,
    questionIdx: session.questionIdx ?? 0,
    phase: session.phase || null,
    currentQuestion: session.currentQuestion || null,
    answers: mapTriviaAnswersByUid(session.answers || {}),
    questionScored: Boolean(session.questionScored),
    matchScores: scoresToRemote(session.matchScores || {}),
    lastRound: session.lastRound
      ? {
          ...session.lastRound,
          correctPlayers: playerNamesToUids(session.lastRound.correctPlayers || []),
          fastestPlayer: session.lastRound.fastestPlayer
            ? userIdForName(session.lastRound.fastestPlayer)
            : null,
          deltas: scoresToRemote(session.lastRound.deltas || {}),
        }
      : null,
    podiumApplied: Boolean(session.podiumApplied),
    results: session.results || null,
  };
}

export function triviaFromRemote(remote) {
  if (!remote) return null;
  return {
    ready: mapReadyByName(remote.ready || {}),
    lobbyStarted: Boolean(remote.lobbyStarted),
    selectedThemeId: remote.selectedThemeId || "random",
    questionCount: remote.questionCount ?? 5,
    deck: remote.deck ? rehydrateTriviaDeck(remote.deck) : null,
    questionIdx: remote.questionIdx ?? 0,
    phase: remote.phase || null,
    currentQuestion: remote.currentQuestion || null,
    answers: mapTriviaAnswersByName(remote.answers || {}),
    questionScored: Boolean(remote.questionScored),
    matchScores: scoresFromRemote(remote.matchScores || {}),
    lastRound: remote.lastRound
      ? {
          ...remote.lastRound,
          correctPlayers: (remote.lastRound.correctPlayers || []).map(
            (uid) => nameForUserId(uid) || uid
          ),
          fastestPlayer: remote.lastRound.fastestPlayer
            ? nameForUserId(remote.lastRound.fastestPlayer) || remote.lastRound.fastestPlayer
            : null,
          deltas: scoresFromRemote(remote.lastRound.deltas || {}),
        }
      : null,
    podiumApplied: Boolean(remote.podiumApplied),
    results: remote.results || null,
  };
}

export function speedVoteToRemote(session) {
  return {
    ready: mapReadyByUid(session.ready || {}),
    lobbyStarted: Boolean(session.lobbyStarted),
    selectedThemeId: session.selectedThemeId || "catalog",
    roundCount: session.roundCount ?? 5,
    deck: session.deck || null,
    roundIdx: session.roundIdx ?? 0,
    phase: session.phase || null,
    currentQuestion: session.currentQuestion || null,
    votes: mapTargetVotesByUid(session.votes || {}),
    voteEndsAt: session.voteEndsAt || null,
    roundScored: Boolean(session.roundScored),
    modifier: session.modifier || "normal",
    matchScores: scoresToRemote(session.matchScores || {}),
  };
}

export function dilemmaToRemote(session) {
  return {
    customDilemmas: session.customDilemmas || [],
    ready: mapReadyByUid(session.ready || {}),
    lobbyStarted: Boolean(session.lobbyStarted),
    selectedDeckId: session.selectedDeckId || "catalog",
    roundCount: session.roundCount ?? 8,
    deck: session.deck ? dehydrateDilemmaDeck(session.deck) : null,
    roundIdx: session.roundIdx ?? 0,
    phase: session.phase || null,
    currentDilemma: session.currentDilemma || null,
    votes: mapVotesByUid(session.votes || {}),
    voteEndsAt: session.voteEndsAt || null,
    roundScored: Boolean(session.roundScored),
    blindMode: Boolean(session.blindMode),
    pausedBy: session.pausedBy ? userIdForName(session.pausedBy) : null,
    matchScores: scoresToRemote(session.matchScores || {}),
    lastRound: session.lastRound
      ? {
          ...session.lastRound,
          deltas: scoresToRemote(session.lastRound.deltas || {}),
          majorityWinners: playerNamesToUids(session.lastRound.majorityWinners || []),
          tieWinners: playerNamesToUids(session.lastRound.tieWinners || []),
        }
      : null,
  };
}

export function dilemmaFromRemote(remote) {
  if (!remote) return null;
  const votes = {};
  Object.entries(remote.votes || {}).forEach(([voterUid, choice]) => {
    const voter = nameForUserId(voterUid) || voterUid;
    votes[voter] = choice;
  });
  return {
    customDilemmas: remote.customDilemmas || [],
    ready: mapReadyByName(remote.ready || {}),
    lobbyStarted: Boolean(remote.lobbyStarted),
    selectedDeckId: remote.selectedDeckId || "catalog",
    roundCount: remote.roundCount ?? 8,
    deck: remote.deck ? rehydrateDilemmaDeck(remote.deck) : null,
    roundIdx: remote.roundIdx ?? 0,
    phase: remote.phase || null,
    currentDilemma: remote.currentDilemma || null,
    votes,
    voteEndsAt: remote.voteEndsAt || null,
    roundScored: Boolean(remote.roundScored),
    blindMode: Boolean(remote.blindMode),
    pausedBy: remote.pausedBy ? nameForUserId(remote.pausedBy) || remote.pausedBy : null,
    matchScores: scoresFromRemote(remote.matchScores || {}),
    lastRound: remote.lastRound
      ? {
          ...remote.lastRound,
          deltas: scoresFromRemote(remote.lastRound.deltas || {}),
          majorityWinners: (remote.lastRound.majorityWinners || []).map(
            (uid) => nameForUserId(uid) || uid
          ),
          tieWinners: (remote.lastRound.tieWinners || []).map(
            (uid) => nameForUserId(uid) || uid
          ),
        }
      : null,
  };
}

function mapFilRougeValidationsToUid(validations = {}) {
  const out = {};
  Object.entries(validations).forEach(([key, val]) => {
    const uid = playerKeyToRemoteUid(key);
    if (!uid) return;
    out[uid] = val;
  });
  return out;
}

export function filRougeToRemote(session) {
  const submissions = mapValuesByUid(session.submissions || {});
  return {
    status: session.status || "idle",
    submissions,
    validations: mapFilRougeValidationsToUid(session.validations || {}),
    resultsModalOpen: Boolean(session.resultsModalOpen),
    resultsSnapshot: session.resultsSnapshot || null,
    closedAt: session.closedAt || null,
    closedByUid: session.closedByUid
      ? playerKeyToRemoteUid(session.closedByUid)
      : null,
  };
}

export function filRougeFromRemote(remote) {
  if (!remote) return null;
  return {
    status: remote.status || "idle",
    submissions: { ...(remote.submissions || {}) },
    validations: { ...(remote.validations || {}) },
    resultsModalOpen: Boolean(remote.resultsModalOpen),
    resultsSnapshot: remote.resultsSnapshot || null,
    closedAt: remote.closedAt || null,
    closedByUid: remote.closedByUid || null,
  };
}

const FIL_ROUGE_STATUS_RANK = { idle: 0, setup: 1, active: 2, completed: 3 };

function filRougeStatusRank(status) {
  return FIL_ROUGE_STATUS_RANK[status] ?? 0;
}

/** Relance ou reset : setup sans soumissions ni résultats → prioritaire sur « completed ». */
function isFilRougeRoundReset(inc) {
  return (
    inc?.status === "setup" &&
    inc?.submissions !== undefined &&
    Object.keys(inc.submissions || {}).length === 0 &&
    !inc?.resultsModalOpen &&
    !inc?.resultsSnapshot
  );
}

function pickFilRougeStatusFields(cur, inc) {
  if (isFilRougeRoundReset(inc)) {
    return {
      status: "setup",
      resultsModalOpen: false,
      resultsSnapshot: null,
      closedAt: null,
      closedByUid: null,
    };
  }
  const curRank = filRougeStatusRank(cur?.status);
  const incRank = filRougeStatusRank(inc?.status);
  const preferInc = incRank >= curRank;
  const src = preferInc ? inc : cur;
  return {
    status: src?.status || cur?.status || inc?.status || "idle",
    resultsModalOpen: Boolean(src?.resultsModalOpen),
    resultsSnapshot: src?.resultsSnapshot ?? cur?.resultsSnapshot ?? inc?.resultsSnapshot ?? null,
    closedAt: src?.closedAt ?? cur?.closedAt ?? inc?.closedAt ?? null,
    closedByUid: src?.closedByUid ?? cur?.closedByUid ?? inc?.closedByUid ?? null,
  };
}

function mergeFilRougeSubmissions(cur, inc) {
  if (!inc || inc.submissions === undefined) return { ...(cur?.submissions || {}) };
  const incSubs = inc.submissions || {};
  if (Object.keys(incSubs).length === 0) return {};
  return { ...(cur?.submissions || {}), ...incSubs };
}

function mergeFilRougeRemote(cur, inc) {
  if (!inc) return cur;
  if (!cur) return inc;
  const reset = isFilRougeRoundReset(inc);
  const statusFields = pickFilRougeStatusFields(cur, inc);
  const merged = {
    ...cur,
    ...inc,
    ...statusFields,
    submissions: mergeFilRougeSubmissions(cur, inc),
    validations: reset
      ? { ...(inc.validations || {}) }
      : { ...(cur.validations || {}), ...(inc.validations || {}) },
  };
  merged.missionAcks = reset ? {} : { ...(cur.missionAcks || {}) };
  if (merged.status === "setup" && cur.status !== "setup") {
    merged.missionAcks = {};
  }
  return merged;
}

function mergeFilRougeLocal(local, remote) {
  if (!remote) return local;
  if (!local) return remote;
  return mergeFilRougeRemote(local, remote);
}

export function speedVoteFromRemote(remote) {
  if (!remote) return null;
  const votes = {};
  Object.entries(remote.votes || {}).forEach(([voterUid, targetUid]) => {
    const voter = nameForUserId(voterUid) || voterUid;
    const target = nameForUserId(targetUid) || targetUid;
    votes[voter] = target;
  });
  return {
    ready: mapReadyByName(remote.ready || {}),
    lobbyStarted: Boolean(remote.lobbyStarted),
    selectedThemeId: remote.selectedThemeId || "catalog",
    roundCount: remote.roundCount ?? 5,
    deck: remote.deck || null,
    roundIdx: remote.roundIdx ?? 0,
    phase: remote.phase || null,
    currentQuestion: remote.currentQuestion || null,
    votes,
    voteEndsAt: remote.voteEndsAt || null,
    roundScored: Boolean(remote.roundScored),
    modifier: remote.modifier || "normal",
    matchScores: scoresFromRemote(remote.matchScores || {}),
  };
}

export function clutchToRemote(session) {
  const remoteTaps = {};
  Object.entries(session.taps || {}).forEach(([name, val]) => {
    if (!val) return;
    const uid = playerKeyToRemoteUid(name);
    if (!uid) return;
    remoteTaps[uid] = {
      ms: typeof val.ms === "number" ? val.ms : null,
      at: typeof val.at === "number" ? val.at : null,
    };
  });
  return {
    ready: mapReadyByUid(session.ready || {}),
    lobbyStarted: Boolean(session.lobbyStarted),
    roundCount: session.roundCount ?? 5,
    roundIdx: session.roundIdx ?? 0,
    phase: session.phase || null,
    targetMs: session.targetMs ?? null,
    hideBeforeMs: session.hideBeforeMs ?? null,
    roundStartAt: session.roundStartAt || null,
    roundEndsAt: session.roundEndsAt || null,
    taps: remoteTaps,
    roundScored: Boolean(session.roundScored),
    matchScores: scoresToRemote(session.matchScores || {}),
    lastRound: session.lastRound
      ? {
          targetMs: session.lastRound.targetMs ?? null,
          ranking: (session.lastRound.ranking || [])
            .map((r) => {
              const uid = playerKeyToRemoteUid(r.name);
              if (!uid) return null;
              return {
                uid,
                ms: r.ms ?? null,
                gap: Number.isFinite(r.gap) ? r.gap : null,
                tapped: Boolean(r.tapped),
              };
            })
            .filter(Boolean),
          deltas: scoresToRemote(session.lastRound.deltas || {}),
        }
      : null,
  };
}

export function clutchFromRemote(remote) {
  if (!remote) return null;
  const taps = {};
  Object.entries(remote.taps || {}).forEach(([uid, val]) => {
    if (!val) return;
    const name = nameForUserId(uid) || uid;
    taps[name] = {
      ms: typeof val.ms === "number" ? val.ms : null,
      at: typeof val.at === "number" ? val.at : null,
    };
  });
  return {
    ready: mapReadyByName(remote.ready || {}),
    lobbyStarted: Boolean(remote.lobbyStarted),
    roundCount: remote.roundCount ?? 5,
    roundIdx: remote.roundIdx ?? 0,
    phase: remote.phase || null,
    targetMs: remote.targetMs ?? null,
    hideBeforeMs: remote.hideBeforeMs ?? null,
    roundStartAt: remote.roundStartAt || null,
    roundEndsAt: remote.roundEndsAt || null,
    taps,
    roundScored: Boolean(remote.roundScored),
    matchScores: scoresFromRemote(remote.matchScores || {}),
    lastRound: remote.lastRound
      ? {
          targetMs: remote.lastRound.targetMs ?? null,
          ranking: (remote.lastRound.ranking || []).map((r) => ({
            name: nameForUserId(r.uid) || r.uid,
            ms: r.ms ?? null,
            gap: r.gap == null ? Infinity : r.gap,
            tapped: Boolean(r.tapped),
          })),
          deltas: scoresFromRemote(remote.lastRound.deltas || {}),
        }
      : null,
  };
}

export function wrongAnswerToRemote(session) {
  const remoteAnswers = {};
  Object.entries(session.answers || {}).forEach(([name, val]) => {
    if (!val) return;
    const uid = playerKeyToRemoteUid(name);
    if (!uid) return;
    remoteAnswers[uid] = {
      text: typeof val.text === "string" ? val.text : "",
      at: typeof val.at === "number" ? val.at : null,
    };
  });
  return {
    ready: mapReadyByUid(session.ready || {}),
    lobbyStarted: Boolean(session.lobbyStarted),
    roundCount: session.roundCount ?? 5,
    deck: session.deck || null,
    roundIdx: session.roundIdx ?? 0,
    phase: session.phase || null,
    currentPrompt: session.currentPrompt || null,
    roundStartAt: session.roundStartAt || null,
    answers: remoteAnswers,
    votes: mapTargetVotesByUid(session.votes || {}),
    roundScored: Boolean(session.roundScored),
    matchScores: scoresToRemote(session.matchScores || {}),
    lastRound: session.lastRound
      ? {
          ...session.lastRound,
          deltas: scoresToRemote(session.lastRound.deltas || {}),
          counts: scoresToRemote(session.lastRound.counts || {}),
        }
      : null,
  };
}

export function wrongAnswerFromRemote(remote) {
  if (!remote) return null;
  const answers = {};
  Object.entries(remote.answers || {}).forEach(([uid, val]) => {
    if (!val) return;
    const name = nameForUserId(uid) || uid;
    answers[name] = {
      text: typeof val.text === "string" ? val.text : "",
      at: typeof val.at === "number" ? val.at : null,
    };
  });
  const votes = {};
  Object.entries(remote.votes || {}).forEach(([voterUid, targetUid]) => {
    if (targetUid == null) return;
    const voter = nameForUserId(voterUid) || voterUid;
    votes[voter] = nameForUserId(targetUid) || targetUid;
  });
  return {
    ready: mapReadyByName(remote.ready || {}),
    lobbyStarted: Boolean(remote.lobbyStarted),
    roundCount: remote.roundCount ?? 5,
    deck: remote.deck || null,
    roundIdx: remote.roundIdx ?? 0,
    phase: remote.phase || null,
    currentPrompt: remote.currentPrompt || null,
    roundStartAt: remote.roundStartAt || null,
    answers,
    votes,
    roundScored: Boolean(remote.roundScored),
    matchScores: scoresFromRemote(remote.matchScores || {}),
    lastRound: remote.lastRound
      ? {
          ...remote.lastRound,
          deltas: scoresFromRemote(remote.lastRound.deltas || {}),
          counts: scoresFromRemote(remote.lastRound.counts || {}),
        }
      : null,
  };
}

function sanitizeTraitreMergeInc(curTr, incTr) {
  if (!incTr || curTr?.impostorRevealed || incTr.impostorRevealed) return incTr;
  const cleaned = { ...incTr };
  delete cleaned.rolesByUid;
  delete cleaned.impostorName;
  delete cleaned.impostorUid;
  delete cleaned.isLocalImpostor;
  return cleaned;
}

export function traitreToRemote(session) {
  const remoteVotes = mapTargetVotesByUid(session.votes || {});
  const dealAcks = mapValuesByUid(session.dealAcks || {}, (val) => (val ? true : null));
  const revealed = Boolean(session.impostorRevealed);
  const remote = {
    ready: mapReadyByUid(session.ready || {}),
    lobbyStarted: Boolean(session.lobbyStarted),
    phase: session.phase || null,
    pairId: session.pairId || null,
    speakRound: session.speakRound ?? 1,
    speakerIndex: session.speakerIndex ?? 0,
    alive: [...(session.alive || [])],
    eliminated: [...(session.eliminated || [])],
    votes: remoteVotes,
    revotePending: Boolean(session.revotePending),
    revoteCount: session.revoteCount ?? 0,
    tieAfterVote: Boolean(session.tieAfterVote),
    voteSurvivals: session.voteSurvivals ?? 0,
    dealAcks,
    lastVoteSnapshot: session.lastVoteSnapshot
      ? mapTargetVotesByUid(session.lastVoteSnapshot)
      : null,
    lastEliminated: session.lastEliminated || null,
    intuitionAwards: { ...(session.intuitionAwards || {}) },
    impostorRevealed: revealed,
    winner: session.winner || null,
    scoresApplied: Boolean(session.scoresApplied),
    lastRound: session.lastRound || null,
  };
  if (revealed && session.impostorName) {
    remote.impostorName = session.impostorName;
    remote.impostorUid = playerKeyToRemoteUid(session.impostorName);
  }
  return remote;
}

export function traitreFromRemote(remote) {
  if (!remote) return null;
  const alive = [...(remote.alive || [])];
  const votes = {};
  Object.entries(remote.votes || {}).forEach(([voterUid, targetUid]) => {
    const voter = nameForUserId(voterUid) || voterUid;
    const target = nameForUserId(targetUid) || targetUid;
    votes[voter] = target;
  });
  const dealAcks = {};
  Object.entries(remote.dealAcks || {}).forEach(([uid, val]) => {
    const name = nameForUserId(uid) || uid;
    if (val) dealAcks[name] = true;
  });
  const revealed = Boolean(remote.impostorRevealed);
  const impostorName = revealed
    ? nameForUserId(remote.impostorUid) || remote.impostorName || null
    : null;
  let lastVoteSnapshot = null;
  if (remote.lastVoteSnapshot) {
    lastVoteSnapshot = {};
    Object.entries(remote.lastVoteSnapshot).forEach(([voterUid, targetUid]) => {
      const voter = nameForUserId(voterUid) || voterUid;
      const target = nameForUserId(targetUid) || targetUid;
      lastVoteSnapshot[voter] = target;
    });
  }
  return {
    ready: mapReadyByName(remote.ready || {}),
    lobbyStarted: Boolean(remote.lobbyStarted),
    phase: remote.phase || null,
    pairId: remote.pairId || null,
    isLocalImpostor: false,
    impostorName,
    speakRound: remote.speakRound ?? 1,
    speakerIndex: remote.speakerIndex ?? 0,
    alive,
    eliminated: [...(remote.eliminated || [])],
    votes: normalizeTraitreVotesMap(votes, alive),
    revotePending: Boolean(remote.revotePending),
    revoteCount: remote.revoteCount ?? 0,
    tieAfterVote: Boolean(remote.tieAfterVote),
    voteSurvivals: remote.voteSurvivals ?? 0,
    dealAcks,
    lastVoteSnapshot: lastVoteSnapshot
      ? normalizeTraitreVotesMap(lastVoteSnapshot, alive)
      : null,
    lastEliminated: remote.lastEliminated || null,
    intuitionAwards: { ...(remote.intuitionAwards || {}) },
    impostorRevealed: Boolean(remote.impostorRevealed),
    winner: remote.winner || null,
    scoresApplied: Boolean(remote.scoresApplied),
    lastRound: remote.lastRound || null,
  };
}

function isNewPlaylistGuessVoteRound(cur, inc) {
  if (!inc) return false;
  if (
    inc.phase === "voting" &&
    inc.roundIdx != null &&
    cur?.roundIdx != null &&
    inc.roundIdx !== cur.roundIdx
  ) {
    return true;
  }
  return (
    inc.phase === "voting" &&
    inc.voteEndsAt &&
    inc.voteEndsAt !== cur?.voteEndsAt &&
    Object.keys(inc.votes || {}).length === 0
  );
}

function mergeRemotePlaylistGuessVotesUid(cur, inc) {
  const curVotes = cur?.votes || {};
  const incVotes = inc?.votes || {};
  if (isNewPlaylistGuessVoteRound(cur, inc)) return incVotes;
  if (
    (inc?.phase === "voting" && cur?.phase === "voting") ||
    inc?.phase === "reveal" ||
    cur?.phase === "reveal"
  ) {
    return { ...curVotes, ...incVotes };
  }
  return incVotes;
}

function mergePlaylistGuessGameLocal(local, remote) {
  if (!remote) return local;
  if (!local) return remote;
  const newVoteRound = isNewPlaylistGuessVoteRound(local, remote);
  const remoteVotes = remote.votes || {};
  const localVotes = local.votes || {};
  let votes = remoteVotes;
  if (newVoteRound) {
    votes = remoteVotes;
  } else if (remote.phase === "voting" || local.phase === "voting") {
    votes = { ...remoteVotes, ...localVotes };
  } else if (remote.phase === "reveal" || local.phase === "reveal") {
    votes = { ...remoteVotes, ...localVotes };
  }
  const ready =
    !remote.lobbyStarted && !local.lobbyStarted
      ? mergeReadyMapsLocal(local.ready || {}, remote.ready || {}, getActivePlayerNames(), getLocalDisplayName())
      : remote.ready || {};
  let roundScored = mergeRoundFlag(local.roundScored, remote.roundScored, newVoteRound);
  if (remote.phase === "voting" && newVoteRound) {
    roundScored = Boolean(remote.roundScored);
  } else if (remote.phase === "voting" && Object.keys(remoteVotes).length === 0) {
    roundScored = false;
  }
  return {
    ...local,
    ...remote,
    phase: newVoteRound
      ? (remote.phase ?? local.phase)
      : mergeForwardGamePhase(local.phase, remote.phase),
    votes,
    ready,
    roundScored,
  };
}

export function playlistGuessToRemote(session) {
  // Votes keyed by voter uid (durable, avoids name collisions)
  const remoteVotes = { ...(session.votes || {}) };
  return {
    // Ready is keyed by userId already (durable, avoids name collisions)
    ready: session.ready || {},
    lobbyStarted: Boolean(session.lobbyStarted),
    roundCount: session.roundCount ?? 5,
    deck: session.deck ? dehydratePlaylistGuessDeck(session.deck) : null,
    roundIdx: session.roundIdx ?? 0,
    phase: session.phase || null,
    votes: remoteVotes,
    voteEndsAt: session.voteEndsAt || null,
    roundScored: Boolean(session.roundScored),
  };
}

export function playlistGuessFromRemote(remote) {
  if (!remote) return null;
  // Votes remain keyed by voter uid
  const votes = { ...(remote.votes || {}) };
  return {
    // Ready map remains keyed by userId (no lossy name mapping)
    ready: { ...(remote.ready || {}) },
    lobbyStarted: Boolean(remote.lobbyStarted),
    roundCount: remote.roundCount ?? 5,
    deck: remote.deck ? rehydratePlaylistGuessDeck(remote.deck) : null,
    roundIdx: remote.roundIdx ?? 0,
    phase: remote.phase || null,
    votes,
    voteEndsAt: remote.voteEndsAt || null,
    roundScored: Boolean(remote.roundScored),
  };
}

export function guessLieToRemote(gl) {
  return {
    sessionId: gl.sessionId,
    submissions: mapSubmissionsByUid(gl.submissions || {}),
    lobbyComplete: Boolean(gl.lobbyComplete),
    roundIdx: gl.roundIdx ?? 0,
    phase: gl.phase || null,
    votes: mapVotesByUid(gl.votes || {}),
    roundScored: Boolean(gl.roundScored),
    statsRecordedRoundIdx: gl.statsRecordedRoundIdx ?? -1,
  };
}

export function guessLieFromRemote(remote) {
  if (!remote) return null;
  return {
    sessionId: remote.sessionId ?? getState().lobbyCode ?? null,
    submissions: mapSubmissionsByName(remote.submissions || {}),
    lobbyComplete: Boolean(remote.lobbyComplete),
    currentRound: remote.roundIdx ?? 0,
    roundIdx: remote.roundIdx ?? 0,
    phase: remote.phase || null,
    votes: mapVotesByName(remote.votes || {}),
    roundScored: Boolean(remote.roundScored),
    statsRecordedRoundIdx: remote.statsRecordedRoundIdx ?? -1,
  };
}

export function tierNightToRemote({
  runId,
  topicId,
  game,
  placements,
  finished,
  mode,
  modifier,
  lobbyStarted,
}) {
  return {
    runId: runId || null,
    topicId: topicId || null,
    mode: mode || "consensus",
    modifier: modifier || "normal",
    lobbyStarted: Boolean(lobbyStarted),
    game: game ?? (lobbyStarted ? true : null),
    placements: mapPlacementsByUid(placements || {}),
    finished: finished || {},
    recap: null,
  };
}

export function tierNightFromRemote(remote) {
  if (!remote) return null;
  return remote;
}

/** Récap Tier Night partagé (hôte → invités via game_sessions.state.tierNight.recap). */
export function tierNightRecapToRemote(session) {
  if (!session?.recaps?.length || !tierNightRecapHasPlacements(session)) return null;
  return {
    runId: session.runId ?? null,
    topicId: session.topicId ?? null,
    listName: session.listName ?? "",
    recaps: session.recaps.map((r) => ({
      player: r.player,
      emoji: r.emoji,
      color: r.color,
      placed: r.placed || {},
      consensusPoints: r.consensusPoints ?? 0,
      outsiderBonus: r.outsiderBonus ?? 0,
    })),
    consensus: session.consensus || null,
    controversialItem: session.controversialItem ?? null,
    controversialSpread: session.controversialSpread ?? 0,
    scoresApplied: Boolean(session.scoresApplied),
  };
}

function tierNightRecapHasPlacements(recapLike = {}) {
  return (recapLike.recaps || []).some(
    (r) => tierNightPlacedItemsCount(r.placed || {}) > 0
  );
}

export function applyTierNightRecapFromRemote(recap) {
  if (!recap?.recaps?.length) return false;
  const localName = getLocalDisplayName();
  const localPts =
    recap.recaps.find((r) => r.player === localName)?.consensusPoints ?? 0;
  saveStatePatch({
    tierNightGame: {
      ...getTierNightSession(),
      ...recap,
      localConsensusPoints: localPts,
      recapSynced: true,
    },
  });
  return true;
}

/* ----- Tier Night « En direct » (mode live temps réel) ----- */

export function tierNightLiveToRemote(session) {
  return {
    runId: session.runId || null,
    lobbyStarted: Boolean(session.lobbyStarted),
    topicId: session.topicId || null,
    listName: session.listName || "",
    deck: session.deck || null,
    roundIdx: session.roundIdx ?? 0,
    phase: session.phase || null,
    votes: mapVotesByUid(session.votes || {}),
    placements: mapPlacementsByUid(session.placements || {}),
    finished: Boolean(session.finished),
  };
}

export function tierNightLiveFromRemote(remote) {
  if (!remote) return null;
  const votes = {};
  Object.entries(remote.votes || {}).forEach(([uid, tier]) => {
    votes[nameForUserId(uid) || uid] = tier;
  });
  return {
    runId: remote.runId || null,
    lobbyStarted: Boolean(remote.lobbyStarted),
    topicId: remote.topicId || null,
    listName: remote.listName || "",
    deck: remote.deck || null,
    roundIdx: remote.roundIdx ?? 0,
    phase: remote.phase || null,
    votes,
    placements: mapPlacementsByName(remote.placements || {}),
    finished: Boolean(remote.finished),
  };
}

/** Merge additif des votes (reset uniquement sur nouvelle manche). */
function mergeRemoteTierNightLiveVotesUid(cur, inc) {
  if (isNewSpeedVoteVoteRound(cur, inc)) return inc?.votes || {};
  return { ...(cur?.votes || {}), ...(inc?.votes || {}) };
}

function mergeTierNightLiveGameLocal(local, remote) {
  if (!remote) return local;
  if (!local) return remote;
  const newRound = isNewSpeedVoteVoteRound(local, remote);
  const votes = newRound
    ? remote.votes || {}
    : { ...(remote.votes || {}), ...(local.votes || {}) };
  const remotePlacements = remote.placements || {};
  const remoteHasPlacements = Object.keys(remotePlacements).length > 0;
  const isRemoteReset =
    (!remote.lobbyStarted && remote.finished) ||
    (remote.lobbyStarted &&
      !remote.finished &&
      remote.phase === "voting" &&
      (remote.roundIdx ?? 0) === 0 &&
      !remoteHasPlacements);
  return {
    ...local,
    ...remote,
    phase: mergeSpeedVotePhase(local, remote),
    votes: normalizePlayerVotesMap(votes),
    placements: isRemoteReset
      ? remotePlacements
      : remoteHasPlacements
        ? { ...(local.placements || {}), ...remotePlacements }
        : local.placements || {},
  };
}

export function scoresToRemote(scoresByName = {}) {
  const out = {};
  Object.entries(scoresByName).forEach(([name, val]) => {
    const uid = playerKeyToRemoteUid(name);
    if (!uid) return;
    if (typeof val === "number" && Number.isFinite(val)) out[uid] = val;
  });
  return out;
}

function scoresFromRemote(remote = {}) {
  const out = {};
  Object.entries(remote).forEach(([uid, val]) => {
    const name = playerKeyToDisplayName(uid);
    if (!name || typeof val !== "number" || !Number.isFinite(val)) return;
    const prev = out[name];
    out[name] = prev == null ? val : Math.max(prev, val);
  });
  return out;
}

export { playerStatsToRemote, applyRemotePlayerStats } from "./playerStatsSync.js";

/** Fusion des matchScores côté blob session (clés uid). */
function mergeRemoteMatchScoresUid(cur = {}, inc = {}) {
  const merged = { ...cur };
  Object.entries(inc).forEach(([uid, val]) => {
    if (typeof val !== "number" || !Number.isFinite(val)) return;
    merged[uid] = Math.max(merged[uid] || 0, val);
  });
  return merged;
}

function gameScoresToRemote(byGame = {}) {
  const out = {};
  Object.entries(byGame).forEach(([gid, scoresByName]) => {
    out[gid] = scoresToRemote(scoresByName || {});
  });
  return out;
}

function gameScoresFromRemote(remote = {}) {
  const out = {};
  Object.entries(remote).forEach(([gid, scoresByUid]) => {
    out[gid] = scoresFromRemote(scoresByUid || {});
  });
  return out;
}

function applyRemoteGameScores(remote, order) {
  if (!remote || typeof remote !== "object") return;
  const byGame = gameScoresFromRemote(remote);
  const current = getState().gameScores || {};
  const merged = { ...current };
  Object.entries(byGame).forEach(([gid, scoresByName]) => {
    const prev = { ...(merged[gid] || {}) };
    Object.entries(scoresByName).forEach(([name, pts]) => {
      prev[name] = Math.max(prev[name] || 0, pts);
    });
    merged[gid] = prev;
  });
  const patch = { gameScores: merged };
  if (Array.isArray(order) && order.length) patch.gameScoreOrder = order;
  saveStatePatch(patch);
}

export function applyRemoteLobbyScores(remote) {
  if (!remote || typeof remote !== "object") return;
  const byName = scoresFromRemote(remote);
  if (!Object.keys(byName).length) return;

  const merged = { ...getState().scores };
  getLobbyParticipants().forEach((p) => {
    if (byName[p.name] != null) {
      merged[p.name] = Math.max(merged[p.name] || 0, byName[p.name]);
    }
  });
  Object.entries(byName).forEach(([name, pts]) => {
    merged[name] = Math.max(merged[name] || 0, pts);
  });
  saveStatePatch({ scores: merged });
}

function applyRemoteFilRougeScores(remote) {
  if (!remote || typeof remote !== "object") return;
  const byName = scoresFromRemote(remote);
  if (!Object.keys(byName).length) return;

  const merged = { ...getState().filRougeScores };
  getLobbyParticipants().forEach((p) => {
    if (byName[p.name] != null) merged[p.name] = byName[p.name];
  });
  Object.entries(byName).forEach(([name, pts]) => {
    merged[name] = pts;
  });
  saveStatePatch({ filRougeScores: merged });
}

function eveningStateToRemote() {
  const {
    stats,
    lastGame,
    tierNightGame,
    gameScoreSessionBaseline,
    gameScoreSessionGameId,
    eveningGamesRecorded,
  } = getState();
  const remote = {
    scores: scoresToRemote(getState().scores),
    playerStats: playerStatsToRemote(getState().playerStats || {}, (name) => playerKeyToRemoteUid(name)),
    gameScores: gameScoresToRemote(getState().gameScores || {}),
    gameScoreOrder: [...(getState().gameScoreOrder || [])],
    gameScoreSessionBaseline: scoresToRemote(gameScoreSessionBaseline || {}),
    gameScoreSessionGameId: gameScoreSessionGameId || null,
    eveningGamesRecorded: normalizeEveningGamesRecorded(eveningGamesRecorded || {}),
    stats: {
      hotTakesPlayed: stats.hotTakesPlayed || 0,
      speedVotesPlayed: stats.speedVotesPlayed || 0,
      clutchesPlayed: stats.clutchesPlayed || 0,
      wrongAnswersPlayed: stats.wrongAnswersPlayed || 0,
      playlistGuessesPlayed: stats.playlistGuessesPlayed || 0,
      triviaGamesPlayed: stats.triviaGamesPlayed || 0,
      truthMetersPlayed: stats.truthMetersPlayed || 0,
      consensusGamesPlayed: stats.consensusGamesPlayed || 0,
      dilemmasPlayed: stats.dilemmasPlayed || 0,
      traitreGamesPlayed: stats.traitreGamesPlayed || 0,
      guessLieGamesPlayed: stats.guessLieGamesPlayed || 0,
      liesFound: stats.liesFound || 0,
      liesTotal: stats.liesTotal || 0,
      tierNightsPlayed: stats.tierNightsPlayed || 0,
    },
    lastGame: lastGame ? { ...lastGame } : null,
    lastTierName: tierNightGame?.listName || null,
  };
  if (FIL_ROUGE_ENABLED) {
    remote.filRougeScores = scoresToRemote(getState().filRougeScores || {});
  }
  return remote;
}

export function applyRemoteEveningState(st) {
  if (!st || typeof st !== "object") return;
  const patch = {};

  if (st.stats && typeof st.stats === "object") {
    patch.stats = mergeEveningStats(getState().stats, st.stats);
  }
  if (st.lastGame !== undefined) {
    patch.lastGame = mergeLastGameRecord(getState().lastGame, st.lastGame);
  }
  if (st.eveningGamesRecorded && typeof st.eveningGamesRecorded === "object") {
    patch.eveningGamesRecorded = mergeEveningGamesRecorded(
      getState().eveningGamesRecorded,
      st.eveningGamesRecorded
    );
  }
  if (st.lastTierName && getState().tierNightGame) {
    patch.tierNightGame = { ...getState().tierNightGame, listName: st.lastTierName };
  } else if (st.lastTierName) {
    patch.tierNightGame = { listName: st.lastTierName };
  }

  if (Object.keys(patch).length) saveStatePatch(patch);
  if (st.scores) applyRemoteLobbyScores(st.scores);
  if (st.playerStats) applyRemotePlayerStats(st.playerStats, (uid) => playerKeyToDisplayName(uid));
  if (FIL_ROUGE_ENABLED && st.filRougeScores) applyRemoteFilRougeScores(st.filRougeScores);
  if (st.gameScores) applyRemoteGameScores(st.gameScores, st.gameScoreOrder);
  if (st.gameScoreSessionGameId !== undefined || st.gameScoreSessionBaseline) {
    const baselinePatch = {};
    if (st.gameScoreSessionGameId !== undefined) {
      baselinePatch.gameScoreSessionGameId = st.gameScoreSessionGameId;
    }
    if (st.gameScoreSessionBaseline) {
      const byName = scoresFromRemote(st.gameScoreSessionBaseline);
      const merged = { ...getState().gameScoreSessionBaseline };
      getLobbyParticipants().forEach((p) => {
        if (byName[p.name] != null) merged[p.name] = byName[p.name];
      });
      Object.assign(merged, byName);
      baselinePatch.gameScoreSessionBaseline = merged;
    }
    if (Object.keys(baselinePatch).length) saveStatePatch(baselinePatch);
  }
}

/** Hôte : pousse scores + stats de soirée vers game_sessions.state */
export async function syncLobbyScores() {
  if (!isGameSyncActive() || !isLobbyHost()) return;
  await patchGameState(eveningStateToRemote());
}

/** Recharge le classement depuis la session multijoueur (résultats / leaderboard). */
export async function refreshEveningScoresFromSession() {
  if (!isGameSyncActive()) return null;
  const row = await refreshGameSession();
  if (row?.state?.scores) applyRemoteLobbyScores(row.state.scores);
  if (row?.state?.playerStats) {
    applyRemotePlayerStats(row.state.playerStats, (uid) => playerKeyToDisplayName(uid));
  }
  return row;
}

let confirmingMissingSession = false;

/**
 * Une session "nulle" (event DELETE Realtime, fetch raté) peut être transitoire :
 * avant d'éjecter un invité (retour lobby + suppression du routage), on reconfirme
 * par un fetch direct. Si la session existe toujours, on l'applique (le routage suit
 * alors l'hôte normalement) au lieu de sortir le joueur de la partie par erreur.
 */
async function confirmMissingSessionThenRoute() {
  if (confirmingMissingSession) return;
  confirmingMissingSession = true;
  try {
    const lobbyId = getState().lobby?.id;
    if (!lobbyId || !isGameSyncActive()) return;

    let confirmedRow = null;
    try {
      confirmedRow = await fetchGameSessionByLobby(lobbyId);
    } catch {
      // Échec réseau ponctuel : on ne tranche pas (pas d'éjection sur un simple raté).
      return;
    }

    if (confirmedRow) {
      applyRemoteSession(confirmedRow);
      return;
    }

    if (!isGameSyncActive()) return;
    const current = getCurrentScreen();
    if (isOnPostGameScreen(current)) {
      // Toujours mémoriser un écran de référence : un timer sans baseline laisse
      // isBrowsingScoresWithRouteSuppress actif tout en cassant isSessionAdvancedFromSuppress.
      suppressSessionRoute(120000, current || "results");
      return;
    }
    if (isActiveGameSessionScreen(current) || isOnGameSetupScreen(current)) {
      suppressSessionRoute(120000, current);
      // Soirée toujours lancée (l'hôte est juste revenu au menu des jeux) : on suit vers le
      // hub plutôt que de renvoyer l'invité sur le lobby d'attente (clignotement + reset prêt).
      if (isLobbyEveningStarted()) {
        routeToSessionScreen("game-select", { force: true });
      } else {
        const { goToLobby } = await import("./lobby.js");
        goToLobby();
      }
    }
  } finally {
    confirmingMissingSession = false;
  }
}

export function applyRemoteSession(row) {
  if (isOlderSessionRow(row)) {
    return;
  }

  const prevScreen = cachedRow?.screen ?? null;
  const prevGuessLie = getState().guessLie;
  const sig = sessionSignature(row);
  const sigUnchanged = sig === lastSessionSig;
  if (!sigUnchanged) lastSessionSig = sig;

  if (row?.updated_at) lastSessionUpdatedAt = row.updated_at;

  cachedRow = row;

  if (!row?.state) {
    if (!sigUnchanged) {
      notify(row);
    }
    if (!row && isGameSyncActive()) {
      void confirmMissingSessionThenRoute();
    }
    return;
  }

  const patch = {};
  const prevPgPhase = getState().playlistGuessGame?.phase ?? null;
  const prevDmPhase = getState().dilemmaGame?.phase ?? null;
  const prevDmRoundIdx = getState().dilemmaGame?.roundIdx ?? null;
  const prevWaPhase = getState().wrongAnswerGame?.phase ?? null;
  const prevWaRoundIdx = getState().wrongAnswerGame?.roundIdx ?? null;
  const prevWaAnswers = JSON.stringify(getState().wrongAnswerGame?.answers || {});
  const prevWaVotes = JSON.stringify(getState().wrongAnswerGame?.votes || {});
  const prevDmVotes = JSON.stringify(getState().dilemmaGame?.votes || {});
  const prevHtPhase = getState().hotTakeGame?.phase ?? null;
  const prevHtTakeIdx = getState().hotTakeGame?.takeIdx ?? null;
  const prevHtVotes = JSON.stringify(getState().hotTakeGame?.votes || {});
  const prevSvVotes = JSON.stringify(getState().speedVoteGame?.votes || {});
  const prevTmVotes = JSON.stringify(getState().truthMeterGame?.votes || {});
  const prevTierNightRunId = getState().tierNightGame?.runId ?? null;
  const prevTierNightRecaps = JSON.stringify(getState().tierNightGame?.recaps || []);
  const prevTierNightLiveRunId = getState().tierNightLiveGame?.runId ?? null;
  const prevTierNightLivePhase = getState().tierNightLiveGame?.phase ?? null;
  const st = { ...(row.state || {}) };
  if (!FIL_ROUGE_ENABLED) {
    delete st.filRouge;
  }

  if (st.hotTake) {
    const remote = hotTakeFromRemote(st.hotTake);
    const local = getState().hotTakeGame;
    patch.hotTakeGame = local ? mergeHotTakeGameLocal(local, remote) : remote;
  }
  if (st.speedVote) {
    const remote = speedVoteFromRemote(st.speedVote);
    const local = getState().speedVoteGame;
    patch.speedVoteGame = local ? mergeSpeedVoteGameLocal(local, remote) : remote;
  }
  if (st.clutch) {
    const remote = clutchFromRemote(st.clutch);
    const local = getState().clutchGame;
    patch.clutchGame = local ? mergeClutchGameLocal(local, remote) : remote;
  }
  if (st.wrongAnswer) {
    const remote = wrongAnswerFromRemote(st.wrongAnswer);
    const local = getState().wrongAnswerGame;
    patch.wrongAnswerGame = local ? mergeWrongAnswerGameLocal(local, remote) : remote;
  }
  if (st.traitre) {
    const remote = traitreFromRemote(st.traitre);
    const local = getState().traitreGame;
    patch.traitreGame = local ? mergeTraitreGameLocal(local, remote) : remote;
    if (st.traitre.pairId && st.traitre.lobbyStarted) {
      void import("./traitrePrivate.js").then(({ syncTraitrePrivateRole }) =>
        syncTraitrePrivateRole(st.traitre.pairId, {
          maxAttempts: 8,
          delayMs: 500,
          notify: () => notify(row),
        })
      );
    }
  }
  if (st.trivia) {
    const remote = triviaFromRemote(st.trivia);
    const local = getState().triviaGame;
    patch.triviaGame = local ? mergeTriviaGameLocal(local, remote) : remote;
  }
  if (st.truthMeter) {
    const remote = truthMeterFromRemote(st.truthMeter);
    const local = getState().truthMeterGame;
    patch.truthMeterGame = local ? mergeTruthMeterGameLocal(local, remote) : remote;
  }
  if (st.consensus) {
    const remote = consensusFromRemote(st.consensus);
    const local = getState().consensusGame;
    patch.consensusGame = local ? mergeConsensusGameLocal(local, remote) : remote;
  }
  if (st.dilemma) {
    const remote = dilemmaFromRemote(st.dilemma);
    const local = getState().dilemmaGame;
    patch.dilemmaGame = local ? mergeDilemmaGameLocal(local, remote) : remote;
  }
  if (st.guessLie) {
    const remote = guessLieFromRemote(st.guessLie);
    const local = getState().guessLie;
    patch.guessLie = local ? mergeGuessLieGameLocal(local, remote) : remote;
  }
  if (st.playlistGuess) {
    const remote = playlistGuessFromRemote(st.playlistGuess);
    const local = getState().playlistGuessGame;
    patch.playlistGuessGame = local ? mergePlaylistGuessGameLocal(local, remote) : remote;
  }
  Object.assign(patch, tierNightConfigPatchFromRemoteState(st));

  if (st.tierNight) {
    const tn = tierNightFromRemote(st.tierNight);
    const localRunId = getState().tierNightGame?.runId || null;
    const remoteRunId = tn.runId || null;
    const recapRunId = tn.recap?.runId || null;
    const recapMatchesRun =
      !remoteRunId || !recapRunId || remoteRunId === recapRunId;
    const recapMatchesLocal =
      !localRunId || !recapRunId || localRunId === recapRunId;
    if (
      tn.recap?.recaps?.length &&
      !tn.lobbyStarted &&
      recapMatchesRun &&
      recapMatchesLocal
    ) {
      const localName = getLocalDisplayName();
      const localPts =
        tn.recap.recaps.find((r) => r.player === localName)?.consensusPoints ?? 0;
      patch.tierNightGame = {
        ...getState().tierNightGame,
        ...tn.recap,
        localConsensusPoints: localPts,
        recapSynced: true,
      };
    } else if (tn.game) {
      patch.tierNightGame = { ...getState().tierNightGame, ...tn.game };
    }
  }
  if (st.tierNightLive) {
    const remote = tierNightLiveFromRemote(st.tierNightLive);
    const local = getState().tierNightLiveGame;
    patch.tierNightLiveGame = local
      ? mergeTierNightLiveGameLocal(local, remote)
      : remote;
  }
  if (FIL_ROUGE_ENABLED && st.filRouge) {
    const remote = filRougeFromRemote(st.filRouge);
    const local = getState().filRougeGame;
    patch.filRougeGame = local ? mergeFilRougeLocal(local, remote) : remote;
  }

  const pgPhaseChanged =
    patch.playlistGuessGame?.phase != null &&
    patch.playlistGuessGame.phase !== prevPgPhase;

  const guessLiePlayChanged =
    patch.guessLie &&
    (Boolean(patch.guessLie.lobbyComplete) !== Boolean(prevGuessLie?.lobbyComplete) ||
      (patch.guessLie.phase ?? null) !== (prevGuessLie?.phase ?? null) ||
      JSON.stringify(patch.guessLie.votes || {}) !==
        JSON.stringify(prevGuessLie?.votes || {}));

  const dilemmaPlayChanged =
    patch.dilemmaGame &&
    ((patch.dilemmaGame.phase ?? null) !== prevDmPhase ||
      (patch.dilemmaGame.roundIdx ?? null) !== prevDmRoundIdx ||
      JSON.stringify(patch.dilemmaGame.votes || {}) !== prevDmVotes);

  const hotTakePlayChanged =
    patch.hotTakeGame &&
    ((patch.hotTakeGame.phase ?? null) !== prevHtPhase ||
      (patch.hotTakeGame.takeIdx ?? null) !== prevHtTakeIdx ||
      JSON.stringify(patch.hotTakeGame.votes || {}) !== prevHtVotes);

  const speedVotePlayChanged =
    patch.speedVoteGame &&
    ((patch.speedVoteGame.phase ?? null) !== (getState().speedVoteGame?.phase ?? null) ||
      (patch.speedVoteGame.roundIdx ?? null) !== (getState().speedVoteGame?.roundIdx ?? null) ||
      JSON.stringify(patch.speedVoteGame.votes || {}) !== prevSvVotes);

  const truthMeterPlayChanged =
    patch.truthMeterGame &&
    ((patch.truthMeterGame.phase ?? null) !== (getState().truthMeterGame?.phase ?? null) ||
      (patch.truthMeterGame.roundIdx ?? null) !== (getState().truthMeterGame?.roundIdx ?? null) ||
      JSON.stringify(patch.truthMeterGame.votes || {}) !== prevTmVotes);

  const wrongAnswerPlayChanged =
    patch.wrongAnswerGame &&
    ((patch.wrongAnswerGame.phase ?? null) !== prevWaPhase ||
      (patch.wrongAnswerGame.roundIdx ?? null) !== prevWaRoundIdx ||
      JSON.stringify(patch.wrongAnswerGame.answers || {}) !== prevWaAnswers ||
      JSON.stringify(patch.wrongAnswerGame.votes || {}) !== prevWaVotes);

  const tierNightPlayChanged =
    patch.tierNightGame &&
    ((patch.tierNightGame.runId ?? null) !== prevTierNightRunId ||
      JSON.stringify(patch.tierNightGame.recaps || []) !== prevTierNightRecaps);

  const tierNightLivePlayChanged =
    patch.tierNightLiveGame &&
    ((patch.tierNightLiveGame.runId ?? null) !== prevTierNightLiveRunId ||
      (patch.tierNightLiveGame.phase ?? null) !== prevTierNightLivePhase);

  const playChanged = Boolean(
    pgPhaseChanged ||
      guessLiePlayChanged ||
      dilemmaPlayChanged ||
      hotTakePlayChanged ||
      speedVotePlayChanged ||
      truthMeterPlayChanged ||
      wrongAnswerPlayChanged ||
      tierNightPlayChanged ||
      tierNightLivePlayChanged
  );

  // Signature distante inchangée (souvent un simple touch `updated_at` sans modif de
  // `state`) et aucune transition locale en retard : l'état local reflète déjà le
  // distant. On évite alors la réécriture localStorage (JSON.stringify de tout le state)
  // qui, multipliée par chaque push/poll, était un coût CPU inutile.
  if (Object.keys(patch).length && (!sigUnchanged || playChanged)) saveStatePatch(patch);

  applyRemoteEveningState(st);
  syncLastGameFromSessionRow(row);

  if (sigUnchanged && !playChanged) {
    // Session déjà observée ≠ navigation déjà réussie : retenter si mustFollow.
    const effective = getEffectiveSessionScreen(row);
    const current = getCurrentScreen();
    const mustFollow = guestMustFollowSession(effective, current);
    if (
      mustFollow &&
      shouldApplySessionRoute(row, {
        fromScreen: prevScreen,
        debugSource: "applyRemoteSession/sig_unchanged_retry",
      })
    ) {
      clearSuppressIfFollowingHost(effective, current);
      handleSessionRoute(row, {
        fromScreen: prevScreen,
        debugSource: "applyRemoteSession/sig_unchanged_handle",
      });
    }
    return;
  }

  notify(row);
  const routeAllowed = shouldApplySessionRoute(row, {
    fromScreen: prevScreen,
    debugSource: "applyRemoteSession/shouldApply",
  });
  if (routeAllowed) {
    const screen = getEffectiveSessionScreen(row);
    const cur = getCurrentScreen();
    clearSuppressIfFollowingHost(screen, cur);
    handleSessionRoute(row, { fromScreen: prevScreen, debugSource: "applyRemoteSession/handle" });
  }
}

export async function refreshGameSession() {
  const lobbyId = getState().lobby?.id;
  if (!lobbyId) return null;
  const row = await fetchGameSessionByLobby(lobbyId);
  if (row) applyRemoteSession(row);
  else {
    // Session supprimée (hôte qui quitte une prépa / partie). On passe par
    // applyRemoteSession(null) pour déclencher confirmMissingSessionThenRoute : sinon, via
    // le polling, un invité resterait bloqué sur la prépa fantôme du jeu quitté.
    applyRemoteSession(null);
    try {
      const { refreshLobbyFromSupabase } = await import("./supabaseLobby.js");
      await refreshLobbyFromSupabase();
    } catch {
      /* lobby fermé → handleLobbyDissolvedForGuest */
    }
  }
  return row;
}

function navStackFor(screen) {
  const base = ["home", "lobby", "game-select"];
  const gameScreens = new Set([
    "traitre-prep",
    "traitre",
    "hottake-prep",
    "hottake",
    "speedvote-prep",
    "speedvote",
    "playlistguess-prep",
    "playlistguess",
    "trivia-prep",
    "trivia",
    "truthmeter-prep",
    "truthmeter",
    "consensus-prep",
    "consensus",
    "guesslie-menu",
    "guesslie-setup",
    "guesslie-wait",
    "guesslie",
    "tiernight-select",
    "tiernight-create",
    "tiernight",
    "tiernight-live",
    "tiernight-end",
    "results",
  ]);
  if (gameScreens.has(screen)) return [...base, screen];
  return [...base, screen];
}

function isAppContentMounted() {
  if (typeof document === "undefined") return true;
  const app = document.getElementById("app");
  return Boolean(app?.innerHTML?.trim());
}

export { isAppContentMounted };

export function routeToSessionScreen(screen, { force = false } = {}) {
  if (!screen || routing) {
    return false;
  }
  const current = getCurrentScreen();
  if (!force && current === screen) return isAppContentMounted();

  routing = true;
  try {
    if (screen === "game-select") {
      navigate("game-select", { navStack: navStackFor("game-select") });
    } else if (screen === "lobby") {
      navigate("lobby", { navStack: ["home", "lobby"] });
    } else if (screen === "results") {
      navigate("results", { navStack: navStackFor("results") });
    } else {
      navigate(screen, { navStack: navStackFor(screen) });
    }
  } finally {
    routing = false;
  }
  return isAppContentMounted();
}

export function suppressSessionRoute(ms = 45000, screen = getCachedGameSession()?.screen ?? null) {
  suppressSessionRouteUntil = Date.now() + ms;
  // Ne jamais activer le timer avec une baseline nulle : sinon isSessionRouteSuppressed()
  // reste true alors que isSessionAdvancedFromSuppress ne peut plus décider.
  suppressSessionScreen = screen ?? getCurrentScreen() ?? "game-select";
  suppressSessionSig = sessionSignature(getCachedGameSession());
}

export function clearSessionRouteSuppress() {
  suppressSessionRouteUntil = 0;
  suppressSessionScreen = null;
  suppressSessionSig = "";
}

export function isSessionRouteSuppressed() {
  return Date.now() < suppressSessionRouteUntil;
}

/**
 * Consulter le classement / les résultats pendant une soirée en cours.
 * On suspend le routage auto vers le jeu courant (sinon le prochain tick de polling
 * renverrait l'utilisateur dans la partie au bout de quelques secondes), tout en
 * gardant la bascule automatique si l'hôte lance/avance vers un AUTRE écran.
 */
export function suppressRoutingForScoreView(ms = 15 * 60 * 1000) {
  const row = getCachedGameSession();
  const active = row ? getEffectiveSessionScreen(row) : null;
  const screenToSuppress =
    active && (isInProgressPlayScreen(active) || isOnGameSetupScreen(active))
      ? active
      : isGameSyncActive()
        ? active || row?.screen || "game-select"
        : null;
  if (!screenToSuppress) return;
  suppressSessionRoute(ms, screenToSuppress);
}

/** Partie en cours (écran de jeu, hors prep et post-partie). */
export function isSessionInProgressPlay(screen) {
  if (!screen || MENU_SCREENS.has(screen) || POST_GAME_SCREENS.has(screen)) return false;
  if (isOnGameSetupScreen(screen)) return false;
  return true;
}

function isInProgressPlayScreen(screen) {
  return isSessionInProgressPlay(screen);
}

/** Prep ou partie en cours a reprendre (pas post-partie ni menu soiree). */
export function getResumableSessionScreen(row = getCachedGameSession()) {
  if (!row || !isGameSyncActive()) return null;
  const screen = getEffectiveSessionScreen(row);
  if (!screen || isOnPostGameScreen(screen)) return null;
  if (screen === "game-select" && isLobbyEveningStarted()) return null;
  if (isOnGameSetupScreen(screen) || isSessionInProgressPlay(screen)) return screen;
  return null;
}

export function isActiveGameSessionScreen(screen) {
  if (!screen || MENU_SCREENS.has(screen)) return false;
  if (POST_GAME_SCREENS.has(screen)) return false;
  return true;
}

/** Écran réel de la partie (row.screen ou état jeu si le champ screen n’a pas été mis à jour). */
function resolveActivePlayScreen(st, gid, declared) {
  if (st.hotTake?.lobbyStarted) return "hottake";
  if (st.speedVote?.lobbyStarted) return "speedvote";
  if (st.clutch?.lobbyStarted) return "clutch";
  if (st.wrongAnswer?.lobbyStarted) return "wronganswer";
  if (st.traitre?.lobbyStarted) {
    if (declared === "game-select" && !isLobbyEveningStarted()) return "game-select";
    return "traitre";
  }
  if (st.trivia?.lobbyStarted) return "trivia";
  if (st.truthMeter?.lobbyStarted) return "truthmeter";
  if (st.consensus?.lobbyStarted) return "consensus";
  if (st.dilemma?.lobbyStarted) return "dilemma";
  if (st.playlistGuess?.lobbyStarted) return "playlistguess";

  if (st.guessLie?.lobbyComplete) return "guesslie";
  const glPhase = st.guessLie?.phase;
  if (glPhase && glPhase !== "idle" && glPhase !== "lobby") return "guesslie";
  if (st.tierNightLive?.lobbyStarted && !st.tierNightLive?.finished) return "tiernight-live";
  if (st.tierNight?.lobbyStarted) return "tiernight";
  return null;
}

export function getEffectiveSessionScreen(row) {
  if (!row) return null;
  const declared = row.screen || null;
  const st = row.state || {};
  const gid = row.game_id || null;
  const local = getCurrentScreen();

  if (
    shouldPreferTierNightEndRoute({
      state: st,
      declared,
      local,
      localHasRecap: hasLocalTierNightRecap(),
    })
  ) {
    if (canRouteToTierNightEnd(row)) return "tiernight-end";
  }

  if (declared === "tiernight-end" && !canRouteToTierNightEnd(row)) {
    const activePlay = resolveActivePlayScreen(st, gid, declared);
    return activePlay || null;
  }

  if (declared && POST_GAME_SCREENS.has(declared)) {
    const skippedActivePlay = resolveActivePlayScreen(st, gid, declared);
    const lobbyGid = getLobbyGameId();
    const lobbyPrep =
      isLobbyEveningStarted() && lobbyGid && lobbyGid !== "menu"
        ? SESSION_GAME_ID_TO_TILE[lobbyGid] || null
        : null;
    if (POST_GAME_SCREENS.has(local) || isSessionRouteSuppressed()) {
      return declared;
    }
    if (lobbyPrep) return lobbyPrep;
    return declared;
  }

  const activePlay = resolveActivePlayScreen(st, gid, declared);
  if (activePlay) return activePlay;

  if (declared && GAME_SETUP_SCREENS.has(declared)) return declared;

  if (declared && !MENU_SCREENS.has(declared) && !POST_GAME_SCREENS.has(declared)) {
    return declared;
  }

  if (declared && POST_GAME_SCREENS.has(declared)) {
    return declared;
  }

  if (declared && MENU_SCREENS.has(declared)) {
    return declared;
  }

  if (st.hotTake) {
    if (gid === "hottake" || declared === "hottake-prep") return "hottake-prep";
  }
  if (st.speedVote) {
    if (gid === "speedvote" || declared === "speedvote-prep") return "speedvote-prep";
  }
  if (st.clutch) {
    if (gid === "clutch" || declared === "clutch-prep") return "clutch-prep";
  }
  if (st.wrongAnswer) {
    if (gid === "wronganswer" || declared === "wronganswer-prep") return "wronganswer-prep";
  }
  if (st.traitre) {
    if (gid === "traitre" || declared === "traitre-prep") return "traitre-prep";
  }
  if (st.trivia) {
    if (gid === "trivia" || declared === "trivia-prep") return "trivia-prep";
  }
  if (st.truthMeter) {
    if (gid === "truthmeter" || declared === "truthmeter-prep") return "truthmeter-prep";
  }
  if (st.consensus) {
    if (gid === "consensus" || declared === "consensus-prep") return "consensus-prep";
  }
  if (st.dilemma) {
    if (gid === "dilemma" || declared === "dilemma-prep") return "dilemma-prep";
  }
  if (st.playlistGuess) {
    if (gid === "playlistguess" || declared === "playlistguess-prep") return "playlistguess-prep";
  }

  if (gid === "guesslie" || declared === "guesslie-menu") return "guesslie-menu";
  return declared;
}

/**
 * Écran Fil Rouge à restaurer au redémarrage de l'app, le cas échéant.
 * Le Fil Rouge est un jeu « de fond » : il ne doit pas être traité comme un écran de
 * partie actif dans le routage continu (sinon il volerait la vedette aux autres jeux),
 * mais à la reprise on ramène le joueur sur la config ou sa mission secrète non vue.
 * Renvoie null si rien à restaurer (mission déjà prise en compte, jeu terminé, etc.).
 */
export function getFilRougeResumeScreen() {
  if (!FIL_ROUGE_ENABLED) return null;
  const fr = getCachedGameSession()?.state?.filRouge;
  if (!fr) return null;
  if (fr.status === "setup") return "filrouge-setup";
  if (fr.status === "active") {
    const uid = getSupabaseUserId();
    const acked = uid ? getState().filRougeGame?.missionAcks?.[uid] : true;
    if (uid && !acked) return "filrouge-mission";
  }
  return null;
}

/** Renvoie l’invité (ou l’hôte) vers la partie en cours si une session active existe. */
export async function routeToActiveGameIfNeeded(cachedRowOnly = null, { force = false } = {}) {
  const source = "routeToActiveGameIfNeeded";
  if (!isGameSyncActive()) {
    return false;
  }
  const row =
    cachedRowOnly || (await refreshGameSession()) || getCachedGameSession();
  const screen = getEffectiveSessionScreen(row);
  const routeLog = (allowed, _reason, _extra = {}) => allowed;

  if (!screen) return routeLog(false, "no_effective_screen");
  const isEveningHub = screen === "game-select" && isLobbyEveningStarted();
  if (!isEveningHub && !isActiveGameSessionScreen(screen) && !isOnGameSetupScreen(screen)) {
    return routeLog(false, "effective_screen_post_game_only");
  }
  const current = getCurrentScreen();
  if (current === screen) return routeLog(isAppContentMounted(), "already_on_target_screen");
  if (
    !force &&
    isBrowsingScoresWithRouteSuppress(current) &&
    !isSessionAdvancedFromSuppress(screen)
  ) {
    return routeLog(false, "scores_suppress_blocks", {
      advancedFromSuppress: false,
      suppressScreen: suppressSessionScreen,
      suppressSig: suppressSessionSig || null,
    });
  }
  if (!force && isCompatibleSessionScreen(screen, current)) {
    return routeLog(true, "compatible_session_screen_no_nav");
  }
  if (!force && !shouldApplySessionRoute(row, { debugSource: `${source}/shouldApply` })) {
    return routeLog(false, "should_apply_session_route_false", {
      localScreenMismatch: current !== screen,
      sigMatchesLast: row ? sessionSignature(row) === lastSessionSig : null,
    });
  }
  if (
    isSessionAdvancedFromSuppress(screen) ||
    shouldFollowHostGameLaunch(current, screen)
  ) {
    clearSessionRouteSuppress();
  }
  routeLog(true, "navigate");
  return routeToSessionScreen(screen, { force: true });
}

export function handleSessionRoute(row, { fromScreen = null, debugSource = null } = {}) {
  const source = debugSource || "handleSessionRoute";
  const screen = getEffectiveSessionScreen(row);
  const decision = shouldApplySessionRoute(row, {
    fromScreen,
    debugSource: `${source}/shouldApply`,
  });
  if (!decision) {
    return;
  }
  const current = getCurrentScreen();
  clearSuppressIfFollowingHost(screen, current);
  routeToSessionScreen(screen, { force: true });
}

/** Polling de secours si Realtime ne pousse pas l’événement (fréquent en local). */
export function pulseGameSessionRealtime() {
  lastGameSessionRealtimeAt = Date.now();
  pollUnchangedStreak = 0;
  if (isActiveGameSessionScreen(getCurrentScreen())) {
    pollIntervalMs = scalePollIntervalMs(POLL_MS_ACTIVE_RELAXED);
  } else {
    pollIntervalMs = scalePollIntervalMs(POLL_MS_MIN);
  }
}

/** Pause le polling quand l’onglet est en arrière-plan (egress + batterie). */
export function initMultiplayerSyncVisibility() {
  if (syncVisibilityInit || typeof document === "undefined") return;
  syncVisibilityInit = true;
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      syncPausedByHidden = true;
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      return;
    }
    syncPausedByHidden = false;
    if (isGameSyncActive() && getState().inLobby) {
      scheduleSyncPoll();
      void syncTick();
      import("./supabaseLobby.js").then((m) => {
        // Le socket Realtime a pu être étranglé/fermé en arrière-plan : on force un
        // canal frais (le navigateur ne le recrée pas toujours seul) en plus du refresh.
        m.resubscribeLobbyRealtime?.();
        m.refreshLobbyFromSupabase?.().catch(() => {});
      });
    }
  });
}

function isRecentGameSessionRealtime() {
  return Date.now() - lastGameSessionRealtimeAt < REALTIME_RECENT_MS;
}

const EVENING_STATE_KEYS = new Set([
  "scores",
  "playerStats",
  "filRougeScores",
  "gameScores",
  "gameScoreOrder",
  "gameScoreSessionBaseline",
  "gameScoreSessionGameId",
  "eveningGamesRecorded",
  "stats",
  "lastGame",
  "lastTierName",
]);

const GAME_PLAY_STATE_KEYS = new Set([
  "hotTake",
  "speedVote",
  "clutch",
  "wrongAnswer",
  "traitre",
  "trivia",
  "truthMeter",
  "consensus",
  "dilemma",
  "guessLie",
  "playlistGuess",
  "tierNight",
  "tierNightLive",
]);

function isEveningScoresOnlyMerge(stateMerge) {
  if (!stateMerge || typeof stateMerge !== "object") return false;
  const keys = Object.keys(stateMerge);
  if (!keys.length) return false;
  return keys.every((k) => EVENING_STATE_KEYS.has(k));
}

/** Patch concurrent (votes / réponses) : toujours relire le blob serveur avant merge. */
function isLateGamePatchAfterPostGame(row, stateMerge = {}) {
  if (!row || !POST_GAME_SCREENS.has(row.screen)) return false;
  return Object.keys(stateMerge || {}).some((key) => GAME_PLAY_STATE_KEYS.has(key));
}

function isStaleTierNightEndPatch(row, stateMerge = {}, screen = null) {
  if (screen !== "tiernight-end") return false;
  const incoming = stateMerge?.tierNight;
  if (!incoming || typeof incoming !== "object") return false;
  const currentRunId = row?.state?.tierNight?.runId || null;
  if (!currentRunId) return false;
  return (incoming.runId || null) !== currentRunId;
}

function patchNeedsFreshSessionRow(mergePayload = {}) {
  for (const inc of Object.values(mergePayload)) {
    if (!inc || typeof inc !== "object") continue;
    if (isVotesOnlyGamePatch(inc) || isAnswersOnlyGamePatch(inc)) return true;
    if (Object.prototype.hasOwnProperty.call(inc, "votes")) return true;
    if (Object.prototype.hasOwnProperty.call(inc, "dealAcks")) return true;
  }
  return false;
}

/**
 * Évite un fetch complet du blob `state` avant merge :
 * - patch scores seulement (hôte) : cache local,
 * - hôte ou invité avec cache : méta légère ; fetch complet seulement si `updated_at` a bougé
 *   (ex. vote invité) - sinon on retéléchargeait le blob à chaque action hôte (egress).
 */
async function loadSessionRowForPatch(lobbyId, { scoresOnly = false, forceFresh = false } = {}) {
  if (forceFresh) return fetchGameSessionByLobby(lobbyId);
  const cached =
    cachedRow?.state && cachedRow.lobby_id === lobbyId ? cachedRow : null;
  if (cached && isLobbyHost() && scoresOnly) return cached;
  if (cached) {
    try {
      const meta = await fetchGameSessionMeta(lobbyId);
      if (meta?.updated_at && meta.updated_at === lastSessionUpdatedAt) {
        return cached;
      }
    } catch {
      /* fetch complet ci-dessous */
    }
  }
  return fetchGameSessionByLobby(lobbyId);
}

function scheduleSyncPoll() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(syncTick, pollIntervalMs);
}

function adjustPollBackoff(sigChanged) {
  /**
   * En partie active : 4 s si Realtime vient de pousser, 2 s sinon (filet de secours).
   * Si le websocket est étranglé (mobile arrière-plan, réseau restrictif), on retombe
   * sur le polling serré dès que Realtime se tait.
   */
  if (isActiveGameSessionScreen(getCurrentScreen())) {
    pollUnchangedStreak = sigChanged ? 0 : pollUnchangedStreak + 1;
    pollIntervalMs = scalePollIntervalMs(
      isRecentGameSessionRealtime() ? POLL_MS_ACTIVE_RELAXED : POLL_MS_ACTIVE
    );
    return;
  }
  if (sigChanged) {
    pollUnchangedStreak = 0;
    pollIntervalMs = scalePollIntervalMs(POLL_MS_DEFAULT);
    return;
  }
  pollUnchangedStreak += 1;
  const recentRealtime = isRecentGameSessionRealtime();
  if (recentRealtime && pollUnchangedStreak >= 2) {
    pollIntervalMs = Math.min(
      scalePollIntervalMs(POLL_MS_MAX),
      pollIntervalMs + scalePollIntervalMs(1500)
    );
  } else if (!recentRealtime && pollUnchangedStreak >= 1) {
    pollIntervalMs = Math.min(
      scalePollIntervalMs(POLL_MS_MAX),
      Math.round(pollIntervalMs * 1.25)
    );
  }
  // Soirée lancée mais invité encore hors partie (menu jeux, lobby, résultats) : on
  // garde un poll réactif pour suivre l'hôte même si le Realtime s'est tu.
  if (isLobbyEveningStarted()) {
    pollIntervalMs = Math.min(pollIntervalMs, scalePollIntervalMs(POLL_MS_HUB_WAIT_MAX));
  }
  const waitingOnHub =
    isLobbyEveningStarted() &&
    !isActiveGameSessionScreen(getCurrentScreen()) &&
    !isOnGameSetupScreen(getCurrentScreen());
  const minPollMs = waitingOnHub ? POLL_MS_HUB_WAIT_MIN : POLL_MS_MIN;
  pollIntervalMs = Math.max(scalePollIntervalMs(minPollMs), pollIntervalMs);
}

async function syncTick() {
  if (!isGameSyncActive() || !getState().inLobby) {
    stopMultiplayerSync();
    return;
  }
  if (syncPausedByHidden) return;
  if (syncTickInFlight) return;
  syncTickInFlight = true;
  const prevSig = lastSessionSig;
  try {
    const lobbyId = getState().lobby?.id;
    // Pas de session tant que la soirée n'est pas lancée - évite le polling inutile.
    if (!getCachedGameSession() && !isLobbyEveningStarted()) {
      adjustPollBackoff(false);
      scheduleSyncPoll();
      return;
    }
    // Polling conditionnel : on récupère d'abord une méta légère (sans `state`),
    // et on ne télécharge le blob complet que si `updated_at` a changé.
    let meta = null;
    try {
      meta = await fetchGameSessionMeta(lobbyId);
    } catch {
      meta = null;
    }

    if (meta && meta.updated_at && meta.updated_at === lastSessionUpdatedAt) {
      adjustPollBackoff(false);
      scheduleSyncPoll();
      const cached = getCachedGameSession();
      if (cached) {
        if (await routeToActiveGameIfNeeded(cached)) return;
        maybeRouteToSessionScreen(cached);
      }
      return;
    }
    const row = await refreshGameSession();
    if (!row) return;
    adjustPollBackoff(sessionSignature(row) !== prevSig);
    scheduleSyncPoll();
    if (await routeToActiveGameIfNeeded(row)) return;
    maybeRouteToSessionScreen(row);
  } catch (e) {
    console.warn("REVEAL sync:", e.message || e);
  } finally {
    syncTickInFlight = false;
  }
}

export function startMultiplayerSync() {
  if (!isGameSyncActive()) return;
  initMultiplayerSyncVisibility();
  stopMultiplayerSync();
  pollIntervalMs = scalePollIntervalMs(POLL_MS_DEFAULT);
  pollUnchangedStreak = 0;
  lastSessionUpdatedAt = "";
  lastGameSessionRealtimeAt = Date.now();
  import("./supabaseLobby.js").then((m) => m.startLobbyPresenceSync());
  if (!syncPausedByHidden) {
    syncTick();
    scheduleSyncPoll();
  }
}

export function stopMultiplayerSync() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  pollIntervalMs = scalePollIntervalMs(POLL_MS_DEFAULT);
  pollUnchangedStreak = 0;
}

export async function startGameSession(gameId, screen, state) {
  if (!isGameSyncActive()) return null;
  const lobbyId = getState().lobby.id;
  const hostId = getSupabaseUserId();
  if (!hostId) throw new Error("Session requise.");

  const { setLobbyPlaying } = await import("./lobby.js");
  await setLobbyPlaying(gameId);
  const priorState = cachedRow?.state || {};
  const filRougePreserve = FIL_ROUGE_ENABLED
    ? (() => {
        const localFr = getState().filRougeGame;
        return priorState.filRouge != null
          ? { filRouge: priorState.filRouge }
          : localFr?.status && localFr.status !== "idle" && localFr.status !== "completed"
            ? { filRouge: filRougeToRemote(localFr) }
            : {};
      })()
    : {};
  const row = await upsertGameSession({
    lobbyId,
    gameId,
    screen,
    hostId,
    state: {
      ...eveningStateToRemote(),
      ...filRougePreserve,
      ...(state || {}),
    },
  });  applyRemoteSession(row);
  routeToSessionScreen(screen, { force: true });
  return row;
}

async function pushGameSessionInner({ screen, gameId, state }) {
  const lobbyId = getState().lobby.id;
  const current = cachedRow?.state || {};
  const nextState = state ? { ...current, ...state } : current;
  const patch = { state: nextState };
  if (screen) patch.screen = screen;
  if (gameId) patch.game_id = gameId;

  let row = await updateGameSession(lobbyId, patch);
  // L'update ne renvoie plus `state` : on le rattache localement (on vient de l'écrire).
  if (row) row = { ...row, state: nextState };
  else row = await fetchGameSessionByLobby(lobbyId);
  if (!row) {
    throw new Error("Impossible de synchroniser la partie (session introuvable).");
  }
  applyRemoteSession(row);
  if (screen) handleSessionRoute(row);
  return row;
}

export async function pushGameSession({
  screen,
  gameId,
  state,
  timeoutMs = DEFAULT_SYNC_PATCH_TIMEOUT_MS,
  alertOnFailure = true,
} = {}) {
  if (
    __trackSessionWrite("pushGameSession", {
      keys: Object.keys(state || {}),
      screen,
      gameId,
    })
  ) {
    return null;
  }
  if (!isGameSyncActive()) return null;
  try {
    return await withPatchTimeout(
      pushGameSessionInner({ screen, gameId, state }),
      timeoutMs
    );
  } catch (err) {
    console.warn("pushGameSession:", err);
    if (alertOnFailure) {
      const { showAppAlert } = await import("./dialog.js");
      await showAppAlert(
        err?.message || "Impossible de synchroniser la partie.",
        { title: "Connexion", icon: "📡" }
      );
    }
    return null;
  }
}

export function guessLieLobbyStartToRemote() {
  return {
    lobbyComplete: true,
    roundIdx: 0,
    phase: "voting",
    roundScored: false,
  };
}

const GUESS_LIE_MP_PATCH_OPTS = {
  gameId: "guesslie",
  screen: "guesslie",
  timeoutMs: GUESS_LIE_SYNC_PATCH_TIMEOUT_MS || SYNC_PATCH_TIMEOUT_MS,
};

/** MP : lancement lobby (phase + roundIdx) sans renvoyer tout le blob submissions. */
export async function commitGuessLieLobbyStart() {
  const { commitMultiplayerLaunch } = await import("./mpLaunch.js");
  return commitMultiplayerLaunch({
    screen: "guesslie",
    gameId: "guesslie",
    state: { guessLie: guessLieLobbyStartToRemote() },
    mode: "patch",
    timeoutMs: GUESS_LIE_MP_PATCH_OPTS.timeoutMs,
  });
}

export async function patchGameState(
  stateMerge,
  { screen, gameId, withEveningScores = false, timeoutMs = DEFAULT_SYNC_PATCH_TIMEOUT_MS } = {}
) {
  if (
    __trackSessionWrite("patchGameState", {
      keys: Object.keys(stateMerge || {}),
      stateKeys: Object.fromEntries(
        Object.entries(stateMerge || {}).map(([k, v]) => [
          k,
          v && typeof v === "object" ? Object.keys(v) : v,
        ])
      ),
      screen,
      gameId,
      withEveningScores,
    })
  ) {
    return null;
  }
  return withPatchTimeout(
    patchGameStateInner(stateMerge, { screen, gameId, withEveningScores }),
    timeoutMs
  );
}

async function patchGameStateInner(
  stateMerge,
  { screen, gameId, withEveningScores = false } = {}
) {
  if (!isGameSyncActive()) return null;
  const lobbyId = getState().lobby.id;
  let mergePayload = stateMerge;
  if (withEveningScores && isLobbyHost()) {
    mergePayload = { ...stateMerge, ...eveningStateToRemote() };
  }
  const scoresOnly = isEveningScoresOnlyMerge(mergePayload);
  const forceFresh = patchNeedsFreshSessionRow(mergePayload);
  let freshRow = await loadSessionRowForPatch(lobbyId, { scoresOnly, forceFresh });

  if (!freshRow) {
    const hostId = getSupabaseUserId();
    if (!hostId) throw new Error("Session requise.");
    if (isLobbyHost()) {
      const cachedSession = getCachedGameSession();
      freshRow = await upsertGameSession({
        lobbyId,
        gameId: gameId || cachedSession?.game_id || "consensus",
        screen: screen || cachedSession?.screen || "game-select",
        hostId,
        state: {
          ...(cachedRow?.state || cachedSession?.state || {}),
          ...eveningStateToRemote(),
          ...stateMerge,
        },
      });
    } else {
      throw new Error(
        "Session de jeu introuvable. Demande à l'hôte de lancer la soirée depuis le lobby."
      );
    }
  }

  if (freshRow) {
    cachedRow = freshRow;
    lastSessionSig = sessionSignature(freshRow);
  }

  if (isLateGamePatchAfterPostGame(freshRow, mergePayload)) {
    applyRemoteSession(freshRow);
    return freshRow;
  }

  if (isStaleTierNightEndPatch(freshRow, mergePayload, screen)) {
    applyRemoteSession(freshRow);
    return freshRow;
  }

  const current = freshRow?.state || cachedRow?.state || {};
  let nextState = { ...current, ...mergePayload };
  if (mergePayload.hotTake) {
    const curHt = current.hotTake;
    const incHt = mergePayload.hotTake;
    const me = getLocalDisplayName();
    nextState.hotTake = curHt
      ? mergeHotTakePatchState(curHt, incHt, me, {
          mergeReadyUid: mergeRemoteReadyUid,
          mergeVotes: mergeRemoteHotTakeVotesUid,
        })
      : incHt;
    if (curHt && incHt && nextState.hotTake) {
      const newHtVote = isNewHotTakeVoteRoundUid(curHt, incHt);
      nextState.hotTake.takeScored = mergeRoundFlag(
        curHt.takeScored,
        incHt.takeScored,
        newHtVote
      );
      nextState.hotTake.matchScores = mergeRemoteMatchScoresUid(
        curHt.matchScores || {},
        incHt.matchScores || {}
      );
      if (incHt.lastRound != null) {
        nextState.hotTake.lastRound = incHt.lastRound;
      }
    }
  }
  if (mergePayload.speedVote) {
    const curSv = current.speedVote;
    const incSv = mergePayload.speedVote;
    const newSvVote = curSv && incSv ? isNewSpeedVoteVoteRoundUid(curSv, incSv) : false;
    nextState.speedVote = curSv
      ? {
          ...mergeSpeedVotePatchState(curSv, incSv, {
            mergeReadyUid: mergeRemoteReadyUid,
            mergeVotes: mergeRemoteSpeedVoteVotesUid,
          }),
          roundScored: mergeRoundFlag(curSv.roundScored, incSv.roundScored, newSvVote),
        }
      : incSv;
    if (curSv && incSv && nextState.speedVote) {
      nextState.speedVote.matchScores = mergeRemoteMatchScoresUid(
        curSv.matchScores || {},
        incSv.matchScores || {}
      );
    }
  }
  if (mergePayload.tierNightLive) {
    const curTl = current.tierNightLive;
    const incTl = mergePayload.tierNightLive;
    nextState.tierNightLive = curTl
      ? mergeSpeedVotePatchState(curTl, incTl, {
          mergeReadyUid: mergeRemoteReadyUid,
          mergeVotes: mergeRemoteTierNightLiveVotesUid,
        })
      : incTl;
  }
  if (mergePayload.clutch) {
    const curRz = current.clutch;
    const incRz = mergePayload.clutch;
    const newRzRound = curRz && incRz ? isNewClutchRoundUid(curRz, incRz) : false;
    nextState.clutch = curRz
      ? {
          ...mergeClutchPatchState(curRz, incRz, {
            mergeReadyUid: mergeRemoteReadyUid,
            mergeTaps: mergeRemoteClutchTapsUid,
          }),
          roundScored: mergeRoundFlag(curRz.roundScored, incRz.roundScored, newRzRound),
        }
      : incRz;
    if (curRz && incRz && nextState.clutch) {
      nextState.clutch.matchScores = mergeRemoteMatchScoresUid(
        curRz.matchScores || {},
        incRz.matchScores || {}
      );
      if (incRz.lastRound != null) {
        nextState.clutch.lastRound = incRz.lastRound;
      }
    }
  }
  if (mergePayload.wrongAnswer) {
    const curWa = current.wrongAnswer;
    const incWa = mergePayload.wrongAnswer;
    const newWaRound = curWa && incWa ? isNewWrongAnswerRoundUid(curWa, incWa) : false;
    nextState.wrongAnswer = curWa
      ? {
          ...mergeWrongAnswerPatchState(curWa, incWa, {
            mergeReadyUid: mergeRemoteReadyUid,
            mergeAnswers: mergeRemoteWrongAnswerAnswersUid,
            mergeVotes: mergeRemoteWrongAnswerVotesUid,
            newRound: newWaRound,
          }),
          roundScored: mergeRoundFlag(curWa.roundScored, incWa.roundScored, newWaRound),
        }
      : incWa;
    if (curWa && incWa && nextState.wrongAnswer) {
      nextState.wrongAnswer.matchScores = mergeRemoteMatchScoresUid(
        curWa.matchScores || {},
        incWa.matchScores || {}
      );
      if (newWaRound) {
        nextState.wrongAnswer.lastRound = incWa.lastRound ?? null;
      } else if (incWa.lastRound != null) {
        nextState.wrongAnswer.lastRound = incWa.lastRound;
      }
    }
  }
  if (mergePayload.traitre) {
    const curTr = current.traitre;
    const incTr = sanitizeTraitreMergeInc(curTr, mergePayload.traitre);
    const newTrVote = curTr && incTr ? isNewTraitreVoteRoundUid(curTr, incTr) : false;
    const newTrGame = curTr && incTr ? isNewTraitreGame(curTr, incTr) : false;
    nextState.traitre = curTr
      ? mergeTraitrePatchState(curTr, incTr, {
          mergeReadyUid: mergeRemoteReadyUid,
          mergeVotes: mergeRemoteTraitreVotesUid,
          newVoteRound: newTrVote,
          newGame: newTrGame,
        })
      : incTr;
  }
  if (mergePayload.trivia) {
    const curTrivia = current.trivia;
    const incTrivia = mergePayload.trivia;
    const newTriviaQ = curTrivia && incTrivia ? isNewTriviaQuestionRoundUid(curTrivia, incTrivia) : false;
    nextState.trivia = curTrivia
      ? {
          ...mergeTriviaPatchState(curTrivia, incTrivia, {
            mergeReadyUid: mergeRemoteReadyUid,
            mergeAnswers: mergeRemoteTriviaAnswersUid,
            newQuestionRound: newTriviaQ,
          }),
          matchScores: { ...(curTrivia.matchScores || {}), ...(incTrivia.matchScores || {}) },
          questionScored: mergeRoundFlag(
            curTrivia.questionScored,
            incTrivia.questionScored,
            newTriviaQ
          ),
          podiumApplied: mergeRoundFlag(
            curTrivia.podiumApplied,
            incTrivia.podiumApplied,
            newTriviaQ
          ),
        }
      : incTrivia;
  }
  if (mergePayload.truthMeter) {
    const curTm = current.truthMeter;
    const incTm = mergePayload.truthMeter;
    const newTmVote = curTm && incTm ? isNewTruthMeterVoteRound(curTm, incTm) : false;
    const newTmRound = curTm && incTm ? isNewTruthMeterRound(curTm, incTm) : false;
    nextState.truthMeter = curTm
      ? {
          ...mergeTruthMeterPatchState(curTm, incTm, {
            mergeReadyUid: mergeRemoteReadyUid,
            mergeVotes: mergeRemoteTruthMeterVotesUid,
            newRound: newTmVote || newTmRound,
          }),
          roundScored: mergeRoundFlag(curTm.roundScored, incTm.roundScored, newTmVote),
          matchScores: mergeRemoteMatchScoresUid(curTm.matchScores || {}, incTm.matchScores || {}),
          lastRound: incTm.lastRound != null ? incTm.lastRound : curTm.lastRound,
        }
      : incTm;
  }
  if (mergePayload.consensus) {
    const curConsensus = current.consensus;
    const incConsensus = mergePayload.consensus;
    const newConsensusQ =
      curConsensus && incConsensus
        ? isNewConsensusQuestionRoundUid(curConsensus, incConsensus)
        : false;
    nextState.consensus = curConsensus
      ? {
          ...mergeConsensusPatchState(curConsensus, incConsensus, {
            mergeReadyUid: mergeRemoteReadyUid,
            mergeAnswers: mergeRemoteConsensusAnswersUid,
            newQuestionRound: newConsensusQ,
          }),
          matchScores: scoresFromRemote({
            ...(curConsensus.matchScores || {}),
            ...(incConsensus.matchScores || {}),
          }),
          roundScored: mergeRoundFlag(
            curConsensus.roundScored,
            incConsensus.roundScored,
            newConsensusQ
          ),
          lastRound: newConsensusQ
            ? incConsensus.lastRound ?? null
            : normalizeConsensusLastRoundRemote(
                incConsensus.lastRound ?? curConsensus.lastRound
              ),
          podiumApplied: mergeRoundFlag(
            curConsensus.podiumApplied,
            incConsensus.podiumApplied,
            newConsensusQ
          ),
        }
      : incConsensus;
  }
  if (FIL_ROUGE_ENABLED && mergePayload.filRouge) {
    nextState.filRouge = mergeFilRougeRemote(current.filRouge, mergePayload.filRouge);
  }
  if (mergePayload.dilemma) {
    const curDm = current.dilemma;
    const incDm = mergePayload.dilemma;
    const me = getLocalDisplayName();
    nextState.dilemma = curDm
      ? mergeDilemmaPatchState(curDm, incDm, me, {
          mergeReadyUid: mergeRemoteReadyUid,
          mergeVotes: mergeRemoteDilemmaVotes,
        })
      : incDm;
    if (curDm && incDm && nextState.dilemma) {
      const newDmVote = isNewDilemmaVoteRoundUid(curDm, incDm);
      nextState.dilemma.roundScored = mergeRoundFlag(
        curDm.roundScored,
        incDm.roundScored,
        newDmVote
      );
      nextState.dilemma.matchScores = mergeRemoteMatchScoresUid(
        curDm.matchScores || {},
        incDm.matchScores || {}
      );
      if (incDm.lastRound != null) {
        nextState.dilemma.lastRound = incDm.lastRound;
      }
    }
  }
  if (mergePayload.tierNight) {
    nextState.tierNight = { ...(current.tierNight || {}), ...mergePayload.tierNight };
  }
  if (mergePayload.guessLie) {
    const curGl = current.guessLie;
    const incGl = mergePayload.guessLie;
    if (curGl && incGl && isSubmissionsOnlyGamePatch(incGl)) {
      nextState.guessLie = {
        ...curGl,
        submissions: { ...(curGl.submissions || {}), ...(incGl.submissions || {}) },
      };
    } else {
    const newGlRound = curGl && incGl ? isNewGuessLieVoteRound(curGl, incGl) : false;
    let mergedSubmissions = curGl?.submissions;
    if (incGl?.submissions !== undefined) {
      if (shouldApplyGuessLieLobbyReset(curGl, incGl)) {
        mergedSubmissions = {};
      } else if (Object.keys(incGl.submissions || {}).length > 0) {
        mergedSubmissions = { ...(curGl.submissions || {}), ...(incGl.submissions || {}) };
      }
    }
    const glLobbyReset = shouldApplyGuessLieLobbyReset(curGl, incGl);
    nextState.guessLie = curGl
      ? {
          ...curGl,
          ...incGl,
          submissions: mergedSubmissions,
          phase: newGlRound
            ? (incGl.phase ?? curGl.phase)
            : mergeForwardGamePhase(curGl.phase, incGl.phase),
          votes: mergeRemoteGuessLieVotes(curGl, incGl),
          roundScored: mergeRoundFlag(curGl.roundScored, incGl.roundScored, newGlRound),
          statsRecordedRoundIdx: mergeMaxIndex(
            curGl.statsRecordedRoundIdx,
            incGl.statsRecordedRoundIdx
          ),
          lobbyComplete: mergeGuessLieLobbyComplete(curGl, incGl, { lobbyReset: glLobbyReset }),
        }
      : incGl;
    }
  }
  if (mergePayload.playlistGuess) {
    const curPg = current.playlistGuess;
    const incPg = mergePayload.playlistGuess;
    const newPgRound = curPg && incPg ? isNewPlaylistGuessVoteRound(curPg, incPg) : false;
    let pgRoundScored = mergeRoundFlag(curPg.roundScored, incPg.roundScored, newPgRound);
    if (incPg.phase === "voting" && newPgRound) {
      pgRoundScored = Boolean(incPg.roundScored);
    } else if (incPg.phase === "voting" && Object.keys(incPg.votes || {}).length === 0) {
      pgRoundScored = false;
    }
    nextState.playlistGuess = curPg
      ? {
          ...curPg,
          ...incPg,
          phase: newPgRound
            ? (incPg.phase ?? curPg.phase)
            : mergeForwardGamePhase(curPg.phase, incPg.phase),
          ready: mergeRemoteReadyUid(curPg, incPg),
          votes: mergeRemotePlaylistGuessVotesUid(curPg, incPg),
          roundScored: pgRoundScored,
        }
      : incPg;
  }

  const patch = { state: nextState };
  if (screen) patch.screen = screen;
  if (gameId) patch.game_id = gameId;

  // Anti-boucle d'écritures : si ce patch n'apporte AUCUN changement par rapport à la
  // ligne serveur qu'on vient de relire (même state + même screen/game_id), on n'écrit
  // pas. C'est le coupe-circuit central qui neutralise tout ping-pong (ex. deux hôtes
  // après un transfert qui réagissent mutuellement à des sessions identiques, ou un
  // listener qui relance un reveal déjà acté). Les vraies transitions changent toujours
  // l'état (phase, votes, scores, voteEndsAt…) et passent donc normalement.
  if (freshRow) {
    const sameState = JSON.stringify(nextState) === JSON.stringify(freshRow.state || {});
    const sameScreen = (screen || freshRow.screen) === freshRow.screen;
    const sameGameId = (gameId || freshRow.game_id) === freshRow.game_id;
    if (sameState && sameScreen && sameGameId) {
      // Pas d'écriture, mais on resynchronise l'état local sur la ligne serveur (utile
      // si ce client était en retard). applyRemoteSession sort tôt via `sigUnchanged`,
      // donc aucune cascade `notify` → pas de réentrée.
      applyRemoteSession(freshRow);
      if (screen) handleSessionRoute(freshRow);
      return freshRow;
    }
  }

  let row = await updateGameSession(lobbyId, patch);
  // L'update ne renvoie plus `state` : on le rattache localement (on vient de l'écrire).
  if (row) {
    row = { ...row, state: nextState };
  } else {
    row = await fetchGameSessionByLobby(lobbyId);
  }
  if (!row) {
    throw new Error("Impossible de synchroniser la partie (session introuvable).");
  }
  applyRemoteSession(row);
  if (screen) handleSessionRoute(row);
  return row;
}

export async function endGameSession() {
  if (!isGameSyncActive()) return;
  const lobbyId = getState().lobby.id;
  await deleteGameSession(lobbyId);
  cachedRow = null;
  lastSessionSig = "";
  lastSessionUpdatedAt = "";
  // Retour au menu des jeux : la soirée continue (statut "playing"), donc on NE repasse PAS
  // le lobby en "waiting" (ce qui réinitialiserait les "prêt" et renverrait les invités sur
  // l'écran d'attente). On garde l'évènement actif via setLobbyBetweenGames.
  const { setLobbyBetweenGames } = await import("./lobby.js");
  await setLobbyBetweenGames();
  notify(null);
}

/** Fin de partie : écran résultats pour tout le lobby (upsert, pas delete+update). */
function deactivatePlayFlagsInSessionState(state = {}) {
  const st = { ...state };
  const lobbyStartedGames = [
    "hotTake",
    "speedVote",
    "clutch",
    "wrongAnswer",
    "traitre",
    "trivia",
    "truthMeter",
    "consensus",
    "dilemma",
    "playlistGuess",
    "tierNight",
    "tierNightLive",
  ];
  lobbyStartedGames.forEach((key) => {
    if (st[key] && typeof st[key] === "object") {
      st[key] = { ...st[key], lobbyStarted: false };
    }
  });
  if (st.guessLie && typeof st.guessLie === "object") {
    st.guessLie = { ...st.guessLie, lobbyComplete: false, phase: "idle" };
  }
  if (st.tierNight && typeof st.tierNight === "object") {
    st.tierNight = { ...st.tierNight, lobbyStarted: false, finished: true };
  }
  return st;
}

export async function completeGameSession({ gameId = "menu", screen = "results", state = {} } = {}) {
  if (!isGameSyncActive()) return null;
  const lobbyId = getState().lobby.id;
  const actorId = getSupabaseUserId();
  if (!actorId) return null;
  const hostId = getState().lobby?.hostId || actorId;

  const { setLobbyBetweenGames } = await import("./lobby.js");
  await setLobbyBetweenGames();

  // Sur un écran post-partie, on écrit game_id = "menu" : sinon le game_id du jeu
  // terminé reste en base et le routage le réinterprète en prépa (renvoi des invités
  // vers la prépa au lieu des résultats). Robuste face à l'ordre d'arrivée des sync
  // lobby/session, contrairement à une inférence basée sur le gameId du lobby.
  const sessionGameId = POST_GAME_SCREENS.has(screen) ? "menu" : gameId;
  const priorState = cachedRow?.state || {};
  const sessionState = deactivatePlayFlagsInSessionState({
    ...priorState,
    ...eveningStateToRemote(),
    ...(state || {}),
  });

  const row = await upsertGameSession({
    lobbyId,
    gameId: sessionGameId,
    screen,
    hostId,
    state: sessionState,
  });
  applyRemoteSession(row);
  routeToSessionScreen(screen, { force: true });
  return row;
}

function resetLocalGamePrepState() {
  resetGameSessionsOnly();
}

/** Vide le cache session multijoueur (après quit lobby). */
export function clearCachedGameSession() {
  cachedRow = null;
  lastSessionSig = "";
  lastSessionUpdatedAt = "";
  notify(null);
}

export function isOnPostGameScreen(screen = getCurrentScreen()) {
  return POST_GAME_SCREENS.has(screen);
}

/** Stoppe un ancien listener de jeu quand la session distante est déjà en post-partie. */
export function stopGameSessionListenerOnPostGame(
  row = getCachedGameSession(),
  { cleanup } = {}
) {
  const screen = row?.screen || null;
  if (!isOnPostGameScreen(screen)) return false;
  if (typeof cleanup === "function") cleanup();
  routeToSessionScreen(screen, { force: true });
  return true;
}

/** Retour au menu jeux (hôte : ferme la session ; invité : navigation locale). */
export async function returnToGameSelect() {
  if (!isGameSyncActive()) return false;

  if (isLobbyHost()) {
    await endGameSession();
    resetLocalGamePrepState();
    routeToSessionScreen("game-select", { force: true });
    return true;
  }

  resetLocalGamePrepState();
  suppressSessionRoute(
    120000,
    getEffectiveSessionScreen(getCachedGameSession()) || getCurrentScreen()
  );
  navigate("game-select", { navStack: ["home", "lobby", "game-select"] });
  return true;
}

/** Quitter la préparation d’un jeu (retour au menu jeux) - multijoueur. */
export async function leaveGameSetup() {
  if (!isGameSyncActive() || !isLobbyHost()) return false;
  return returnToGameSelect();
}

export async function syncHotTakeSession(extra = {}, patchOpts = {}) {
  const session = { ...getState().hotTakeGame, ...extra };
  saveStatePatch({ hotTakeGame: session });
  if (!isGameSyncActive()) return session;
  await patchGameState({ hotTake: hotTakeToRemote(session) }, patchOpts);
  return session;
}

export async function syncSpeedVoteSession(extra = {}, patchOpts = {}) {
  const session = { ...getState().speedVoteGame, ...extra };
  saveStatePatch({ speedVoteGame: session });
  if (!isGameSyncActive()) return session;
  await patchGameState({ speedVote: speedVoteToRemote(session) }, patchOpts);
  return session;
}

export async function syncClutchSession(extra = {}, patchOpts = {}) {
  const session = { ...getState().clutchGame, ...extra };
  saveStatePatch({ clutchGame: session });
  if (!isGameSyncActive()) return session;
  await patchGameState({ clutch: clutchToRemote(session) }, patchOpts);
  return session;
}

export async function syncWrongAnswerSession(extra = {}, patchOpts = {}) {
  const session = { ...getState().wrongAnswerGame, ...extra };
  saveStatePatch({ wrongAnswerGame: session });
  if (!isGameSyncActive()) return session;
  await patchGameState({ wrongAnswer: wrongAnswerToRemote(session) }, patchOpts);
  return session;
}

export async function syncTraitreSession(extra = {}, patchOpts = {}) {
  const session = { ...getState().traitreGame, ...extra };
  saveStatePatch({ traitreGame: session });
  if (!isGameSyncActive()) return session;
  await patchGameState({ traitre: traitreToRemote(session) }, patchOpts);
  return session;
}

export async function syncPlaylistGuessSession(extra = {}, patchOpts = {}) {
  const session = { ...getState().playlistGuessGame, ...extra };
  saveStatePatch({ playlistGuessGame: session });
  if (!isGameSyncActive()) return session;
  await patchGameState({ playlistGuess: playlistGuessToRemote(session) }, patchOpts);
  return session;
}

export async function syncTriviaSession(extra = {}, patchOpts = {}) {
  const session = { ...getState().triviaGame, ...extra };
  saveStatePatch({ triviaGame: session });
  if (!isGameSyncActive()) return session;
  await patchGameState({ trivia: triviaToRemote(session) }, patchOpts);
  return session;
}

export async function syncTruthMeterSession(extra = {}, patchOpts = {}) {
  const session = { ...getState().truthMeterGame, ...extra };
  saveStatePatch({ truthMeterGame: session });
  if (!isGameSyncActive()) return session;
  await patchGameState({ truthMeter: truthMeterToRemote(session) }, patchOpts);
  return session;
}

export async function syncConsensusSession(extra = {}, patchOpts = {}) {
  const session = { ...getState().consensusGame, ...extra };
  saveStatePatch({ consensusGame: session });
  if (!isGameSyncActive()) return session;
  await patchGameState({ consensus: consensusToRemote(session) }, patchOpts);
  return session;
}

export async function syncDilemmaSession(extra = {}, patchOpts = {}) {
  const session = { ...getState().dilemmaGame, ...extra };
  saveStatePatch({ dilemmaGame: session });
  if (!isGameSyncActive()) return session;
  await patchGameState({ dilemma: dilemmaToRemote(session) }, patchOpts);
  return session;
}

export async function syncFilRougeSession(extra = {}, patchOpts = {}) {
  if (!FIL_ROUGE_ENABLED) return getState().filRougeGame || null;
  const session = { ...getState().filRougeGame, ...extra };
  saveStatePatch({ filRougeGame: session });
  if (!isGameSyncActive()) {
    return session;
  }
  await patchGameState({ filRouge: filRougeToRemote(session) }, patchOpts);
  return getState().filRougeGame || session;
}

/** Recharge l'état Fil Rouge depuis la session multijoueur (hôte + invités). */
export async function refreshFilRougeFromSession() {
  if (!FIL_ROUGE_ENABLED) return null;
  if (!isGameSyncActive()) return getState().filRougeGame;
  const row = await refreshGameSession();
  return getState().filRougeGame;
}

export async function commitGuessLieSubmission(playerName, payload) {
  const gl = { ...getState().guessLie };
  gl.submissions = { ...(gl.submissions || {}), [playerName]: payload };
  saveStatePatch({ guessLie: gl });
  if (!isGameSyncActive()) return gl;
  const uid = requirePlayerUid(playerName);
  const { patchGameStateWithFeedback } = await import("./patchGameStateFeedback.js");
  await patchGameStateWithFeedback(
    { guessLie: { submissions: { [uid]: payload } } },
    { gameId: "guesslie", screen: "guesslie-menu" }
  );
  return gl;
}

export async function syncGuessLieSession(extra = {}, patchOpts = {}) {
  const gl = { ...getState().guessLie, ...extra };
  saveStatePatch({ guessLie: gl });
  if (!isGameSyncActive()) return gl;
  await patchGameState({ guessLie: guessLieToRemote(gl) }, patchOpts);
  return gl;
}

export async function commitGuessLiePlay(patch, { screen, withEveningScores = false } = {}) {
  const gl = { ...getState().guessLie, ...patch };
  saveStatePatch({ guessLie: gl });
  if (!isGameSyncActive() || !isLobbyHost()) return gl;
  await patchGameState(
    { guessLie: pickRemotePlayFields(guessLieToRemote(gl), patch) },
    { screen: screen || "guesslie", gameId: "guesslie", withEveningScores }
  );
  return gl;
}

export async function syncTierNightSession(payload) {
  if (payload.topicId != null) saveStatePatch({ tierNightTopicId: payload.topicId });
  if (payload.mode != null) saveStatePatch({ tierNightMode: payload.mode });
  if (payload.modifier != null) saveStatePatch({ tierNightModifier: payload.modifier });
  if (payload.game) saveStatePatch({ tierNightGame: payload.game });
  if (!isGameSyncActive()) return;
  const cached = getTierNightRemote() || {};
  const remote = tierNightToRemote({
    runId: payload.runId ?? getState().tierNightGame?.runId ?? cached.runId ?? null,
    topicId: payload.topicId ?? getState().tierNightTopicId,
    mode: payload.mode ?? getState().tierNightMode,
    modifier: payload.modifier ?? getState().tierNightModifier,
    game: payload.game ?? getState().tierNightGame,
    placements: payload.placements ?? cached.placements,
    finished: payload.finished ?? cached.finished,
    lobbyStarted: payload.lobbyStarted ?? cached.lobbyStarted ?? true,
  });
  await patchGameState({ tierNight: remote }, { screen: payload.screen, gameId: "tiernight" });
}

export function getActiveMemberUserIds() {
  return (getState().lobby?.participants || [])
    .map((p) => p.userId)
    .filter(Boolean);
}

export function allMembersReady(readyMapByUid) {
  const participants = getState().lobby?.participants || [];
  if (!participants.length) return false;
  return participants.every((p) => {
    if (p.userId && readyMapByUid[p.userId]) return true;
    if (p.name && readyMapByUid[p.name]) return true;
    return false;
  });
}

export function getTierNightRemote() {
  return getCachedGameSession()?.state?.tierNight || null;
}

export async function syncTierNightLiveSession(extra = {}, patchOpts = {}) {
  const session = { ...getState().tierNightLiveGame, ...extra };
  saveStatePatch({ tierNightLiveGame: session });
  if (!isGameSyncActive()) return;
  await patchGameState({ tierNightLive: tierNightLiveToRemote(session) }, patchOpts);
}

export function getTierNightLiveRemote() {
  return getCachedGameSession()?.state?.tierNightLive || null;
}

export function getTierNightLobbyProgress() {
  const finished = getTierNightRemote()?.finished || {};
  return getLobbyParticipants().map((p) => ({
    name: p.name,
    emoji: p.emoji,
    color: p.color,
    userId: p.userId,
    done: Boolean(p.userId && finished[p.userId]),
  }));
}

export function allTierNightMembersFinished(finishedMap) {
  const ids = getActiveMemberUserIds();
  if (!ids.length) return false;
  const map = finishedMap ?? getTierNightRemote()?.finished ?? {};
  return ids.every((id) => map[id]);
}

export function countTierNightMembersFinished(finishedMap) {
  const map = finishedMap ?? getTierNightRemote()?.finished ?? {};
  return getActiveMemberUserIds().filter((id) => map[id]).length;
}

export function canForceTierNightResults() {
  const finished = countTierNightMembersFinished();
  const total = getActiveMemberUserIds().length;
  return finished > 0 && finished < total;
}

function tierNightLocalRecapsComplete(session, list) {
  if (session.recapSynced) return true;
  if (session.topicId !== list.id) return false;
  const recaps = session.recaps || [];
  if (!recaps.length) return false;
  if (recaps[0]?.consensusPoints == null) return false;
  const expected = getActivePlayers().length;
  if (expected > 0 && recaps.length < expected) return false;
  return recaps.some((r) => Object.values(r.placed || {}).flat().length > 0);
}

function tierNightPlacedItemsCount(placements = {}) {
  return Object.values(placements || {}).reduce(
    (sum, placed) => sum + Object.values(placed || {}).flat().length,
    0
  );
}

function tierNightPlacementsByName(placements = {}) {
  const byName = {};
  const participants = getLobbyParticipants();
  participants.forEach((p) => {
    if (placements[p.name]) byName[p.name] = placements[p.name];
    else if (p.userId && placements[p.userId]) byName[p.name] = placements[p.userId];
  });
  Object.entries(placements || {}).forEach(([key, placed]) => {
    if (!placed || byName[key]) return;
    const known = participants.some((p) => p.name === key || p.userId === key);
    if (!known) byName[key] = placed;
  });
  return byName;
}

function buildTierNightRecapFromLiveSession(live, list = null) {
  const liveItems = Array.isArray(live?.deck) ? live.deck : [];
  const livePlacements = tierNightPlacementsByName(live?.placements || {});
  if (!liveItems.length || tierNightPlacedItemsCount(livePlacements) <= 0) return null;
  const built = buildRecapsFromPlacements(
    live.topicId || list?.id || null,
    live.listName || list?.name || "Tier list",
    liveItems,
    livePlacements
  );
  return built.some((r) => Object.values(r.placed || {}).flat().length > 0) ? built : null;
}

export async function ensureTierNightRecapsFromRemote(list) {
  if (isGameSyncActive()) {
    await refreshGameSession();
  }

  const tn = getTierNightRemote();
  if (!tn) return;

  if (tn.recap?.recaps?.length && tierNightRecapHasPlacements(tn.recap)) {
    applyTierNightRecapFromRemote(tn.recap);
    return;
  }

  const live = getState().tierNightLiveGame;
  const liveBuilt = buildTierNightRecapFromLiveSession(live, list);
  if (liveBuilt) {
    recordTierNightPlayed();
    return;
  }

  if (!list) return;

  const session = getTierNightSession();
  if (tierNightLocalRecapsComplete(session, list)) {
    return;
  }

  const byName = tierNightPlacementsByName(tn.placements || {});

  const built = buildRecapsFromPlacements(list.id, list.name, list.items, byName);
  if (built.some((r) => Object.values(r.placed || {}).flat().length > 0)) {
    recordTierNightPlayed();
  }
}

/** Hôte : publie le récap Tier Night pour les invités. */
export async function pushTierNightRecapToSession() {
  if (!isGameSyncActive() || !isLobbyHost()) return;
  const recap = tierNightRecapToRemote(getTierNightSession());
  if (!recap) return;
  const tn = getTierNightRemote() || {};
  await patchGameState({ tierNight: { ...tn, recap } });
}

/**
 * Hôte (mode live) : publie le récap, marque la partie live terminée et bascule
 * tout le monde sur l'écran de résultats Tier Night.
 */
export async function finalizeTierNightLiveToResults() {
  if (!isGameSyncActive() || !isLobbyHost()) return false;
  let recap = tierNightRecapToRemote(getTierNightSession());
  if (!recap) {
    const liveBuilt = buildTierNightRecapFromLiveSession(getState().tierNightLiveGame);
    if (liveBuilt) {
      recordTierNightPlayed();
      recap = tierNightRecapToRemote(getTierNightSession());
    }
  }
  const tnRemote = getTierNightRemote() || {};
  const row = await patchGameState(
    {
      tierNight: { ...tnRemote, lobbyStarted: false, ...(recap ? { recap } : {}) },
      tierNightLive: finishedTierNightLiveRemote(getState().tierNightLiveGame),
    },
    { screen: "tiernight-end", gameId: "tiernight", withEveningScores: true }
  );
  if (getEffectiveSessionScreen(row) !== "tiernight-end") return false;
  navigate("tiernight-end");
  return true;
}

/** Hôte : fin Tier Night - récap + scores + écran en un seul write. */
export async function advanceTierNightToResultsWhenReady(list, { force = false, isMounted = null } = {}) {
  if (!isGameSyncActive() || !isLobbyHost()) return false;
  if (!force && !allTierNightMembersFinished()) return false;
  if (force && countTierNightMembersFinished() === 0) return false;

  const stillMounted = () => typeof isMounted !== "function" || isMounted();

  await ensureTierNightRecapsFromRemote(list);
  if (!stillMounted()) return false;
  const recap = tierNightRecapToRemote(getTierNightSession());
  const tnRemote = getTierNightRemote() || {};
  const row = await patchGameState(
    { tierNight: { ...tnRemote, lobbyStarted: false, ...(recap ? { recap } : {}) } },
    { screen: "tiernight-end", gameId: "tiernight", withEveningScores: true }
  );
  if (!stillMounted()) return false;
  if (getEffectiveSessionScreen(row) !== "tiernight-end") return false;
  navigate("tiernight-end");
  return true;
}

export function allMembersVoted(votesByUid, options = {}) {
  const { excludeUserId = null } = options;
  const ids = getActiveMemberUserIds().filter((id) => id !== excludeUserId);
  if (!ids.length) return false;
  return ids.every((id) => votesByUid[id] != null && votesByUid[id] !== "");
}

export function initGameSyncFromLobby(row) {
  if (row) applyRemoteSession(row);
}
