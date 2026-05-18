import { PLAYERS } from "../../data/players.js";
import {
  getState,
  saveStatePatch,
  newLobby as genLobbyCode,
  getLocalDisplayName,
  getLocalEmoji,
  ensurePlayerScore,
} from "./state.js";
import { loginAsGuest } from "./auth.js";
import { syncAllPlayerScores } from "./players.js";
import { navigate } from "./router.js";

const MAX_PLAYERS = 10;

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

export function getLobbyGameId() {
  return getLobby()?.gameId || null;
}

export function setLobbyPlaying(gameId) {
  const lobby = { ...getLobby(), status: "playing", gameId };
  saveStatePatch({ lobby });
  if (lobby.code) publishOpenLobby(lobby.code, lobby);
}

export function setLobbyWaiting() {
  const lobby = { ...getLobby(), status: "waiting", gameId: null };
  const participants = (lobby.participants || []).map((p) => ({ ...p, ready: false }));
  const next = { ...lobby, participants };
  saveStatePatch({ lobby: next });
  if (next.code) publishOpenLobby(next.code, next);
}

/** Tous les joueurs repassent en non-prêt */
export function resetAllParticipantsReady() {
  const lobby = getLobby();
  if (!lobby?.participants?.length) return;
  const participants = lobby.participants.map((p) => ({ ...p, ready: false }));
  const next = { ...lobby, participants };
  saveStatePatch({ lobby: next });
  if (next.code) publishOpenLobby(next.code, next);
}

export function hasActiveLobby() {
  const lobby = getLobby();
  return Boolean(getState().inLobby && lobby?.code && lobby.participants?.length);
}

/** Accueil → salon d’attente (pas la liste des jeux) */
export function goToLobby() {
  const lobby = getLobby();
  if (!lobby?.code || !lobby.participants?.length) {
    navigate("home", { reset: true });
    return;
  }
  saveStatePatch({ inLobby: true });
  navigate("lobby", { navStack: ["home", "lobby"] });
}

/** Accueil (partie en cours) → choix des jeux */
export function goToGameSelect() {
  if (!hasActiveLobby()) {
    navigate("home", { reset: true });
    return;
  }
  saveStatePatch({ inLobby: true });
  setLobbyWaiting();
  navigate("game-select", { navStack: ["home", "lobby", "game-select"] });
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

export function createLobby() {
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

export function joinLobby(code) {
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

export function joinLobbyAsGuest(code, guestName) {
  const auth = loginAsGuest(guestName);
  if (!auth.ok) return auth;
  return joinLobby(code);
}

export function setLocalReady(ready) {
  const participants = getLobbyParticipants().map((p) =>
    p.isLocal ? { ...p, ready } : p
  );
  const lobby = { ...getLobby(), participants };
  saveStatePatch({ lobby });
  if (lobby.code) publishOpenLobby(lobby.code, lobby);
}

export function toggleLocalReady() {
  const local = getLobbyParticipants().find((p) => p.isLocal);
  setLocalReady(!local?.ready);
}

export function getReadyCount() {
  const ps = getLobbyParticipants();
  return {
    ready: ps.filter((p) => p.ready).length,
    total: ps.length,
  };
}

export function simulateLobbyJoins(onUpdate) {
  const pool = PLAYERS.filter(
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

export function addLobbyMessage(text) {
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

export { MAX_PLAYERS };
