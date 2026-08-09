/**
 * FEATURE-TIERNIGHT-03 - clear distant autoritatif customRosterTopics (frontière sortie).
 *
 * Source de vérité : game_sessions.state.customRosterTopics
 * RPC : clear_tiernight_custom_roster_topics (hôte réel + CAS session).
 * Ne pas appeler à series_end (snapshots encore utiles) - seulement à la sortie produit.
 *
 * Isolation (décision B) : collection top-level ; pas d’exigence game_id.
 * Protection stale : p_expected_session_id obligatoire si session existante (serveur).
 */

import { createActionLock } from "./actionLock.js";
import { getState, saveStatePatch } from "./state.js";
import { clearCustomRosterTopicsLocal } from "./customRosterTopicSession.js";
import { mergeCustomRosterTopics } from "./sessionMerge.js";

export const TIERNIGHT_CLEAR_CUSTOM_ROSTER_RPC = "clear_tiernight_custom_roster_topics";

const clearLock = createActionLock();

/** Writable courant : absent → legacy ouverte (lecture). */
export function readLocalCustomRosterWritable(state = getState()) {
  return state?.customRosterTopicsWritable !== false;
}

/**
 * @param {object|null|undefined} result - payload RPC
 */
export function applyClearedCustomRosterTopicsFromRpc(result) {
  const epoch = Number(result?.epoch);
  const writable =
    result?.writable === true || result?.writable === false
      ? Boolean(result.writable)
      : false;
  const patch = {
    customRosterTopics: [],
    customRosterTopicsWritable: writable,
  };
  if (Number.isFinite(epoch) && epoch >= 0) {
    patch.customRosterTopicsEpoch = epoch;
  }
  saveStatePatch(patch);
  return patch;
}

/**
 * Hydrate : un epoch remote plus récent autorise [] même avec customs locaux multi-auteurs.
 * @param {object} st - row.state
 * @param {unknown[]} localBefore
 * @param {number} localEpoch
 */
export function shouldAcceptRemoteCustomRosterTopicsEmpty(st, localBefore, localEpoch) {
  const remoteEpoch = Number(st?.customRosterTopicsEpoch) || 0;
  if (remoteEpoch > (Number(localEpoch) || 0)) return true;
  if (st?.customRosterTopicsWritable === false && Array.isArray(st?.customRosterTopics)) {
    return st.customRosterTopics.length === 0;
  }
  return false;
}

/**
 * AUDIT-004 — décision d'hydrate customRosterTopics (pur / testable).
 *
 * Contrat :
 * - acceptEmpty (epoch↑ / writable:false+[]) → remote autoritaire (y compris []) ;
 * - remote epoch < local + [] → conserver local (stale empty) ;
 * - sinon merge : remote gagne pour les autres ; own absents du remote = optimisme.
 *
 * Ne jamais « ignorer » un [] remote à epoch égale à cause de customs d'autrui :
 * delete_player_custom_entry ne bump pas l'epoch → [B]→[] doit passer par merge.
 *
 * @param {{
 *   remoteList?: unknown[],
 *   localBefore?: unknown[],
 *   localAuthor?: string|null,
 *   localAuthorUid?: string|null,
 *   localEpoch?: number,
 *   remoteState?: object|null,
 * }} input
 */
export function resolveCustomRosterTopicsFromRemote(input = {}) {
  const remoteList = Array.isArray(input.remoteList) ? input.remoteList : [];
  const localBefore = Array.isArray(input.localBefore) ? input.localBefore : [];
  const localEpoch = Number(input.localEpoch) || 0;
  const remoteState = input.remoteState || {};
  const remoteEpoch = Number(remoteState.customRosterTopicsEpoch) || 0;
  const acceptEmpty = shouldAcceptRemoteCustomRosterTopicsEmpty(
    { ...remoteState, customRosterTopics: remoteList },
    localBefore,
    localEpoch
  );

  if (acceptEmpty || remoteEpoch > localEpoch) {
    return {
      topics: remoteList,
      mode: "authoritative",
      acceptEmpty,
      remoteEpoch,
    };
  }

  // Stale empty : epoch remote strictement plus ancienne → ne pas amputer le local.
  if (remoteList.length === 0 && remoteEpoch < localEpoch) {
    return {
      topics: localBefore,
      mode: "keep_local_stale_empty",
      acceptEmpty,
      remoteEpoch,
    };
  }

  return {
    topics: mergeCustomRosterTopics(
      localBefore,
      remoteList,
      input.localAuthor ?? null,
      input.localAuthorUid ?? null
    ),
    mode: "merge",
    acceptEmpty,
    remoteEpoch,
  };
}

/**
 * Frontière unique : vide distant (hôte) + local.
 * @param {{
 *   reopen?: boolean,
 *   shouldContinue?: () => boolean,
 *   lobbyId?: string|null,
 *   expectedSessionId?: string|null,
 * }} [opts]
 */
