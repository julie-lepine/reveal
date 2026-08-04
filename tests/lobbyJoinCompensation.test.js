/**
 * SYN/ARCH - Compensation join partiel (membership B orpheline).
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/** @type {Map<string, string>} */
const memoryStorage = new Map();

globalThis.localStorage = {
  getItem: (key) => (memoryStorage.has(key) ? memoryStorage.get(key) : null),
  setItem: (key, value) => {
    memoryStorage.set(key, String(value));
  },
  removeItem: (key) => {
    memoryStorage.delete(key);
  },
};

const {
  createLobbyJoinEffects,
  markLobbyJoinFinalized,
  needsJoinCompensation,
  recordGuestMembershipWriteForJoin,
  recordMembershipInsertForJoin,
  recordMembershipReclaimForJoin,
  recordPreexistingMembershipForJoin,
  shouldCompensateMembershipDelete,
  shouldCompensateReclaimedMembershipDelete,
} = await import("../js/core/lobbyJoinEffects.js");

const {
  buildMembershipReconciliationConflict,
  clearPendingLobbyMembershipCompensationIfMatches,
  compensateFailedLobbyJoin,
  getPendingLobbyMembershipCompensation,
  restoreGuestMembershipFromJoinEffects,
  resolvePendingMembershipByLeave,
  retryPendingLobbyMembershipCompensation,
  savePendingLobbyMembershipCompensation,
  shouldBlockMembershipQueryForPending,
} = await import("../js/core/lobbyMembershipCompensation.js");

const { finalizeFailedJoinAttempt } = await import("../js/core/lobbyJoinFinalize.js");

const {
  clearGuestMembership,
  loadGuestMembership,
  saveGuestMembership,
} = await import("../js/core/guestMembership.js");

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const GUEST_A = {
  membershipId: "mem-a",
  lobbyId: "lobby-a",
  lobbyCode: "AAAA",
  displayName: "Alice",
};

const GUEST_B = {
  membershipId: "mem-b",
  lobbyId: "lobby-b",
  lobbyCode: "BBBB",
  displayName: "Alice",
};

function resetGuestStorage() {
  memoryStorage.clear();
}

describe("lobbyJoinEffects - journal", () => {
  it("INSERT confirmé → eligible DELETE", () => {
    const effects = createLobbyJoinEffects(GUEST_A);
    recordMembershipInsertForJoin(effects, { id: "mem-b" }, "lobby-b");
    assert.equal(shouldCompensateMembershipDelete(effects), true);
    assert.equal(needsJoinCompensation(effects), true);
  });

  it("membership préexistante → pas de DELETE", () => {
    const effects = createLobbyJoinEffects(GUEST_A);
    recordPreexistingMembershipForJoin(effects, { id: "mem-b" }, "lobby-b");
    assert.equal(shouldCompensateMembershipDelete(effects), false);
    assert.equal(needsJoinCompensation(effects), false);
  });

  it("F - reclaim avec mutation → DELETE éligible", () => {
    const effects = createLobbyJoinEffects(GUEST_A);
    recordMembershipReclaimForJoin(effects, {
      membershipId: "mem-b-guest",
      lobbyId: "lobby-b",
      reclaimed: true,
    });
    assert.equal(shouldCompensateReclaimedMembershipDelete(effects), true);
    assert.equal(shouldCompensateMembershipDelete(effects), true);
    assert.equal(needsJoinCompensation(effects), true);
  });

  it("reclaim idempotent (reclaimed false) → pas de compensation", () => {
    const effects = createLobbyJoinEffects(GUEST_A);
    recordMembershipReclaimForJoin(effects, {
      membershipId: "mem-b",
      lobbyId: "lobby-b",
      reclaimed: false,
    });
    assert.equal(needsJoinCompensation(effects), false);
  });

  it("join finalisé → aucune compensation", () => {
    const effects = createLobbyJoinEffects(GUEST_A);
    recordMembershipInsertForJoin(effects, { id: "mem-b" }, "lobby-b");
    markLobbyJoinFinalized(effects);
    assert.equal(needsJoinCompensation(effects), false);
  });
});

