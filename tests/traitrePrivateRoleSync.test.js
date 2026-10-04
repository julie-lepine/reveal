/**
 * Lecture du rôle privé Spot the fake.
 * Le nonce suit le contexte de deal, pas chaque snapshot du deal affiché.
 */
import { describe, it, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

  it("deux déclencheurs du même deal : un seul fetch, la réponse reste applicable", async () => {
    seatGuest({ phase: "deal", privateRoleNonce: 7 });
    let fetches = 0;
    fetchBehavior = async () => {
      fetches += 1;
      mergeSnapshot({ phase: "deal", pairId: PAIR, lobbyStarted: true });
      return { data: { is_impostor: true, pair_id: PAIR }, error: null };
    };

    const [first, second] = await Promise.all([
      syncTraitrePrivateRole(PAIR, { maxAttempts: 1, delayMs: 0 }),
      syncTraitrePrivateRole(PAIR, { maxAttempts: 1, delayMs: 0 }),
    ]);
    const session = getState().traitreGame;

    assert.equal(fetches, 1);
    assert.equal(first, true);
    assert.equal(second, true);
    assert.equal(session.privateRoleNonce, 7);
    assert.equal(session.isLocalImpostor, true);
    assert.equal(session.privateRoleSynced, true);
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

function holdRow(row) {
  let release;
  const promise = new Promise((resolve) => {
    release = () => resolve({ data: row, error: null });
  });
  return { promise, release };
}

describe("sync rôle privé — une lecture par contexte", () => {
  it("prep → deal : nonce incrémenté, A et B partagent un seul fetch", async () => {
    seatGuest({
      phase: null,
      pairId: null,
      lobbyStarted: false,
      privateRoleNonce: 2,
      privateRoleSynced: false,
      isLocalImpostor: null,
    });
    assert.equal(getState().traitreGame.pairId, null);

    const invalidated = mergeSnapshot({ phase: "deal", pairId: PAIR, lobbyStarted: true });
    const opened = getState().traitreGame;
    assert.equal(invalidated, true);
    assert.equal(opened.pairId, PAIR);
    assert.equal(opened.phase, "deal");
    assert.equal(opened.privateRoleNonce, 3);
    assert.equal(wordShown(opened), null);

    let fetches = 0;
    const held = holdRow({ is_impostor: true, pair_id: PAIR });
    fetchBehavior = () => {
      fetches += 1;
      return held.promise;
    };
    let notifies = 0;
    const fromSession = syncTraitrePrivateRole(PAIR, {
      maxAttempts: 1,
      delayMs: 0,
      notify: () => {
        notifies += 1;
      },
    });
    const fromScreen = syncTraitrePrivateRole(PAIR, { maxAttempts: 1, delayMs: 0 });

    assert.equal(fetches, 1);
    assert.equal(wordShown(getState().traitreGame), null);
    held.release();
    const [okSession, okScreen] = await Promise.all([fromSession, fromScreen]);
    const session = getState().traitreGame;

    assert.equal(okSession, true);
    assert.equal(okScreen, true);
    assert.equal(fetches, 1);
    assert.equal(notifies, 1);
    assert.equal(session.isLocalImpostor, true);
    assert.equal(session.privateRoleSynced, true);
    assert.equal(session.privateRolePairId, PAIR);
    assert.equal(wordShown(session), WORD_B);
    assert.notEqual(wordShown(session), WORD_A);
  });

  it("deux déclencheurs pendant le fetch : une requête, un notify, rôle fake", async () => {
    seatGuest({ phase: "deal", privateRoleNonce: 4 });
    let fetches = 0;
    const held = holdRow({ is_impostor: true, pair_id: PAIR });
    fetchBehavior = () => {
      fetches += 1;
      return held.promise;
    };
    let notifies = 0;
    const first = syncTraitrePrivateRole(PAIR, { maxAttempts: 1, delayMs: 0 });
    const second = syncTraitrePrivateRole(PAIR, {
      maxAttempts: 1,
      delayMs: 0,
      notify: () => {
        notifies += 1;
      },
    });

    assert.equal(fetches, 1);
    assert.equal(isTraitrePrivateRoleCurrent(getState().traitreGame), false);
    held.release();
    const [okFirst, okSecond] = await Promise.all([first, second]);
    const session = getState().traitreGame;

    assert.equal(okFirst, true);
    assert.equal(okSecond, true);
    assert.equal(fetches, 1);
    assert.equal(notifies, 1);
    assert.equal(session.isLocalImpostor, true);
    assert.equal(wordShown(session), WORD_B);
  });

  it("détective : is_impostor false valide le mot A", async () => {
    seatGuest({ phase: "deal", privateRoleNonce: 4 });
    let fetches = 0;
    fetchBehavior = async () => {
      fetches += 1;
      return { data: { is_impostor: false, pair_id: PAIR }, error: null };
    };

    const ok = await syncTraitrePrivateRole(PAIR, { maxAttempts: 1, delayMs: 0 });
    const session = getState().traitreGame;

    assert.equal(fetches, 1);
    assert.equal(ok, true);
    assert.equal(session.isLocalImpostor, false);
    assert.equal(session.privateRoleSynced, true);
    assert.equal(wordShown(session), WORD_A);
  });

  it("ancien contexte : réponse A rejetée, lecture B autorisée", async () => {
    seatGuest({ phase: "deal", privateRoleNonce: 4 });
    let fetches = 0;
    let releaseOld;
    fetchBehavior = () => {
      fetches += 1;
      if (fetches === 1) {
        mergeSnapshot({ phase: "deal", pairId: OTHER_PAIR, lobbyStarted: true });
        return new Promise((resolve) => {
          releaseOld = () => resolve({ data: { is_impostor: true, pair_id: PAIR }, error: null });
        });
      }
      return Promise.resolve({ data: { is_impostor: false, pair_id: OTHER_PAIR }, error: null });
    };

    const oldSync = syncTraitrePrivateRole(PAIR, { maxAttempts: 1, delayMs: 0 });
    assert.equal(getState().traitreGame.pairId, OTHER_PAIR);
    assert.notEqual(getState().traitreGame.privateRoleNonce, 4);
    const fresh = syncTraitrePrivateRole(OTHER_PAIR, { maxAttempts: 1, delayMs: 0 });
    assert.equal(fetches, 2);

    const okFresh = await fresh;
    releaseOld();
    const okOld = await oldSync;
    const session = getState().traitreGame;

    assert.equal(okOld, false);
    assert.equal(okFresh, true);
    assert.equal(session.pairId, OTHER_PAIR);
    assert.equal(session.isLocalImpostor, false);
    assert.equal(session.privateRolePairId, OTHER_PAIR);
    assert.equal(wordShown(session), "Coca");
    assert.notEqual(wordShown(session), WORD_B);
  });

  it("même paire, nouveau tour : réponse du nonce N rejetée, lecture N+1 possible", async () => {
    seatGuest({
      phase: "speak",
      privateRoleNonce: 4,
      privateRoleSynced: false,
      privateRolePairId: null,
      isLocalImpostor: null,
    });
    let fetches = 0;
    let releaseOld;
    fetchBehavior = () => {
      fetches += 1;
      if (fetches === 1) {
        mergeSnapshot({ phase: "deal", pairId: PAIR, lobbyStarted: true });
        return new Promise((resolve) => {
          releaseOld = () => resolve({ data: { is_impostor: false, pair_id: PAIR }, error: null });
        });
      }
      return Promise.resolve({ data: { is_impostor: true, pair_id: PAIR }, error: null });
    };

    const oldSync = syncTraitrePrivateRole(PAIR, { maxAttempts: 1, delayMs: 0 });
    assert.equal(getState().traitreGame.privateRoleNonce, 5);
    assert.equal(getState().traitreGame.pairId, PAIR);
    const fresh = syncTraitrePrivateRole(PAIR, { maxAttempts: 1, delayMs: 0 });
    assert.equal(fetches, 2);

    const okFresh = await fresh;
    releaseOld();
    const okOld = await oldSync;
    const session = getState().traitreGame;

    assert.equal(okOld, false);
    assert.equal(okFresh, true);
    assert.equal(session.privateRoleNonce, 5);
    assert.equal(session.isLocalImpostor, true);
    assert.equal(session.privateRoleSynced, true);
    assert.equal(wordShown(session), WORD_B);
    assert.notEqual(wordShown(session), WORD_A);
  });

  it("écran non monté : la lecture de A suffit, B ne relance pas le fetch", async () => {
    seatGuest({ phase: "deal", privateRoleNonce: 6 });
    let fetches = 0;
    fetchBehavior = async () => {
      fetches += 1;
      return { data: { is_impostor: false, pair_id: PAIR }, error: null };
    };

    const okFirst = await syncTraitrePrivateRole(PAIR, { maxAttempts: 1, delayMs: 0 });
    assert.equal(okFirst, true);
    assert.equal(fetches, 1);
    assert.equal(wordShown(getState().traitreGame), WORD_A);

    const okLater = await syncTraitrePrivateRole(PAIR, { maxAttempts: 1, delayMs: 0 });
    assert.equal(okLater, true);
    assert.equal(fetches, 1);
    assert.equal(wordShown(getState().traitreGame), WORD_A);
  });

  it("réseau lent : le rôle reste indisponible, un second appel ne refetch pas, puis le mot arrive", async () => {
    seatGuest({ phase: "deal", privateRoleNonce: 8 });
    let fetches = 0;
    const held = holdRow({ is_impostor: true, pair_id: PAIR });
    fetchBehavior = () => {
      fetches += 1;
      return held.promise;
    };

    const pending = syncTraitrePrivateRole(PAIR, { maxAttempts: 1, delayMs: 0 });
    const joined = syncTraitrePrivateRole(PAIR, { maxAttempts: 1, delayMs: 0 });
    assert.equal(fetches, 1);
    assert.equal(wordShown(getState().traitreGame), null);
    assert.equal(isTraitrePrivateRoleCurrent(getState().traitreGame), false);

    const screen = readFileSync(new URL("../js/games/traitre.js", import.meta.url), "utf8");
    const ensureStart = screen.indexOf("async function ensurePrivateRole");
    const ensureBlock = screen.slice(ensureStart, ensureStart + 400);
    assert.equal(ensureBlock.includes("await import("), false);
    assert.match(ensureBlock, /await syncTraitrePrivateRole\(pairId/);
    assert.match(screen, /void ensurePrivateRole\(\)\.then\(\(\) => \{[\s\S]*?render\(\);\s*\}\);\s*render\(\);/);

    held.release();
    const [okPending, okJoined] = await Promise.all([pending, joined]);
    const session = getState().traitreGame;
    assert.equal(okPending, true);
    assert.equal(okJoined, true);
    assert.equal(fetches, 1);
    assert.equal(wordShown(session), WORD_B);
  });

  it("hôte : aucun fetch traitre_private", async () => {
    saveStatePatch({
      lobby: {
        id: "lobby-role",
        hostId: "uid-host",
        participants: [{ name: "Hote", isLocal: true, isHost: true, userId: "uid-host" }],
      },
      user: { name: "Hote" },
      traitreGame: guestSession({ phase: "deal", privateRoleNonce: 1 }),
    });
    let fetches = 0;
    fetchBehavior = async () => {
      fetches += 1;
      return { data: { is_impostor: true, pair_id: PAIR }, error: null };
    };

    const ok = await syncTraitrePrivateRole(PAIR, { maxAttempts: 1, delayMs: 0 });
    const screen = readFileSync(new URL("../js/games/traitre.js", import.meta.url), "utf8");

    assert.equal(ok, true);
    assert.equal(fetches, 0);
    assert.equal(getState().traitreGame.isLocalImpostor, null);
    assert.match(screen, /if \(!mp \|\| isLobbyHost\(\) \|\| isTraitrePrivateRoleReady\(\)\) return;/);
  });
});
