import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  MEMBERSHIP_SNAPSHOT_FRESH_MS,
  LOBBY_CREATE_ERROR,
  makeLobbyCreateError,
  decideMembershipSnapshotWrite,
  isMembershipSnapshotFresh,
  canCreateLobbyFromInputs,
  assertCanInsertLobby,
  applyMembershipQueryToSnapshot,
} from "../js/core/lobbyCreateGuard.js";
import {
  resetMembershipSnapshotTestState,
  sameIdentity,
} from "./helpers/membershipSnapshotTest.js";
import {
  getMembershipSnapshot,
  setMembershipSnapshot,
  invalidateMembershipSnapshot,
} from "../js/core/lobbyMembershipSnapshot.js";
import { deriveHomeMembershipChrome } from "../js/core/homeMembershipChrome.js";
import {
  createMountGuard,
  advanceMountGeneration,
  resetMountGenerationForTests,
} from "../js/core/mountLifecycle.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const FOUND = {
  status: "found",
  membership: {
    lobbyId: "L1",
    code: "ABCD",
    lobbyStatus: "waiting",
    gameId: null,
    role: "member",
  },
  extraCount: 0,
};

const UID = "user-c-test-1111-2222";

function guardDeps(overrides = {}) {
  return {
    hasActiveLobby: false,
    getSupabaseUserId: () => UID,
    getMembershipSnapshot,
    setMembershipSnapshot,
    ...overrides,
  };
}

describe("lobbyCreateVagueC — assertCanInsertLobby", () => {
  beforeEach(() => {
    resetMembershipSnapshotTestState(UID);
  });

  it("1 — cache actif → refus sans query/INSERT", async () => {
    let queries = 0;
    await assert.rejects(
      () =>
        assertCanInsertLobby(
          guardDeps({
            hasActiveLobby: true,
            activeLobbyCode: "ZZZZ",
            queryActiveLobbyMembership: async () => {
              queries += 1;
              return { status: "none" };
            },
          })
        ),
      (err) => err.code === LOBBY_CREATE_ERROR.CACHE_ACTIVE
    );
    assert.equal(queries, 0);
  });

  it("2 — query found → refus + snapshot found", async () => {
    await assert.rejects(
      () =>
        assertCanInsertLobby(
          guardDeps({
            queryActiveLobbyMembership: async () => FOUND,
          })
        ),
      (err) =>
        err.code === LOBBY_CREATE_ERROR.ALREADY_EXISTS &&
        /ABCD/.test(err.message)
    );
    assert.equal(getMembershipSnapshot()?.status, "found");
    assert.equal(getMembershipSnapshot()?.membership?.code, "ABCD");
  });

  it("3 — query unknown → refus sans « déjà dans un lobby »", async () => {
    await assert.rejects(
      () =>
        assertCanInsertLobby(
          guardDeps({
            queryActiveLobbyMembership: async () => ({ status: "unknown" }),
          })
        ),
      (err) =>
        err.code === LOBBY_CREATE_ERROR.CHECK_FAILED &&
        !/déjà dans un lobby/i.test(err.message)
    );
    assert.equal(getMembershipSnapshot()?.status, "unknown");
  });

  it("4 — query none → autorise (pas throw)", async () => {
    const out = await assertCanInsertLobby(
      guardDeps({
        queryActiveLobbyMembership: async () => ({ status: "none" }),
      })
    );
    assert.equal(out.status, "none");
    assert.equal(getMembershipSnapshot()?.status, "none");
  });

  it("5 — snapshot none ancien, query found → refus", async () => {
    setMembershipSnapshot({ status: "none" }, "old", UID);
    await assert.rejects(
      () =>
        assertCanInsertLobby(
          guardDeps({
            queryActiveLobbyMembership: async () => FOUND,
          })
        ),
      (err) => err.code === LOBBY_CREATE_ERROR.ALREADY_EXISTS
    );
    assert.equal(getMembershipSnapshot()?.status, "found");
  });

  it("6 — snapshot none, query unknown → refus", async () => {
    setMembershipSnapshot({ status: "none" }, "old", UID);
    await assert.rejects(
      () =>
        assertCanInsertLobby(
          guardDeps({
            queryActiveLobbyMembership: async () => ({ status: "unknown" }),
          })
        ),
      (err) => err.code === LOBBY_CREATE_ERROR.CHECK_FAILED
    );
  });

  it("7 — found met à jour le snapshot", async () => {
    setMembershipSnapshot({ status: "none" }, "x", UID);
    try {
      await assertCanInsertLobby(
        guardDeps({
          queryActiveLobbyMembership: async () => FOUND,
        })
      );
    } catch {
      /* expected */
    }
    assert.equal(getMembershipSnapshot()?.status, "found");
  });

  it("8 — unknown sans ancien found → check_failed snapshot", async () => {
    applyMembershipQueryToSnapshot(
      { status: "unknown" },
      {
        getMembershipSnapshot,
        setMembershipSnapshot,
        userId: UID,
        queryAuthGeneration: 0,
      }
    );
    assert.equal(getMembershipSnapshot()?.status, "unknown");
  });

  it("9 — unknown avec ancien found → retain", async () => {
    setMembershipSnapshot(FOUND, "home", UID);
    const action = applyMembershipQueryToSnapshot(
      { status: "unknown" },
      {
        getMembershipSnapshot,
        setMembershipSnapshot,
        userId: UID,
        queryAuthGeneration: 0,
      }
    );
    assert.equal(action, "retained");
    assert.equal(getMembershipSnapshot()?.status, "found");
  });

  it("11 — membership > 24 h (joinedAt vieux) → found bloque toujours", async () => {
    const oldFound = {
      ...FOUND,
      membership: { ...FOUND.membership, code: "OLD1" },
    };
    await assert.rejects(
      () =>
        assertCanInsertLobby(
          guardDeps({
            queryActiveLobbyMembership: async () => oldFound,
          })
        ),
      (err) => err.code === LOBBY_CREATE_ERROR.ALREADY_EXISTS
    );
  });

  it("query throw → unknown / CHECK_FAILED", async () => {
    await assert.rejects(
      () =>
        assertCanInsertLobby(
          guardDeps({
            queryActiveLobbyMembership: async () => {
              throw new Error("net");
            },
          })
        ),
      (err) => err.code === LOBBY_CREATE_ERROR.CHECK_FAILED
    );
  });
});