describe("restoreGuestMembershipFromJoinEffects", () => {
  beforeEach(() => resetGuestStorage());
  afterEach(() => resetGuestStorage());

  it("G - restaure guestMembership A après écriture B", () => {
    saveGuestMembership(GUEST_A);
    const effects = createLobbyJoinEffects(loadGuestMembership());
    recordGuestMembershipWriteForJoin(effects, GUEST_B, saveGuestMembership);
    assert.equal(loadGuestMembership()?.lobbyId, "lobby-b");

    const res = restoreGuestMembershipFromJoinEffects(effects);
    assert.equal(res.restored, true);
    assert.equal(loadGuestMembership()?.lobbyId, "lobby-a");
  });

  it("H - supprime B si aucun guestMembership avant", () => {
    const effects = createLobbyJoinEffects(null);
    recordGuestMembershipWriteForJoin(effects, GUEST_B, saveGuestMembership);
    assert.equal(loadGuestMembership()?.lobbyId, "lobby-b");

    restoreGuestMembershipFromJoinEffects(effects);
    assert.equal(loadGuestMembership(), null);
  });

  it("ne pas écraser si stockage modifié entre-temps", () => {
    const effects = createLobbyJoinEffects(GUEST_A);
    recordGuestMembershipWriteForJoin(effects, GUEST_B, saveGuestMembership);
    saveGuestMembership({ ...GUEST_B, membershipId: "mem-other" });

    const res = restoreGuestMembershipFromJoinEffects(effects);
    assert.equal(res.restored, false);
    assert.equal(loadGuestMembership()?.membershipId, "mem-other");
  });
});

