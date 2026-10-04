/**
 * Lecture du rôle privé Spot the fake.
 * Le nonce suit le contexte de deal, pas chaque snapshot du deal affiché.
 */
import { describe, it, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import { getTraitrePairById } from "../data/traitre.js";
import { getState, saveStatePatch } from "../js/core/state.js";
import {
  isTraitrePrivateRoleCurrent,
  shouldInvalidateTraitrePrivateRole,
  traitreKnownImpostorFlag,
  traitrePrivateRoleFields,
} from "../js/core/sessionMerge.js";

const PAIR = "tech_9";
const OTHER_PAIR = "food_10";
const WORD_A = "Android";
const WORD_B = "iOS";

let fetchBehavior = async () => ({ data: null, error: null });
let syncTraitrePrivateRole;

/** Même règle que getMyTraitreWord : rôle validé → mot A ou mot B. */
function wordShown(session) {
  const pair = getTraitrePairById(session?.pairId);
  const amImpostor = traitreKnownImpostorFlag(session, { offline: false });
  if (!pair || amImpostor === null) return null;
  return amImpostor ? pair.b : pair.a;
}

function guestSession(overrides = {}) {
  return {
    phase: null,
    pairId: PAIR,
    lobbyStarted: true,
    isLocalImpostor: null,
    privateRoleSynced: false,
    privateRolePairId: null,
    privateRoleNonce: 3,
    impostorName: null,
    impostorRevealed: false,
    alive: ["Hote", "Sam"],
    ...overrides,
  };
}

function seatGuest(overrides = {}) {
  saveStatePatch({
    lobby: {
      id: "lobby-role",
      hostId: "uid-host",
      participants: [{ name: "Sam", isLocal: true, isHost: false, userId: "uid-fake" }],
    },
    user: { name: "Sam" },
    traitreGame: guestSession(overrides),
  });
}

/** Même effet qu'un merge de snapshot sur les champs de rôle. */
function mergeSnapshot(remote) {
  const local = getState().traitreGame;
  const pairId = remote.pairId || local.pairId || null;
  const invalidate = shouldInvalidateTraitrePrivateRole(local, remote);
  const privateRole = traitrePrivateRoleFields(local, pairId, invalidate);
  saveStatePatch({
    traitreGame: {
      ...local,
      phase: remote.phase ?? local.phase,
      pairId,
      lobbyStarted: remote.lobbyStarted !== false,
      ...privateRole,
    },
  });
  return invalidate;
}

before(async () => {
  mock.module("../js/core/supabaseClient.js", {
    namedExports: {
      isSupabaseConfigured: () => true,
      supabase: {
        from() {
          const api = {
            select() {
              return api;
            },
            eq() {
              return api;
            },
            maybeSingle() {
              return fetchBehavior();
            },
            upsert() {
              return Promise.resolve({ error: null });
            },
            delete() {
              return { eq: () => Promise.resolve({ error: null }) };
            },
          };
          return api;
        },
      },
    },
  });
  mock.module("../js/core/supabaseAuth.js", {
    namedExports: {
      getSupabaseUserId: () => "uid-fake",
    },
  });
  ({ syncTraitrePrivateRole } = await import("../js/core/traitrePrivate.js"));
});

after(() => {
  mock.restoreAll();
});

describe("sync rôle privé — contexte de deal", () => {
  it("invité fake : merge du même deal pendant le fetch applique le mot B", async () => {
    seatGuest({ phase: null, privateRoleNonce: 3 });
    fetchBehavior = async () => {
      const invalidated = mergeSnapshot({ phase: "deal", pairId: PAIR, lobbyStarted: true });
      assert.equal(invalidated, false);
      assert.equal(getState().traitreGame.privateRoleNonce, 3);
      return { data: { is_impostor: true, pair_id: PAIR }, error: null };
    };

    const ok = await syncTraitrePrivateRole(PAIR, { maxAttempts: 1, delayMs: 0 });
    const session = getState().traitreGame;

    assert.equal(ok, true);
    assert.equal(session.isLocalImpostor, true);
    assert.equal(session.privateRoleSynced, true);
    assert.equal(session.privateRolePairId, PAIR);
    assert.equal(isTraitrePrivateRoleCurrent(session), true);
    assert.equal(wordShown(session), WORD_B);
  });

  it("même deal déjà en phase deal : merge pendant le fetch, rôle normal, mot A", async () => {
    seatGuest({ phase: "deal", privateRoleNonce: 3 });
    fetchBehavior = async () => {
      const invalidated = mergeSnapshot({ phase: "deal", pairId: PAIR, lobbyStarted: true });
      assert.equal(invalidated, false);
      assert.equal(getState().traitreGame.privateRoleNonce, 3);
      return { data: { is_impostor: false, pair_id: PAIR }, error: null };
    };

    const ok = await syncTraitrePrivateRole(PAIR, { maxAttempts: 1, delayMs: 0 });
    const session = getState().traitreGame;

    assert.equal(ok, true);
    assert.equal(session.isLocalImpostor, false);
    assert.equal(wordShown(session), WORD_A);
  });

  it("deux fetchs du même deal : un merge du snapshot ne rejette pas la réponse", async () => {
    seatGuest({ phase: "deal", privateRoleNonce: 7 });
    fetchBehavior = async () => {
      mergeSnapshot({ phase: "deal", pairId: PAIR, lobbyStarted: true });
      return { data: { is_impostor: true, pair_id: PAIR }, error: null };
    };

    const [first, second] = await Promise.all([
      syncTraitrePrivateRole(PAIR, { maxAttempts: 1, delayMs: 0 }),
      syncTraitrePrivateRole(PAIR, { maxAttempts: 1, delayMs: 0 }),
    ]);
    const session = getState().traitreGame;

    assert.equal(first, true);
    assert.equal(second, true);
    assert.equal(session.privateRoleNonce, 7);
    assert.equal(session.isLocalImpostor, true);
    assert.equal(wordShown(session), WORD_B);
  });

  it("fetch ancien puis nouveau pairId : réponse rejetée", async () => {
    seatGuest({ phase: "deal", privateRoleNonce: 3 });
    fetchBehavior = async () => {
      const invalidated = mergeSnapshot({
        phase: "deal",
        pairId: OTHER_PAIR,
        lobbyStarted: true,
      });
      assert.equal(invalidated, true);
      assert.notEqual(getState().traitreGame.privateRoleNonce, 3);
      return { data: { is_impostor: true, pair_id: PAIR }, error: null };
    };

    const ok = await syncTraitrePrivateRole(PAIR, { maxAttempts: 1, delayMs: 0 });
    const session = getState().traitreGame;

    assert.equal(ok, false);
    assert.equal(session.pairId, OTHER_PAIR);
    assert.equal(isTraitrePrivateRoleCurrent(session), false);
    assert.equal(wordShown(session), null);
  });

  it("fetch ancien puis nouveau deal, même paire : réponse rejetée", async () => {
    seatGuest({
      phase: "speak",
      privateRoleNonce: 4,
      privateRoleSynced: false,
      privateRolePairId: null,
      isLocalImpostor: null,
    });
    fetchBehavior = async () => {
      const invalidated = mergeSnapshot({ phase: "deal", pairId: PAIR, lobbyStarted: true });
      assert.equal(invalidated, true);
      assert.equal(getState().traitreGame.privateRoleNonce, 5);
      return { data: { is_impostor: true, pair_id: PAIR }, error: null };
    };

    const ok = await syncTraitrePrivateRole(PAIR, { maxAttempts: 1, delayMs: 0 });
    const session = getState().traitreGame;

    assert.equal(ok, false);
    assert.equal(session.isLocalImpostor, null);
    assert.equal(session.privateRoleSynced, false);
    assert.equal(isTraitrePrivateRoleCurrent(session), false);
    assert.equal(wordShown(session), null);
  });
});
