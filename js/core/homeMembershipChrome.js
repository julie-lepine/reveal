/**
 * Vague B/D/E3 — projection Home de la membership résolue (pure, testable).
 *
 * SoT chrome server-only : snapshot mémoire (`status === "found"`), pas `pendingServerLobby`.
 * Politique `found` face à `unknown` : consommateur Home / create (lobbyCreateGuard),
 * pas `setMembershipSnapshot` bas niveau.
 *
 * Vague D : Quitter/Fermer server-only via snapshot.membership ; confirmation `none`
 * obligatoire avant Créer. `leaveConfirmationPending` si mutation OK + query unknown.
 *
 * Vague E3 : `postLeaveHomeTransition` — soft-hold UI après leave confirmé (snapshot null)
 * sans checking générique ni faux `none` snapshot.
 * Priorité chrome (extrait) :
 * reconciliation → leave_confirmation_pending → post_leave_transition → cached_active → …
 */

import { leaveServerActionLabel } from "./lobbyServerLeave.js";

export { decideMembershipSnapshotWrite } from "./lobbyCreateGuard.js";
export { leaveServerActionLabel } from "./lobbyServerLeave.js";

/**
 * @typedef {"checking"|"none"|"cached_active"|"server_membership_recoverable"|"server_membership_unrecoverable"|"check_failed"|"leave_confirmation_pending"|"membership_reconciliation_required"|"post_leave_transition"} HomeMembershipState
 *
 * @typedef {{
 *   lobbyId?: string,
 *   code?: string,
 *   lobbyStatus?: string|null,
 *   gameId?: string|null,
 *   role?: "host"|"member",
 * }} MembershipMeta
 *
 * @typedef {{
 *   status?: string,
 *   membership?: MembershipMeta,
 *   extraCount?: number,
 * }|null} MembershipSnapshotLike
 *
 * @typedef {{
 *   state: HomeMembershipState,
 *   showReturnToLobby: boolean,
 *   showResume: boolean,
 *   showLeave: boolean,
 *   showLeaveServer: boolean,
 *   showLeavePrepDisabled: boolean,
 *   leaveServerLabel: string|null,
 *   leaveServerRole: "host"|"member"|null,
 *   createEnabled: boolean,
 *   createDisabledReason: string|null,
 *   primaryMessage: string|null,
 *   errorMessage: string|null,
 *   showRetry: boolean,
 *   membershipCode: string|null,
 *   membershipRole: string|null,
 *   membershipLobbyId: string|null,
 *   lobbyStatus: string|null,
 *   checkStaleHint: boolean,
 *   serverLeaveBusy: boolean,
 * }} HomeMembershipChrome
 */

const CREATE_DISABLED_CHECKING = "Vérification de ton lobby en cours…";
const CREATE_DISABLED_FOUND = (code) =>
  `Reprends ou quitte le lobby ${code || "?"} avant d'en créer un nouveau.`;
const CREATE_DISABLED_CHECK_FAILED =
  "Impossible de vérifier si tu es déjà dans un lobby. Réessaie avant d'en créer un.";
const CREATE_DISABLED_ACTIVE = "Quitte le lobby actuel avant d'en créer un nouveau.";
const CREATE_DISABLED_LEAVE_PENDING =
  "Sortie en cours de vérification — attends la confirmation serveur avant de créer.";
/** E3 — indication discrète CTA pendant soft-hold post-leave. */
export const CREATE_DISABLED_POST_LEAVE = "Finalisation…";

