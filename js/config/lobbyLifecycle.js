/**
 * Durées de vie des lobbies (alignées sur supabase/lobby-lifecycle.sql).
 * Le join est refusé côté serveur (find_lobby_by_code) au-delà de JOIN_MAX_AGE.
 */

/** Plafond de joueurs par lobby (UI + gate join client). Hôte sans Maître. */
export const MAX_PLAYERS = 8;

/** Hôte Maître de soirée : 1 + 13 invités. */
export const MAX_PLAYERS_HOST = 14;

export function lobbyMaxPlayers(hostPack) {
  return hostPack === true ? MAX_PLAYERS_HOST : MAX_PLAYERS;
}

/**
 * Plafond de CE salon : pack de l’hôte du salon, pas du viewer.
 * `localIsHost && localHostPack` : l’hôte qui vient d’acheter voit 14 avant le prochain fetch.
 */
export function resolveLobbySeatCap({
  salonHostPack = false,
  localIsHost = false,
  localHostPack = false,
} = {}) {
  return lobbyMaxPlayers(
    salonHostPack === true || (localIsHost === true && localHostPack === true)
  );
}

/** Upsell Forfaits seulement si ce salon est encore à 8 et que le viewer n’a pas Maître. */
export function shouldShowLobbyCapUpsell({
  salonHostPack = false,
  localHostPack = false,
} = {}) {
  if (salonHostPack === true) return false;
  return localHostPack !== true;
}

export function hostLobbyCapacityHint() {
  return "Avantage Maître de soirée : tu peux inviter 13 autres joueurs.";
}

export function hostLobbyUpsellHint() {
  return "Tu veux un + grand lobby ?";
}

/** Message renvoyé quand le lobby est plein. */
export const LOBBY_FULL_MSG = "Nombre de joueurs max atteint pour ce lobby";

/** Exception trigger H-RACE (`lobby_members_enforce_seat_cap`). */
export const LOBBY_FULL_SQL = "lobby_full";

/**
 * Erreur serveur « salon complet » (trigger H-RACE ou copy join).
 * `lobby_invite_full` est un autre code (invites) — ne pas le confondre ici.
 * @param {unknown} error
 */
export function isLobbyFullServerError(error) {
  if (error == null) return false;
  const blob = [
    typeof error === "string" ? error : "",
    error && typeof error === "object" ? error.message : "",
    error && typeof error === "object" ? error.details : "",
    error && typeof error === "object" ? error.hint : "",
  ]
    .filter(Boolean)
    .join(" ");
  return blob.includes(LOBBY_FULL_SQL) || blob.includes(LOBBY_FULL_MSG);
}

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
