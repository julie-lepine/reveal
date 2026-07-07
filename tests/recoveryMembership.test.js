import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

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

const { getState, saveStatePatch } = await import("../js/core/state.js");
const {
  saveGuestMembership,
  loadGuestMembership,
  clearGuestMembership,
  membershipFromBundle,
  canUseGuestMembershipRecovery,
} = await import("../js/core/guestMembership.js");

const SAMPLE_MEMBERSHIP = {
  membershipId: "11111111-1111-1111-1111-111111111111",
  lobbyId: "22222222-2222-2222-2222-222222222222",
  lobbyCode: "ABCD",
  displayName: "Alice",
};

describe("guestMembership storage", () => {
  let stateSnapshot;

  beforeEach(() => {
    stateSnapshot = structuredClone(getState());
    memoryStorage.clear();
  });

  afterEach(() => {
    saveStatePatch(stateSnapshot);
    memoryStorage.clear();
  });

  it("T3.2 — persiste membershipId + lobby pour recovery hors session", () => {
    saveGuestMembership(SAMPLE_MEMBERSHIP);
    const loaded = loadGuestMembership();
    assert.deepEqual(loaded, SAMPLE_MEMBERSHIP);
  });

  it("T3.4 — clearGuestMembership supprime la preuve locale", () => {
    saveGuestMembership(SAMPLE_MEMBERSHIP);
    clearGuestMembership();
    assert.equal(loadGuestMembership(), null);
  });

  it("rejette un enregistrement incomplet", () => {
    saveGuestMembership({ membershipId: SAMPLE_MEMBERSHIP.membershipId });
    assert.equal(loadGuestMembership(), null);
  });
});

describe("canUseGuestMembershipRecovery", () => {
  let stateSnapshot;

  beforeEach(() => {
    stateSnapshot = structuredClone(getState());
    memoryStorage.clear();
  });

  afterEach(() => {
    saveStatePatch(stateSnapshot);
    memoryStorage.clear();
  });

  it("T3.5 — ignore guestMembership pour un compte email connecté", () => {
    saveGuestMembership(SAMPLE_MEMBERSHIP);
    saveStatePatch({
      user: {
        email: "alice@example.com",
        name: "Alice",
        loggedIn: true,
        isGuest: false,
        provider: "email",
      },
    });
    assert.equal(canUseGuestMembershipRecovery(), false);
  });

  it("autorise recovery invité si membership présent", () => {
    saveGuestMembership(SAMPLE_MEMBERSHIP);
    saveStatePatch({
      user: { email: null, name: "Alice", loggedIn: false, isGuest: true, provider: "guest" },
    });
    assert.equal(canUseGuestMembershipRecovery(), true);
  });

  it("autorise recovery si uid absent mais membership présent", () => {
    saveGuestMembership(SAMPLE_MEMBERSHIP);
    saveStatePatch({
      supabaseUserId: null,
      user: { email: null, name: null, loggedIn: false, isGuest: false, provider: null },
    });
    assert.equal(canUseGuestMembershipRecovery(), true);
  });

  it("faux sans membership stocké", () => {
    assert.equal(canUseGuestMembershipRecovery(), false);
  });
});

describe("membershipFromBundle", () => {
  it("extrait membershipId du joueur local", () => {
    const membership = membershipFromBundle({
      id: SAMPLE_MEMBERSHIP.lobbyId,
      code: SAMPLE_MEMBERSHIP.lobbyCode,
      participants: [
        { name: "Bob", isLocal: false, membershipId: "other-id" },
        {
          name: SAMPLE_MEMBERSHIP.displayName,
          isLocal: true,
          membershipId: SAMPLE_MEMBERSHIP.membershipId,
        },
      ],
    });
    assert.deepEqual(membership, SAMPLE_MEMBERSHIP);
  });

  it("T3.6 — deux invités même pseudo : membership distincte par id", () => {
    const otherMembershipId = "33333333-3333-3333-3333-333333333333";
    const bundle = {
      id: SAMPLE_MEMBERSHIP.lobbyId,
      code: SAMPLE_MEMBERSHIP.lobbyCode,
      participants: [
        { name: "Alice", isLocal: false, membershipId: otherMembershipId },
        {
          name: "Alice",
          isLocal: true,
          membershipId: SAMPLE_MEMBERSHIP.membershipId,
        },
      ],
    };
    const local = membershipFromBundle(bundle);
    assert.equal(local.membershipId, SAMPLE_MEMBERSHIP.membershipId);
    assert.notEqual(local.membershipId, otherMembershipId);
  });
});
