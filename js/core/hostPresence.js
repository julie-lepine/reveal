import { HOST_PRESENCE_STALE_MS } from "../config/lobbyLifecycle.js";

/**
 * Présence d'un membre d'après son dernier heartbeat (`lastSeenAt`).
 * `lastSeenAt` absent (colonne legacy non migrée) → considéré présent, pour ne
 * jamais déclencher le repli d'hôte par erreur.
 */
export function isMemberPresent(participant, now = Date.now()) {
  if (!participant?.lastSeenAt) return true;
  const t = new Date(participant.lastSeenAt).getTime();
  if (!Number.isFinite(t)) return true;
  return now - t < HOST_PRESENCE_STALE_MS;
}

/**
 * Logique pure du repli d'hôte (testable, sans état global).
 * - Hôte réel présent → c'est lui.
 * - Hôte absent/déconnecté (heartbeat périmé) → repli déterministe sur le membre présent
 *   au plus petit userId. Déterministe = tous les clients désignent le même acting-host,
 *   donc pas de double déclenchement.
 */
export function resolveActingHostUserId(participants = [], hostId = null, now = Date.now()) {
  if (!participants.length) return hostId;
  const host =
    participants.find((p) => p.userId === hostId) ||
    participants.find((p) => p.isHost);
  if (host && isMemberPresent(host, now)) return host.userId || hostId;
  const present = participants
    .filter((p) => p.userId && isMemberPresent(p, now))
    .map((p) => p.userId)
    .sort();
  return present[0] || host?.userId || hostId;
}
