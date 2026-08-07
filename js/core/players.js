import { DEMO_NPC_PLAYERS } from "./demoPlayers.js";
import { getLobbyParticipants, hasActiveLobby } from "./lobby.js";
import { buildEveningStandingPlayers } from "./eveningStandings.js";
import { getLocalDisplayName, getLocalEmoji, getState, ensurePlayerScore } from "./state.js";

/** Joueurs actifs : lobby si présent, sinon NPC + local */
export function getActivePlayers() {
  if (hasActiveLobby()) {
    const ps = getLobbyParticipants();
    if (ps.length) return ps.map((p) => ({
      name: p.name,
      userId: p.userId || null,
      color: p.color,
      emoji: p.emoji,
      isLocal: Boolean(p.isLocal),
      isHost: Boolean(p.isHost),
    }));
  }
  const localName = getLocalDisplayName();
  return [
    ...DEMO_NPC_PLAYERS.map((p) => ({ ...p, isLocal: false, isHost: false })),
    { name: localName, color: "#60A5FA", emoji: getLocalEmoji(), isLocal: true, isHost: true },
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
    emoji: getLocalEmoji(),
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

/**
 * Résout une clé score (uid ou pseudo) → pseudo lobby si connue.
 * Pur lobby (évite import gameSync).
 */
function resolveLobbyDisplayName(key) {
  if (key == null || key === "") return null;
  const raw = String(key);
  const ps = getLobbyParticipants() || [];
  const byUid = ps.find((p) => p.userId && String(p.userId) === raw);
  if (byUid?.name) return byUid.name;
  const byName = ps.find((p) => p.name === raw);
  if (byName) return raw;
  return null;
}

/**
 * UX-HIST-01 - standings soirée : roster actif ∪ contributeurs historiques.
 * Ne pas utiliser pour lobby / ready / présence / HUD in-game.
 * @param {{ gameId?: string|null }} [opts]
 */
export function getEveningStandingPlayers({ gameId = null } = {}) {
  const { scores = {}, gameScores = {} } = getState();
  return buildEveningStandingPlayers({
    activePlayers: getActivePlayers(),
    scores,
    gameScores,
    gameId,
    resolveDisplayName: resolveLobbyDisplayName,
  });
}

/** Tri par score soirée (sans ensurePlayerScore sur les historiques). */
export function getSortedEveningStandingPlayers({ gameId = null } = {}) {
  const { scores = {} } = getState();
  const players = getEveningStandingPlayers({ gameId });
  return [...players].sort(
    (a, b) =>
      (scores[b.name] || 0) - (scores[a.name] || 0) ||
      String(a.name).localeCompare(String(b.name))
  );
}

export function pickRandomNpc() {
  const npcs = getNpcPlayers();
  if (!npcs.length) return null;
  return npcs[Math.floor(Math.random() * npcs.length)];
}
