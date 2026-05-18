import { PLAYERS } from "../../data/players.js";
import { getLobbyParticipants, hasActiveLobby } from "./lobby.js";
import { getLocalDisplayName, getState, ensurePlayerScore } from "./state.js";

/** Joueurs actifs : lobby si présent, sinon NPC + local */
export function getActivePlayers() {
  if (hasActiveLobby()) {
    const ps = getLobbyParticipants();
    if (ps.length) return ps.map((p) => ({
      name: p.name,
      color: p.color,
      emoji: p.emoji,
      isLocal: Boolean(p.isLocal),
      isHost: Boolean(p.isHost),
    }));
  }
  const localName = getLocalDisplayName();
  return [
    ...PLAYERS.map((p) => ({ ...p, isLocal: false, isHost: false })),
    { name: localName, color: "#60A5FA", emoji: "👤", isLocal: true, isHost: true },
  ];
}

export function getActivePlayerNames() {
  return getActivePlayers().map((p) => p.name);
}

export function getNpcPlayers() {
  return getActivePlayers().filter((p) => !p.isLocal);
}

export function getLocalPlayer() {
  return getActivePlayers().find((p) => p.isLocal) || {
    name: getLocalDisplayName(),
    color: "#60A5FA",
    emoji: "👤",
    isLocal: true,
  };
}

export function syncAllPlayerScores() {
  getActivePlayerNames().forEach(ensurePlayerScore);
}

export function getSortedActivePlayers() {
  const { scores } = getState();
  syncAllPlayerScores();
  return [...getActivePlayers()].sort(
    (a, b) => (scores[b.name] || 0) - (scores[a.name] || 0)
  );
}

export function pickRandomNpc() {
  const npcs = getNpcPlayers();
  if (!npcs.length) return null;
  return npcs[Math.floor(Math.random() * npcs.length)];
}
