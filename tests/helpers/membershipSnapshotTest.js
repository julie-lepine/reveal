/** Helpers partagés — snapshot membership scoped (E1). */
import { saveStatePatch } from "../../js/core/state.js";
import {
  __resetMembershipAuthForTests,
  invalidateMembershipSnapshot,
} from "../../js/core/lobbyMembershipSnapshot.js";

export const UID_A = "user-a-1111-2222-3333";
export const UID_B = "user-b-4444-5555-6666";

export function resetMembershipSnapshotTestState(userId = UID_A) {
  __resetMembershipAuthForTests();
  saveStatePatch({ supabaseUserId: userId });
}

export function clearMembershipSnapshotTestState() {
  __resetMembershipAuthForTests();
  invalidateMembershipSnapshot();
  saveStatePatch({ supabaseUserId: null });
}

/** @param {string} [userId] */
export function sameIdentity(userId = UID_A) {
  return {
    queryUserId: userId,
    currentUserId: userId,
    queryAuthGeneration: 0,
    currentAuthGeneration: 0,
  };
}
