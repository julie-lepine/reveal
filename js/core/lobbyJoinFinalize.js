/**
 * Finalisation join échoué — compensation serveur puis rollback local.
 * Exporté pour tests comportementaux.
 */
import { needsJoinCompensation, markLobbyJoinFinalized } from "./lobbyJoinEffects.js";
import { compensateFailedLobbyJoin } from "./lobbyMembershipCompensation.js";

/**
 * @param {{
 *   joinEffects?: import('./lobbyJoinEffects.js').LobbyJoinEffects|null,
 *   rollbackSnapshot?: object|null,
 * }} ctx
 * @param {{
 *   compensateFailedLobbyJoin?: typeof compensateFailedLobbyJoin,
 *   deleteOwnLobbyMembershipById?: (lobbyId: string) => Promise<{ ok: boolean, error?: string }>,
 *   rollbackLobbyJoinTransition?: (snapshot: object) => Promise<void>,
 * }} [deps]
 */
export async function finalizeFailedJoinAttempt(ctx, deps = {}) {
  const { joinEffects, rollbackSnapshot } = ctx || {};
  const compensateFn = deps.compensateFailedLobbyJoin || compensateFailedLobbyJoin;

  if (joinEffects && needsJoinCompensation(joinEffects)) {
    await compensateFn(joinEffects, {
      deleteOwnLobbyMembershipById: deps.deleteOwnLobbyMembershipById,
    });
  }
  if (rollbackSnapshot && typeof deps.rollbackLobbyJoinTransition === "function") {
    await deps.rollbackLobbyJoinTransition(rollbackSnapshot);
  }
}

export { markLobbyJoinFinalized };
