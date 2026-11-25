/**
 * Audit carnet et cosmétiques n°4 — brouillons d'archive carnet sur l'appareil.
 * Purge des brouillons de plus de 14 jours au démarrage, retrait à la déconnexion
 * (sauf le salon encore rejoint), effacement complet à la suppression du compte
 * et à la réinitialisation.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { removeSignatureCarnetDraftsForUser } from "../js/core/signatureCarnetDraftLogic.js";
import {
  clearAllSignatureEveningArchiveDrafts,
  clearSignatureEveningArchiveDraftsForUser,
  pruneSignatureEveningArchiveDrafts,
  readSignatureCarnetDraftStore,
  saveSignatureEveningArchiveDraft,
} from "../js/core/signatureCarnetDraftStore.js";
import { SIGNATURE_CARNET_DRAFT_STORAGE_KEY } from "../js/config/signatureCarnetDraft.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const L1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const L2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const DAY = 24 * 60 * 60 * 1000;

function memoryStorage() {
  const map = new Map();
  let writes = 0;
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => {
      writes += 1;
      map.set(k, String(v));
    },
    removeItem: (k) => map.delete(k),
    get writes() {
      return writes;
    },
  };
}

function payload(lobbyId) {
  return { lobbyId, rank: 1, score: 10, games: ["trivia"], peerUserIds: [] };
}

function seed(storage, now) {
  saveSignatureEveningArchiveDraft({ userId: U1, lobbyId: L1, payload: payload(L1) }, now, storage);
  saveSignatureEveningArchiveDraft({ userId: U1, lobbyId: L2, payload: payload(L2) }, now, storage);
  saveSignatureEveningArchiveDraft({ userId: U2, lobbyId: L1, payload: payload(L1) }, now, storage);
}

describe("removeSignatureCarnetDraftsForUser", () => {
  it("retire les brouillons du compte, garde le salon demandé et les autres comptes", () => {
    const store = {
      [`${U1}:${L1}`]: { a: 1 },
      [`${U1}:${L2}`]: { a: 2 },
      [`${U2}:${L1}`]: { a: 3 },
    };
    assert.deepEqual(Object.keys(removeSignatureCarnetDraftsForUser(store, U1, { keepLobbyId: L2 })), [
      `${U1}:${L2}`,
      `${U2}:${L1}`,
    ]);
    assert.deepEqual(Object.keys(removeSignatureCarnetDraftsForUser(store, U1)), [`${U2}:${L1}`]);
    assert.equal(removeSignatureCarnetDraftsForUser(store, "pas-un-uuid"), store);
  });
});

describe("stockage des brouillons", () => {
  it("purge : retire seulement les brouillons de plus de 14 jours", () => {
    const storage = memoryStorage();
    const t0 = Date.UTC(2026, 10, 1);
    seed(storage, t0);
    saveSignatureEveningArchiveDraft({ userId: U2, lobbyId: L2, payload: payload(L2) }, t0 + 10 * DAY, storage);
    pruneSignatureEveningArchiveDrafts(t0 + 15 * DAY, storage);
    assert.deepEqual(Object.keys(readSignatureCarnetDraftStore(storage)), [`${U2}:${L2}`]);
  });

  it("purge : rien à retirer → aucune écriture", () => {
    const storage = memoryStorage();
    const t0 = Date.UTC(2026, 10, 1);
    seed(storage, t0);
    const before = storage.writes;
    pruneSignatureEveningArchiveDrafts(t0 + DAY, storage);
    assert.equal(storage.writes, before);
  });

  it("déconnexion : garde le salon encore rejoint", () => {
    const storage = memoryStorage();
    seed(storage, Date.now());
    clearSignatureEveningArchiveDraftsForUser(U1, { keepLobbyId: L1 }, storage);
    assert.deepEqual(Object.keys(readSignatureCarnetDraftStore(storage)).sort(), [
      `${U1}:${L1}`,
      `${U2}:${L1}`,
    ]);
  });

  it("suppression du compte ou réinitialisation : clé effacée", () => {
    const storage = memoryStorage();
    seed(storage, Date.now());
    assert.equal(clearAllSignatureEveningArchiveDrafts(storage), true);
    assert.equal(storage.getItem(SIGNATURE_CARNET_DRAFT_STORAGE_KEY), null);
  });
});

describe("branchements", () => {
  it("déconnexion : après le départ du salon, avant la fin de session", () => {
    const auth = read("js/core/auth.js");
    const fn = auth.slice(auth.indexOf("export async function logout"), auth.indexOf("export async function deleteRegisteredAccount"));
    const leave = fn.indexOf("if (!leave.ok) return leave;");
    const clear = fn.indexOf("clearSignatureEveningArchiveDraftsForUser(getSupabaseUserId()");
    const signOut = fn.indexOf("await signOutSupabase();");
    assert.ok(leave > 0 && clear > leave && signOut > clear);
    assert.match(fn, /keepLobbyId: snap\?\.status === "found"/);
  });

  it("suppression du compte, réinitialisation et démarrage", () => {
    const auth = read("js/core/auth.js");
    const del = auth.slice(auth.indexOf("export async function deleteRegisteredAccount"));
    assert.ok(del.indexOf("clearAllSignatureEveningArchiveDrafts();") > del.indexOf("if (!server.ok) return server;"));
    assert.match(read("js/core/lobby.js"), /localStorage\.removeItem\("reveal-app-state"\);\s+clearAllSignatureEveningArchiveDrafts\(\);/);
    assert.match(read("js/core/signatureCarnet.js"), /\npruneSignatureEveningArchiveDrafts\(\);/);
  });
});
