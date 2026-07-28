import { DEMO_NPC_PLAYERS } from "./demoPlayers.js";
import {
  getState,
  saveStatePatch,
  newLobby as genLobbyCode,
  getLocalDisplayName,
  getLocalEmoji,
  ensurePlayerScore,
  resetEveningState,
  beginGameScoreSession,
  setActiveScoringGame,
  hasEveningStatsActivity,
} from "./state.js";
import { loginAsGuest, isGuest } from "./auth.js";
import { clearGuestMembership, loadGuestMembership } from "./guestMembership.js";
import { signOutSupabase, getSupabaseUserId, getLiveSupabaseUserId } from "./supabaseAuth.js";
import { syncAllPlayerScores } from "./players.js";
import { navigate, getCurrentScreen } from "./router.js";
import { resetWelcomeSeen } from "./welcomeGate.js";
import { isSupabaseConfigured, supabase } from "./supabaseClient.js";
import {
  createLobbySupabase,
  joinLobbySupabase,
  leaveLobbySupabase,
  closeLobbySupabase,
  fetchLobbyHostIdById,
  deleteOwnLobbyMembershipById,
  closeLobbyByIdAsHost,
  refreshLobbyFromSupabase,
  isLocalStillLobbyMember,
  setLocalReadySupabase,
  setLobbyStatusSupabase,
  addLobbyMessageSupabase,
  subscribeLobbyRealtime,
  unsubscribeLobbyRealtime,
  startLobbyPresenceSync,
  stopLobbyPresenceSync,
  onLobbyBundleUpdated,
  notifyLobbyBundleUpdated,
  recoverLobbyFromServer,
  recoverAfterMembershipAlreadyExists,
  peekServerLobbyForUser,
  getRememberedLobbyCode,
  transferLobbyHostSupabase,
  kickLobbyMemberSupabase,
} from "./supabaseLobby.js";
import { queryActiveLobbyMembership } from "./lobbyMembershipFetch.js";
import {
  alignMembershipSnapshotAfterLobbyHydration,
  commitMembershipRemoved,
  MEMBERSHIP_HYDRATION_SOURCE,
} from "./lobbyMembershipAlign.js";
import {
  beginPostLeaveHomeTransition,
  endPostLeaveHomeTransition,
} from "./homeMembershipLeaveTransition.js";
import {
  getMembershipSnapshot,
  setMembershipSnapshot,
  invalidateMembershipSnapshot,
  getMembershipAuthGeneration,
} from "./lobbyMembershipSnapshot.js";
import {
  assertCanInsertLobby,
  applyMembershipQueryToSnapshot,
  LOBBY_CREATE_ERROR,
  makeLobbyCreateError,
} from "./lobbyCreateGuard.js";
import { LOBBY_DISSOLVE_STATUS } from "./lobbyDissolveContract.js";
import { clearTraitrePrivateLocalForLobby } from "./traitrePrivate.js";
import {
  leaveLobbyMembershipFromServer as runServerOnlyLeave,
  SERVER_LEAVE_CONFIRM,
} from "./lobbyServerLeave.js";
import {
  runVoluntaryMemberLeave,
  notifyVoluntaryLeaveFailure as notifyLeaveFailureCore,
  isVoluntaryLeaveInFlight,
  resetVoluntaryLeaveLockForTests,
} from "./voluntaryMemberLeave.js";
import {
  showAppAlert,
  showAppConfirm,
  showTransferHostDialog,
} from "./dialog.js";

export {
  isVoluntaryLeaveInFlight,
  resetVoluntaryLeaveLockForTests,
  runVoluntaryMemberLeave,
} from "./voluntaryMemberLeave.js";
import {
  stopMultiplayerSync,
  endGameSession,
  clearCachedGameSession,
  routeToActiveGameIfNeeded,
  refreshGameSession,
  startMultiplayerSync,
  isGameSyncActive,
  suppressSessionRoute,
  clearSessionRouteSuppress,
  isSessionRouteSuppressed,
  getCachedGameSession,
  getEffectiveSessionScreen,
  isActiveGameSessionScreen,
  isOnGameSetupScreen,
  isOnPostGameScreen,
  isLobbyHost,
  returnToGameSelect,
  routeToSessionScreen,
  isAppContentMounted,
  refreshEveningScoresFromSession,
} from "./gameSync.js";
import { isGuessLieGameActive, tryEnterGuessLiePlayFromWait } from "./guessLieSession.js";
import {
  mapParticipantsReadyFalse,
  shouldReconcileLobbyReadyFromServer,
} from "./lobbyReadyMount.js";
import { MAX_PLAYERS } from "../config/lobbyLifecycle.js";
import { newOfflineLobbyInstanceId } from "./lobbyBoundary.js";
import { bumpLobbyRuntimeGeneration } from "./lobbyRuntime.js";
import {
  createLobbyJoinEffects,
  markLobbyJoinFinalized,
} from "./lobbyJoinEffects.js";
import { finalizeFailedJoinAttempt } from "./lobbyJoinFinalize.js";

const GUEST_RECOVERY_CAPTCHA_KEY = "reveal-guest-recovery-captcha-required";

let lobbyDissolveHandling = false;
let lobbyKickHandling = false;

function setGuestRecoveryCaptchaRequired(required) {
  try {
    if (required) sessionStorage.setItem(GUEST_RECOVERY_CAPTCHA_KEY, "1");
    else sessionStorage.removeItem(GUEST_RECOVERY_CAPTCHA_KEY);
  } catch {
    /* storage indisponible */
  }
}

export function isGuestRecoveryCaptchaPending() {
  try {
    return sessionStorage.getItem(GUEST_RECOVERY_CAPTCHA_KEY) === "1";
  } catch {
    return false;
  }
}

function isLocalLobbyHost() {
  const uid = getSupabaseUserId();
  const hostId = getLobby()?.hostId;
  if (uid && hostId) return uid === hostId;
  return getLobbyParticipants().some((p) => p.isLocal && p.isHost);
}

async function signOutAnonGuestIfNeeded(wasGuest) {
  let shouldSignOut = wasGuest;
  if (!shouldSignOut && isSupabaseConfigured()) {
    const { data: authData } = await supabase.auth.getUser();
    shouldSignOut = Boolean(authData?.user?.is_anonymous);
  }
  if (shouldSignOut) {
    try {
      await signOutSupabase();
    } catch (e) {
      console.warn("REVEAL signOut guest on leave:", e.message || e);
    }
  }
}

function clearLocalOpenLobbySlot(code) {
  if (!code) return;
  const open = { ...(getState().openLobbies || {}) };
  const published = open[code];
  if (!published) return;
  const localName = getLocalDisplayName();
  open[code] = {
    ...published,
    participants: (published.participants || []).filter((p) => p.name !== localName),
    updatedAt: Date.now(),
  };
  saveStatePatch({ openLobbies: open });
}

function applyLeaveLobbyLocal({ wasGuest, navigateAway }) {
  const patch = { inLobby: false, lobby: null, lobbyCode: null };
  if (wasGuest) {
    patch.user = {
      email: null,
      name: null,
      loggedIn: false,
      isGuest: false,
      provider: null,
    };
    try {
      sessionStorage.setItem("reveal-auth-tab", "guest");
    } catch {
      /* storage indisponible */
    }
  }
  performLobbyBoundaryTeardown();
  clearGuestMembership();
  saveStatePatch(patch);
  if (navigateAway) {
    navigate("home", { reset: true });
  }
}

