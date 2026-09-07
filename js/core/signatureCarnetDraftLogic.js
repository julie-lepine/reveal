/**
 * FEATURE-PROFILE-04d — helpers purs du draft d’archive Signature.
 * Pas de localStorage, pas de fetch, pas de DOM.
 *
 * Isolation : userId + lobbyId. Pas de runId en clé : le carnet serveur
 * est unique (user_id, lobby_id). runId est une identité de manche, pas de soirée.
 */
import {
  SIGNATURE_CARNET_DRAFT_TTL_MS,
  SIGNATURE_CARNET_DRAFT_VERSION,
} from "../config/signatureCarnetDraft.js";
import { buildSignatureEveningPayload } from "./signatureCarnetLogic.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isSignatureDraftUuid(value) {
  return typeof value === "string" && UUID_RE.test(value.trim());
}

export function signatureCarnetDraftKey(userId, lobbyId) {
  const uid = typeof userId === "string" ? userId.trim() : "";
  const lid = typeof lobbyId === "string" ? lobbyId.trim() : "";
  if (!isSignatureDraftUuid(uid) || !isSignatureDraftUuid(lid)) return null;
  return `${uid}:${lid}`;
}

export function parseSignatureCarnetDraftStore(raw) {
  if (raw == null || raw === "") return {};
  let parsed = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return {};
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  return parsed;
}

export function serializeSignatureCarnetDraftStore(store) {
  return JSON.stringify(store && typeof store === "object" ? store : {});
}

function payloadLooksComplete(payload) {
  if (!payload || typeof payload !== "object") return false;
  if (!isSignatureDraftUuid(payload.lobbyId)) return false;
  if (!Number.isInteger(payload.rank) || payload.rank < 1 || payload.rank > 16) {
    return false;
  }
  if (!Number.isFinite(payload.score)) return false;
  if (!Array.isArray(payload.games) || !Array.isArray(payload.peerUserIds)) {
    return false;
  }
  return true;
}

export function sanitizeSignatureCarnetDraft(row) {
  if (!row || typeof row !== "object") return null;
  if (Number(row.v) !== SIGNATURE_CARNET_DRAFT_VERSION) return null;
  const userId = typeof row.userId === "string" ? row.userId.trim() : "";
  const lobbyId = typeof row.lobbyId === "string" ? row.lobbyId.trim() : "";
  if (!isSignatureDraftUuid(userId) || !isSignatureDraftUuid(lobbyId)) return null;
  const createdAt = Number(row.createdAt);
  const updatedAt = Number(row.updatedAt);
  if (!Number.isFinite(createdAt) || !Number.isFinite(updatedAt)) return null;
  const payload = row.payload;
  if (!payloadLooksComplete(payload)) return null;
  if (String(payload.lobbyId) !== lobbyId) return null;
  return {
    v: SIGNATURE_CARNET_DRAFT_VERSION,
    userId,
    lobbyId,
    createdAt,
    updatedAt,
    payload: {
      lobbyId,
      rank: payload.rank,
      score: payload.score,
      games: [...payload.games],
      peerUserIds: [...payload.peerUserIds],
    },
  };
}

export function isSignatureCarnetDraftFresh(draft, now = Date.now(), ttlMs = SIGNATURE_CARNET_DRAFT_TTL_MS) {
  const row = sanitizeSignatureCarnetDraft(draft);
  if (!row) return false;
  const t = Number(now);
  const ttl = Number(ttlMs);
  if (!Number.isFinite(t) || !Number.isFinite(ttl) || ttl < 0) return false;
  return t - row.updatedAt <= ttl;
}

/** Revalide le snapshot via le builder d’archive (même contrat RPC). */
export function payloadFromSignatureCarnetDraft(draft) {
  const row = sanitizeSignatureCarnetDraft(draft);
  if (!row) return null;
  return buildSignatureEveningPayload({
    profilePack: true,
    isGuest: false,
    loggedIn: true,
    lobbyId: row.payload.lobbyId,
    hasActivity: true,
    localRank: row.payload.rank,
    localScore: row.payload.score,
    gameIds: row.payload.games,
    peerUserIds: row.payload.peerUserIds,
  });
}

export function inspectSignatureCarnetDraft(store, userId, lobbyId, now = Date.now()) {
  const key = signatureCarnetDraftKey(userId, lobbyId);
  if (!key) return { draft: null, reason: "none" };
  const row = sanitizeSignatureCarnetDraft(store?.[key]);
  if (!row) return { draft: null, reason: "none" };
  if (row.userId !== String(userId).trim() || row.lobbyId !== String(lobbyId).trim()) {
    return { draft: null, reason: "mismatch" };
  }
  if (!isSignatureCarnetDraftFresh(row, now)) return { draft: null, reason: "stale" };
  return { draft: row, reason: "ok" };
}

export function getSignatureCarnetDraft(store, userId, lobbyId, now = Date.now()) {
  return inspectSignatureCarnetDraft(store, userId, lobbyId, now).draft;
}

export function upsertSignatureCarnetDraft(store, input, now = Date.now()) {
  const userId = typeof input?.userId === "string" ? input.userId.trim() : "";
  const payload = input?.payload;
  const lobbyId =
    (typeof input?.lobbyId === "string" && input.lobbyId.trim()) ||
    (payload && typeof payload.lobbyId === "string" ? payload.lobbyId.trim() : "");
  const key = signatureCarnetDraftKey(userId, lobbyId);
  if (!key || !payloadLooksComplete({ ...payload, lobbyId })) return store || {};
  const prev = sanitizeSignatureCarnetDraft(store?.[key]);
  const t = Number.isFinite(Number(now)) ? Number(now) : Date.now();
  if (
    prev &&
    prev.payload.rank === payload.rank &&
    prev.payload.score === payload.score &&
    JSON.stringify(prev.payload.games) === JSON.stringify(payload.games) &&
    JSON.stringify(prev.payload.peerUserIds) === JSON.stringify(payload.peerUserIds)
  ) {
    return store && typeof store === "object" ? store : {};
  }
  const nextRow = {
    v: SIGNATURE_CARNET_DRAFT_VERSION,
    userId,
    lobbyId,
    createdAt: prev?.createdAt || t,
    updatedAt: t,
    payload: {
      lobbyId,
      rank: payload.rank,
      score: payload.score,
      games: [...payload.games],
      peerUserIds: [...payload.peerUserIds],
    },
  };
  const out = { ...(store && typeof store === "object" ? store : {}) };
  out[key] = nextRow;
  return pruneStaleSignatureCarnetDrafts(out, t);
}

export function removeSignatureCarnetDraft(store, userId, lobbyId) {
  const key = signatureCarnetDraftKey(userId, lobbyId);
  if (!key || !store || typeof store !== "object") return store || {};
  if (!Object.prototype.hasOwnProperty.call(store, key)) return store;
  const out = { ...store };
  delete out[key];
  return out;
}

export function pruneStaleSignatureCarnetDrafts(store, now = Date.now(), ttlMs = SIGNATURE_CARNET_DRAFT_TTL_MS) {
  const src = store && typeof store === "object" ? store : {};
  const out = {};
  for (const [key, row] of Object.entries(src)) {
    if (isSignatureCarnetDraftFresh(row, now, ttlMs)) out[key] = sanitizeSignatureCarnetDraft(row);
  }
  return out;
}
