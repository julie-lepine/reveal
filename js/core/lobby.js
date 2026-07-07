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
import { clearGuestMembership } from "./guestMembership.js";
import { signOutSupabase, getSupabaseUserId } from "./supabaseAuth.js";
import { syncAllPlayerScores } from "./players.js";
import { navigate, getCurrentScreen } from "./router.js";
import { resetWelcomeSeen } from "./welcomeGate.js";
import { isSupabaseConfigured, supabase } from "./supabaseClient.js";
import {
  createLobbySupabase,
  joinLobbySupabase,
  leaveLobbySupabase,
  closeLobbySupabase,
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
  recoverLobbyFromServer,
  peekServerLobbyForUser,
  getRememberedLobbyCode,
  transferLobbyHostSupabase,
} from "./supabaseLobby.js";
import { showAppAlert, showAppConfirm, showTransferHostDialog } from "./dialog.js";
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
  // getFilRougeResumeScreen,
  routeToSessionScreen,
  isAppContentMounted,
  refreshEveningScoresFromSession,
} from "./gameSync.js";
import { isGuessLieGameActive, tryEnterGuessLiePlayFromWait } from "./guessLieSession.js";

const MAX_PLAYERS = 10;

let lobbyDissolveHandling = false;

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
  resetEveningState();
  clearCachedGameSession();
  clearGuestMembership();
  saveStatePatch(patch);
  if (navigateAway) {
    navigate("home", { reset: true });
  }
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
  if (st.scores && Object.values(st.scores).some((n) => Number(n) > 0)) return true;
  const s = st.stats || {};
  return (
    (s.hotTakesPlayed || 0) > 0 ||
    (s.speedVotesPlayed || 0) > 0 ||
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
  const participants = (lobby.participants || []).map((p) => ({ ...p, ready: false }));
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

  const participants = lobby.participants.map((p) => ({ ...p, ready: false }));
  const next = { ...lobby, participants };
  saveStatePatch({ lobby: next });
  if (next.code) publishOpenLobby(next.code, next);
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

/** Tente de restaurer le lobby depuis Supabase (compte connecté). */
export async function tryRecoverLobbyFromServer() {
  if (!isSupabaseConfigured() || !getSupabaseUserId()) {
    return { ok: false };
  }
  try {
    const res = await recoverLobbyFromServer();
    return res.ok ? { ok: true, code: res.code } : { ok: false };
  } catch (e) {
    console.warn("REVEAL recover lobby:", e.message || e);
    return { ok: false };
  }
}

export { peekServerLobbyForUser, getRememberedLobbyCode };

/** Nettoie un lobby fantôme en local (sans quitter Supabase côté serveur). */
export function forceClearClientLobbyState() {
  stopMultiplayerSync();
  clearCachedGameSession();
  saveStatePatch({ inLobby: false, lobby: null, lobbyCode: null });
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

  const uid = getSupabaseUserId();

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
    if (!uid) forceClearClientLobbyState();
    return { cleared: !uid };
  }

  if (!uid) {
    forceClearClientLobbyState();
    return { cleared: true };
  }

  try {
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
    // localStorage.removeItem("reveal-fil-rouge-private");
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

  await routeToEveningHub({ rejoinActiveGame: false });
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

export async function routeToEveningHub({ rejoinActiveGame = true } = {}) {
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
    navigate("game-select", { navStack: ["home", "lobby", "game-select"] });
    return true;
  }

  if (!isLobbyEveningStarted()) {
    goToLobby();
    return true;
  }

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

export function getLobbyJoinUrl(code) {
  const c = code || getLobby()?.code;
  if (!c) return window.location.href.split("#")[0];
  return `${window.location.origin}${window.location.pathname}#join=${encodeURIComponent(c)}`;
}

export function parseJoinCodeFromHash() {
  const hash = window.location.hash.replace(/^#/, "");
  const params = new URLSearchParams(hash.replace(/&/g, "&"));
  if (params.has("join")) return params.get("join");
  const m = hash.match(/^join=(.+)$/i);
  return m ? decodeURIComponent(m[1]) : null;
}

export async function createLobby() {
  resetEveningState();

  if (isSupabaseConfigured()) {
    const res = await createLobbySupabase();
    if (!res.ok) throw new Error(res.error);
    return res.code;
  }

  const code = genLobbyCode();
  const participants = [localParticipant(false, { asHost: true })];
  ensurePlayerScore(getLocalDisplayName());
  syncAllPlayerScores();
  const lobby = { code, participants, messages: [], status: "waiting", gameId: null };
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
  resetEveningState();

  if (isSupabaseConfigured()) {
    return joinLobbySupabase(code);
  }

  const trimmed = code.trim().toUpperCase().replace(/\s/g, "");
  if (trimmed.length < 4) return { ok: false, error: "Code invalide." };

  const published = getOpenLobby(trimmed);
  if (!published) {
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

  return { ok: true, code: trimmed };
}

function normalizeLobbyCode(code) {
  return String(code || "")
    .trim()
    .toUpperCase()
    .replace(/\s/g, "");
}

export async function joinLobbyAsGuest(code, guestName, captchaToken = null) {
  const auth = await loginAsGuest(guestName, captchaToken);
  if (!auth.ok) return auth;

  const joinCode =
    normalizeLobbyCode(code) || normalizeLobbyCode(getLobby()?.code) || normalizeLobbyCode(getRememberedLobbyCode());

  const nextCode = joinCode;
  const currentCode = normalizeLobbyCode(getLobby()?.code);
  if (hasActiveLobby() && currentCode && nextCode && currentCode !== nextCode) {
    await leaveLobby({ navigateAway: false });
  }

  const res = await joinLobby(joinCode);
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
  if (lobbyDissolveHandling) return;
  if (!getState().inLobby) return;
  if (isLocalLobbyHost()) return;

  lobbyDissolveHandling = true;
  stopMultiplayerSync();
  stopLobbyPresenceSync();

  const wasGuest = isGuest();
  await signOutAnonGuestIfNeeded(wasGuest);
  applyLeaveLobbyLocal({ wasGuest, navigateAway: false });

  await showAppAlert("L'hôte a quitté le lobby.", { title: "Lobby fermé", icon: "👋" });

  lobbyDissolveHandling = false;
  navigate("home", { reset: true });
}

/** Hôte : supprime le lobby pour tout le monde. */
export async function dissolveLobbyAsHost({ navigateAway = true } = {}) {
  stopMultiplayerSync();
  stopLobbyPresenceSync();

  const lobby = getLobby();
  const code = lobby?.code;
  const wasGuest = isGuest();

  if (isSupabaseConfigured() && lobby?.id) {
    const res = await closeLobbySupabase();
    if (!res.ok) {
      return { ok: false, error: res.error };
    }
    await signOutAnonGuestIfNeeded(wasGuest);
  } else if (code) {
    clearLocalOpenLobbySlot(code);
  }

  applyLeaveLobbyLocal({ wasGuest, navigateAway });
  return { ok: true };
}

/** Confirmation si hôte, sinon simple sortie du lobby. */
export async function confirmAndLeaveLobby({ navigateAway = true } = {}) {
  if (!hasActiveLobby()) return { ok: true };

  if (isSupabaseConfigured() && isLocalLobbyHost()) {
    const ok = await showAppConfirm(
      "Le lobby sera fermé pour tous les joueurs. Continuer ?",
      {
        title: "Quitter le lobby",
        confirmLabel: "Fermer le lobby",
        cancelLabel: "Annuler",
        icon: "🚪",
      }
    );
    if (!ok) return { ok: false, cancelled: true };
    return dissolveLobbyAsHost({ navigateAway });
  }

  return leaveLobby({ navigateAway });
}

/**
 * Quitte le lobby sans supprimer le compte connecté.
 * Invité : retour à l’accueil (onglet Invité) pour rejoindre une autre partie.
 */
export async function leaveLobby({ navigateAway = true } = {}) {
  if (isSupabaseConfigured() && getLobby()?.id && isLocalLobbyHost()) {
    return confirmAndLeaveLobby({ navigateAway });
  }

  stopMultiplayerSync();
  stopLobbyPresenceSync();

  const lobby = getLobby();
  const code = lobby?.code;
  const wasGuest = isGuest();

  if (isSupabaseConfigured() && lobby?.id) {
    const res = await leaveLobbySupabase();
    if (!res.ok) {
      console.warn("REVEAL leaveLobbySupabase:", res.error);
    }
    await signOutAnonGuestIfNeeded(wasGuest);
  } else if (code) {
    clearLocalOpenLobbySlot(code);
  }

  applyLeaveLobbyLocal({ wasGuest, navigateAway });
  return { ok: true };
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
  const messages = [
    ...(getLobby()?.messages || []),
    { from: getLocalDisplayName(), text: trimmed, at: Date.now() },
  ];
  const lobby = { ...getLobby(), messages };
  saveStatePatch({ lobby });
  if (lobby.code) publishOpenLobby(lobby.code, lobby);
}

function incrementGlobalStat(key) {
  const gs = { ...getState().globalStats };
  gs[key] = (gs[key] || 0) + 1;
  saveStatePatch({ globalStats: gs });
}

export { MAX_PLAYERS, unsubscribeLobbyRealtime };
