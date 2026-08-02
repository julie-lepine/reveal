import { truthMeterRevealErrorCode } from "./truthMeterRevealErrors.js";

const TRUTHMETER_SOFT_VOTE_CODES = new Set([
  "TRUTHMETER_VOTE_UNAVAILABLE",
  "TRUTHMETER_VOTE_UNKNOWN",
]);

export function isTruthMeterRevealBusinessError(err) {
  const code = truthMeterRevealErrorCode(err);
  return Boolean(code) && !TRUTHMETER_SOFT_VOTE_CODES.has(code);
}

export function isTruthMeterRevealNetworkError(err) {
  if (!err || isTruthMeterRevealBusinessError(err)) return false;
  const name = String(err?.name || "");
  const msg = String(err?.message || err || "").toLowerCase();
  const code = String(err?.code || "");
  return (
    name === "AbortError" ||
    name === "TypeError" ||
    code === "ECONNRESET" ||
    code === "ETIMEDOUT" ||
    msg.includes("fetch") ||
    msg.includes("network") ||
    msg.includes("timeout") ||
    msg.includes("failed to fetch") ||
    msg.includes("synchronisation trop longue")
  );
}

/**
 * @param {object|null|undefined} remoteTm
 * @param {{ runId: string, roundIdx: number }} expected
 */
export function evaluateTruthMeterRevealRecovery(remoteTm, expected) {
  if (!remoteTm || typeof remoteTm !== "object") {
    return { recovered: false, reason: "no_state" };
  }
  const remoteRunId = remoteTm.runId || null;
  if (!remoteRunId || remoteRunId !== expected.runId) {
    return { recovered: false, reason: "stale_run" };
  }
  const remoteIdx = remoteTm.roundIdx ?? 0;
  if (remoteIdx !== expected.roundIdx) {
    return { recovered: false, reason: "stale_round" };
  }
  const phase = remoteTm.phase || null;
  const scored = Boolean(remoteTm.roundScored);
  if (scored && phase === "reveal") {
    return { recovered: true, reason: "revealed" };
  }
  return { recovered: false, reason: "not_revealed" };
}

/**
 * @param {object|null|undefined} remoteTm
 * @param {{ runId: string, roundIdx: number, choice: number, localUid: string }} expected
 */
export function evaluateTruthMeterVoteRecovery(remoteTm, expected) {
  if (!remoteTm || typeof remoteTm !== "object") {
    return { recovered: false, reason: "no_state" };
  }
  const remoteRunId = remoteTm.runId || null;
  if (!remoteRunId || remoteRunId !== expected.runId) {
    return { recovered: false, reason: "stale_run" };
  }
  const remoteIdx = remoteTm.roundIdx ?? 0;
  if (remoteIdx !== expected.roundIdx) {
    return { recovered: false, reason: "stale_round" };
  }

  const phase = remoteTm.phase || null;
  const scored = Boolean(remoteTm.roundScored);
  const uid = expected.localUid;
  const remoteVote = uid != null ? remoteTm.votes?.[uid] : null;
  const voteMatch =
    remoteVote != null &&
    Number.isFinite(Number(remoteVote)) &&
    Math.abs(Number(remoteVote) - expected.choice) < 1e-9;

  if (voteMatch && phase === "voting" && !scored) {
    return { recovered: true, reason: "vote_recorded" };
  }
  if (scored && phase === "reveal" && remoteTm.lastRound) {
    return { recovered: true, reason: "auto_revealed" };
  }
  if (voteMatch && scored && phase === "reveal") {
    return { recovered: true, reason: "auto_revealed" };
  }
  return { recovered: false, reason: "vote_missing" };
}
