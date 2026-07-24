/**
 * Transitions présence → UI (ARCH-03 / ARCH-03b) — helpers purs + logs LIVE temporaires.
 * Filtrer console : ARCH03-LIVE / ARCH03B-LIVE
 */
import { HOST_PRESENCE_STALE_MS, HOST_TRANSFER_STALE_MS } from "../config/lobbyLifecycle.js";
import { resolveActingHostUserId } from "./hostPresence.js";

export const ARCH03_LIVE_DEBUG = true;

export function arch03LiveLog(tag, step, data = undefined) {
  if (!ARCH03_LIVE_DEBUG) return;
  const prefix = tag.startsWith("[") ? tag : `[${tag}]`;
  if (data === undefined) {
    console.info(`${prefix} ${step}`);
    return;
  }
  console.info(`${prefix} ${step}`, data);
}

/** Présence hôte dérivée d'un lastSeenAt + seuil (120 s acting / 300 s claim). */
export function isHostPresentAt(lastSeenAt, now = Date.now(), staleMs = HOST_PRESENCE_STALE_MS) {
  if (!lastSeenAt) return true; // legacy null = présent
  const t = new Date(lastSeenAt).getTime();
  if (!Number.isFinite(t)) return true;
  return now - t < staleMs;
}

export function hostAgeMs(lastSeenAt, now = Date.now()) {
  if (!lastSeenAt) return null;
  const t = new Date(lastSeenAt).getTime();
  if (!Number.isFinite(t)) return null;
  return now - t;
}

/**
 * Éligibilité claim UX (miroir clientMayOfferHostClaim, testable).
 * @returns {boolean}
 */
export function computeClaimEligible({
  participants,
  hostId,
  localUserId,
  now = Date.now(),
  isRealHost = false,
}) {
  if (!localUserId || !hostId || isRealHost) return false;
  const host =
    (participants || []).find((p) => p.userId === hostId) ||
    (participants || []).find((p) => p.isHost);
  if (!host?.lastSeenAt) return false;
  if (isHostPresentAt(host.lastSeenAt, now, HOST_TRANSFER_STALE_MS)) return false;
  const elected = resolveActingHostUserId(
    participants || [],
    hostId,
    now,
    HOST_TRANSFER_STALE_MS
  );
  return elected === localUserId;
}

/** Nudge hub uniquement sur transition d'éligibilité. */
export function shouldNudgeClaimHubUi(prevEligible, nextEligible) {
  if (prevEligible === null || prevEligible === undefined) return false;
  return Boolean(prevEligible) !== Boolean(nextEligible);
}

/**
 * Décision notif acting host (sans DOM).
 * ack uniquement après show (appelant).
 */
export function decideActingHostNotice({
  wasActing,
  isActing,
  isRealHost,
  token,
  ackedTokens,
  inActivePlaySession,
}) {
  if (!isActing || isRealHost) {
    return { show: false, pending: false, nextWasActing: isActing };
  }
  if (!Number.isFinite(token) || ackedTokens.has(token)) {
    return { show: false, pending: false, nextWasActing: isActing };
  }
  // Transition vers acting : pas déjà acting avant ce nudge d'élection
  const became = isActing && wasActing !== true;
  if (!became) {
    return { show: false, pending: false, nextWasActing: isActing };
  }
  if (!inActivePlaySession) {
    return { show: false, pending: true, nextWasActing: isActing };
  }
  return { show: true, pending: false, nextWasActing: isActing };
}