describe("compensateFailedLobbyJoin", () => {
  beforeEach(() => {
    resetGuestStorage();
    savePendingLobbyMembershipCompensation(null);
  });
  afterEach(() => {
    resetGuestStorage();
    savePendingLobbyMembershipCompensation(null);
  });

  it("A - INSERT puis échec simulé : DELETE B + guest restauré", async () => {
    saveGuestMembership(GUEST_A);
    const effects = createLobbyJoinEffects(loadGuestMembership());
    recordMembershipInsertForJoin(effects, { id: "mem-b" }, "lobby-b");
    recordGuestMembershipWriteForJoin(effects, GUEST_B, saveGuestMembership);

    let deletedLobby = null;
    const result = await compensateFailedLobbyJoin(effects, {
      deleteOwnLobbyMembershipById: async (lobbyId) => {
        deletedLobby = lobbyId;
        return { ok: true };
      },
    });

    assert.equal(deletedLobby, "lobby-b");
    assert.equal(result.membershipDeleted, true);
    assert.equal(result.guestMembershipRestored, true);
    assert.equal(loadGuestMembership()?.lobbyId, "lobby-a");
    assert.equal(getPendingLobbyMembershipCompensation(), null);
  });

  it("B - même contrat après hydrate échoué (journal identique INSERT)", async () => {
    const effects = createLobbyJoinEffects(null);
    recordMembershipInsertForJoin(effects, { id: "mem-b" }, "lobby-b");
    recordGuestMembershipWriteForJoin(effects, GUEST_B, saveGuestMembership);

    const result = await compensateFailedLobbyJoin(effects, {
      deleteOwnLobbyMembershipById: async () => ({ ok: true }),
    });
    assert.equal(result.membershipDeleted, true);
    assert.equal(loadGuestMembership(), null);
  });

  it("D - join finalisé : aucune action", async () => {
    const effects = createLobbyJoinEffects(null);
    recordMembershipInsertForJoin(effects, { id: "mem-b" }, "lobby-b");
    markLobbyJoinFinalized(effects);

    let called = false;
    const result = await compensateFailedLobbyJoin(effects, {
      deleteOwnLobbyMembershipById: async () => {
        called = true;
        return { ok: true };
      },
    });
    assert.equal(called, false);
    assert.equal(result.membershipDeleted, false);
  });

  it("E - préexistant : pas de DELETE", async () => {
    const effects = createLobbyJoinEffects(GUEST_A);
    recordPreexistingMembershipForJoin(effects, { id: "mem-b" }, "lobby-b");

    let called = false;
    await compensateFailedLobbyJoin(effects, {
      deleteOwnLobbyMembershipById: async () => {
        called = true;
        return { ok: true };
      },
    });
    assert.equal(called, false);
  });

  it("I - DELETE échoue : pending + guest restauré", async () => {
    saveGuestMembership(GUEST_A);
    const effects = createLobbyJoinEffects(loadGuestMembership());
    recordMembershipInsertForJoin(effects, { id: "mem-b" }, "lobby-b");
    recordGuestMembershipWriteForJoin(effects, GUEST_B, saveGuestMembership);

    const result = await compensateFailedLobbyJoin(effects, {
      deleteOwnLobbyMembershipById: async () => ({ ok: false, error: "network" }),
    });

    assert.equal(result.ok, false);
    assert.equal(result.guestMembershipRestored, true);
    assert.equal(getPendingLobbyMembershipCompensation()?.lobbyId, "lobby-b");
    assert.equal(loadGuestMembership()?.lobbyId, "lobby-a");
  });

  it("J - retry pending réussit et efface le journal", async () => {
    savePendingLobbyMembershipCompensation({
      lobbyId: "lobby-b",
      membershipId: "mem-b",
      createdAt: Date.now(),
      reason: "join_failed_after_membership_insert",
    });

    const retry = await retryPendingLobbyMembershipCompensation({
      deleteOwnLobbyMembershipById: async () => ({ ok: true }),
    });
    assert.equal(retry.ok, true);
    assert.equal(getPendingLobbyMembershipCompensation(), null);
  });

  it("J - retry pending reclaim réussit", async () => {
    savePendingLobbyMembershipCompensation({
      lobbyId: "lobby-b",
      membershipId: "mem-b-guest",
      createdAt: Date.now(),
      reason: "join_failed_after_reclaim_delete_failed",
    });

    const retry = await retryPendingLobbyMembershipCompensation({
      deleteOwnLobbyMembershipById: async () => ({ ok: true }),
    });
    assert.equal(retry.ok, true);
    assert.equal(getPendingLobbyMembershipCompensation(), null);
  });

  it("J - membership déjà absente acceptée comme succès DELETE", async () => {
    savePendingLobbyMembershipCompensation({
      lobbyId: "lobby-b",
      membershipId: "mem-b",
      createdAt: Date.now(),
      reason: "join_failed_after_membership_insert",
    });

    const retry = await retryPendingLobbyMembershipCompensation({
      deleteOwnLobbyMembershipById: async () => ({ ok: true }),
    });
    assert.equal(retry.membershipDeleted, true);
    assert.equal(getPendingLobbyMembershipCompensation(), null);
  });

  it("L - double compensation : guest A intact, pas d'erreur fatale", async () => {
    saveGuestMembership(GUEST_A);
    const effects = createLobbyJoinEffects(loadGuestMembership());
    recordMembershipInsertForJoin(effects, { id: "mem-b" }, "lobby-b");
    recordGuestMembershipWriteForJoin(effects, GUEST_B, saveGuestMembership);

    let deleteCount = 0;
    const deps = {
      deleteOwnLobbyMembershipById: async () => {
        deleteCount += 1;
        return { ok: true };
      },
    };
    await compensateFailedLobbyJoin(effects, deps);
    assert.equal(loadGuestMembership()?.lobbyId, "lobby-a");
    await compensateFailedLobbyJoin(effects, deps);
    assert.equal(loadGuestMembership()?.lobbyId, "lobby-a");
    assert.equal(deleteCount, 2);
  });

  it("reclaim réussi puis échec - DELETE B appelé, pas de pending", async () => {
    const effects = createLobbyJoinEffects(GUEST_B);
    recordMembershipReclaimForJoin(effects, {
      membershipId: "mem-b-guest",
      lobbyId: "lobby-b",
      reclaimed: true,
    });

    let deleted = null;
    const result = await compensateFailedLobbyJoin(effects, {
      deleteOwnLobbyMembershipById: async (lobbyId) => {
        deleted = lobbyId;
        return { ok: true };
      },
    });

    assert.equal(deleted, "lobby-b");
    assert.equal(result.membershipDeleted, true);
    assert.equal(getPendingLobbyMembershipCompensation(), null);
  });

  it("reclaim DELETE échoue - pending retryable distinct", async () => {
    const effects = createLobbyJoinEffects(GUEST_B);
    recordMembershipReclaimForJoin(effects, {
      membershipId: "mem-b-guest",
      lobbyId: "lobby-b",
      reclaimed: true,
    });

    const result = await compensateFailedLobbyJoin(effects, {
      deleteOwnLobbyMembershipById: async () => ({ ok: false, error: "timeout" }),
    });

    assert.equal(result.ok, false);
    assert.equal(
      getPendingLobbyMembershipCompensation()?.reason,
      "join_failed_after_reclaim_delete_failed"
    );
  });

  it("reclaim idempotent (reclaimed false) - pas de DELETE", async () => {
    const effects = createLobbyJoinEffects(GUEST_B);
    recordMembershipReclaimForJoin(effects, {
      membershipId: "mem-b",
      lobbyId: "lobby-b",
      reclaimed: false,
    });

    let called = false;
    await compensateFailedLobbyJoin(effects, {
      deleteOwnLobbyMembershipById: async () => {
        called = true;
        return { ok: true };
      },
    });
    assert.equal(called, false);
    assert.equal(getPendingLobbyMembershipCompensation(), null);
  });
});

