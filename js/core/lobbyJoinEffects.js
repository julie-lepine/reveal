/**
 * Journal d'effets d'une tentative de join MP - purs / testables.
 */

/** @typedef {'none'|'inserted'|'reclaimed'|'preexisting'} LobbyJoinMembershipOrigin */

/**
 * @typedef {{
 *   targetLobbyId: string|null,
 *   targetMembershipId: string|null,
 *   membershipOrigin: LobbyJoinMembershipOrigin,
 *   membershipCreatedByAttempt: boolean,
 *   previousGuestMembership: import('./guestMembership.js').GuestMembership|null,
 *   guestMembershipWritten: import('./guestMembership.js').GuestMembership|null,
 *   guestMembershipChanged: boolean,
 *   serverMutationConfirmed: boolean,
 *   joinFinalized: boolean,
 * }} LobbyJoinEffects
 */

/**
 * @param {import('./guestMembership.js').GuestMembership|null|undefined} previousGuestMembership
 * @returns {LobbyJoinEffects}
 */
export function createLobbyJoinEffects(previousGuestMembership = null) {
  return {
    targetLobbyId: null,
    targetMembershipId: null,
    membershipOrigin: "none",
    membershipCreatedByAttempt: false,
    previousGuestMembership: previousGuestMembership
      ? { ...previousGuestMembership }
      : null,
    guestMembershipWritten: null,
    guestMembershipChanged: false,
    serverMutationConfirmed: false,
    joinFinalized: false,
  };
}

/** @param {LobbyJoinEffects|null|undefined} effects */
export function markLobbyJoinFinalized(effects) {
  if (effects) effects.joinFinalized = true;
}

/**
 * INSERT confirmé pendant cette tentative - éligible au DELETE compensation.
 * Reclaim confirmé (UPDATE user_id) - même DELETE que « Quitter le lobby ».
 * @param {LobbyJoinEffects|null|undefined} effects
 */
export function shouldCompensateInsertedMembershipDelete(effects) {
  if (!effects || effects.joinFinalized) return false;
  return (
    effects.membershipCreatedByAttempt === true &&
    effects.membershipOrigin === "inserted" &&
    effects.serverMutationConfirmed === true &&
    Boolean(effects.targetLobbyId) &&
    Boolean(effects.targetMembershipId)
  );
}

/**
 * Reclaim avec mutation confirmée - DELETE équivalent au leave volontaire.
 * @param {LobbyJoinEffects|null|undefined} effects
 */
export function shouldCompensateReclaimedMembershipDelete(effects) {
  if (!effects || effects.joinFinalized) return false;
  return (
    effects.membershipOrigin === "reclaimed" &&
    effects.serverMutationConfirmed === true &&
    Boolean(effects.targetLobbyId) &&
    Boolean(effects.targetMembershipId)
  );
}

/** @param {LobbyJoinEffects|null|undefined} effects */
export function shouldCompensateMembershipDelete(effects) {
  return (
    shouldCompensateInsertedMembershipDelete(effects) ||
    shouldCompensateReclaimedMembershipDelete(effects)
  );
}

/**
 * @param {LobbyJoinEffects|null|undefined} effects
 */
export function needsJoinCompensation(effects) {
  if (!effects || effects.joinFinalized) return false;
  if (shouldCompensateMembershipDelete(effects)) return true;
  if (effects.guestMembershipChanged) return true;
  if (
    effects.serverMutationConfirmed &&
    effects.membershipOrigin === "reclaimed" &&
    effects.targetLobbyId
  ) {
    return true;
  }
  return false;
}

/**
 * @param {LobbyJoinEffects} effects
 * @param {import('./guestMembership.js').GuestMembership} membership
 * @param {(m: import('./guestMembership.js').GuestMembership) => void} saveFn
 */
export function recordGuestMembershipWriteForJoin(effects, membership, saveFn) {
  if (!effects || !membership?.membershipId) return;
  saveFn(membership);
  effects.guestMembershipWritten = { ...membership };
  effects.guestMembershipChanged = true;
}

/**
 * @param {LobbyJoinEffects} effects
 * @param {{ id: string }} insertedRow
 * @param {string} lobbyId
 */
export function recordMembershipInsertForJoin(effects, insertedRow, lobbyId) {
  effects.targetLobbyId = lobbyId;
  effects.targetMembershipId = insertedRow.id;
  effects.membershipOrigin = "inserted";
  effects.membershipCreatedByAttempt = true;
  effects.serverMutationConfirmed = true;
}

/**
 * Reclaim : UPDATE user_id sur ligne préexistante.
 * Compensation = DELETE (même contrat que leave volontaire), pas revert RPC.
 * @param {LobbyJoinEffects} effects
 * @param {{ membershipId: string, lobbyId: string, reclaimed?: boolean }} reclaimInfo
 */
export function recordMembershipReclaimForJoin(effects, reclaimInfo) {
  effects.targetLobbyId = reclaimInfo.lobbyId;
  effects.targetMembershipId = reclaimInfo.membershipId;
  effects.membershipOrigin = "reclaimed";
  effects.membershipCreatedByAttempt = false;
  effects.serverMutationConfirmed = reclaimInfo.reclaimed === true;
}

/**
 * @param {LobbyJoinEffects} effects
 * @param {{ id: string }} existingRow
 * @param {string} lobbyId
 */
export function recordPreexistingMembershipForJoin(effects, existingRow, lobbyId) {
  effects.targetLobbyId = lobbyId;
  effects.targetMembershipId = existingRow.id;
  effects.membershipOrigin = "preexisting";
  effects.membershipCreatedByAttempt = false;
  effects.serverMutationConfirmed = false;
}