/**
 * Teardown local canonique à chaque frontière de lobby (commit).
 * Ordre : invalider génération → arrêt sync → cache → reset soirée.
 * lastGame : scope lobby (state.js) — non effacé ici.
 */
export function performLobbyBoundaryTeardown() {
  bumpLobbyRuntimeGeneration();
  stopMultiplayerSync();
  stopLobbyPresenceSync();
  clearCachedGameSession();
  resetEveningState();
}

const EVENING_ROLLBACK_KEYS = [
  "scores",
  "stats",
  "gameScores",
  "gameScoreOrder",
  "gameScoreSessionBaseline",
  "gameScoreSessionGameId",
  "eveningGamesRecorded",
  "lastGame",
  "guessLie",
  "hotTakeGame",
  "speedVoteGame",
  "clutchGame",
  "wrongAnswerGame",
  "traitreGame",
  "playlistGuessGame",
  "truthMeterGame",
  "consensusGame",
  "dilemmaGame",
  "triviaGame",
  "tierNightGame",
  "tierNightLiveGame",
  "tierNightTopicId",
  "tierNightMode",
  "tierNightModifier",
];

function captureLobbyRollbackSnapshot() {
  const s = getState();
  /** @type {Record<string, unknown>} */
  const patch = {
    lobby: structuredClone(s.lobby),
    lobbyCode: s.lobbyCode,
    inLobby: s.inLobby,
  };
  for (const key of EVENING_ROLLBACK_KEYS) {
    const value = s[key];
    if (value && typeof value === "object") {
      patch[key] = structuredClone(value);
    } else {
      patch[key] = value;
    }
  }
  if (Array.isArray(s.gameScoreOrder)) {
    patch.gameScoreOrder = [...s.gameScoreOrder];
  }
  return {
    lobbyId: s.lobby?.id || null,
    localInstanceId: s.lobby?.localInstanceId || null,
    patch,
  };
}

/** Préparation transition A → B : suspendre A sans détruire son état local. */
function prepareLobbyJoinTransition() {
  bumpLobbyRuntimeGeneration();
  stopMultiplayerSync();
  stopLobbyPresenceSync();
}

/** Commit après join/create réussi depuis un lobby actif : nettoyer la soirée de A. */
function commitLobbyJoinTransition() {
  resetEveningState();
  bumpLobbyRuntimeGeneration();
}

/** Rollback si join/create échoue : rétablir A et sa sync. */
async function rollbackLobbyJoinTransition(snapshot) {
  bumpLobbyRuntimeGeneration();
  stopMultiplayerSync();
  stopLobbyPresenceSync();
  clearCachedGameSession();
  if (snapshot?.patch) {
    saveStatePatch(snapshot.patch);
  }
  const canRestoreMp =
    snapshot?.lobbyId && getState().inLobby && isSupabaseConfigured() && isGameSyncActive();
  if (canRestoreMp) {
    await refreshGameSession();
    startMultiplayerSync();
  }
}

/**
 * Compensation serveur B puis rollback local A (ordre : compensation d'abord).
 * @param {{ joinEffects?: import('./lobbyJoinEffects.js').LobbyJoinEffects|null, rollbackSnapshot?: object|null }} ctx
 */
async function runFinalizeFailedJoinAttempt(ctx) {
  await finalizeFailedJoinAttempt(ctx, {
    deleteOwnLobbyMembershipById,
    rollbackLobbyJoinTransition,
  });
}

function localParticipant(ready = false, { asHost = false } = {}) {
  const name = getLocalDisplayName();
  return {
    name,
    emoji: getLocalEmoji(),
    color: asHost ? "#A78BFA" : "#60A5FA",
    ready,
    isHost: asHost,
    isLocal: true,
  };
}

function publishOpenLobby(code, lobby) {
  const open = { ...(getState().openLobbies || {}) };
  open[code] = {
    code,
    localInstanceId: lobby.localInstanceId || null,
    hostName: lobby.participants.find((p) => p.isHost)?.name || "Hôte",
    participants: lobby.participants
      .filter((p) => !p.isLocal)
      .map((p) => ({ ...p, isLocal: false })),
    messages: [...(lobby.messages || [])],
    status: lobby.status || "waiting",
    gameId: lobby.gameId || null,
    updatedAt: Date.now(),
  };
  saveStatePatch({ openLobbies: open });
}

export function getOpenLobby(code) {
  const trimmed = code?.trim().toUpperCase().replace(/\s/g, "");
  return getState().openLobbies?.[trimmed] || null;
}

export function getLobby() {
  return getState().lobby;
}

export function getLobbyStatus() {
  return getLobby()?.status || "waiting";
}

function hasRemoteEveningActivity() {
  if (!isGameSyncActive()) return false;
  const row = getCachedGameSession();
  if (!row?.state) return false;
  const st = row.state;
  if (st.eveningGamesRecorded && Object.keys(st.eveningGamesRecorded).length > 0) return true;
  if (st.scores && Object.values(st.scores).some((n) => Number(n) > 0)) return true;
  const s = st.stats || {};
  return (
    (s.hotTakesPlayed || 0) > 0 ||
    (s.speedVotesPlayed || 0) > 0 ||
    (s.clutchesPlayed || 0) > 0 ||
    (s.wrongAnswersPlayed || 0) > 0 ||
    (s.playlistGuessesPlayed || 0) > 0 ||
    (s.traitreGamesPlayed || 0) > 0 ||
    (s.triviaGamesPlayed || 0) > 0 ||
    (s.truthMetersPlayed || 0) > 0 ||
    (s.consensusGamesPlayed || 0) > 0 ||
    (s.dilemmasPlayed || 0) > 0 ||
    (s.liesTotal || 0) > 0 ||
    (s.tierNightsPlayed || 0) > 0 ||
    (s.guessLieGamesPlayed || 0) > 0
  );
}

/** Soirée lancée : statut playing OU déjà des parties / scores (entre deux jeux inclus). */
export function isLobbyEveningStarted() {
  if (getLobbyStatus() === "playing") return true;
  if (hasEveningStatsActivity()) return true;
  if (hasRemoteEveningActivity()) return true;
  return false;
}

export function getLobbyGameId() {
  return getLobby()?.gameId || null;
}

export async function setLobbyPlaying(gameId) {
  if (getState().gameScoreSessionGameId !== gameId) {
    beginGameScoreSession(gameId);
  } else {
    setActiveScoringGame(gameId);
  }
  if (isSupabaseConfigured() && getLobby()?.id) {
    await setLobbyStatusSupabase("playing", gameId);
    return;
  }
  const lobby = { ...getLobby(), status: "playing", gameId };
  saveStatePatch({ lobby });
  if (lobby.code) publishOpenLobby(lobby.code, lobby);
}

/** Entre deux jeux (MP) : reste en soirée, retour au hub menu. */
export async function setLobbyBetweenGames() {
  if (isSupabaseConfigured() && getLobby()?.id) {
    await setLobbyStatusSupabase("playing", "menu");
    return;
  }
  const lobby = { ...getLobby(), status: "playing", gameId: "menu" };
  saveStatePatch({ lobby });
  if (lobby.code) publishOpenLobby(lobby.code, lobby);
}