describe("membership query guard with pending", () => {
  afterEach(() => savePendingLobbyMembershipCompensation(null));

  it("bloque found B si pending B et local A", () => {
    const pending = {
      lobbyId: "lobby-b",
      membershipId: "mem-b",
      createdAt: Date.now(),
      reason: "join_failed_after_reclaim_delete_failed",
    };
    const query = {
      status: "found",
      membership: { lobbyId: "lobby-b", code: "BBBB" },
    };
    assert.equal(
      shouldBlockMembershipQueryForPending(pending, query, { localLobbyId: "lobby-a" }),
      true
    );
  });

  it("n'applique pas le bloc si membership déjà absente (none)", () => {
    const pending = {
      lobbyId: "lobby-b",
      membershipId: "mem-b",
      createdAt: Date.now(),
      reason: "join_failed_after_membership_insert",
    };
    assert.equal(
      shouldBlockMembershipQueryForPending(pending, { status: "none" }, { localLobbyId: "lobby-a" }),
      false
    );
  });

  it("build conflict expose remoteCode", () => {
    const pending = {
      lobbyId: "lobby-b",
      membershipId: "mem-b",
      createdAt: Date.now(),
      reason: "join_failed_after_reclaim_delete_failed",
    };
    const conflict = buildMembershipReconciliationConflict(
      pending,
      { status: "found", membership: { lobbyId: "lobby-b", code: "BBBB" } },
      "lobby-a"
    );
    assert.equal(conflict.status, "membership_reconciliation_required");
    assert.equal(conflict.remoteCode, "BBBB");
    assert.equal(conflict.localLobbyId, "lobby-a");
  });
});

describe("resolvePendingMembershipByLeave", () => {
  afterEach(() => savePendingLobbyMembershipCompensation(null));

  it("membership absente = succès et pending effacé", async () => {
    savePendingLobbyMembershipCompensation({
      lobbyId: "lobby-b",
      membershipId: "mem-b",
      createdAt: Date.now(),
      reason: "join_failed_after_reclaim_delete_failed",
    });

    const res = await resolvePendingMembershipByLeave({
      deleteOwnLobbyMembershipById: async () => ({ ok: true }),
    });
    assert.equal(res.ok, true);
    assert.equal(getPendingLobbyMembershipCompensation(), null);
  });
});

describe("finalizeFailedJoinAttempt - comportement", () => {
  it("mutation confirmée + !ok : compensation avant rollback, pas de commit", async () => {
    const effects = createLobbyJoinEffects(GUEST_A);
    recordMembershipInsertForJoin(effects, { id: "mem-b" }, "lobby-b");

    const calls = [];
    await finalizeFailedJoinAttempt(
      { joinEffects: effects, rollbackSnapshot: { lobbyId: "lobby-a" } },
      {
        compensateFailedLobbyJoin: async () => {
          calls.push("compensate");
          return { ok: true, membershipDeleted: true };
        },
        deleteOwnLobbyMembershipById: async () => ({ ok: true }),
        rollbackLobbyJoinTransition: async () => {
          calls.push("rollback");
        },
      }
    );

    assert.deepEqual(calls, ["compensate", "rollback"]);
    assert.equal(effects.joinFinalized, false);
  });

  it("échec finalisation : joinEffects restent non finalisés", async () => {
    const effects = createLobbyJoinEffects(null);
    recordMembershipInsertForJoin(effects, { id: "mem-b" }, "lobby-b");

    await finalizeFailedJoinAttempt(
      { joinEffects: effects, rollbackSnapshot: { lobbyId: "lobby-a" } },
      {
        compensateFailedLobbyJoin: async () => ({ ok: true }),
        rollbackLobbyJoinTransition: async () => {},
      }
    );

    assert.equal(effects.joinFinalized, false);
  });
});

