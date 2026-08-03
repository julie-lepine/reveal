/**
 * Sortie volontaire membre non-hôte — contrat d’échec distant strict.
 * Module pur (deps injectées) pour tests sans charger Supabase / DOM.
 */
import { finalizeGuestAfterAuthoritativeLeave } from "./finalizeGuestLeave.js";

let voluntaryLeaveInFlight = false;

export function isVoluntaryLeaveInFlight() {
  return voluntaryLeaveInFlight;
}

/** Tests uniquement. */
export function resetVoluntaryLeaveLockForTests() {
  voluntaryLeaveInFlight = false;
}

/**
 * Feedback échec leave volontaire (pas busy, pas cancel).
 * E5 : NOT_ALLOWED ne doit pas se masquer en « connexion a empêché ».
 * @param {{ ok?: boolean, cancelled?: boolean, busy?: boolean, error?: string, status?: string }|null|undefined} res
 * @param {{ showAppAlert: Function }} deps
 */
export async function notifyVoluntaryLeaveFailure(res, deps) {
  if (!res || res.ok || res.cancelled || res.busy) return;
  const alert = deps?.showAppAlert;
  if (!alert) return;
  if (res.status === "NOT_ALLOWED") {
    await alert(res.error || "Tu n'es pas l'hôte de ce lobby.", {
      title: "Fermeture impossible",
      icon: "⚠️",
    });
    return;
  }
  await alert(
    "La connexion a empêché la sortie du lobby. Réessaie dans quelques instants.",
    {
      title: "Impossible de quitter le lobby",
      icon: "⚠️",
    }
  );
}

/**
 * @param {{ navigateAway?: boolean }} [options]
 * @param {{
 *   getLobby: () => object|null|undefined,
 *   isGuest: () => boolean,
 *   isSupabaseConfigured: () => boolean,
 *   leaveLobbySupabase: () => Promise<{ ok: boolean, error?: string }>,
 *   stopMultiplayerSync: () => void,
 *   stopLobbyPresenceSync: () => void,
 *   signOutAnonGuestIfNeeded: (wasGuest: boolean) => Promise<void>|void,
 *   clearGuestMembership: () => void,
 *   clearLocalOpenLobbySlot: (code: string) => void,
 *   applyLeaveLobbyLocal: (args: { wasGuest: boolean, navigateAway: boolean }) => void,
 *   getUserId?: () => string|null|undefined,
 *   commitMembershipRemoved?: (input: { userId: string, lobbyId?: string|null }) => unknown,
 *   beginPostLeaveHomeTransition?: () => number,
 *   invalidateCurrentLobbySessionCache?: () => void,
 * }} deps
 * @returns {Promise<{ ok: boolean, error?: string, busy?: boolean, code?: string, cancelled?: boolean }>}
 */
export async function runVoluntaryMemberLeave(options = {}, deps) {
  if (!deps) {
    throw new Error("runVoluntaryMemberLeave: deps required");
  }

  const navigateAway = options.navigateAway !== false;

  if (voluntaryLeaveInFlight) {
    return { ok: false, busy: true };
  }

  voluntaryLeaveInFlight = true;
  try {
    const lobby = deps.getLobby();
    const code = lobby?.code;
    const lobbyId = lobby?.id || null;
    const wasGuest = deps.isGuest();
    const remote = Boolean(deps.isSupabaseConfigured() && lobby?.id);

    if (remote) {
      let res;
      try {
        res = await deps.leaveLobbySupabase();
      } catch (e) {
        console.warn("REVEAL leaveLobbySupabase threw:", e?.message || e);
        return { ok: false, error: e?.message || String(e) };
      }
      if (!res?.ok) {
        console.warn("REVEAL leaveLobbySupabase:", res?.error || res?.code);
        return {
          ok: false,
          error: res?.error || "Impossible de quitter le lobby.",
          code: res?.code,
        };
      }

      // E3 — soft-hold Home avant invalidate snapshot (survit navigate/remount).
      deps.beginPostLeaveHomeTransition?.();

      // Preuve : DELETE membership courant OK — retirer found(B) avant clear runtime.
      const userId = deps.getUserId?.() || null;
      if (userId && lobbyId && deps.commitMembershipRemoved) {
        deps.commitMembershipRemoved({ userId, lobbyId });
      }

      deps.invalidateCurrentLobbySessionCache?.();

      deps.stopMultiplayerSync();
      deps.stopLobbyPresenceSync();
      // Guest finalize avant wipe lobby : wasGuest encore valide ; hint clear idempotent
      // avec applyLeaveLobbyLocal.
      await finalizeGuestAfterAuthoritativeLeave(
        { wasGuest, canonicalElsewhere: false },
        {
          signOutAnonGuestIfNeeded: deps.signOutAnonGuestIfNeeded,
          clearGuestMembership: deps.clearGuestMembership,
        }
      );
      deps.applyLeaveLobbyLocal({ wasGuest, navigateAway });
      return {
        ok: true,
        deleted: Boolean(res.deleted),
        membershipAbsent: Boolean(res.membershipAbsent),
      };
    }

    // Offline / démo : aucune ligne lobby_members — cleanup local direct.
    deps.stopMultiplayerSync();
    deps.stopLobbyPresenceSync();
    if (code) deps.clearLocalOpenLobbySlot(code);
    await finalizeGuestAfterAuthoritativeLeave(
      { wasGuest, canonicalElsewhere: false },
      {
        signOutAnonGuestIfNeeded: deps.signOutAnonGuestIfNeeded,
        clearGuestMembership: deps.clearGuestMembership,
      }
    );
    deps.applyLeaveLobbyLocal({ wasGuest, navigateAway });
    return { ok: true };
  } finally {
    voluntaryLeaveInFlight = false;
  }
}