export async function setLobbyWaiting() {
  if (isSupabaseConfigured() && getLobby()?.id) {
    await setLobbyStatusSupabase("waiting", null);
    return;
  }
  const lobby = { ...getLobby(), status: "waiting", gameId: null };
  const participants = mapParticipantsReadyFalse(lobby.participants);
  const next = { ...lobby, participants };
  saveStatePatch({ lobby: next });
  if (next.code) publishOpenLobby(next.code, next);
}

export async function resetAllParticipantsReady() {
  const lobby = getLobby();
  if (!lobby?.participants?.length) return;

  if (isSupabaseConfigured() && lobby.id) {
    await setLocalReadySupabase(false);
    return;
  }

  const participants = mapParticipantsReadyFalse(lobby.participants);
  const next = { ...lobby, participants };
  saveStatePatch({ lobby: next });
  if (next.code) publishOpenLobby(next.code, next);
}

/**
 * Mount / remount du lobby : non destructif pour `ready`.
 * Sous Supabase, réhydrate depuis le bundle serveur (ARCH-09 léger) sans écraser
 * le serveur avec un ready local par défaut. Ne wipe jamais les prêts.
 */
export async function reconcileLobbyReadyOnMount() {
  if (
    !shouldReconcileLobbyReadyFromServer({
      supabaseConfigured: isSupabaseConfigured(),
      lobbyId: getLobby()?.id,
    })
  ) {
    return;
  }
  try {
    await refreshLobbyFromSupabase();
  } catch (e) {
    console.warn("REVEAL lobby ready reconcile:", e?.message || e);
  }
}

export function hasActiveLobby() {
  const lobby = getLobby();
  if (!getState().inLobby || !lobby?.code) {
    return false;
  }
  if (!lobby.participants?.length) {
    if (isSupabaseConfigured() && lobby.id && getSupabaseUserId()) {
      return true;
    }
    return false;
  }
  if (isSupabaseConfigured()) {
    const uid = getSupabaseUserId();
    if (uid && !lobby.participants.some((p) => p.userId === uid || p.isLocal)) {
      return false;
    }
  }
  return true;
}

/** E2 — promote snapshot après join Supabase finalisé (pas rollback / compensation). */
function promoteMembershipSnapshotAfterJoinConfirmed(canonicalRow = null) {
  const userId = getSupabaseUserId();
  const lobby = getLobby();
  if (!userId || !lobby?.id || !lobby?.code) return;

  alignMembershipSnapshotAfterLobbyHydration({
    bundle: {
      id: lobby.id,
      code: lobby.code,
      status: lobby.status,
      gameId: lobby.gameId,
      hostId: lobby.hostId,
      participants: lobby.participants,
    },
    userId,
    source: MEMBERSHIP_HYDRATION_SOURCE.JOIN_CONFIRMED,
    canonicalRow,
  });
}

/** Tente de restaurer le lobby depuis Supabase (compte connecté ou invité via membership). */
export async function tryRecoverLobbyFromServer() {
  if (!isSupabaseConfigured()) {
    return { ok: false };
  }
  try {
    const res = await recoverLobbyFromServer();
    if (res.ok || res.staleMembership) setGuestRecoveryCaptchaRequired(false);
    if (res.captchaRequired) setGuestRecoveryCaptchaRequired(true);
    return res.ok
      ? { ok: true, code: res.code }
      : {
          ok: false,
          staleMembership: Boolean(res.staleMembership),
          captchaRequired: Boolean(res.captchaRequired),
        };
  } catch (e) {
    console.warn("REVEAL recover lobby:", e.message || e);
    return { ok: false };
  }
}

export { peekServerLobbyForUser, getRememberedLobbyCode };

/**
 * Nettoie un lobby fantôme en local (sans quitter Supabase côté serveur).
 * Notifie après mutations pour rafraîchir les écrans dérivés (ex. settings).
 */
export function forceClearClientLobbyState() {
  performLobbyBoundaryTeardown();
  saveStatePatch({ inLobby: false, lobby: null, lobbyCode: null });
  notifyLobbyBundleUpdated();
}

export function handleGuestRecoveryRequiresCaptcha() {
  stopLobbyPresenceSync();
  forceClearClientLobbyState();
  setGuestRecoveryCaptchaRequired(true);
  try {
    sessionStorage.setItem("reveal-auth-tab", "guest");
  } catch {
    /* storage indisponible */
  }
  navigate("home", { reset: true, params: { authTab: "guest" } });
}

/**
 * Recovery invité quand uid absent : tente membership avant tout wipe local.
 * @returns {Promise<{ cleared: boolean, recovered?: boolean }|null>} null si uid présent
 */
async function reconcileLobbyWhenUidMissing() {
  if (loadGuestMembership()?.membershipId) {
    if (isGuestRecoveryCaptchaPending()) {
      return { cleared: false, captchaRequired: true };
    }
    console.debug("[Lobby Recovery] trying membership recovery");
    const recovered = await tryRecoverLobbyFromServer();
    console.debug("[DEBUG UID MISSING RECOVERY RESULT]", recovered);
    if (recovered.ok) {
      console.debug("[Lobby Recovery] restored lobby");
      return { cleared: false, recovered: true };
    }
    if (recovered.captchaRequired) {
      console.debug("[Lobby Recovery] captcha required for recovery");
      handleGuestRecoveryRequiresCaptcha();
      return { cleared: true, captchaRequired: true };
    }
    if (!recovered.staleMembership) {
      return { cleared: false };
    }
  }

  console.debug("[Lobby Recovery] clearing stale lobby");
  forceClearClientLobbyState();
  if (loadGuestMembership()) clearGuestMembership();
  return { cleared: true };
}

/**
 * Vérifie que le joueur local est encore membre du lobby (après F5 / nouvelle session anon).
 * Restaure depuis Supabase si le localStorage a perdu l'état.
 * @returns {{ cleared: boolean, recovered?: boolean }}
 */
