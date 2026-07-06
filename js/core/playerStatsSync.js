import { getState, saveStatePatch } from "./state.js";

export function mergePlayerStatsRecord(local = {}, remote = {}) {
  const keys = new Set([...Object.keys(local || {}), ...Object.keys(remote || {})]);
  const out = {};
  keys.forEach((key) => {
    const a = local?.[key];
    const b = remote?.[key];
    if (typeof a === "number" && typeof b === "number") {
      out[key] = Math.max(a, b);
    } else if (typeof b === "number" && Number.isFinite(b)) {
      out[key] = b;
    } else if (typeof a === "number" && Number.isFinite(a)) {
      out[key] = a;
    }
  });
  return out;
}

export function playerStatsToRemote(playerStatsByName = {}, nameToUid = (name) => name) {
  const out = {};
  Object.entries(playerStatsByName).forEach(([name, stats]) => {
    if (!stats || typeof stats !== "object") return;
    const uid = nameToUid(name) || name;
    const remoteStats = {};
    Object.entries(stats).forEach(([key, val]) => {
      if (typeof val === "number" && Number.isFinite(val)) remoteStats[key] = val;
    });
    if (Object.keys(remoteStats).length) out[uid] = remoteStats;
  });
  return out;
}

export function playerStatsFromRemote(remote = {}, uidToName = (uid) => uid) {
  const out = {};
  Object.entries(remote).forEach(([uid, stats]) => {
    const name = uidToName(uid);
    if (!name || !stats || typeof stats !== "object") return;
    out[name] = mergePlayerStatsRecord(out[name], stats);
  });
  return out;
}

export function applyRemotePlayerStats(remote, uidToName = (uid) => uid) {
  if (!remote || typeof remote !== "object") return;
  const byName = playerStatsFromRemote(remote, uidToName);
  if (!Object.keys(byName).length) return;

  const merged = { ...getState().playerStats };
  const participants = getState().lobby?.participants || [];
  participants.forEach((p) => {
    if (!p?.name || !byName[p.name]) return;
    merged[p.name] = mergePlayerStatsRecord(merged[p.name], byName[p.name]);
  });
  Object.entries(byName).forEach(([name, stats]) => {
    merged[name] = mergePlayerStatsRecord(merged[name], stats);
  });
  saveStatePatch({ playerStats: merged });
}