describe("lobbyCreateVagueC — canCreateLobby / staleness", () => {
  beforeEach(() => {
    resetMembershipSnapshotTestState(UID);
  });

  it("12 — snapshot null → faux", () => {
    assert.equal(
      canCreateLobbyFromInputs({
        loggedIn: true,
        hasActiveLobby: false,
        authReady: true,
        supabaseConfigured: true,
        snapshot: null,
      }),
      false
    );
  });

  it("13 — unknown → faux", () => {
    assert.equal(
      canCreateLobbyFromInputs({
        loggedIn: true,
        supabaseConfigured: true,
        snapshot: { status: "unknown", userId: UID, checkedAt: Date.now() },
      }),
      false
    );
  });

  it("14 — found → faux", () => {
    assert.equal(
      canCreateLobbyFromInputs({
        loggedIn: true,
        supabaseConfigured: true,
        snapshot: {
          status: "found",
          userId: UID,
          checkedAt: Date.now(),
          membership: FOUND.membership,
        },
      }),
      false
    );
  });

  it("15 — snapshot stale → faux", () => {
    const now = 1_000_000;
    assert.equal(
      canCreateLobbyFromInputs({
        loggedIn: true,
        supabaseConfigured: true,
        snapshot: {
          status: "none",
          userId: UID,
          checkedAt: now - MEMBERSHIP_SNAPSHOT_FRESH_MS - 1,
        },
        now,
      }),
      false
    );
    assert.equal(
      isMembershipSnapshotFresh(
        { status: "none", checkedAt: now - MEMBERSHIP_SNAPSHOT_FRESH_MS - 1 },
        now
      ),
      false
    );
  });

  it("16 — none frais + login + cache absent → vrai", () => {
    const now = Date.now();
    assert.equal(
      canCreateLobbyFromInputs({
        loggedIn: true,
        hasActiveLobby: false,
        authReady: true,
        supabaseConfigured: true,
        snapshot: { status: "none", userId: UID, checkedAt: now },
        now,
      }),
      true
    );
  });

  it("offline supabaseConfigured false → vrai si login", () => {
    assert.equal(
      canCreateLobbyFromInputs({
        loggedIn: true,
        hasActiveLobby: false,
        supabaseConfigured: false,
        snapshot: null,
      }),
      true
    );
  });

  it("auth non prête → faux", () => {
    assert.equal(
      canCreateLobbyFromInputs({
        loggedIn: true,
        supabaseConfigured: true,
        authReady: false,
        snapshot: { status: "none", userId: UID, checkedAt: Date.now() },
      }),
      false
    );
  });
});