export async function reconcileLobbyMembership() {
  if (!isSupabaseConfigured()) {
    if (!getState().inLobby) return { cleared: false };
    const lobby = getLobby();
    if (!lobby?.code || !lobby.participants?.length) {
      forceClearClientLobbyState();
      return { cleared: true };
    }
    return { cleared: false };
  }

  const liveUser = await getLiveSupabaseUserId();
  const hasGuestMembership = Boolean(loadGuestMembership()?.membershipId);
  const stateUser = getState().user;
  if (!liveUser && hasGuestMembership && isGuestRecoveryCaptchaPending()) {
    return { cleared: false, captchaRequired: true };
  }
  if (!liveUser && hasGuestMembership && !(stateUser?.loggedIn && stateUser?.isGuest === false)) {
    return reconcileLobbyWhenUidMissing();
  }

  const uid = liveUser || getSupabaseUserId();

  if (!getState().inLobby) {
    if (uid) {
      const recovered = await tryRecoverLobbyFromServer();
      if (recovered.ok) return { cleared: false, recovered: true };
    }
    return { cleared: false };
  }

  const lobbyId = getLobby()?.id;

  if (!lobbyId) {
    if (uid) {
      const recovered = await tryRecoverLobbyFromServer();
      if (recovered.ok) return { cleared: false, recovered: true };
    }
    if (!uid) return reconcileLobbyWhenUidMissing();
    return { cleared: false };
  }

  if (!uid) {
    return reconcileLobbyWhenUidMissing();
  }

  try {
    if (!getSupabaseUserId() && loadGuestMembership()?.membershipId) {
      return reconcileLobbyWhenUidMissing();
    }
  
    await refreshLobbyFromSupabase();
  
    const participants = getLobbyParticipants();
  
    if (!participants.length || !participants.some((p) => p.userId === uid)) {
      const stillMember = await isLocalStillLobbyMember(lobbyId);
  
      if (stillMember !== false) {
        if (stillMember === true) {
          const recovered = await tryRecoverLobbyFromServer();
          if (recovered.ok) return { cleared: false, recovered: true };
        }
  
        return { cleared: false };
      }
  
      forceClearClientLobbyState();
      return { cleared: true };
    }
  
    return { cleared: false };
  } catch (e) {
    console.warn("REVEAL reconcile lobby:", e.message || e);
    const stillMember = await isLocalStillLobbyMember(lobbyId);
    if (stillMember !== false) return { cleared: false };
    forceClearClientLobbyState();
    return { cleared: true };
  }
}

/** Réinitialisation complète (session + stockage local) - déblocage accueil invité. */
export async function resetAppToCleanHome() {
  stopMultiplayerSync();
  stopLobbyPresenceSync();
  try {
    await signOutSupabase();
  } catch (e) {
    console.warn("REVEAL reset signOut:", e.message || e);
  }
  resetWelcomeSeen();
  try {
    localStorage.removeItem("reveal-app-state");
    localStorage.removeItem("reveal-auth-credentials");
    clearGuestMembership();
  } catch {
    /* ignore */
  }
  try {
    sessionStorage.removeItem("reveal-pending-join");
    sessionStorage.setItem("reveal-auth-tab", "guest");
  } catch {
    /* storage indisponible */
  }
  window.location.reload();
}

export function goToLobby() {
  const lobby = getLobby();
  if (!lobby?.code || !lobby.participants?.length) {
    navigate("home", { reset: true });
    return;
  }
  saveStatePatch({ inLobby: true });
  navigate("lobby", { navStack: ["home", "lobby"] });
}

/**
 * Après join / rejoin : partie ou prep en cours → jeu ; soirée lancée → menu jeux ; sinon → lobby.
 */
export async function navigateAfterLobbyJoin() {
  if (!hasActiveLobby()) {
    navigate("home", { reset: true });
    return;
  }
  clearSessionRouteSuppress();
  await routeToEveningHub({ rejoinActiveGame: true });
}

/**
 * Menu jeux ou reprise de partie (accueil / paramètres).
 * @param {boolean} [hubOnly] - true pour l'onglet Jeux : menu sans quitter prep/partie.
 */
export async function returnToEveningGames({ rejoinActiveGame = false, hubOnly = false } = {}) {
  if (!hasActiveLobby()) {
    if (rejoinActiveGame) {
      const recovered = await tryRecoverLobbyFromServer();
      if (!recovered.ok) {
        navigate("home", { reset: true });
        return;
      }
    } else {
      navigate("home", { reset: true });
      return;
    }
  }

  if (rejoinActiveGame) {
    clearSessionRouteSuppress();
    await routeToEveningHub({ rejoinActiveGame: true });
    return;
  }

  if (!hubOnly && isGameSyncActive()) {
    startMultiplayerSync();
    const row = await refreshGameSession();
    const screen = row ? getEffectiveSessionScreen(row) : null;
    if (screen && isOnPostGameScreen(screen) && isLobbyHost()) {
      await returnToGameSelect();
      return;
    }
    if (screen && (isActiveGameSessionScreen(screen) || isOnGameSetupScreen(screen))) {
      await returnToGameSelect();
      return;
    }
  }

  await routeToEveningHub({ rejoinActiveGame: false, allowPostGameExit: hubOnly });
}

export async function goToGameSelect() {
  await returnToEveningGames({ hubOnly: true });
}

/** Reprise Guess The Lie si l'état local indique une partie en cours mais #app est vide (F5). */
function resumeLocalGuessLiePlay() {
  if (!isGuessLieGameActive()) return false;
  if (isAppContentMounted()) return true;
  return tryEnterGuessLiePlayFromWait();
}

export async function routeToEveningHub({
  rejoinActiveGame = true,
  allowPostGameExit = false,
} = {}) {
  if (!hasActiveLobby()) return false;

  saveStatePatch({ inLobby: true });

  if (isSupabaseConfigured()) {
    startLobbyPresenceSync();
    try {
      await refreshLobbyFromSupabase();
    } catch (e) {
      console.warn("REVEAL evening hub:", e);
    }
  }

  if (isGameSyncActive()) {
    startMultiplayerSync();
    const row = await refreshGameSession();
    await refreshEveningScoresFromSession();
    if (rejoinActiveGame && resumeLocalGuessLiePlay()) {
      return true;
    }
    if (rejoinActiveGame && (await routeToActiveGameIfNeeded(row, { force: true }))) {
      resumeLocalGuessLiePlay();
      const passive = getCurrentScreen();
      if (passive === "home" || passive === "settings") {
        if (!isLobbyEveningStarted()) goToLobby();
        else navigate("game-select", { navStack: ["home", "lobby", "game-select"] });
      }
      return true;
    }

    if (rejoinActiveGame && row) {
      const effective = getEffectiveSessionScreen(row);
      if (
        effective &&
        (isActiveGameSessionScreen(effective) || isOnGameSetupScreen(effective))
      ) {
        routeToSessionScreen(effective, { force: true });
        return true;
      }
    }

    if (!isLobbyEveningStarted()) {
      goToLobby();
      return true;
    }
    if (!allowPostGameExit && isOnPostGameScreen(getCurrentScreen())) return true;
    navigate("game-select", { navStack: ["home", "lobby", "game-select"] });
    return true;
  }

  if (!isLobbyEveningStarted()) {
    goToLobby();
    return true;
  }

  if (!allowPostGameExit && isOnPostGameScreen(getCurrentScreen())) return true;
  navigate("game-select", { navStack: ["home", "lobby", "game-select"] });
  return true;
}

/**
 * Après F5 ou reconnexion : resynchronise et rejoint la partie en cours si besoin.
 * @param {{ force?: boolean }} [options] - force=true au boot ; false si l’utilisateur est allé à l’accueil volontairement.
 */
export async function resumeEveningSession({ force = false } = {}) {
  if (!hasActiveLobby()) {
    const recovered = await tryRecoverLobbyFromServer();
    if (!recovered.ok) return false;
  }
  if (!force && isSessionRouteSuppressed()) return false;

  if (force) clearSessionRouteSuppress();
  return routeToEveningHub({ rejoinActiveGame: true });
}

export function getLobbyParticipants() {
  return getState().lobby?.participants || [];
}

