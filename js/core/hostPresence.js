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
    // Aligné SQL is_acting_host : ORDER BY user_id::text ASC
    .sort((a, b) => String(a).localeCompare(String(b)));
  return present[0] || host?.userId || hostId;
}

/** True si l'identité acting host change entre deux snapshots lobby. */
export function didActingHostChange(
  prevParticipants,
  prevHostId,
  nextParticipants,
  nextHostId,
  now = Date.now()
) {
  const prev = resolveActingHostUserId(prevParticipants || [], prevHostId, now);
  const next = resolveActingHostUserId(nextParticipants || [], nextHostId, now);
  return prev !== next;
}

/**
 * Bypass shouldSkipFullRender : compare le token courant au dernier token
 * **acquitté après un full-render**, pas à une lecture « before » dans le même tick.
 * (Le nudge incrémente puis notify : before/after dans le listener seraient égaux.)
 */
export function needsActingHostUiRefresh(ackedToken, currentToken) {
  return ackedToken !== currentToken;
}