/**
 * @param {{
 *   hasActiveLobby?: boolean,
 *   snapshot?: MembershipSnapshotLike,
 *   resolutionInProgress?: boolean,
 *   authReady?: boolean,
 *   supabaseConfigured?: boolean,
 *   loggedIn?: boolean,
 *   shouldCheckMembership?: boolean,
 *   resumeUnrecoverable?: boolean,
 *   resumeErrorMessage?: string|null,
 *   retainedFoundDespiteUnknown?: boolean,
 *   activeLobbyCode?: string|null,
 *   leaveConfirmationPending?: boolean,
 *   postLeaveHomeTransition?: boolean,
 *   serverLeaveInFlight?: boolean,
 *   membershipReconciliationConflict?: {
 *     remoteLobbyId?: string,
 *     remoteCode?: string|null,
 *     localLobbyId?: string|null,
 *   }|null,
 * }} input
 * @returns {HomeMembershipChrome}
 */
export function deriveHomeMembershipChrome(input = {}) {
  const hasActiveLobby = Boolean(input.hasActiveLobby);
  const snapshot = input.snapshot ?? null;
  const resolutionInProgress = Boolean(input.resolutionInProgress);
  const authReady = input.authReady !== false;
  const supabaseConfigured = Boolean(input.supabaseConfigured);
  const loggedIn = Boolean(input.loggedIn);
  const shouldCheckMembership = Boolean(input.shouldCheckMembership);
  const resumeUnrecoverable = Boolean(input.resumeUnrecoverable);
  const resumeErrorMessage = input.resumeErrorMessage || null;
  const retainedFoundDespiteUnknown = Boolean(input.retainedFoundDespiteUnknown);
  const activeLobbyCode = input.activeLobbyCode || null;
  const leaveConfirmationPending = Boolean(input.leaveConfirmationPending);
  const postLeaveHomeTransition = Boolean(input.postLeaveHomeTransition);
  const serverLeaveInFlight = Boolean(input.serverLeaveInFlight);
  const reconciliation = input.membershipReconciliationConflict || null;

  const found =
    snapshot?.status === "found" && snapshot.membership?.code
      ? snapshot.membership
      : null;

  /** @type {HomeMembershipChrome} */
  const base = {
    state: "none",
    showReturnToLobby: false,
    showResume: false,
    showLeave: false,
    showLeaveServer: false,
    showLeavePrepDisabled: false,
    leaveServerLabel: null,
    leaveServerRole: null,
    createEnabled: false,
    createDisabledReason: null,
    primaryMessage: null,
    errorMessage: null,
    showRetry: false,
    membershipCode: null,
    membershipRole: null,
    membershipLobbyId: null,
    lobbyStatus: null,
    checkStaleHint: false,
    serverLeaveBusy: serverLeaveInFlight,
  };

  if (reconciliation?.remoteLobbyId) {
    const code = reconciliation.remoteCode || "?";
    return {
      ...base,
      state: "membership_reconciliation_required",
      createEnabled: false,
      createDisabledReason: `Résous la connexion inachevée au lobby ${code} avant d'en créer un nouveau.`,
      membershipCode: code,
      membershipLobbyId: reconciliation.remoteLobbyId,
      primaryMessage: `Une tentative de connexion au lobby ${code} n'a pas été finalisée.`,
      errorMessage:
        reconciliation.localLobbyId
          ? "Choisis de quitter ce lobby ou d'y revenir."
          : "Choisis de quitter ce lobby ou d'y rejoindre.",
    };
  }

  // Mutation OK + confirmation unknown : pas de faux none, pas de found ressuscité.
  // Avant cached_active : handoff unknown→pending ne doit pas réafficher le cache.
  if (leaveConfirmationPending && !found) {
    return {
      ...base,
      state: "leave_confirmation_pending",
      createEnabled: false,
      createDisabledReason: CREATE_DISABLED_LEAVE_PENDING,
      showRetry: true,
      primaryMessage:
        "Sortie probablement effectuée, mais la vérification serveur est impossible.",
      errorMessage: "Réessaie la vérification avant de créer un lobby.",
    };
  }

  // E3 — soft-hold après leave confirmé : none-like, pas de checking générique, Créer off.
  // Avant cached_active : pendant await signOut / avant applyLeaveLobbyLocal le cache
  // runtime est encore vrai ; le soft-hold doit le neutraliser (leave serveur confirmé).
  // Hors E3 (!postLeave) : politique cached_active inchangée.
  if (postLeaveHomeTransition) {
    return {
      ...base,
      state: "post_leave_transition",
      createEnabled: false,
      createDisabledReason: CREATE_DISABLED_POST_LEAVE,
      primaryMessage: null,
      errorMessage: null,
      showRetry: false,
      showResume: false,
      showReturnToLobby: false,
      showLeave: false,
      showLeaveServer: false,
    };
  }

  if (hasActiveLobby) {
    return {
      ...base,
      state: "cached_active",
      showReturnToLobby: true,
      showLeave: true,
      createEnabled: false,
      createDisabledReason: CREATE_DISABLED_ACTIVE,
      membershipCode: activeLobbyCode,
    };
  }

  if (found) {
    const code = String(found.code);
    const role = found.role === "host" || found.role === "member" ? found.role : null;
    const playing = found.lobbyStatus === "playing";
    const state = resumeUnrecoverable
      ? "server_membership_unrecoverable"
      : "server_membership_recoverable";
    return {
      ...base,
      state,
      showResume: true,
      showLeaveServer: Boolean(role),
      leaveServerLabel: role ? leaveServerActionLabel(role) : null,
      leaveServerRole: role,
      createEnabled: false,
      createDisabledReason: CREATE_DISABLED_FOUND(code),
      membershipCode: code,
      membershipRole: role,
      membershipLobbyId: found.lobbyId || null,
      lobbyStatus: found.lobbyStatus ?? null,
      checkStaleHint: retainedFoundDespiteUnknown,
      primaryMessage: playing
        ? `Tu es encore dans le lobby ${code} (partie en cours).`
        : `Tu es encore dans le lobby ${code}.`,
      errorMessage: resumeUnrecoverable
        ? resumeErrorMessage ||
          "Impossible de retrouver ta soirée. Tu peux réessayer ou demander le code à l'hôte."
        : retainedFoundDespiteUnknown
          ? "Vérification serveur impossible pour le moment — membership connue conservée."
          : null,
    };
  }

  if (!supabaseConfigured || !shouldCheckMembership) {
    return {
      ...base,
      state: "none",
      createEnabled: loggedIn,
      createDisabledReason: loggedIn ? null : null,
    };
  }

  if (!authReady) {
    return {
      ...base,
      state: "checking",
      createEnabled: false,
      createDisabledReason: CREATE_DISABLED_CHECKING,
      primaryMessage: "Vérification de ton lobby…",
    };
  }

  if (snapshot?.status === "unknown") {
    return {
      ...base,
      state: "check_failed",
      createEnabled: false,
      createDisabledReason: CREATE_DISABLED_CHECK_FAILED,
      showRetry: true,
      primaryMessage: "Impossible de vérifier si tu es déjà dans un lobby.",
      errorMessage: "Réessaie dans un instant.",
    };
  }

  if (snapshot?.status === "none") {
    // Vague C : none + refresh en cours → Créer non actionnable (état reste none).
    if (resolutionInProgress) {
      return {
        ...base,
        state: "none",
        createEnabled: false,
        createDisabledReason: CREATE_DISABLED_CHECKING,
        primaryMessage: "Vérification de ton lobby…",
      };
    }
    return {
      ...base,
      state: "none",
      createEnabled: loggedIn,
    };
  }

  // Pas encore de snapshot, ou résolution initiale en cours.
  if (snapshot == null || resolutionInProgress) {
    return {
      ...base,
      state: "checking",
      createEnabled: false,
      createDisabledReason: CREATE_DISABLED_CHECKING,
      primaryMessage: "Vérification de ton lobby…",
    };
  }

  return {
    ...base,
    state: "none",
    createEnabled: loggedIn,
  };
}