/**
 * Crée un lobby.
 *
 * Garde serveur (Vague C) : uniquement `queryActiveLobbyMembership()` —
 * `found` / `unknown` → refus ; `none` → INSERT. `peekServerLobbyForUser`
 * (filtre 24 h) n’est plus une garde de création.
 *
 * Vague E4 : INSERT autoritatif = RPC `create_lobby_atomically` (UNIQUE user_id).
 * `assertCanInsertLobby` reste un pré-check UX, pas l’autorité finale.
 */
export async function createLobby() {
  const activeLobby = hasActiveLobby() ? getLobby() : null;
  if (activeLobby?.code) {
    throw makeLobbyCreateError(
      LOBBY_CREATE_ERROR.CACHE_ACTIVE,
      `Quitte le lobby ${activeLobby.code} avant d'en créer un nouveau.`,
      { lobbyCode: activeLobby.code }
    );
  }

  if (isSupabaseConfigured()) {
    await assertCanInsertLobby({
      hasActiveLobby: false,
      queryActiveLobbyMembership,
      getSupabaseUserId,
      getMembershipSnapshot,
      setMembershipSnapshot,
    });
  }

  performLobbyBoundaryTeardown();

  if (isSupabaseConfigured()) {
    const res = await createLobbySupabase();
    if (!res.ok) throw new Error(res.error);
    if (res.alreadyExists) {
      await showAppAlert("Une soirée est déjà active. Reconnexion…", {
        title: "Lobby existant",
        icon: "ℹ️",
      });
      const recovered = await recoverAfterMembershipAlreadyExists();
      if (!recovered.ok) {
        if (recovered.unknown) {
          throw makeLobbyCreateError(
            LOBBY_CREATE_ERROR.CHECK_FAILED,
            recovered.error || "Impossible de vérifier votre situation. Réessayez."
          );
        }
        throw makeLobbyCreateError(
          LOBBY_CREATE_ERROR.ALREADY_EXISTS,
          recovered.error || "Une soirée est déjà active."
        );
      }
      return recovered.code;
    }
    return res.code;
  }

  const code = genLobbyCode();
  const participants = [localParticipant(false, { asHost: true })];
  ensurePlayerScore(getLocalDisplayName());
  syncAllPlayerScores();
  const localInstanceId = newOfflineLobbyInstanceId();
  const lobby = {
    code,
    localInstanceId,
    participants,
    messages: [],
    status: "waiting",
    gameId: null,
  };
  saveStatePatch({
    lobby,
    lobbyCode: code,
    inLobby: true,
  });
  publishOpenLobby(code, lobby);
  incrementGlobalStat("lobbiesCreated");
  return code;
}

export async function joinLobby(code) {
  console.log("[DEBUG JOIN LOBBY START]", { code });

  const fromActiveLobby = hasActiveLobby();
  const rollbackSnapshot = fromActiveLobby ? captureLobbyRollbackSnapshot() : null;

  if (fromActiveLobby) {
    prepareLobbyJoinTransition();
  } else {
    performLobbyBoundaryTeardown();
  }

  try {
    if (isSupabaseConfigured()) {
      console.log("[DEBUG CALL JOIN SUPABASE]");
      const joinEffects = createLobbyJoinEffects(loadGuestMembership());
      let res;
      try {
        res = await joinLobbySupabase(code, { joinEffects });
      } catch (joinErr) {
        await runFinalizeFailedJoinAttempt({ joinEffects, rollbackSnapshot });
        throw joinErr;
      }
      if (!res.ok) {
        await runFinalizeFailedJoinAttempt({ joinEffects, rollbackSnapshot });
        // E4 — déjà membre ailleurs : re-query + hydrate soirée canonique.
        if (res.code === "membership_already_elsewhere") {
          const recovered = await recoverAfterMembershipAlreadyExists();
          if (recovered.ok) {
            return { ok: true, code: recovered.code, recoveredExisting: true };
          }
          return {
            ok: false,
            error: recovered.error || res.error,
            code: recovered.unknown ? "membership_check_failed" : res.code,
          };
        }
        return res;
      }
      markLobbyJoinFinalized(joinEffects);
      if (fromActiveLobby) {
        commitLobbyJoinTransition();
      }
      promoteMembershipSnapshotAfterJoinConfirmed(res.membershipRow || null);
      return res;
    }

    const trimmed = code.trim().toUpperCase().replace(/\s/g, "");
    if (trimmed.length < 4) {
      if (rollbackSnapshot) await rollbackLobbyJoinTransition(rollbackSnapshot);
      return { ok: false, error: "Code invalide." };
    }

    const published = getOpenLobby(trimmed);
    if (!published) {
      if (rollbackSnapshot) await rollbackLobbyJoinTransition(rollbackSnapshot);
      return {
        ok: false,
        error:
          "Code introuvable. Vérifie le code auprès de l'hôte ou ouvre le lien d'invitation qu'il t'a envoyé.",
      };
    }

    const me = localParticipant(false, { asHost: false });
    ensurePlayerScore(me.name);

    const others = published.participants
      .filter((p) => p.name !== me.name)
      .map((p) => ({ ...p, ready: false, isLocal: false }));
    const participants = [...others, { ...me, ready: false }];

    const lobby = {
      code: trimmed,
      localInstanceId: published.localInstanceId || newOfflineLobbyInstanceId(),
      participants,
      messages: published.messages || [],
      status: published.status || "waiting",
      gameId: published.gameId || null,
    };

    saveStatePatch({
      lobbyCode: trimmed,
      lobby,
      inLobby: true,
      guessLie: { sessionId: trimmed, submissions: {}, lobbyComplete: false, currentRound: 0 },
    });

    syncAllPlayerScores();

    const gs = { ...getState().globalStats };
    gs.playersJoined = (gs.playersJoined || 0) + 1;
    saveStatePatch({ globalStats: gs });

    if (fromActiveLobby) {
      commitLobbyJoinTransition();
    }

    return { ok: true, code: trimmed };
  } catch (err) {
    throw err;
  }
}

function normalizeLobbyCode(code) {
  return String(code || "")
    .trim()
    .toUpperCase()
    .replace(/\s/g, "");
}

export async function joinLobbyAsGuest(code, guestName, captchaToken = null, emoji = null) {
  setGuestRecoveryCaptchaRequired(false);
  const auth = await loginAsGuest(guestName, captchaToken, emoji);
  if (!auth.ok) return auth;

  const joinCode =
    normalizeLobbyCode(code) || normalizeLobbyCode(getLobby()?.code) || normalizeLobbyCode(getRememberedLobbyCode());

  const nextCode = joinCode;
  const currentCode = normalizeLobbyCode(getLobby()?.code);
  if (hasActiveLobby() && currentCode && nextCode && currentCode !== nextCode) {
    await leaveLobby({ navigateAway: false });
  }

  const res = await joinLobby(joinCode);

  console.log("[JOIN RESULT]", res);
    if (!res.ok) {
    const sessionCleared = !auth.hadSession;
    if (sessionCleared) {
      await clearGuestSessionAfterFailedJoin();
    }
    return { ...res, sessionCleared };
  }
  return res;
}

/** Évite de rester « invité » sans lobby si le code est invalide ou le join échoue. */
async function clearGuestSessionAfterFailedJoin() {
  if (isSupabaseConfigured()) {
    try {
      await signOutSupabase();
    } catch (e) {
      console.warn("REVEAL guest rollback:", e.message || e);
    }
  }
  saveStatePatch({
    user: {
      email: null,
      name: null,
      loggedIn: false,
      isGuest: false,
      provider: null,
    },
    inLobby: false,
    lobby: null,
    lobbyCode: null,
  });
  sessionStorage.setItem("reveal-auth-tab", "guest");
}

