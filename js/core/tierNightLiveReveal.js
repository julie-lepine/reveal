/**
 * BUG-TIERNIGHT-03 - décisions / verrou pour auto-reveal Rank live (pures, testables).
 * Ne gère pas le passage manuel à l'item suivant.
 */

import { isSyncNetworkError } from "./authErrors.js";

export const TIER_NIGHT_LIVE_REVEAL_AUTO_ALERT =
  'Impossible de lancer la révélation automatiquement. Utilise « Révéler maintenant » pour réessayer.';

/** Erreur réseau / timeout → résultat de commit potentiellement déjà appliqué côté serveur. */
export function isTierNightLiveRevealNetworkUncertainty(err) {
  if (!err) return false;
  const name = String(err?.name || "");
  const msg = String(err?.message || err || "").toLowerCase();
  const code = String(err?.code || "");
  return (
    name === "AbortError" ||
    name === "TypeError" ||
    code === "ECONNRESET" ||
    code === "ETIMEDOUT" ||
    isSyncNetworkError(msg) ||
    msg.includes("timeout") ||
    msg.includes("aborted") ||
    msg.includes("abort") ||
    msg.includes("synchronisation trop longue") ||
    msg.includes("fetch") ||
    msg.includes("network")
  );
}

/**
 * Après timeout / incertitude : la phase distante est-elle déjà `reveal` ?
 * @param {object|null|undefined} remoteLive
 * @param {{ runId?: string|null, roundIdx?: number|null }} expected
 */
export function evaluateTierNightLiveRevealRecovery(remoteLive, expected = {}) {
  if (!remoteLive || typeof remoteLive !== "object") {
    return { recovered: false, reason: "no_state" };
  }
  const expectedRun = expected.runId ?? null;
  const remoteRun = remoteLive.runId || null;
  if (expectedRun != null && remoteRun != null && remoteRun !== expectedRun) {
    return { recovered: false, reason: "stale_run" };
  }
  const expectedIdx = expected.roundIdx ?? 0;
  const remoteIdx = remoteLive.roundIdx ?? 0;
  if (remoteIdx !== expectedIdx) {
    return { recovered: false, reason: "stale_round" };
  }
  const phase = remoteLive.phase || null;
  if (phase === "reveal") {
    return { recovered: true, reason: "remote_reveal" };
  }
  if (phase === "done" || remoteLive.finished) {
    return { recovered: true, reason: "remote_done" };
  }
  return { recovered: false, reason: "still_voting" };
}

/**
 * Décide si on commit, on attend l'in-flight, ou no-op.
 * Manual peut forcer même si votes incomplets (filet `#live-reveal`).
 */
export function decideTierNightLiveRevealAction({
  phase = null,
  canActAsHost = false,
  allVotesIn = false,
  source = "auto",
  inFlight = false,
  retryUsed = false,
} = {}) {
  if (phase === "reveal" || phase === "done") {
    return { action: "noop", reason: "already-reveal" };
  }
  if (phase !== "voting") {
    return { action: "noop", reason: "wrong-phase" };
  }
  if (!canActAsHost) {
    return { action: "noop", reason: "not-host" };
  }
  if (inFlight) {
    return { action: "await-inflight", reason: "inflight" };
  }

  const isAuto = source === "auto" || source === "auto-retry";
  if (isAuto && !allVotesIn) {
    return { action: "noop", reason: "incomplete" };
  }
  // Après échec + retry one-shot consommé : plus d'auto sur les events suivants.
  // `auto-retry` (en cours) n'est pas bloqué - le flag est posé juste avant ce commit.
  if (source === "auto" && retryUsed) {
    return { action: "noop", reason: "auto-exhausted" };
  }

  return {
    action: "commit",
    reason: source === "manual" ? "manual" : source === "auto-retry" ? "auto-retry" : "auto",
    requireAllVotes: isAuto,
  };
}

/** Textes chrome vote pendant / avant reveal (sans full render). */
export function tierNightLiveRevealChromeState({
  allIn = false,
  revealPending = false,
  votedCount = 0,
  totalPlayers = 0,
  hasLocalVote = false,
} = {}) {
  if (revealPending) {
    return {
      hint: "Révélation en cours…",
      buttonLabel: `Révélation en cours… (${votedCount}/${totalPlayers})`,
      buttonDisabled: true,
    };
  }
  if (allIn) {
    return {
      hint: "Tout le monde a voté !",
      buttonLabel: `Révéler maintenant (${votedCount}/${totalPlayers})`,
      buttonDisabled: false,
    };
  }
  return {
    hint: hasLocalVote ? "En attente des autres joueurs…" : "Choisis un tier !",
    buttonLabel: `Révéler maintenant (${votedCount}/${totalPlayers})`,
    buttonDisabled: false,
  };
}

/** Clé de manche pour reset du verrou (runId + roundIdx). */
export function tierNightLiveRevealLockKey(session = {}) {
  return `${session.runId ?? "null"}:${session.roundIdx ?? 0}`;
}

/**
 * Verrou local anti-double commit reveal (auto + manuel partagent la même promesse).
 * Reset automatique quand la clé manche change (nouveau round / runId).
 */
export function createTierNightLiveRevealLock() {
  let inFlight = null;
  let retryUsed = false;
  let lockKey = null;

  return {
    getInFlight() {
      return inFlight;
    },
    isInFlight() {
      return Boolean(inFlight);
    },
    getRetryUsed() {
      return retryUsed;
    },
    currentKey() {
      return lockKey;
    },

    ensureSessionKey(session) {
      const key = tierNightLiveRevealLockKey(session);
      if (lockKey !== key) {
        inFlight = null;
        retryUsed = false;
        lockKey = key;
      }
      return key;
    },

    reset(_reason) {
      inFlight = null;
      retryUsed = false;
      lockKey = null;
    },

    begin(promise) {
      inFlight = promise;
      return promise;
    },

    clearInFlightIf(promise) {
      if (inFlight === promise) inFlight = null;
    },

    markRetryUsed() {
      retryUsed = true;
    },

    /** Auto-retry one-shot : pas déjà consommé, pas d'autre promesse. */
    canAutoRetry() {
      return !retryUsed && !inFlight;
    },
  };
}