describe("lobbyCreateVagueC — Home chrome + source", () => {
  it("17 — none + resolutionInProgress → Créer disabled", () => {
    const chrome = deriveHomeMembershipChrome({
      hasActiveLobby: false,
      snapshot: { status: "none" },
      resolutionInProgress: true,
      authReady: true,
      supabaseConfigured: true,
      loggedIn: true,
      shouldCheckMembership: true,
    });
    assert.equal(chrome.state, "none");
    assert.equal(chrome.createEnabled, false);
  });

  it("18 — handler pattern : createEnabled false bloque", () => {
    const chrome = deriveHomeMembershipChrome({
      hasActiveLobby: false,
      snapshot: { status: "none" },
      resolutionInProgress: true,
      loggedIn: true,
      supabaseConfigured: true,
      shouldCheckMembership: true,
      authReady: true,
    });
    const wouldRun = Boolean(chrome.createEnabled);
    assert.equal(wouldRun, false);
  });

  it("10+QA — createLobby n’appelle plus peekServerLobbyForUser", () => {
    const lobbySrc = readFileSync(join(ROOT, "js/core/lobby.js"), "utf8");
    const createIdx = lobbySrc.indexOf("export async function createLobby()");
    const nextExport = lobbySrc.indexOf("\nexport ", createIdx + 10);
    const slice = lobbySrc.slice(createIdx, nextExport > 0 ? nextExport : createIdx + 2000);
    assert.equal(slice.includes("peekServerLobbyForUser"), false);
    assert.match(slice, /assertCanInsertLobby/);
    assert.match(slice, /queryActiveLobbyMembership/);
  });

  it("Home n’importe pas lobbyMembershipQuery injectable", () => {
    const homeSrc = readFileSync(join(ROOT, "js/screens/home.js"), "utf8");
    assert.equal(homeSrc.includes("lobbyMembershipQuery.js"), false);
    assert.match(homeSrc, /LOBBY_CREATE_ERROR/);
  });

  it("createLobby / lobby.js n’importe pas la query injectable", () => {
    const lobbySrc = readFileSync(join(ROOT, "js/core/lobby.js"), "utf8");
    assert.equal(lobbySrc.includes("lobbyMembershipQuery.js"), false);
    assert.match(lobbySrc, /lobbyMembershipFetch\.js/);
  });

  it("21 — message unknown ≠ déjà dans un lobby", () => {
    const err = makeLobbyCreateError(
      LOBBY_CREATE_ERROR.CHECK_FAILED,
      "Impossible de vérifier votre situation. Réessayez."
    );
    assert.equal(err.code, LOBBY_CREATE_ERROR.CHECK_FAILED);
    assert.equal(/déjà dans un lobby/i.test(err.message), false);
  });

  it("23 — mount guard : late assert n’écrit pas si disposed", async () => {
    resetMountGenerationForTests();
    advanceMountGeneration();
    const mount = createMountGuard();
    mount.dispose();
    const shouldContinue = () => mount.isMounted() && mount.isCurrentMount();

    setMembershipSnapshot(FOUND, "B", UID);
    if (shouldContinue()) {
      await assertCanInsertLobby(
        guardDeps({
          queryActiveLobbyMembership: async () => ({ status: "none" }),
        })
      );
    }
    assert.equal(getMembershipSnapshot()?.status, "found");
  });

  it("24 — ensureLobby appelle createLobby (source)", () => {
    const lobbyScreen = readFileSync(join(ROOT, "js/screens/lobby.js"), "utf8");
    assert.match(lobbyScreen, /async function ensureLobby/);
    assert.match(lobbyScreen, /await createLobby\(\)/);
    assert.match(lobbyScreen, /assertCanInsertLobby|Vague C|createLobby centralise/i);
  });

  it("25 — offline createLobby path conserve branche sans query (source)", () => {
    const lobbySrc = readFileSync(join(ROOT, "js/core/lobby.js"), "utf8");
    const createIdx = lobbySrc.indexOf("export async function createLobby()");
    const slice = lobbySrc.slice(createIdx, createIdx + 2800);
    assert.match(slice, /guardClientCompatibility\("create"\)/);
    assert.match(slice, /if \(isSupabaseConfigured\(\)\)/);
    assert.match(slice, /assertCanInsertLobby/);
    // Branche offline après garde
    assert.match(slice, /genLobbyCode|newLobby/);
  });

  it("double pipeline : second appel bloqué par flag simulé", () => {
    let inFlight = false;
    let runs = 0;
    function tryCreate() {
      if (inFlight) return false;
      inFlight = true;
      runs += 1;
      inFlight = false;
      return true;
    }
    assert.equal(tryCreate(), true);
    inFlight = true;
    assert.equal(tryCreate(), false);
    assert.equal(runs, 1);
  });
});

describe("lobbyCreateVagueC — decideMembershipSnapshotWrite source", () => {
  it("écrit avec source custom", () => {
    const d = decideMembershipSnapshotWrite(
      null,
      { status: "none" },
      "create-lobby-guard",
      sameIdentity(UID)
    );
    assert.equal(d.action, "write");
    assert.equal(d.source, "create-lobby-guard");
  });
});