/** Invité : l'hôte a fermé le lobby (realtime ou refresh). */
export async function handleLobbyDissolvedForGuest() {
  if (lobbyDissolveHandling || lobbyKickHandling) return;
  if (!getState().inLobby) return;
  if (isLocalLobbyHost()) return;

  lobbyDissolveHandling = true;
  stopMultiplayerSync();
  stopLobbyPresenceSync();

  // Preuve : DELETE lobby (Realtime) ou membership absente confirmée (refresh gone).
  const dissolvedLobbyId = getLobby()?.id || null;
  const dissolvedUserId = getSupabaseUserId();
  if (dissolvedUserId && dissolvedLobbyId) {
    commitMembershipRemoved({ userId: dissolvedUserId, lobbyId: dissolvedLobbyId });
  }

  const wasGuest = isGuest();
  await signOutAnonGuestIfNeeded(wasGuest);
  applyLeaveLobbyLocal({ wasGuest, navigateAway: false });

  await showAppAlert("L'hôte a quitté le lobby.", { title: "Lobby fermé", icon: "👋" });

  lobbyDissolveHandling = false;
  navigate("home", { reset: true });
}

/** Invité : retiré du lobby par l'hôte (kick) — membership locale absente côté serveur. */
export async function handleKickedFromLobby() {
  if (lobbyKickHandling || lobbyDissolveHandling) return;
  if (!getState().inLobby) return;
  if (isLocalLobbyHost()) return;

  lobbyKickHandling = true;
  stopMultiplayerSync();
  stopLobbyPresenceSync();

  // Preuve : DELETE lobby_members user_id === local (Realtime) ou uid absent du bundle.
  // Ne s'applique jamais au kick d'un *autre* joueur (hôte reste dans le roster).
  const kickedLobbyId = getLobby()?.id || null;
  const kickedUserId = getSupabaseUserId();
  if (kickedUserId && kickedLobbyId) {
    commitMembershipRemoved({ userId: kickedUserId, lobbyId: kickedLobbyId });
  }

  const wasGuest = isGuest();
  await signOutAnonGuestIfNeeded(wasGuest);
  applyLeaveLobbyLocal({ wasGuest, navigateAway: false });

  await showAppAlert("Tu as été retiré du lobby par l'hôte.", {
    title: "Retiré du lobby",
    icon: "👋",
  });

  lobbyKickHandling = false;
  navigate("home", { reset: true });
}

/**
 * E5 — après DISSOLVED / ALREADY_GONE (succès silencieux pour ALREADY_GONE).
 */
function applyHostDissolveLocalSuccess({ lobbyId, wasGuest, navigateAway }) {
  beginPostLeaveHomeTransition();
  const hostUserId = getSupabaseUserId();
  if (hostUserId && lobbyId) {
    commitMembershipRemoved({ userId: hostUserId, lobbyId });
  }
  clearTraitrePrivateLocalForLobby(lobbyId);
  applyLeaveLobbyLocal({ wasGuest, navigateAway });
}

/**
 * E5 — timeout dissolve X puis membership vivante Y (≠ X).
 * Ordre : drop cache X (sans Home, sans soft-hold) → snapshot Y déjà appliqué
 * en re-query → recover Y → goToLobby. Soft-hold bloquerait le chrome found Y.
 *
 * @returns {Promise<{ ok: boolean, status: string, code?: string, error?: string }>}
 */
async function reconcileHostDissolveCanonicalElsewhere({
  attemptedLobbyId,
  canonicalLobbyId = null,
} = {}) {
  // Ne pas beginPostLeave : post_leave > found masquerait Resume / bloquerait Y.
  clearTraitrePrivateLocalForLobby(attemptedLobbyId);

  const localId = getLobby()?.id;
  if (localId && String(localId) === String(attemptedLobbyId)) {
    // Drop X sans wipe auth invité (besoin session pour recover Y) ni navigate Home.
    performLobbyBoundaryTeardown();
    const guestMem = loadGuestMembership();
    if (
      guestMem?.lobbyId &&
      String(guestMem.lobbyId) === String(attemptedLobbyId)
    ) {
      clearGuestMembership();
    }
    saveStatePatch({ inLobby: false, lobby: null, lobbyCode: null });
  }

  // commitMembershipRemoved(X) no-op si snapshot déjà found Y (lobby_mismatch).
  const userId = getSupabaseUserId();
  if (userId && attemptedLobbyId) {
    commitMembershipRemoved({ userId, lobbyId: attemptedLobbyId });
  }

  endPostLeaveHomeTransition();

  const recovered = await recoverLobbyFromServer({ withMessages: true });
  if (!recovered?.ok) {
    return {
      ok: false,
      status: LOBBY_DISSOLVE_STATUS.CANONICAL_ELSEWHERE,
      error:
        "Une autre soirée est active sur le serveur, mais la reconnexion a échoué. Réessaie depuis l'accueil.",
      canonicalLobbyId: canonicalLobbyId || recovered?.lobbyId || null,
    };
  }

  goToLobby();
  return {
    ok: true,
    status: LOBBY_DISSOLVE_STATUS.CANONICAL_ELSEWHERE,
    code: recovered.code,
    canonicalLobbyId: recovered.lobbyId || canonicalLobbyId,
  };
}

/**
 * E5 — NOT_ALLOWED : pas de wipe succès ; relecture membership E2.
 */
async function reconcileHostDissolveNotAllowed(lobbyId) {
  invalidateMembershipSnapshot();
  const userId = getSupabaseUserId();
  const queryAuthGeneration = getMembershipAuthGeneration();
  const result = await queryActiveLobbyMembership(userId);

  applyMembershipQueryToSnapshot(result, {
    getMembershipSnapshot,
    setMembershipSnapshot,
    source: "e5-dissolve-not-allowed",
    userId,
    queryAuthGeneration,
  });

  if (result.status === "found" && result.membership?.lobbyId) {
    const mid = result.membership.lobbyId;
    if (String(mid) !== String(lobbyId)) {
      return reconcileHostDissolveCanonicalElsewhere({
        attemptedLobbyId: lobbyId,
        canonicalLobbyId: mid,
      });
    }
    await recoverLobbyFromServer({ withMessages: true });
    return {
      ok: false,
      status: LOBBY_DISSOLVE_STATUS.NOT_ALLOWED,
      error: "Tu n'es pas l'hôte de ce lobby. L'état a été resynchronisé.",
    };
  }

  if (result.status === "none") {
    // Lobby encore présent côté DEFINER, mais plus de membership vivante :
    // pas de promotion dissolve ; clear local seulement si c’était ce lobby.
    const localId = getLobby()?.id;
    if (localId && String(localId) === String(lobbyId)) {
      beginPostLeaveHomeTransition();
      if (userId) commitMembershipRemoved({ userId, lobbyId });
      clearTraitrePrivateLocalForLobby(lobbyId);
      applyLeaveLobbyLocal({ wasGuest: isGuest(), navigateAway: true });
    }
    return {
      ok: false,
      status: LOBBY_DISSOLVE_STATUS.NOT_ALLOWED,
      error: "Tu n'es pas l'hôte de ce lobby.",
    };
  }

  return {
    ok: false,
    status: LOBBY_DISSOLVE_STATUS.NOT_ALLOWED,
    unknown: true,
    error:
      "Fermeture refusée par le serveur, et la vérification membership a échoué. Réessaie.",
  };
}

