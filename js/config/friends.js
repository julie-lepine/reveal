/**
 * FEATURE-FRIENDS-01 — contrats figés (Palier 0).
 * Aligné sur docs/FRIENDS.md. Le SQL / l’UI des paliers suivants importent d’ici.
 * Ne pas y mettre de fetch, de Realtime, ni de DOM.
 * Invitations de lobby : FEATURE-FRIENDS-02 (`js/config/lobbyInvites.js`).
 * Annuler une demande envoyée : FEATURE-FRIENDS-03 (mêmes tables, RPC cancel / listOutgoing).
 */

export const FRIENDS_FEATURE_ID = "FEATURE-FRIENDS-01";

export const FRIENDS_03_FEATURE_ID = "FEATURE-FRIENDS-03";

/** Écran dédié page Amis (pas un 4e onglet Settings). */
export const FRIENDS_SCREEN_ID = "friends";

/** Channel Realtime client : `friends:${userId}`. */
export const FRIENDS_REALTIME_TOPIC_PREFIX = "friends:";

export function friendsRealtimeTopic(userId) {
  return `${FRIENDS_REALTIME_TOPIC_PREFIX}${userId}`;
}

/** Tables Postgres (Palier 1). Pas de colonnes d’amitié sur lobby_members. */
export const FRIENDS_TABLE = {
  requests: "friend_requests",
  friendships: "friendships",
  cooldowns: "friend_request_cooldowns",
};

/**
 * Overlay roster : une entrée par *autre* membre du lobby.
 * `self` n’existe pas — le joueur local est omis.
 * `guest` = cible anonyme (auth.users.is_anonymous), pas un statut d’amitié.
 */
export const FRIEND_OVERLAY = {
  guest: "guest",
  none: "none",
  pendingOut: "pending_out",
  pendingIn: "pending_in",
  friends: "friends",
};

export const FRIEND_OVERLAY_STATUSES = Object.freeze([
  FRIEND_OVERLAY.guest,
  FRIEND_OVERLAY.none,
  FRIEND_OVERLAY.pendingOut,
  FRIEND_OVERLAY.pendingIn,
  FRIEND_OVERLAY.friends,
]);

/** Noms RPC Postgres (SECURITY DEFINER, authenticated, refuse is_anonymous). */
export const FRIEND_RPC_F01 = {
  send: "send_friend_request",
  decline: "decline_friend_request",
  accept: "accept_friend_request",
  unfriend: "unfriend",
  overlay: "get_lobby_friend_overlay",
  listFriends: "list_my_friends",
  listIncoming: "list_incoming_friend_requests",
};

/** FEATURE-FRIENDS-03 — SQL palier 1 (`feature-friends-03.sql`). */
export const FRIEND_RPC_F03 = {
  cancel: "cancel_friend_request",
  listOutgoing: "list_outgoing_friend_requests",
};

export const FRIEND_RPC = {
  ...FRIEND_RPC_F01,
  ...FRIEND_RPC_F03,
};

/**
 * `error.message` renvoyé par les RPC (raise exception).
 * `friends_cooldown` : le bouton reste « + Ami », aucun toast « refusé ».
 */
export const FRIEND_RPC_ERROR = {
  cooldown: "friends_cooldown",
  guest: "friends_guest",
  self: "friends_self",
  notFound: "friends_not_found",
  alreadyFriends: "friends_already",
};

/** Après un refus A→B, A ne peut pas renvoyer avant ce délai. Table serveur, pas un statut declined. */
export const FRIEND_REQUEST_COOLDOWN_MS = 60 * 1000;

export const FRIEND_LABEL = {
  add: "+ Ami",
  sent: "Envoyée",
  accept: "Accepter",
  friend: "Ami",
  unfriend: "Retirer",
  refuse: "Refuser",
  noticeTitle: "Demande d’ami",
  /** Carte d’un invité, vue par un inscrit. */
  guestCard: "Pas de compte",
  /** Sous la grille, seulement si le joueur local est invité. */
  guestHint: "Crée un compte pour ajouter des amis",
  pageTitle: "Amis",
  incomingSection: "Demandes reçues",
  friendsSection: "Tes amis",
  incomingEmpty: "Aucune demande pour le moment.",
  friendsEmpty: "Pas encore d’amis. Ajoute des joueurs depuis un lobby.",
  entrySettings: "Mes amis",
  entryHome: "Amis",
  unfriendCancel: "Annuler",
  /** FEATURE-FRIENDS-03 : rétracter sa demande (pas unfriend). */
  cancelRequest: "Annuler",
  outgoingSection: "Demandes envoyées",
  outgoingEmpty: "Aucune demande envoyée.",
};

/** Action roster ( Palier 4 ). `hint_guest` = pas de bouton + Ami. */
export const FRIEND_ROSTER_ACTION = {
  hintGuest: "hint_guest",
  add: "add",
  sent: "sent",
  accept: "accept",
  friend: "friend",
  /** F03 palier 3 UI : pending_out → bouton Annuler. */
  cancel: "cancel",
};

/**
 * @param {string|null|undefined} overlayStatus
 * @param {{ localIsRegistered: boolean }} opts
 */
export function rosterActionFromOverlay(overlayStatus, { localIsRegistered } = { localIsRegistered: false }) {
  if (!localIsRegistered) return FRIEND_ROSTER_ACTION.hintGuest;
  if (overlayStatus === FRIEND_OVERLAY.guest || overlayStatus == null) {
    return FRIEND_ROSTER_ACTION.hintGuest;
  }
  if (overlayStatus === FRIEND_OVERLAY.none) return FRIEND_ROSTER_ACTION.add;
  if (overlayStatus === FRIEND_OVERLAY.pendingOut) return FRIEND_ROSTER_ACTION.cancel;
  if (overlayStatus === FRIEND_OVERLAY.pendingIn) return FRIEND_ROSTER_ACTION.accept;
  if (overlayStatus === FRIEND_OVERLAY.friends) return FRIEND_ROSTER_ACTION.friend;
  return FRIEND_ROSTER_ACTION.hintGuest;
}

/**
 * Popup demande d’ami autorisée uniquement ici.
 * Ailleurs (prépas + manches) : badge seulement.
 */
export const FRIEND_NOTICE_CALM_SCREENS = new Set([
  "lobby",
  "game-select",
  "results",
  "leaderboard",
  FRIENDS_SCREEN_ID,
  "settings",
  "home",
]);

export function isFriendNoticeCalmScreen(screenId) {
  return FRIEND_NOTICE_CALM_SCREENS.has(screenId);
}

/**
 * Annuler ≠ refus : pas de ligne cooldown.
 * No-op (aucune demande from→to) : succès, pas d’erreur métier.
 */
export function cancelFriendRequestAppliesCooldown() {
  return false;
}

/** Erreurs que `cancel_friend_request` peut lever (réutilise F01). Pas de code dédié no-op. */
export const FRIEND_CANCEL_RPC_ERROR = {
  guest: FRIEND_RPC_ERROR.guest,
  self: FRIEND_RPC_ERROR.self,
  notFound: FRIEND_RPC_ERROR.notFound,
};

/** Entrées UI vers l’écran friends (Palier 6). */
export const FRIENDS_ENTRY = {
  settingsProfile: "settings-profile",
  homeLoggedIn: "home-logged-in",
};
