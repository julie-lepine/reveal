/**
 * FEATURE-FRIENDS-02 — contrats invitations de lobby (Palier 0).
 * Aligné sur docs/FRIENDS.md § Phase 2. Pas de fetch, Realtime, ni DOM.
 * Le graphe d’amis reste FEATURE-FRIENDS-01 (`js/config/friends.js`).
 */

export const LOBBY_INVITES_FEATURE_ID = "FEATURE-FRIENDS-02";

/** Table Postgres. Pas de colonnes d’invite sur lobby_members. Pas le code lobby. */
export const LOBBY_INVITE_TABLE = "lobby_invites";

/**
 * Unique pending : (lobby_id, to_user_id) = pas deux lignes vers le *même* ami
 * pour le *même* lobby (re-tap = Envoyée).
 * L’émetteur peut inviter **tous** ses amis inscrits hors salle (1, 7, N).
 * Le plafond 8 s’applique au **Rejoindre**, pas à l’envoi.
 */
export const LOBBY_INVITE_UNIQUE = "lobby_id_to_user_id";

/** Noms RPC (SECURITY DEFINER, authenticated, refuse is_anonymous).
 * send(p_to uuid) · decline/accept(p_id uuid) · list_incoming() — pas le code.
 */
export const LOBBY_INVITE_RPC = {
  send: "send_lobby_invite",
  decline: "decline_lobby_invite",
  accept: "accept_lobby_invite",
  listIncoming: "list_incoming_lobby_invites",
};

/**
 * `error.message` métier.
 * `friends_guest` / `friends_self` : mêmes codes que FEATURE-FRIENDS-01
 * (helpers `friends_auth_kind` / `friends_require_caller`).
 */
export const LOBBY_INVITE_RPC_ERROR = {
  guest: "friends_guest",
  self: "friends_self",
  notFound: "friends_not_found",
  notFriends: "lobby_invite_not_friends",
  noLobby: "lobby_invite_no_lobby",
  alreadyIn: "lobby_invite_already_in",
  full: "lobby_invite_full",
  closed: "lobby_invite_closed",
  busy: "lobby_invite_busy",
  gone: "lobby_invite_gone",
};

/** Action sur une fiche ami (page Amis, émetteur dans un lobby). */
export const LOBBY_INVITE_ACTION = {
  omit: "omit",
  invite: "invite",
  sent: "sent",
  alreadyIn: "already_in",
};

export const LOBBY_INVITE_LABEL = {
  invite: "Inviter",
  sent: "Envoyée",
  join: "Rejoindre",
  refuse: "Refuser",
  alreadyIn: "Dans la soirée",
  incomingSection: "Invitations de soirée",
  incomingEmpty: "Aucune invitation pour le moment.",
  noLobbyHint: "Crée ou rejoins une soirée pour inviter tes amis.",
  noticeTitle: "Invitation",
  busyTitle: "Tu es déjà dans une soirée",
  busyConfirm: "Quitter et rejoindre",
  busyRefuse: "Rester et refuser",
  entryLobby: "Inviter des amis",
};

/**
 * @param {{
 *   localIsRegistered?: boolean,
 *   localInLobby?: boolean,
 *   peerInSameLobby?: boolean,
 *   pendingOut?: boolean,
 * }} opts
 */
export function friendInviteAction({
  localIsRegistered = false,
  localInLobby = false,
  peerInSameLobby = false,
  pendingOut = false,
} = {}) {
  if (!localIsRegistered || !localInLobby) return LOBBY_INVITE_ACTION.omit;
  if (peerInSameLobby) return LOBBY_INVITE_ACTION.alreadyIn;
  if (pendingOut) return LOBBY_INVITE_ACTION.sent;
  return LOBBY_INVITE_ACTION.invite;
}

export function lobbyInviteNoticeCopy(row) {
  const name = row?.name || "Quelqu’un";
  const emoji = row?.emoji || "👤";
  return {
    title: LOBBY_INVITE_LABEL.noticeTitle,
    message: `${name} t’invite à une soirée`,
    icon: emoji,
    confirmLabel: LOBBY_INVITE_LABEL.join,
    cancelLabel: LOBBY_INVITE_LABEL.refuse,
  };
}

export function lobbyInviteBusyCopy(row) {
  const name = row?.name || "Quelqu’un";
  const emoji = row?.emoji || "👤";
  return {
    title: LOBBY_INVITE_LABEL.busyTitle,
    message: `${name} t’invite dans une autre soirée. Tu ne peux être que dans une à la fois.`,
    icon: emoji,
    confirmLabel: LOBBY_INVITE_LABEL.busyConfirm,
    cancelLabel: LOBBY_INVITE_LABEL.busyRefuse,
  };
}

/**
 * Popup simple (pas déjà dans un lobby) : Rejoindre / Refuser.
 * true = join, false = refuse, autre = reporter.
 */
export function lobbyInvitePopupDecision(confirmResult) {
  if (confirmResult === true) return "join";
  if (confirmResult === false) return "refuse";
  return "dismiss";
}

/**
 * Déjà dans une autre soirée : deux issues, pas d’Annuler neutre.
 * true = quitter + rejoindre, false = rester + refuser l’invitation.
 * Clic hors / Escape = reporter (reste ici, l’invite **reste**).
 */
export function lobbyInviteBusyDecision(confirmResult) {
  if (confirmResult === true) return "leave_and_join";
  if (confirmResult === false) return "stay_and_refuse";
  return "dismiss";
}