/** Hôte : supprime le lobby pour tout le monde. */
export async function dissolveLobbyAsHost({ navigateAway = true } = {}) {
  stopMultiplayerSync();
  stopLobbyPresenceSync();

  const lobby = getLobby();
  const code = lobby?.code;
  const lobbyId = lobby?.id || null;
  const wasGuest = isGuest();

  if (isSupabaseConfigured() && lobby?.id) {
    const res = await closeLobbySupabase();
    if (!res.ok) {
      if (res.status === LOBBY_DISSOLVE_STATUS.NOT_ALLOWED) {
        return reconcileHostDissolveNotAllowed(lobbyId);
      }
      return {
        ok: false,
        error: res.error,
        status: res.status ?? null,
        unknown: Boolean(res.unknown),
        retryable: Boolean(res.retryable),
      };
    }
    if (res.status === LOBBY_DISSOLVE_STATUS.CANONICAL_ELSEWHERE) {
      // Pas de signOut anon : session requise pour recover Y.
      return reconcileHostDissolveCanonicalElsewhere({
        attemptedLobbyId: lobbyId,
        canonicalLobbyId: res.canonicalLobbyId ?? null,
      });
    }
    // E3 soft-hold — DISSOLVED et ALREADY_GONE (succès silencieux).
    await signOutAnonGuestIfNeeded(wasGuest);
    applyHostDissolveLocalSuccess({ lobbyId, wasGuest, navigateAway });
    return { ok: true, status: res.status };
  } else if (code) {
    clearLocalOpenLobbySlot(code);
  }

  applyLeaveLobbyLocal({ wasGuest, navigateAway });
  return { ok: true };
}

/** Confirmation puis sortie : hôte → dissolve ; membre → leave (soi uniquement). */
export async function confirmAndLeaveLobby({ navigateAway = true } = {}, testDeps = null) {
  if (!hasActiveLobby()) return { ok: true };

  const confirm = testDeps?.showAppConfirm ?? showAppConfirm;
  const leaveFn = testDeps?.leaveLobby ?? leaveLobby;
  const dissolveFn = testDeps?.dissolveLobbyAsHost ?? dissolveLobbyAsHost;

  if (isSupabaseConfigured() && isLocalLobbyHost()) {
    const ok = await confirm(
      "Le lobby sera fermé pour tous les joueurs. Continuer ?",
      {
        title: "Quitter le lobby",
        confirmLabel: "Fermer le lobby",
        cancelLabel: "Annuler",
        icon: "🚪",
      }
    );
    if (!ok) return { ok: false, cancelled: true };
    return dissolveFn({ navigateAway });
  }

  const cfg = SERVER_LEAVE_CONFIRM.member;
  const ok = await confirm(cfg.message, {
    title: cfg.title,
    confirmLabel: cfg.confirmLabel,
    cancelLabel: cfg.cancelLabel,
    icon: cfg.icon,
  });
  if (!ok) return { ok: false, cancelled: true };
  return leaveFn({ navigateAway });
}

/**
 * Feedback échec leave volontaire (pas busy, pas cancel).
 * @param {{ ok?: boolean, cancelled?: boolean, busy?: boolean, error?: string }|null|undefined} res
 */
export async function notifyVoluntaryLeaveFailure(res, testDeps = null) {
  return notifyLeaveFailureCore(res, {
    showAppAlert: testDeps?.showAppAlert ?? showAppAlert,
  });
}

/**
 * Quitte le lobby sans supprimer le compte connecté.
 * Invité / membre : runVoluntaryMemberLeave (contrat échec distant strict).
 * Hôte : redirige vers confirmAndLeaveLobby → dissolve.
 *
 * Branche locale (pas de lobby.id Supabase) : démo / offline — cleanup immédiat
 * sans DELETE distant (voir runVoluntaryMemberLeave).
 */
export async function leaveLobby({ navigateAway = true } = {}) {
  if (isSupabaseConfigured() && getLobby()?.id && isLocalLobbyHost()) {
    return confirmAndLeaveLobby({ navigateAway });
  }

  return runVoluntaryMemberLeave(
    { navigateAway },
    {
      getLobby,
      isGuest,
      isSupabaseConfigured,
      leaveLobbySupabase,
      stopMultiplayerSync,
      stopLobbyPresenceSync,
      signOutAnonGuestIfNeeded,
      clearLocalOpenLobbySlot,
      applyLeaveLobbyLocal,
      getUserId: getSupabaseUserId,
      commitMembershipRemoved,
      beginPostLeaveHomeTransition,
    }
  );
}

/**
 * Vague D — quitter / fermer depuis une membership serveur sans cache hydraté.
 * Identité : { lobbyId, code, role } du snapshot — pas state.lobby.
 * Ne remplace pas leaveLobby / dissolveLobbyAsHost (pipeline cache-actif).
 *
 * @param {{ lobbyId: string, code?: string|null, role: "host"|"member" }} membership
 * @returns {Promise<{ ok: true, action: "left"|"dissolved", lobbyId: string, code?: string|null }>}
 */
export async function leaveLobbyMembershipFromServer(membership) {
  if (!isSupabaseConfigured()) {
    const { makeLobbyServerLeaveError, LOBBY_SERVER_LEAVE_ERROR } = await import(
      "./lobbyServerLeave.js"
    );
    throw makeLobbyServerLeaveError(
      LOBBY_SERVER_LEAVE_ERROR.FAILED,
      "Multijoueur en ligne requis."
    );
  }

  return runServerOnlyLeave(
    {
      lobbyId: membership?.lobbyId,
      code: membership?.code,
      role: membership?.role,
      hasActiveLobby: hasActiveLobby(),
    },
    {
      getUserId: () => getSupabaseUserId() || null,
      fetchLobbyHostId: fetchLobbyHostIdById,
      deleteOwnMembership: deleteOwnLobbyMembershipById,
      closeLobbyAsHost: closeLobbyByIdAsHost,
    }
  ).then(async (result) => {
    if (result?.action === "canonical_elsewhere") {
      return reconcileHostDissolveCanonicalElsewhere({
        attemptedLobbyId: membership?.lobbyId,
        canonicalLobbyId: result.canonicalLobbyId ?? null,
      });
    }
    // E3 soft-hold puis preuve DELETE/dissolve OK (Vague D / E5).
    beginPostLeaveHomeTransition();
    const userId = getSupabaseUserId();
    if (userId && membership?.lobbyId) {
      commitMembershipRemoved({ userId, lobbyId: membership.lobbyId });
    }
    // E5 — localStorage Traître uniquement (SQL CASCADE déjà fait côté dissolve).
    if (result?.action === "dissolved" && membership?.lobbyId) {
      clearTraitrePrivateLocalForLobby(membership.lobbyId);
    }
    performLobbyBoundaryTeardown();
    return result;
  });
}

