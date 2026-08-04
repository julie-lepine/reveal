/**
 * Membership Vague E1 - snapshot scoped par identité auth.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { saveStatePatch } from "../js/core/state.js";
import {
  decideMembershipSnapshotWrite,
  canCreateLobbyFromInputs,
  applyMembershipQueryToSnapshot,
  assertCanInsertLobby,
} from "../js/core/lobbyCreateGuard.js";
import { deriveHomeMembershipChrome } from "../js/core/homeMembershipChrome.js";
import {
  getMembershipSnapshot,
  getMembershipSnapshotForUser,
  setMembershipSnapshot,
  invalidateMembershipSnapshot,
  handleMembershipAuthIdentityTransition,
  getMembershipAuthGeneration,
  __resetMembershipAuthForTests,
} from "../js/core/lobbyMembershipSnapshot.js";
import {
  UID_A,
  UID_B,
  sameIdentity,
  resetMembershipSnapshotTestState,
  clearMembershipSnapshotTestState,
} from "./helpers/membershipSnapshotTest.js";

const FOUND_A = {
  status: "found",
  membership: {
    lobbyId: "L-a",
    code: "AAAA",
    lobbyStatus: "waiting",
    gameId: null,
    role: "member",
  },
  extraCount: 0,
};

function foundSnap(userId = UID_A) {
  return {
    status: "found",
    userId,
    membership: { ...FOUND_A.membership },
    extraCount: 0,
    checkedAt: Date.now(),
  };
}

function signedOutChrome(snapshot = null) {
  return deriveHomeMembershipChrome({
    hasActiveLobby: false,
    snapshot,
    resolutionInProgress: false,
    authReady: true,
    supabaseConfigured: true,
    loggedIn: false,
    shouldCheckMembership: false,
  });
}

function signedInCheckingChrome(snapshot = null) {
  return deriveHomeMembershipChrome({
    hasActiveLobby: false,
    snapshot,
    resolutionInProgress: true,
    authReady: true,
    supabaseConfigured: true,
    loggedIn: true,
    shouldCheckMembership: true,
  });
}

describe("lobbyMembershipVagueE1 - A logout avec snapshot found A", () => {
  beforeEach(() => {
    resetMembershipSnapshotTestState(UID_A);
    setMembershipSnapshot(FOUND_A, "home-query", UID_A);
  });

  it("snapshot A non exposable après transition signed out", () => {
    handleMembershipAuthIdentityTransition(UID_A, null);
    saveStatePatch({ supabaseUserId: null });
    assert.equal(getMembershipSnapshot(), null);
    assert.equal(getMembershipSnapshotForUser(UID_A), null);
  });

  it("pas de chrome Resume A après logout", () => {
    handleMembershipAuthIdentityTransition(UID_A, null);
    saveStatePatch({ supabaseUserId: null });
    const chrome = signedOutChrome(getMembershipSnapshot());
    assert.equal(chrome.showResume, false);
    assert.equal(chrome.membershipCode, null);
    assert.notEqual(chrome.state, "server_membership_recoverable");
  });

  it("canCreateLobbyFromInputs ignore le snapshot A après logout", () => {
    const snap = getMembershipSnapshot();
    handleMembershipAuthIdentityTransition(UID_A, null);
    saveStatePatch({ supabaseUserId: null });
    assert.equal(
      canCreateLobbyFromInputs({
        loggedIn: false,
        hasActiveLobby: false,
        authReady: true,
        supabaseConfigured: true,
        snapshot: snap,
      }),
      false
    );
  });
});

describe("lobbyMembershipVagueE1 - B login B après logout A", () => {
  beforeEach(() => {
    resetMembershipSnapshotTestState(UID_A);
    setMembershipSnapshot(FOUND_A, "home-query", UID_A);
    handleMembershipAuthIdentityTransition(UID_A, null);
    saveStatePatch({ supabaseUserId: null });
    handleMembershipAuthIdentityTransition(null, UID_B);
    saveStatePatch({ supabaseUserId: UID_B });
  });

  it("aucun found(A) exposable pour B", () => {
    assert.equal(getMembershipSnapshot(), null);
    assert.equal(getMembershipSnapshotForUser(UID_A), null);
  });

  it("chrome B non résolu (checking) avant query B", () => {
    const chrome = signedInCheckingChrome(getMembershipSnapshot());
    assert.equal(chrome.state, "checking");
    assert.equal(chrome.showResume, false);
    assert.equal(chrome.createEnabled, false);
  });

  it("retain_found interdit entre identités", () => {
    const decision = decideMembershipSnapshotWrite(
      { ...foundSnap(UID_A), status: "found" },
      { status: "unknown" },
      "home-query",
      {
        queryUserId: UID_B,
        currentUserId: UID_B,
        queryAuthGeneration: getMembershipAuthGeneration(),
        currentAuthGeneration: getMembershipAuthGeneration(),
      }
    );
    assert.equal(decision.action, "reject_stale_identity");
  });
});

describe("lobbyMembershipVagueE1 - C query unknown B avec ancien found A", () => {
  it("reject_stale_identity, pas retain_found", () => {
    const decision = decideMembershipSnapshotWrite(
      foundSnap(UID_A),
      { status: "unknown" },
      "home-query",
      sameIdentity(UID_B)
    );
    assert.equal(decision.action, "reject_stale_identity");
  });
});

describe("lobbyMembershipVagueE1 - D query unknown A avec ancien found A", () => {
  beforeEach(() => resetMembershipSnapshotTestState(UID_A));

  it("retain_found_same_identity autorisé", () => {
    setMembershipSnapshot(FOUND_A, "home", UID_A);
    const decision = decideMembershipSnapshotWrite(
      getMembershipSnapshot(),
      { status: "unknown" },
      "home-query",
      sameIdentity(UID_A)
    );
    assert.equal(decision.action, "retain_found_same_identity");
  });
});

describe("lobbyMembershipVagueE1 - E query A lente puis login B", () => {
  beforeEach(() => resetMembershipSnapshotTestState(UID_A));

  it("réponse A ignorée - snapshot B non écrasé", async () => {
    let currentUserId = UID_A;
    saveStatePatch({ supabaseUserId: UID_A });

    await assert.rejects(
      assertCanInsertLobby({
        hasActiveLobby: false,
        getSupabaseUserId: () => currentUserId,
        queryActiveLobbyMembership: async () => {
          handleMembershipAuthIdentityTransition(UID_A, UID_B);
          saveStatePatch({ supabaseUserId: UID_B });
          currentUserId = UID_B;
          setMembershipSnapshot({ status: "none" }, "b-resolved", UID_B);
          return FOUND_A;
        },
        getMembershipSnapshot,
        setMembershipSnapshot,
      })
    );

    const snap = getMembershipSnapshot();
    assert.equal(snap?.userId, UID_B);
    assert.equal(snap?.status, "none");
    assert.notEqual(snap?.membership?.code, "AAAA");
  });

  it("création B non bloquée par réponse tardive A", async () => {
    resetMembershipSnapshotTestState(UID_B);
    setMembershipSnapshot({ status: "none" }, "b", UID_B);

    let currentUserId = UID_A;
    await assert.rejects(
      assertCanInsertLobby({
        hasActiveLobby: false,
        getSupabaseUserId: () => currentUserId,
        queryActiveLobbyMembership: async () => {
          currentUserId = UID_B;
          handleMembershipAuthIdentityTransition(UID_A, UID_B);
          saveStatePatch({ supabaseUserId: UID_B });
          return FOUND_A;
        },
        getMembershipSnapshot,
        setMembershipSnapshot,
      })
    );

    currentUserId = UID_B;
    const out = await assertCanInsertLobby({
      hasActiveLobby: false,
      getSupabaseUserId: () => UID_B,
      queryActiveLobbyMembership: async () => ({ status: "none" }),
      getMembershipSnapshot,
      setMembershipSnapshot,
    });
    assert.equal(out.status, "none");
  });
});

describe("lobbyMembershipVagueE1 - F query A lente puis logout", () => {
  beforeEach(() => resetMembershipSnapshotTestState(UID_A));

  it("réponse A ignorée après logout", async () => {
    const queryAuthGen = getMembershipAuthGeneration();
    let currentUserId = UID_A;

    await assert.rejects(
      assertCanInsertLobby({
        hasActiveLobby: false,
        getSupabaseUserId: () => currentUserId,
        queryActiveLobbyMembership: async () => {
          handleMembershipAuthIdentityTransition(UID_A, null);
          saveStatePatch({ supabaseUserId: null });
          currentUserId = null;
          return FOUND_A;
        },
        getMembershipSnapshot,
        setMembershipSnapshot,
      })
    );

    assert.equal(getMembershipSnapshot(), null);
    saveStatePatch({ supabaseUserId: UID_A });
    assert.equal(getMembershipSnapshot(), null);
  });

  it("applyMembershipQueryToSnapshot rejette génération stale", () => {
    setMembershipSnapshot(FOUND_A, "a", UID_A);
    handleMembershipAuthIdentityTransition(UID_A, null);
    saveStatePatch({ supabaseUserId: null });

    const action = applyMembershipQueryToSnapshot(
      { status: "none" },
      {
        getMembershipSnapshot,
        setMembershipSnapshot,
        userId: UID_A,
        queryAuthGeneration: 0,
      }
    );
    assert.equal(action, "rejected");
    assert.equal(getMembershipSnapshot(), null);
  });
});

describe("lobbyMembershipVagueE1 - G refresh auth même userId", () => {
  beforeEach(() => resetMembershipSnapshotTestState(UID_A));

  it("snapshot A conservé - pas d'invalidation", () => {
    setMembershipSnapshot(FOUND_A, "home", UID_A);
    const before = getMembershipSnapshot();
    handleMembershipAuthIdentityTransition(UID_A, UID_A);
    const after = getMembershipSnapshot();
    assert.equal(after?.status, "found");
    assert.equal(after?.membership?.code, before?.membership?.code);
    assert.equal(getMembershipAuthGeneration(), 0);
  });
});

describe("lobbyMembershipVagueE1 - H snapshot legacy sans userId", () => {
  it("setMembershipSnapshot sans userId → null, jamais exposé", () => {
    resetMembershipSnapshotTestState(UID_A);
    const written = setMembershipSnapshot({ status: "found", membership: FOUND_A.membership });
    assert.equal(written, null);
    assert.equal(getMembershipSnapshot(), null);
  });

  it("getMembershipSnapshotForUser rejette mismatch authGeneration", () => {
    resetMembershipSnapshotTestState(UID_A);
    setMembershipSnapshot(FOUND_A, "t", UID_A, { authGeneration: 0 });
    handleMembershipAuthIdentityTransition(UID_A, UID_B);
    saveStatePatch({ supabaseUserId: UID_B });
    assert.equal(getMembershipSnapshotForUser(UID_B), null);
  });
});

describe("lobbyMembershipVagueE1 - I signed out", () => {
  beforeEach(() => clearMembershipSnapshotTestState());

  it("aucune membership serveur exposée", () => {
    assert.equal(getMembershipSnapshot(), null);
  });

  it("pas de Vérification… infini - état none", () => {
    const chrome = signedOutChrome(null);
    assert.equal(chrome.state, "none");
    assert.notEqual(chrome.primaryMessage, "Vérification de ton lobby…");
    assert.equal(chrome.createEnabled, false);
  });

  it("snapshot invalidé ne revient pas au prochain login", () => {
    setMembershipSnapshot(FOUND_A, "stale", UID_A);
    handleMembershipAuthIdentityTransition(null, UID_B);
    saveStatePatch({ supabaseUserId: UID_B });
    assert.equal(getMembershipSnapshot(), null);
  });
});

describe("lobbyMembershipVagueE1 - J idempotence", () => {
  beforeEach(() => resetMembershipSnapshotTestState(UID_A));

  it("invalidation multiple sans erreur", () => {
    setMembershipSnapshot(FOUND_A, "t", UID_A);
    invalidateMembershipSnapshot();
    invalidateMembershipSnapshot();
    assert.equal(getMembershipSnapshot(), null);
  });

  it("réponses tardives multiples ignorées", () => {
    handleMembershipAuthIdentityTransition(UID_A, UID_B);
    saveStatePatch({ supabaseUserId: UID_B });
    const identity = { queryUserId: UID_A, currentUserId: UID_B, queryAuthGeneration: 0, currentAuthGeneration: 1 };
    assert.equal(
      decideMembershipSnapshotWrite(foundSnap(UID_A), { status: "found" }, "late", identity).action,
      "reject_stale_identity"
    );
    assert.equal(
      decideMembershipSnapshotWrite(foundSnap(UID_A), { status: "none" }, "late", identity).action,
      "reject_stale_identity"
    );
  });

  it("remount même identité - snapshot mémoire-only conservé", () => {
    setMembershipSnapshot(FOUND_A, "home", UID_A);
    const first = getMembershipSnapshot();
    __resetMembershipAuthForTests();
    resetMembershipSnapshotTestState(UID_A);
    setMembershipSnapshot(FOUND_A, "home", UID_A);
    const second = getMembershipSnapshot();
    assert.equal(second?.status, first?.status);
    assert.equal(second?.userId, UID_A);
  });
});
