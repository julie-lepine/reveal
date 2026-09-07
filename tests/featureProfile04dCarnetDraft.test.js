/**
 * FEATURE-PROFILE-04d / C-HOME — draft local d’archive Signature.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SIGNATURE_CARNET_DRAFT_STORAGE_KEY,
  SIGNATURE_CARNET_DRAFT_TTL_MS,
} from "../js/config/signatureCarnetDraft.js";
import {
  getSignatureCarnetDraft,
  inspectSignatureCarnetDraft,
  payloadFromSignatureCarnetDraft,
  pruneStaleSignatureCarnetDrafts,
  removeSignatureCarnetDraft,
  signatureCarnetDraftKey,
  upsertSignatureCarnetDraft,
} from "../js/core/signatureCarnetDraftLogic.js";
import { shouldBlockServerLeaveUntilArchive } from "../js/core/signatureCarnet.js";
import {
  clearSignatureEveningArchiveDraft,
  loadSignatureEveningArchiveDraft,
  readSignatureCarnetDraftStore,
  saveSignatureEveningArchiveDraft,
} from "../js/core/signatureCarnetDraftStore.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

const USER_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const USER_B = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const LOBBY_A = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const LOBBY_B = "cccccccc-cccc-cccc-cccc-cccccccccccc";

function payload(lobbyId, rank = 2, score = 10) {
  return {
    lobbyId,
    rank,
    score,
    games: ["hottake"],
    peerUserIds: [],
  };
}

function memoryStorage(initial = {}) {
  const map = { ...initial };
  return {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(map, k) ? map[k] : null),
    setItem: (k, v) => {
      map[k] = String(v);
    },
    removeItem: (k) => {
      delete map[k];
    },
    _map: map,
  };
}

describe("FEATURE-PROFILE-04d — draft lifecycle", () => {
  it("1. aucune donnée → aucun draft", () => {
    assert.equal(getSignatureCarnetDraft({}, USER_A, LOBBY_A), null);
    assert.equal(signatureCarnetDraftKey("not-uuid", LOBBY_A), null);
  });

  it("2. première archive possible → draft créé", () => {
    const now = 1_000_000;
    const store = upsertSignatureCarnetDraft(
      {},
      { userId: USER_A, lobbyId: LOBBY_A, payload: payload(LOBBY_A) },
      now
    );
    const row = getSignatureCarnetDraft(store, USER_A, LOBBY_A, now);
    assert.ok(row);
    assert.equal(row.createdAt, now);
    assert.equal(row.payload.rank, 2);
  });

  it("3. évolution score/rank → draft mis à jour (snapshot atomique)", () => {
    const t1 = 1_000_000;
    let store = upsertSignatureCarnetDraft(
      {},
      { userId: USER_A, lobbyId: LOBBY_A, payload: payload(LOBBY_A, 3, 4) },
      t1
    );
    const t2 = t1 + 5_000;
    store = upsertSignatureCarnetDraft(
      store,
      { userId: USER_A, lobbyId: LOBBY_A, payload: payload(LOBBY_A, 1, 40) },
      t2
    );
    const row = getSignatureCarnetDraft(store, USER_A, LOBBY_A, t2);
    assert.equal(row.createdAt, t1);
    assert.equal(row.updatedAt, t2);
    assert.equal(row.payload.rank, 1);
    assert.equal(row.payload.score, 40);
    const same = upsertSignatureCarnetDraft(
      store,
      { userId: USER_A, lobbyId: LOBBY_A, payload: payload(LOBBY_A, 1, 40) },
      t2 + 1
    );
    assert.equal(same, store);
    assert.equal(getSignatureCarnetDraft(same, USER_A, LOBBY_A, t2).updatedAt, t2);
  });

  it("4. draft isolé par lobby", () => {
    let store = upsertSignatureCarnetDraft(
      {},
      { userId: USER_A, lobbyId: LOBBY_A, payload: payload(LOBBY_A, 2, 9) },
      10
    );
    store = upsertSignatureCarnetDraft(
      store,
      { userId: USER_A, lobbyId: LOBBY_B, payload: payload(LOBBY_B, 5, 1) },
      10
    );
    assert.equal(getSignatureCarnetDraft(store, USER_A, LOBBY_A, 10).payload.rank, 2);
    assert.equal(getSignatureCarnetDraft(store, USER_A, LOBBY_B, 10).payload.rank, 5);
  });

  it("5. isolation compte ; runId n’est pas une clé de soirée", () => {
    let store = upsertSignatureCarnetDraft(
      {},
      { userId: USER_A, lobbyId: LOBBY_A, payload: payload(LOBBY_A, 2, 9) },
      10
    );
    store = upsertSignatureCarnetDraft(
      store,
      { userId: USER_B, lobbyId: LOBBY_A, payload: payload(LOBBY_A, 8, 0) },
      10
    );
    assert.equal(getSignatureCarnetDraft(store, USER_A, LOBBY_A, 10).payload.rank, 2);
    assert.equal(getSignatureCarnetDraft(store, USER_B, LOBBY_A, 10).payload.rank, 8);
    const logic = read("js/core/signatureCarnetDraftLogic.js");
    assert.match(logic, /Pas de runId en clé/);
  });
});

describe("FEATURE-PROFILE-04d — leave / C-HOME contrats source", () => {
  it("6–7. leaveLobby hydraté inchangé ; quiet nettoie le draft après succès", () => {
    const lobby = read("js/core/lobby.js");
    const leaveCall = lobby.slice(
      lobby.indexOf("return runVoluntaryMemberLeave"),
      lobby.indexOf("export async function leaveLobbyMembershipFromServer")
    );
    assert.match(leaveCall, /archiveSignatureEvening:\s*archiveSignatureEveningBeforeLeave/);
    assert.doesNotMatch(leaveCall, /archiveSignatureEveningForServerLeave/);

    const carnet = read("js/core/signatureCarnet.js");
    const quiet = carnet.slice(
      carnet.indexOf("export async function archiveSignatureEveningQuiet"),
      carnet.indexOf("export async function fetchSignatureCarnet")
    );
    const errIdx = quiet.indexOf("return { ok: false");
    const clearIdx = quiet.indexOf("clearDraftAfterConfirmedArchive");
    assert.ok(clearIdx > errIdx);
  });

  it("8. archive échoue → pas de clear draft (ordre dans quiet)", () => {
    const quiet = read("js/core/signatureCarnet.js").slice(
      read("js/core/signatureCarnet.js").indexOf("export async function archiveSignatureEveningQuiet"),
      read("js/core/signatureCarnet.js").indexOf("export async function fetchSignatureCarnet")
    );
    const failReturn = quiet.indexOf("return { ok: false, code");
    const clearIdx = quiet.indexOf("clearDraftAfterConfirmedArchive");
    assert.ok(failReturn >= 0 && clearIdx > failReturn);
  });

  it("9–13. C-HOME : archive avant DELETE ; skip diagnostiqué ; pas d’invention", () => {
    const fn = read("js/core/lobby.js").slice(
      read("js/core/lobby.js").indexOf("export async function leaveLobbyMembershipFromServer"),
      read("js/core/lobby.js").indexOf("export async function transferLobbyHost")
    );
    const archIdx = fn.indexOf("archiveSignatureEveningForServerLeave");
    const blockIdx = fn.indexOf("shouldBlockServerLeaveUntilArchive");
    const remoteIdx = fn.indexOf("runServerOnlyLeave");
    assert.ok(archIdx >= 0 && blockIdx > archIdx && remoteIdx > blockIdx);
    assert.match(fn, /if \(!hasActiveLobby\(\)\)/);
    assert.match(fn, /archiveFailed:\s*true/);

    const carnet = read("js/core/signatureCarnet.js");
    assert.match(carnet, /REVEAL C-HOME signature archive skipped/);
    assert.match(carnet, /REVEAL C-HOME signature archive failed/);
    assert.match(carnet, /source: "live"/);
    assert.match(carnet, /Ne invente rien/);

    assert.equal(shouldBlockServerLeaveUntilArchive({ ok: true, skipped: true }), false);
    assert.equal(shouldBlockServerLeaveUntilArchive({ ok: true, skipped: false }), false);
    assert.equal(
      shouldBlockServerLeaveUntilArchive({ ok: false, skipped: false, code: "signature_locked" }),
      false
    );
    assert.equal(
      shouldBlockServerLeaveUntilArchive({ ok: false, skipped: false, code: "signature_not_member" }),
      false
    );
    assert.equal(shouldBlockServerLeaveUntilArchive({ ok: false, skipped: false }), true);
  });

  it("14. draft A jamais consommé pour lobby B", () => {
    const t = 50;
    const store = upsertSignatureCarnetDraft(
      {},
      { userId: USER_A, lobbyId: LOBBY_A, payload: payload(LOBBY_A, 1, 99) },
      t
    );
    assert.equal(getSignatureCarnetDraft(store, USER_A, LOBBY_B, t), null);
    const fromA = payloadFromSignatureCarnetDraft(
      getSignatureCarnetDraft(store, USER_A, LOBBY_A, t)
    );
    assert.equal(fromA.lobbyId, LOBBY_A);
  });

  it("15. même lobby, snapshot remplacé (pas de fusion N / N-1)", () => {
    let store = upsertSignatureCarnetDraft(
      {},
      {
        userId: USER_A,
        lobbyId: LOBBY_A,
        payload: { lobbyId: LOBBY_A, rank: 3, score: 1, games: ["hottake"], peerUserIds: [] },
      },
      1
    );
    store = upsertSignatureCarnetDraft(
      store,
      {
        userId: USER_A,
        lobbyId: LOBBY_A,
        payload: {
          lobbyId: LOBBY_A,
          rank: 1,
          score: 50,
          games: ["trivia"],
          peerUserIds: [USER_B],
        },
      },
      2
    );
    const row = getSignatureCarnetDraft(store, USER_A, LOBBY_A, 2);
    assert.deepEqual(row.payload.games, ["trivia"]);
    assert.equal(row.payload.rank, 1);
    assert.equal(row.payload.score, 50);
  });
});

describe("FEATURE-PROFILE-04d — persist / crash / stale", () => {
  it("16–17. draft survit hors reveal-app-state (kill / reset soirée)", () => {
    const storage = memoryStorage();
    assert.equal(
      saveSignatureEveningArchiveDraft(
        { userId: USER_A, lobbyId: LOBBY_A, payload: payload(LOBBY_A, 2, 11) },
        1_000,
        storage
      ),
      true
    );
    assert.ok(storage._map[SIGNATURE_CARNET_DRAFT_STORAGE_KEY]);
    const loaded = loadSignatureEveningArchiveDraft(USER_A, LOBBY_A, 1_000, storage);
    assert.equal(loaded.payload.score, 11);
    const store = readSignatureCarnetDraftStore(storage);
    assert.ok(store[signatureCarnetDraftKey(USER_A, LOBBY_A)]);
  });

  it("TTL : draft trop vieux → inspect stale, pas réutilisé", () => {
    const now = SIGNATURE_CARNET_DRAFT_TTL_MS + 50;
    const store = upsertSignatureCarnetDraft(
      {},
      { userId: USER_A, lobbyId: LOBBY_A, payload: payload(LOBBY_A) },
      0
    );
    const inspected = inspectSignatureCarnetDraft(store, USER_A, LOBBY_A, now);
    assert.equal(inspected.reason, "stale");
    assert.equal(inspected.draft, null);
    const pruned = pruneStaleSignatureCarnetDrafts(store, now);
    assert.equal(getSignatureCarnetDraft(pruned, USER_A, LOBBY_A, now), null);
  });

  it("clear après archive confirmée retire seulement ce salon", () => {
    const storage = memoryStorage();
    saveSignatureEveningArchiveDraft(
      { userId: USER_A, lobbyId: LOBBY_A, payload: payload(LOBBY_A, 1, 1) },
      10,
      storage
    );
    saveSignatureEveningArchiveDraft(
      { userId: USER_A, lobbyId: LOBBY_B, payload: payload(LOBBY_B, 2, 2) },
      10,
      storage
    );
    clearSignatureEveningArchiveDraft(USER_A, LOBBY_A, storage);
    assert.equal(loadSignatureEveningArchiveDraft(USER_A, LOBBY_A, 10, storage), null);
    assert.equal(loadSignatureEveningArchiveDraft(USER_A, LOBBY_B, 10, storage).payload.rank, 2);
    const leftover = removeSignatureCarnetDraft(
      readSignatureCarnetDraftStore(storage),
      USER_A,
      LOBBY_B
    );
    assert.equal(Object.keys(leftover).length, 0);
  });

  it("18–20. hooks state ; leaveLobbyMembershipFromServer conserve Vague D", () => {
    const state = read("js/core/state.js");
    assert.match(state, /notifySignatureEveningArchiveDraft/);
    assert.match(state, /export function addScore/);
    const add = state.slice(state.indexOf("export function addScore"), state.indexOf("export function addLocalScore"));
    assert.match(add, /notifySignatureEveningArchiveDraft/);
    const rec = state.slice(
      state.indexOf("export function recordEveningGameOnce"),
      state.indexOf("export function recordHotTakePlayed")
    );
    assert.match(rec, /notifySignatureEveningArchiveDraft/);

    const fn = read("js/core/lobby.js").slice(
      read("js/core/lobby.js").indexOf("export async function leaveLobbyMembershipFromServer"),
      read("js/core/lobby.js").indexOf("export async function transferLobbyHost")
    );
    assert.match(fn, /runServerOnlyLeave/);
    assert.match(fn, /performLobbyBoundaryTeardown/);
    assert.match(fn, /finalizeGuestAfterAuthoritativeLeave/);
  });

  it("refresh ne wipe pas un draft si le live est vide", () => {
    const refresh = read("js/core/signatureCarnet.js").slice(
      read("js/core/signatureCarnet.js").indexOf("export function refreshSignatureEveningArchiveDraft"),
      read("js/core/signatureCarnet.js").indexOf("export function resolveSignatureEveningArchivePayloadForLobby")
    );
    assert.match(refresh, /if \(!payload \|\| !userId\) return false/);
    assert.doesNotMatch(refresh, /clearSignatureEveningArchiveDraft/);
  });
});