export async function clearTierNightCustomRosterTopicsAtExitBoundary({
  reopen = false,
  shouldContinue = null,
  lobbyId = null,
  expectedSessionId = null,
} = {}) {
  const canContinue = () => typeof shouldContinue !== "function" || shouldContinue();

  const outcome = await clearLock.run(async () => {
    const state = getState();
    const capturedLobbyId = lobbyId || state.lobby?.id || null;
    const targetWritable = Boolean(reopen);

    const { isGameSyncActive, isLobbyHost, refreshGameSession, getCachedGameSession } =
      await import("./gameSync.js");

    let capturedSessionId =
      expectedSessionId ||
      (typeof getCachedGameSession === "function" ? getCachedGameSession()?.id : null) ||
      null;

    // Offline / local-only
    if (!isGameSyncActive()) {
      const topics = state.customRosterTopics || [];
      const epoch = Number(state.customRosterTopicsEpoch) || 0;
      const writable = readLocalCustomRosterWritable(state);
      const already =
        Array.isArray(topics) &&
        topics.length === 0 &&
        writable === targetWritable &&
        Number.isInteger(epoch);

      if (already) {
        return {
          ok: true,
          localOnly: true,
          applied: false,
          alreadyEmpty: true,
          code: "ALREADY_CANONICAL",
          epoch,
          writable,
          reopen: targetWritable,
        };
      }

      clearCustomRosterTopicsLocal();
      const nextEpoch = epoch + 1;
      saveStatePatch({
        customRosterTopicsEpoch: nextEpoch,
        customRosterTopicsWritable: targetWritable,
      });
      return {
        ok: true,
        localOnly: true,
        applied: true,
        alreadyEmpty: topics.length === 0,
        epoch: nextEpoch,
        writable: targetWritable,
        reopen: targetWritable,
      };
    }

    // Invité : clear local ; suit le remote hôte (pas d’invocation clear global).
    if (!isLobbyHost()) {
      clearCustomRosterTopicsLocal();
      return {
        ok: true,
        guestLocalOnly: true,
        applied: false,
        reopen: targetWritable,
      };
    }

    if (!capturedLobbyId) {
      clearCustomRosterTopicsLocal();
      return {
        ok: false,
        code: "NO_LOBBY",
        error: "Lobby introuvable pour vider les thèmes personnalisés.",
      };
    }

    // Session existante → identité obligatoire pour CAS serveur.
    if (!capturedSessionId) {
      try {
        const row = await refreshGameSession();
        capturedSessionId = row?.id || null;
      } catch {
        capturedSessionId = null;
      }
    }

    const previousTopics = [...(getState().customRosterTopics || [])];
    const previousEpoch = Number(getState().customRosterTopicsEpoch) || 0;
    const previousWritable = readLocalCustomRosterWritable(getState());
    const localAlreadyCanonical =
      previousTopics.length === 0 && previousWritable === targetWritable;

    if (!localAlreadyCanonical) {
      applyClearedCustomRosterTopicsFromRpc({
        epoch: previousEpoch + 1,
        writable: targetWritable,
      });
    }

    try {
      const { rpcClearTierNightCustomRosterTopics } = await import("./gameSessionRpc.js");
      const result = await rpcClearTierNightCustomRosterTopics({
        lobbyId: capturedLobbyId,
        expectedSessionId: capturedSessionId,
        reopen: targetWritable,
      });

      if (!canContinue()) {
        return {
          ok: false,
          code: "STALE",
          stale: true,
          appliedRemote: result?.applied === true,
        };
      }

      const liveLobbyId = getState().lobby?.id || null;
      if (liveLobbyId && liveLobbyId !== capturedLobbyId) {
        return {
          ok: false,
          code: "STALE_LOBBY",
          stale: true,
          appliedRemote: result?.applied === true,
        };
      }

      // Serveur a déjà refusé STALE_SESSION ; défense locale post-succès.
      if (
        result?.ok === true &&
        capturedSessionId &&
        result?.sessionId &&
        String(result.sessionId) !== String(capturedSessionId)
      ) {
        return {
          ok: false,
          code: "STALE_SESSION",
          stale: true,
          appliedRemote: result?.applied === true,
        };
      }

      if (result?.ok !== true) {
        if (!localAlreadyCanonical) {
          saveStatePatch({
            customRosterTopics: previousTopics,
            customRosterTopicsEpoch: previousEpoch,
            customRosterTopicsWritable: previousWritable,
          });
        }
        const code = result?.code || "CLEAR_REJECTED";
        return {
          ok: false,
          code,
          error:
            code === "NOT_HOST"
              ? "Seul l'hôte peut vider les thèmes personnalisés."
              : code === "SESSION_ABSENT_CANNOT_REOPEN"
                ? "Aucune session à rouvrir pour les thèmes personnalisés."
                : code === "STALE_SESSION"
                  ? "Session de jeu obsolète - thèmes non modifiés."
                  : code === "CUSTOM_ROSTER_EPOCH_EXHAUSTED"
                    ? "Compteur de thèmes personnalisés saturé - clear impossible."
                  : code === "EXPECTED_SESSION_REQUIRED"
                    ? "Identité de session requise pour vider les thèmes."
                    : "Impossible de vider les thèmes personnalisés.",
          unauthorized: code === "NOT_HOST" || code === "AUTH_REQUIRED",
          cannotReopen: code === "SESSION_ABSENT_CANNOT_REOPEN",
          stale: code === "STALE_SESSION",
          epochExhausted: code === "CUSTOM_ROSTER_EPOCH_EXHAUSTED",
          actualSessionId: result?.actualSessionId || null,
        };
      }

      applyClearedCustomRosterTopicsFromRpc(result);
      if (result.state && typeof result.state === "object") {
        const epoch = Number(result.state.customRosterTopicsEpoch);
        if (Number.isFinite(epoch)) {
          saveStatePatch({
            customRosterTopics: [],
            customRosterTopicsEpoch: epoch,
            customRosterTopicsWritable:
              result.state.customRosterTopicsWritable === true,
          });
        }
      }

      return {
        ok: true,
        applied: result.applied === true,
        alreadyEmpty: result.alreadyEmpty === true,
        epoch: result.epoch,
        writable: result.writable === true,
        reopen: targetWritable,
        code: result.code || null,
        sessionId: result.sessionId || null,
      };
    } catch (err) {
      try {
        const row = await refreshGameSession();
        if (!canContinue()) {
          return { ok: false, code: "STALE", stale: true, timeout: true };
        }
        const liveLobbyId = getState().lobby?.id || null;
        if (liveLobbyId && liveLobbyId !== capturedLobbyId) {
          return {
            ok: false,
            code: "STALE_LOBBY",
            stale: true,
            timeout: true,
          };
        }
        if (
          capturedSessionId &&
          row?.id &&
          String(row.id) !== String(capturedSessionId)
        ) {
          if (!localAlreadyCanonical) {
            saveStatePatch({
              customRosterTopics: previousTopics,
              customRosterTopicsEpoch: previousEpoch,
              customRosterTopicsWritable: previousWritable,
            });
          }
          return {
            ok: false,
            code: "STALE_SESSION",
            stale: true,
            timeout: true,
            actualSessionId: row.id,
          };
        }
        const absent = !row;
        if (absent) {
          if (targetWritable) {
            if (!localAlreadyCanonical) {
              saveStatePatch({
                customRosterTopics: previousTopics,
                customRosterTopicsEpoch: previousEpoch,
                customRosterTopicsWritable: previousWritable,
              });
            }
            return {
              ok: false,
              code: "SESSION_ABSENT_CANNOT_REOPEN",
              cannotReopen: true,
              timeout: true,
              error: "Aucune session à rouvrir pour les thèmes personnalisés.",
            };
          }
          applyClearedCustomRosterTopicsFromRpc({
            epoch: previousEpoch,
            writable: false,
          });
          return {
            ok: true,
            reconciled: true,
            timeout: true,
            alreadyEmpty: true,
            applied: false,
            code: "SESSION_ABSENT",
            reopen: false,
          };
        }

        const remoteList = row.state?.customRosterTopics;
        const remoteEpoch = Number(row.state?.customRosterTopicsEpoch) || 0;
        const remoteWritable = row.state?.customRosterTopicsWritable === true;
        const remoteEmpty = Array.isArray(remoteList) && remoteList.length === 0;
        const looksApplied =
          remoteEmpty &&
          typeof row.state?.customRosterTopicsWritable === "boolean" &&
          (remoteEpoch > previousEpoch ||
            (remoteEpoch === previousEpoch &&
              remoteWritable === targetWritable &&
              localAlreadyCanonical) ||
            remoteEpoch >= previousEpoch + 1);

        if (looksApplied) {
          applyClearedCustomRosterTopicsFromRpc({
            epoch: remoteEpoch,
            writable: remoteWritable,
          });
          return {
            ok: true,
            reconciled: true,
            timeout: true,
            alreadyEmpty: true,
            applied: remoteEpoch > previousEpoch,
            code:
              remoteEpoch === previousEpoch && remoteWritable === targetWritable
                ? "ALREADY_CANONICAL"
                : null,
            reopen: targetWritable,
          };
        }
      } catch {
        /* fall through */
      }

      saveStatePatch({
        customRosterTopics: previousTopics,
        customRosterTopicsEpoch: previousEpoch,
        customRosterTopicsWritable: previousWritable,
      });
      return {
        ok: false,
        code: "NETWORK",
        timeout: true,
        error: err?.message || "Délai dépassé en vidant les thèmes personnalisés.",
        rolledBack: true,
      };
    }
  });

  if (outcome.skipped) {
    return { ok: false, skipped: true, code: "IN_FLIGHT" };
  }
  return outcome.value;
}

export function __testGetClearCustomRosterLock() {
  return clearLock;
}