/** Hôte MP : transfère le rôle à un autre joueur du lobby. */
export async function transferLobbyHost() {
  if (!isSupabaseConfigured() || !getLobby()?.id) {
    return { ok: false, error: "Multijoueur en ligne requis." };
  }
  if (!isLocalLobbyHost()) {
    return { ok: false, error: "Seul l'hôte peut transférer le rôle." };
  }

  const candidates = getLobbyParticipants()
    .filter((p) => !p.isLocal && p.userId)
    .map((p) => ({ userId: p.userId, name: p.name, emoji: p.emoji }));

  if (!candidates.length) {
    await showAppAlert("Ajoute au moins un autre joueur avant de transférer l'hôte.", {
      title: "Transfert impossible",
      icon: "👑",
    });
    return { ok: false, cancelled: true };
  }

  const choice = await showTransferHostDialog(candidates);
  if (!choice.ok) return { ok: false, cancelled: true };

  const target = candidates.find((p) => p.userId === choice.userId);
  const confirmed = await showAppConfirm(
    `Confirmer le transfert à ${target?.name || "ce joueur"} ?`,
    {
      title: "Transférer l'hôte",
      confirmLabel: "Confirmer",
      icon: "👑",
    }
  );
  if (!confirmed) return { ok: false, cancelled: true };

  const res = await transferLobbyHostSupabase(choice.userId);
  if (!res.ok) {
    await showAppAlert(res.error || "Transfert impossible.", { title: "Erreur", icon: "⚠️" });
    return res;
  }

  if (isGameSyncActive()) {
    try {
      await refreshGameSession();
    } catch (e) {
      console.warn("REVEAL refresh game session after host transfer:", e);
    }
  }

  try {
    await addLobbyMessage(
      `👑 ${target?.name || "Un joueur"} est maintenant l'hôte de la soirée.`
    );
  } catch {
    /* message optionnel */
  }

  await showAppAlert(
    `${target?.name || "Le joueur"} est maintenant l'hôte. Tu peux quitter le lobby sans fermer la soirée pour les autres.`,
    { title: "Hôte transféré", icon: "✅" }
  );

  return { ok: true };
}

/** Lobby d'attente ou hub entre deux jeux (pas mid-manche). */
export function canManageLobbyRoster() {
  const status = getLobbyStatus();
  const gameId = getLobbyGameId();
  return status === "waiting" || !gameId || gameId === "menu";
}

/** Hôte MP : retire un joueur du lobby (libère une place). */
export async function kickLobbyMember(targetUserId, { confirmName = "" } = {}) {
  if (!isSupabaseConfigured() || !getLobby()?.id) {
    return { ok: false, error: "Multijoueur en ligne requis." };
  }
  if (!isLocalLobbyHost()) {
    return { ok: false, error: "Seul l'hôte peut retirer un joueur." };
  }
  if (!canManageLobbyRoster()) {
    return {
      ok: false,
      error: "Tu ne peux retirer un joueur qu'au lobby ou entre deux jeux.",
    };
  }
  if (!targetUserId) {
    return { ok: false, error: "Joueur invalide." };
  }

  const target =
    getLobbyParticipants().find((p) => p.userId === targetUserId) || null;
  const label = confirmName || target?.name || "ce joueur";

  const confirmed = await showAppConfirm(
    `Retirer ${label} du lobby ? La place sera libérée.`,
    {
      title: "Retirer du lobby",
      confirmLabel: "Retirer",
      cancelLabel: "Annuler",
      icon: "🚪",
    }
  );
  if (!confirmed) return { ok: false, cancelled: true };

  const res = await kickLobbyMemberSupabase(targetUserId);
  if (!res.ok) {
    await showAppAlert(res.error || "Impossible de retirer ce joueur.", {
      title: "Erreur",
      icon: "⚠️",
    });
    return res;
  }

  return { ok: true };
}

export async function setLocalReady(ready) {
  if (isSupabaseConfigured() && getLobby()?.id) {
    await setLocalReadySupabase(ready);
    return;
  }
  const participants = getLobbyParticipants().map((p) =>
    p.isLocal ? { ...p, ready } : p
  );
  const lobby = { ...getLobby(), participants };
  saveStatePatch({ lobby });
  if (lobby.code) publishOpenLobby(lobby.code, lobby);
}

export async function toggleLocalReady() {
  const local = getLobbyParticipants().find((p) => p.isLocal);
  await setLocalReady(!local?.ready);
}

export function getReadyCount() {
  const ps = getLobbyParticipants();
  return {
    ready: ps.filter((p) => p.ready).length,
    total: ps.length,
  };
}

export function allLobbyMembersReady() {
  const { ready, total } = getReadyCount();
  return total > 0 && ready === total;
}

export function getNotReadyParticipants() {
  return getLobbyParticipants().filter((p) => !p.ready);
}

export function simulateLobbyJoins(onUpdate) {
  if (isSupabaseConfigured()) {
    startLobbyPresenceSync();
    if (!onUpdate) return () => {};
    const unsub = onLobbyBundleUpdated(onUpdate);
    return () => unsub();
  }

  const pool = DEMO_NPC_PLAYERS.filter(
    (p) => !getLobbyParticipants().some((x) => x.name === p.name)
  );
  let i = 0;
  const id = setInterval(() => {
    const current = getLobbyParticipants();
    if (i >= pool.length || current.length >= MAX_PLAYERS) {
      clearInterval(id);
      return;
    }
    const p = pool[i++];
    const participants = [
      ...current,
      { name: p.name, emoji: p.emoji, color: p.color, ready: false, isHost: false, isLocal: false },
    ];
    const lobby = { ...getLobby(), participants };
    saveStatePatch({ lobby });
    ensurePlayerScore(p.name);
    if (lobby.code) publishOpenLobby(lobby.code, lobby);
    const gs = { ...getState().globalStats };
    gs.playersJoined = (gs.playersJoined || 0) + 1;
    saveStatePatch({ globalStats: gs });
    onUpdate?.();
  }, 2200);
  return () => clearInterval(id);
}

export function getLobbyMessages() {
  return getLobby()?.messages || [];
}

export async function addLobbyMessage(text) {
  if (isSupabaseConfigured() && getLobby()?.id) {
    await addLobbyMessageSupabase(text);
    return;
  }
  const trimmed = text.trim();
  if (!trimmed) return;
  const at = Date.now();
  const messages = [
    ...(getLobby()?.messages || []),
    {
      id: `local-${at}-${Math.random().toString(36).slice(2, 10)}`,
      from: getLocalDisplayName(),
      text: trimmed,
      at,
      userId: getSupabaseUserId() || "local",
    },
  ];
  const lobby = { ...getLobby(), messages };
  saveStatePatch({ lobby });
  if (lobby.code) publishOpenLobby(lobby.code, lobby);
  try {
    const { notifyLocalChatMessagesChanged } = await import("./chatUnread.js");
    notifyLocalChatMessagesChanged();
  } catch {
    /* unread optionnel */
  }
}

function incrementGlobalStat(key) {
  const gs = { ...getState().globalStats };
  gs[key] = (gs[key] || 0) + 1;
  saveStatePatch({ globalStats: gs });
}

export { MAX_PLAYERS, unsubscribeLobbyRealtime };
