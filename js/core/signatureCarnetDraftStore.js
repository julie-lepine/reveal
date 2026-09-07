/**
 * FEATURE-PROFILE-04d — persistance localStorage du draft carnet.
 * Clé dédiée : hors `reveal-app-state` (resetEveningState ne l’efface pas).
 */
import { SIGNATURE_CARNET_DRAFT_STORAGE_KEY } from "../config/signatureCarnetDraft.js";
import {
  inspectSignatureCarnetDraft,
  parseSignatureCarnetDraftStore,
  pruneStaleSignatureCarnetDrafts,
  removeSignatureCarnetDraft,
  serializeSignatureCarnetDraftStore,
  upsertSignatureCarnetDraft,
} from "./signatureCarnetDraftLogic.js";

function defaultStorage() {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

export function readSignatureCarnetDraftStore(storage = defaultStorage()) {
  if (!storage?.getItem) return {};
  try {
    return parseSignatureCarnetDraftStore(
      storage.getItem(SIGNATURE_CARNET_DRAFT_STORAGE_KEY)
    );
  } catch {
    return {};
  }
}

export function writeSignatureCarnetDraftStore(store, storage = defaultStorage()) {
  if (!storage?.setItem) return false;
  try {
    storage.setItem(
      SIGNATURE_CARNET_DRAFT_STORAGE_KEY,
      serializeSignatureCarnetDraftStore(store)
    );
    return true;
  } catch {
    return false;
  }
}

export function inspectSignatureEveningArchiveDraft(userId, lobbyId, now = Date.now(), storage = defaultStorage()) {
  return inspectSignatureCarnetDraft(
    readSignatureCarnetDraftStore(storage),
    userId,
    lobbyId,
    now
  );
}

export function loadSignatureEveningArchiveDraft(userId, lobbyId, now = Date.now(), storage = defaultStorage()) {
  return inspectSignatureEveningArchiveDraft(userId, lobbyId, now, storage).draft;
}

export function saveSignatureEveningArchiveDraft(input, now = Date.now(), storage = defaultStorage()) {
  const prev = readSignatureCarnetDraftStore(storage);
  const next = upsertSignatureCarnetDraft(prev, input, now);
  if (next === prev) return true;
  return writeSignatureCarnetDraftStore(next, storage);
}

export function clearSignatureEveningArchiveDraft(userId, lobbyId, storage = defaultStorage()) {
  const next = removeSignatureCarnetDraft(
    readSignatureCarnetDraftStore(storage),
    userId,
    lobbyId
  );
  return writeSignatureCarnetDraftStore(next, storage);
}

export function pruneSignatureEveningArchiveDrafts(now = Date.now(), storage = defaultStorage()) {
  const next = pruneStaleSignatureCarnetDrafts(
    readSignatureCarnetDraftStore(storage),
    now
  );
  return writeSignatureCarnetDraftStore(next, storage);
}