describe("pending storage", () => {
  beforeEach(() => resetGuestStorage());
  afterEach(() => {
    resetGuestStorage();
    savePendingLobbyMembershipCompensation(null);
  });

  it("clearPendingIfMatches", () => {
    savePendingLobbyMembershipCompensation({
      lobbyId: "lobby-b",
      membershipId: "mem-b",
      createdAt: Date.now(),
      reason: "join_failed_after_membership_insert",
    });
    clearPendingLobbyMembershipCompensationIfMatches("lobby-b");
    assert.equal(getPendingLobbyMembershipCompensation(), null);
  });
});

describe("joinLobby - contrats source compensation", () => {
  it("C - finalizeFailedJoinAttempt extrait et câblé dans joinLobby", () => {
    const lobbySrc = readFileSync(join(ROOT, "js/core/lobby.js"), "utf8");
    const finalizeSrc = readFileSync(join(ROOT, "js/core/lobbyJoinFinalize.js"), "utf8");
    assert.match(lobbySrc, /runFinalizeFailedJoinAttempt/);
    assert.match(lobbySrc, /if \(!res\.ok\)/);
    assert.match(lobbySrc, /catch \(joinErr\)/);
    assert.match(finalizeSrc, /compensateFailedLobbyJoin/);
    assert.match(finalizeSrc, /rollbackLobbyJoinTransition/);
  });

  it("ordre compensation B avant rollback A", () => {
    const src = readFileSync(join(ROOT, "js/core/lobbyJoinFinalize.js"), "utf8");
    const compIdx = src.indexOf("compensateFailedLobbyJoin");
    const rollIdx = src.indexOf("rollbackLobbyJoinTransition");
    assert.ok(compIdx >= 0 && rollIdx >= 0);
    assert.ok(compIdx < rollIdx, "compensation doit précéder rollback");
  });

  it("Home garde pending avant apply + UI reconciliation", () => {
    const src = readFileSync(join(ROOT, "js/screens/home.js"), "utf8");
    assert.match(src, /shouldBlockMembershipQueryForPending/);
    assert.match(src, /btn-pending-leave-remote/);
    assert.match(src, /btn-pending-join-remote/);
    const blockMatch = src.match(
      /await retryPendingLobbyMembershipCompensation\([\s\S]*?await queryActiveLobbyMembership\(\)/
    );
    assert.ok(blockMatch, "retry pending doit précéder queryActiveLobbyMembership dans le flux Home");
  });
});

describe("joinLobbySupabase - contrats source journal", () => {
  it("recordPreexistingMembershipForJoin sur membership existante", () => {
    const src = readFileSync(join(ROOT, "js/core/supabaseLobby.js"), "utf8");
    assert.match(src, /recordPreexistingMembershipForJoin\(joinEffects, existing/);
  });

  it("recordMembershipInsertForJoin après INSERT réussi", () => {
    const src = readFileSync(join(ROOT, "js/core/supabaseLobby.js"), "utf8");
    assert.match(src, /recordMembershipInsertForJoin\(joinEffects, joinData/);
  });

  it("reclaim enregistré avec reclaimed flag, pas comme inserted", () => {
    const src = readFileSync(join(ROOT, "js/core/supabaseLobby.js"), "utf8");
    assert.match(src, /recordMembershipReclaimForJoin\(joinEffects/);
    assert.match(src, /reclaimed: reclaimRes\.reclaimed/);
  });

  it("globalStats.playersJoined incrémenté uniquement après INSERT, pas décrémenté", () => {
    const src = readFileSync(join(ROOT, "js/core/supabaseLobby.js"), "utf8");
    assert.match(src, /gs\.playersJoined = \(gs\.playersJoined \|\| 0\) \+ 1/);
    assert.doesNotMatch(src, /playersJoined.*-\s*1/);
  });
});
