import { DEMO_NPC_PLAYERS } from "./demoPlayers.js";
import {
  getState,
  saveStatePatch,
  newLobby as genLobbyCode,
  getLocalDisplayName,
  getLocalEmoji,
  ensurePlayerScore,
  resetEveningState,
  setActiveScoringGame,
} from "./state.js";
import { loginAsGuest, isGuest } from "./auth.js";
import { signOutSupabase, getSupabaseUserId } from "./supabaseAuth.js";
import { syncAllPlayerScores } from "./players.js";
import { navigate } from "./router.js";
import { resetWelcomeSeen } from "./welcomeGate.js";
import { isSupabaseConfigured, supabase } from "./supabaseClient.js";
import {
  createLobbySupabase,
  joinLobbySupabase,
  leaveLobbySupabase,
  closeLobbySupabase,
  refreshLobbyFromSupabase,
  setLocalReadySupabase,
  setLobbyStatusSupabase,
  addLobbyMessageSupabase,
  subscribeLobbyRealtime,
  unsubscribeLobbyRealtime,
  startLobbyPresenceSync,
  stopLobbyPresenceSync,
  onLobbyBundleUpdated,
  sendLobbyNudgeSupabase,
} from "./supabaseLobby.js";
import { showAppAlert, showAppConfirm } from "./dialog.js";
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
  getFilRougeResumeScreen,
  routeToSessionScreen,
} from "./gameSync.js";

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
    sessionStorage.setItem("reveal-auth-tab", "guest");
  }
  resetEveningState();
  clearCachedGameSession();
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

export function isLobbyEveningStarted() {
  return getLobbyStatus() === "playing";
}

export function getLobbyGameId() {
  return getLobby()?.gameId || null;
}

export async function setLobbyPlaying(gameId) {
  setActiveScoringGame(gameId);
  if (isSupabaseConfigured() && getLobby()?.id) {
    await setLobbyStatusSupabase("playing", gameId);
    return;
  }
  const lobby = { ...getLobby(), status: "playing", gameId };
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
  if (!getState().inLobby || !lobby?.code || !lobby.participants?.length) {
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

/** Nettoie un lobby fantôme en local (sans quitter Supabase côté serveur). */
export function forceClearClientLobbyState() {
  stopMultiplayerSync();
  clearCachedGameSession();
  saveStatePatch({ inLobby: false, lobby: null, lobbyCode: null });
}

/**
 * Vérifie que le joueur local est encore membre du lobby (après F5 / nouvelle session anon).
 * @returns {{ cleared: boolean }}
 */
export async function reconcileLobbyMembership() {
  if (!getState().inLobby) return { cleared: false };

  if (!isSupabaseConfigured()) {
    const lobby = getLobby();
    if (!lobby?.code || !lobby.participants?.length) {
      forceClearClientLobbyState();
      return { cleared: true };
    }
    return { cleared: false };
  }

  const lobbyId = getLobby()?.id;
  const uid = getSupabaseUserId();

  if (!lobbyId) {
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
      forceClearClientLobbyState();
      return { cleared: true };
    }
    return { cleared: false };
  } catch (e) {
    console.warn("REVEAL reconcile lobby:", e.message || e);
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
    localStorage.removeItem("reveal-fil-rouge-private");
  } catch {
    /* ignore */
  }
  sessionStorage.removeItem("reveal-pending-join");
  sessionStorage.setItem("reveal-auth-tab", "guest");
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

/** Accueil / paramètres → menu jeux (ne force pas la reprise d’une partie en cours). */
export async function returnToEveningGames() {
  if (!hasActiveLobby()) {
    navigate("home", { reset: true });
    return;
  }

  clearSessionRouteSuppress();
  await routeToEveningHub();
}

export async function goToGameSelect() {
  await returnToEveningGames();
}

export async function routeToEveningHub() {
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
    if (await routeToActiveGameIfNeeded(row)) return true;
    const frScreen = getFilRougeResumeScreen();
    if (frScreen) {
      routeToSessionScreen(frScreen, { force: true });
      return true;
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
  if (!hasActiveLobby()) return false;
  if (!force && isSessionRouteSuppressed()) return false;

  if (force) clearSessionRouteSuppress();
  return routeToEveningHub();
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
      error: "Code introuvable. Demande le code à l'hôte ou vérifie qu'il n'y a pas de faute.",
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

  const nextCode = normalizeLobbyCode(code);
  const currentCode = normalizeLobbyCode(getLobby()?.code);
  if (hasActiveLobby() && currentCode && nextCode && currentCode !== nextCode) {
    await leaveLobby({ navigateAway: false });
  }

  const res = await joinLobby(code);
  if (!res.ok) {
    await clearGuestSessionAfterFailedJoin();
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

export function getLobbyNudge() {
  const lobby = getLobby();
  return {
    at: lobby?.nudgeAt || 0,
    forUserId: lobby?.nudgeForUserId || null,
  };
}

export async function sendLobbyNudgeToNotReady() {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: "Wizz disponible avec le lobby en ligne (Supabase)." };
  }
  const notReady = getNotReadyParticipants().filter((p) => !p.isHost);
  if (!notReady.length) {
    return { ok: false, error: "Tout le monde est déjà prêt." };
  }
  return sendLobbyNudgeSupabase(null);
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
  return getLobby().messages || [];
}

export async function addLobbyMessage(text) {
  if (isSupabaseConfigured() && getLobby()?.id) {
    await addLobbyMessageSupabase(text);
    return;
  }
  const trimmed = text.trim();
  if (!trimmed) return;
  const messages = [
    ...(getLobby().messages || []),
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
