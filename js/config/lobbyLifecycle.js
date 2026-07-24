/**
 * Durées de vie des lobbies (alignées sur supabase/lobby-lifecycle.sql).
 * Le join est refusé côté serveur (find_lobby_by_code) au-delà de JOIN_MAX_AGE.
 */

/** Plafond de joueurs par lobby (UI + gate join client). */
export const MAX_PLAYERS = 8;

/** Message renvoyé quand le lobby est plein. */
export const LOBBY_FULL_MSG = "Nombre de joueurs max atteint pour ce lobby";

/** Refus de rejoindre si last_activity > 24 h (RPC find_lobby_by_code). */
export const LOBBY_JOIN_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Heartbeat membre : intervalle minimum entre deux UPDATE last_seen_at. */
export const LOBBY_HEARTBEAT_MIN_MS = 60 * 1000;

/**
 * Au-delà de ce délai sans heartbeat, un membre est considéré « absent » pour le repli
 * d'hôte (contrôles de manche). Volontairement > 2× le heartbeat (60 s) pour éviter les
 * faux positifs (deux hôtes agissants) : on tolère ~2 min avant de débloquer une manche.
 */
export const HOST_PRESENCE_STALE_MS = 120 * 1000;

/**
 * ARCH-03b : seuil pour proposer / accepter un transfert réel de `lobbies.host_id`.
 * Volontairement > acting technique (120 s) pour éviter un transfert après une pause courte.
 */
export const HOST_TRANSFER_STALE_MS = 5 * 60 * 1000;

/** Purge serveur : lobby waiting inactif (h). */
export const LOBBY_TTL_WAITING_HOURS = 2;

/** Purge serveur : lobby playing inactif (h). */
export const LOBBY_TTL_PLAYING_HOURS = 12;

/** Purge serveur : waiting sans membre « vu » depuis N minutes. */
export const LOBBY_TTL_NO_PRESENCE_MINUTES = 45;

export function getLobbyAutoCloseHint(status = "waiting") {
  if (status === "playing") {
    return `Ce lobby se fermera automatiquement après ${LOBBY_TTL_PLAYING_HOURS} h sans activité.`;
  }
  return `Ce lobby se fermera automatiquement après ${LOBBY_TTL_WAITING_HOURS} h sans activité, ou ${LOBBY_TTL_NO_PRESENCE_MINUTES} min si personne n'est en ligne.`;
}

/** Garde-fou client si la RPC n'est pas encore migrée. */
export function isLobbyJoinTooOld(lastActivityAt) {
  if (!lastActivityAt) return false;
  const t = new Date(lastActivityAt).getTime();
  if (!Number.isFinite(t)) return false;
  return Date.now() - t > LOBBY_JOIN_MAX_AGE_MS;
}

export const LOBBY_EXPIRED_JOIN_MSG =
  "Cette partie n'existe plus ou a expiré. Demande un nouveau code à l'hôte.";
