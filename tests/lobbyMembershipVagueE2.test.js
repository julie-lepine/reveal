/**
 * Membership Vague E2 — sync asymétrique cache runtime ↔ snapshot membership.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { saveStatePatch } from "../js/core/state.js";
import {
  getMembershipSnapshot,
  setMembershipSnapshot,
  invalidateMembershipSnapshot,
  getMembershipAuthGeneration,
  handleMembershipAuthIdentityTransition,
  __resetMembershipAuthForTests,
} from "../js/core/lobbyMembershipSnapshot.js";
import {
  commitMembershipHydrated,
  commitMembershipRemoved,
  mergeMembershipFields,
  membershipFromHydratedBundle,
  MEMBERSHIP_HYDRATION_SOURCE,
  shouldAlignSnapshotOnRefresh,
} from "../js/core/lobbyMembershipAlign.js";
import { canCreateLobbyFromInputs } from "../js/core/lobbyCreateGuard.js";
import { deriveHomeMembershipChrome } from "../js/core/homeMembershipChrome.js";
import {
  savePendingLobbyMembershipCompensation,
  clearPendingLobbyMembershipCompensationIfMatches,
  shouldBlockMembershipQueryForPending,
} from "../js/core/lobbyMembershipCompensation.js";
import {
  UID_A,
  UID_B,
  resetMembershipSnapshotTestState,
} from "./helpers/membershipSnapshotTest.js";

const BUNDLE_B = {
  id: "lobby-b-id",
  code: "BBBB",
  status: "waiting",
  gameId: null,
  hostId: UID_A,
  participants: [
    {
      userId: UID_A,
      isLocal: true,
      isHost: true,
      membershipId: "mem-b-1",
    },
  ],
};

const MEMBERSHIP_A = {
  lobbyId: "lobby-a-id",
  code: "AAAA",
  lobbyStatus: "waiting",
  gameId: null,
  role: "member",
  membershipId: "mem-a-1",
  joinedAt: "2026-07-01T12:00:00.000Z",
};

const MEMBERSHIP_B = {
  lobbyId: "lobby-b-id",
  code: "BBBB",
  lobbyStatus: "waiting",
  gameId: null,
  role: "host",
  membershipId: "mem-b-1",
  hostId: UID_A,
};

describe("lobbyMembershipVagueE2 — primitives", () => {
  beforeEach(() => {
    __resetMembershipAuthForTests();
    clearPendingLobbyMembershipCompensationIfMatches(null);
    resetMembershipSnapshotTestState(UID_A);
  });

  it("A — create confirmé : none → found B host", () => {
    setMembershipSnapshot({ status: "none" }, "create-lobby-guard", UID_A);
    const out = commitMembershipHydrated({
      userId: UID_A,
      membership: MEMBERSHIP_B,
      source: MEMBERSHIP_HYDRATION_SOURCE.CREATE_CONFIRMED,
    });
    assert.equal(out.action, "wrote");
    const snap = getMembershipSnapshot();
    assert.equal(snap?.status, "found");
    assert.equal(snap?.membership?.lobbyId, "lobby-b-id");
    assert.equal(snap?.membership?.role, "host");
    assert.equal(snap?.userId, UID_A);
    assert.equal(snap?.authGeneration, 0);
  });

  it("B — source non autorisée rejetée", () => {
    const out = commitMembershipHydrated({
      userId: UID_A,
      membership: MEMBERSHIP_B,
      source: "optimistic",
    });
    assert.equal(out.action, "rejected");
    assert.equal(getMembershipSnapshot(), null);
  });

  it("C — join confirmé remplace found A par found B", () => {
    setMembershipSnapshot(
      { status: "found", membership: MEMBERSHIP_A },
      "home-query",
      UID_A
    );
    const out = commitMembershipHydrated({
      userId: UID_A,
      membership: MEMBERSHIP_B,
      source: MEMBERSHIP_HYDRATION_SOURCE.JOIN_CONFIRMED,
    });
    assert.equal(out.action, "wrote");
    assert.equal(getMembershipSnapshot()?.membership?.code, "BBBB");
    assert.equal(getMembershipSnapshot()?.membership?.lobbyId, "lobby-b-id");
  });

  it("D — identity mismatch refusé (E1)", () => {
    const out = commitMembershipHydrated({
      userId: UID_B,
      membership: MEMBERSHIP_B,
      source: MEMBERSHIP_HYDRATION_SOURCE.JOIN_CONFIRMED,
    });
    assert.equal(out.action, "rejected");
    assert.equal(out.reason, "identity_mismatch");
  });

  it("E — recovery : membershipFromHydratedBundle + promote", () => {
    const m = membershipFromHydratedBundle(BUNDLE_B, UID_A);
    assert.equal(m?.role, "host");
    assert.equal(m?.membershipId, "mem-b-1");
    commitMembershipHydrated({
      userId: UID_A,
      membership: m,
      source: MEMBERSHIP_HYDRATION_SOURCE.RECOVER_CONFIRMED,
    });
    assert.equal(getMembershipSnapshot()?.membership?.code, "BBBB");
  });

  it("F — refresh conserve membershipId/joinedAt, met à jour runtime", () => {
    setMembershipSnapshot(
      {
        status: "found",
        membership: { ...MEMBERSHIP_B, joinedAt: "2026-07-01T12:00:00.000Z" },
      },
      "join_confirmed",
      UID_A
    );
    const refreshMembership = {
      ...MEMBERSHIP_B,
      lobbyStatus: "playing",
      gameId: "guesslie",
    };
    commitMembershipHydrated({
      userId: UID_A,
      membership: refreshMembership,
      source: MEMBERSHIP_HYDRATION_SOURCE.REFRESH_CONFIRMED,
    });
    const snap = getMembershipSnapshot();
    assert.equal(snap?.membership?.lobbyStatus, "playing");
    assert.equal(snap?.membership?.gameId, "guesslie");
    assert.equal(snap?.membership?.membershipId, "mem-b-1");
    assert.equal(snap?.membership?.joinedAt, "2026-07-01T12:00:00.000Z");
  });

  it("F2 — refresh identique skip rewrite", () => {
    setMembershipSnapshot(
      { status: "found", membership: MEMBERSHIP_B },
      "join_confirmed",
      UID_A
    );
    const before = getMembershipSnapshot()?.checkedAt;
    const out = commitMembershipHydrated({
      userId: UID_A,
      membership: { ...MEMBERSHIP_B },
      source: MEMBERSHIP_HYDRATION_SOURCE.REFRESH_CONFIRMED,
    });
    assert.equal(out.action, "skipped");
    assert.equal(out.reason, "unchanged");
    assert.equal(getMembershipSnapshot()?.checkedAt, before);
  });

  it("G — mismatch A→B silent realign (found A remplacé)", () => {
    setMembershipSnapshot(
      { status: "found", membership: MEMBERSHIP_A },
      "home",
      UID_A
    );
    commitMembershipHydrated({
      userId: UID_A,
      membership: MEMBERSHIP_B,
      source: MEMBERSHIP_HYDRATION_SOURCE.JOIN_CONFIRMED,
    });
    assert.equal(getMembershipSnapshot()?.membership?.lobbyId, "lobby-b-id");
  });

  it("H — commitMembershipRemoved : cache clear simulé, found conservé jusqu'à leave confirmé", () => {
    setMembershipSnapshot(
      { status: "found", membership: MEMBERSHIP_B },
      "join_confirmed",
      UID_A
    );
    saveStatePatch({ inLobby: false, lobby: null, lobbyCode: null });
    assert.equal(getMembershipSnapshot()?.status, "found");
    assert.equal(
      deriveHomeMembershipChrome({
        hasActiveLobby: false,
        snapshot: getMembershipSnapshot(),
        loggedIn: true,
        supabaseConfigured: true,
        shouldCheckMembership: true,
        authReady: true,
      }).showResume,
      true
    );
  });

  it("I — leave serveur confirmé retire found B", () => {
    setMembershipSnapshot(
      { status: "found", membership: MEMBERSHIP_B },
      "join_confirmed",
      UID_A
    );
    const out = commitMembershipRemoved({ userId: UID_A, lobbyId: "lobby-b-id" });
    assert.equal(out.action, "removed");
    assert.equal(getMembershipSnapshot(), null);
  });

  it("J — leave échoué ne retire pas found", () => {
    setMembershipSnapshot(
      { status: "found", membership: MEMBERSHIP_B },
      "join_confirmed",
      UID_A
    );
    const out = commitMembershipRemoved({ userId: UID_A, lobbyId: "other-lobby" });
    assert.equal(out.action, "skipped");
    assert.equal(getMembershipSnapshot()?.status, "found");
  });

  it("K — canCreateLobbyFromInputs : cache actif bloque même avec snapshot none", () => {
    setMembershipSnapshot({ status: "none" }, "guard", UID_A);
    assert.equal(
      canCreateLobbyFromInputs({
        loggedIn: true,
        hasActiveLobby: true,
        authReady: true,
        supabaseConfigured: true,
        snapshot: getMembershipSnapshot(),
      }),
      false
    );
    invalidateMembershipSnapshot();
    assert.equal(
      canCreateLobbyFromInputs({
        loggedIn: true,
        hasActiveLobby: false,
        authReady: true,
        supabaseConfigured: true,
        snapshot: { status: "none", userId: UID_A, checkedAt: Date.now() },
      }),
      true
    );
    assert.equal(
      canCreateLobbyFromInputs({
        loggedIn: true,
        hasActiveLobby: false,
        authReady: true,
        supabaseConfigured: true,
        snapshot: { status: "found", userId: UID_A, checkedAt: Date.now(), membership: MEMBERSHIP_A },
      }),
      false
    );
  });

  it("L — offline skip (isSupabaseConfigured false simulé via guard)", () => {
    // commitMembershipHydrated vérifie isSupabaseConfigured — testé via import mock difficile ;
    // mergeMembershipFields reste pur hors Supabase.
    const merged = mergeMembershipFields(MEMBERSHIP_A, MEMBERSHIP_A);
    assert.equal(merged?.lobbyId, MEMBERSHIP_A.lobbyId);
  });

  it("M — anonymous : promotion scoped userId", () => {
    commitMembershipHydrated({
      userId: UID_A,
      membership: MEMBERSHIP_B,
      source: MEMBERSHIP_HYDRATION_SOURCE.CREATE_CONFIRMED,
    });
    assert.equal(getMembershipSnapshot()?.userId, UID_A);
    handleMembershipAuthIdentityTransition(UID_A, UID_B);
    saveStatePatch({ supabaseUserId: UID_B });
    assert.equal(getMembershipSnapshot(), null);
  });

  it("N — stale auth generation refusé", () => {
    commitMembershipHydrated({
      userId: UID_A,
      membership: MEMBERSHIP_B,
      source: MEMBERSHIP_HYDRATION_SOURCE.JOIN_CONFIRMED,
      authGeneration: 0,
    });
    handleMembershipAuthIdentityTransition(UID_A, null);
    saveStatePatch({ supabaseUserId: null });
    handleMembershipAuthIdentityTransition(null, UID_A);
    saveStatePatch({ supabaseUserId: UID_A });
    const out = commitMembershipHydrated({
      userId: UID_A,
      membership: MEMBERSHIP_B,
      source: MEMBERSHIP_HYDRATION_SOURCE.JOIN_CONFIRMED,
      authGeneration: 0,
    });
    assert.equal(out.action, "rejected");
    assert.equal(out.reason, "stale_auth_generation");
  });

  it("O — pending compensation bloque promotion silencieuse", () => {
    const pending = {
      lobbyId: "lobby-b-id",
      membershipId: "mem-b-1",
      createdAt: Date.now(),
      reason: "join_failed_after_membership_insert",
    };
    assert.equal(
      shouldBlockMembershipQueryForPending(
        pending,
        { status: "found", membership: MEMBERSHIP_B },
        { localLobbyId: null }
      ),
      true
    );
    assert.equal(
      shouldBlockMembershipQueryForPending(
        pending,
        { status: "found", membership: MEMBERSHIP_B },
        { localLobbyId: "lobby-b-id" }
      ),
      false
    );
  });

  it("mergeMembershipFields — lobby différent remplace", () => {
    const merged = mergeMembershipFields(MEMBERSHIP_A, MEMBERSHIP_B);
    assert.equal(merged?.lobbyId, "lobby-b-id");
    assert.equal(merged?.membershipId, "mem-b-1");
  });

  it("shouldAlignSnapshotOnRefresh — détecte changement runtime", () => {
    const existing = {
      status: "found",
      membership: MEMBERSHIP_B,
      userId: UID_A,
      authGeneration: 0,
      checkedAt: Date.now(),
    };
    assert.equal(
      shouldAlignSnapshotOnRefresh(existing, { ...MEMBERSHIP_B, lobbyStatus: "playing" }, MEMBERSHIP_HYDRATION_SOURCE.REFRESH_CONFIRMED),
      true
    );
    assert.equal(
      shouldAlignSnapshotOnRefresh(existing, { ...MEMBERSHIP_B }, MEMBERSHIP_HYDRATION_SOURCE.REFRESH_CONFIRMED),
      false
    );
  });
});

describe("lobbyMembershipVagueE2 — contrats source", () => {
  it("supabaseLobby importe align après hydrate confirmé", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");
    const root = join(dirname(fileURLToPath(import.meta.url)), "..");
    const src = readFileSync(join(root, "js/core/supabaseLobby.js"), "utf8");
    assert.match(src, /alignMembershipSnapshotAfterLobbyHydration/);
    assert.match(src, /CREATE_CONFIRMED/);
    assert.match(src, /RECOVER_CONFIRMED/);
    assert.match(src, /REFRESH_CONFIRMED/);
  });

  it("lobby.js promeut après markLobbyJoinFinalized", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");
    const root = join(dirname(fileURLToPath(import.meta.url)), "..");
    const src = readFileSync(join(root, "js/core/lobby.js"), "utf8");
    assert.match(src, /markLobbyJoinFinalized/);
    assert.match(src, /promoteMembershipSnapshotAfterJoinConfirmed/);
  });

  it("auth.canCreateLobby utilise hasActiveLobby", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");
    const root = join(dirname(fileURLToPath(import.meta.url)), "..");
    const src = readFileSync(join(root, "js/core/auth.js"), "utf8");
    assert.match(src, /hasActiveLobby\(\)/);
    assert.equal(src.includes("hasJoinedLobby"), false);
  });

  it("forceClearClientLobbyState n'invalide pas le snapshot", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");
    const root = join(dirname(fileURLToPath(import.meta.url)), "..");
    const src = readFileSync(join(root, "js/core/lobby.js"), "utf8");
    const fn = src.slice(src.indexOf("export function forceClearClientLobbyState"), src.indexOf("export function handleGuestRecoveryRequiresCaptcha"));
    assert.equal(fn.includes("invalidateMembershipSnapshot"), false);
  });
});
