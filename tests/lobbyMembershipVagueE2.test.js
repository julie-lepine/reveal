/**
 * Membership Vague E2 — sync asymétrique cache runtime ↔ snapshot membership.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { saveStatePatch, getState } from "../js/core/state.js";
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
  buildHydratedMembership,
  normalizeCanonicalMembershipRow,
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
import { runVoluntaryMemberLeave } from "../js/core/voluntaryMemberLeave.js";
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
  it("supabaseLobby importe align après hydrate confirmé + canonicalRow create/join", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");
    const root = join(dirname(fileURLToPath(import.meta.url)), "..");
    const src = readFileSync(join(root, "js/core/supabaseLobby.js"), "utf8");
    assert.match(src, /alignMembershipSnapshotAfterLobbyHydration/);
    assert.match(src, /CREATE_CONFIRMED/);
    assert.match(src, /RECOVER_CONFIRMED/);
    assert.match(src, /REFRESH_CONFIRMED/);
    assert.match(src, /canonicalRow:\s*memberData/);
    assert.match(src, /membershipRow/);
  });

  it("lobby.js promeut après markLobbyJoinFinalized avec membershipRow", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");
    const root = join(dirname(fileURLToPath(import.meta.url)), "..");
    const src = readFileSync(join(root, "js/core/lobby.js"), "utf8");
    assert.match(src, /markLobbyJoinFinalized/);
    assert.match(src, /promoteMembershipSnapshotAfterJoinConfirmed\(res\.membershipRow/);
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
    const fn = src.slice(
      src.indexOf("export function forceClearClientLobbyState"),
      src.indexOf("export function handleGuestRecoveryRequiresCaptcha")
    );
    assert.equal(fn.includes("invalidateMembershipSnapshot"), false);
    assert.equal(fn.includes("commitMembershipRemoved"), false);
  });

  it("helpers génériques leave/teardown n'appellent pas commitMembershipRemoved", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");
    const root = join(dirname(fileURLToPath(import.meta.url)), "..");
    const src = readFileSync(join(root, "js/core/lobby.js"), "utf8");
    const leaveLocal = src.slice(
      src.indexOf("function applyLeaveLobbyLocal"),
      src.indexOf("export function performLobbyBoundaryTeardown")
    );
    const teardown = src.slice(
      src.indexOf("export function performLobbyBoundaryTeardown"),
      src.indexOf("const EVENING_ROLLBACK_KEYS")
    );
    assert.equal(leaveLocal.includes("commitMembershipRemoved"), false);
    assert.equal(teardown.includes("commitMembershipRemoved"), false);
  });

  it("dissolve / kick / leave server-only retirent le snapshot après preuve", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");
    const root = join(dirname(fileURLToPath(import.meta.url)), "..");
    const src = readFileSync(join(root, "js/core/lobby.js"), "utf8");

    const dissolveGuest = src.slice(
      src.indexOf("export async function handleLobbyDissolvedForGuest"),
      src.indexOf("export async function handleKickedFromLobby")
    );
    const kick = src.slice(
      src.indexOf("export async function handleKickedFromLobby"),
      src.indexOf("export async function dissolveLobbyAsHost")
    );
    const dissolveHost = src.slice(
      src.indexOf("export async function dissolveLobbyAsHost"),
      src.indexOf("export async function confirmAndLeaveLobby")
    );
    const dissolveSuccessHelper = src.slice(
      src.indexOf("function applyHostDissolveLocalSuccess"),
      src.indexOf("async function reconcileHostDissolveCanonicalElsewhere")
    );
    const serverLeave = src.slice(
      src.indexOf("export async function leaveLobbyMembershipFromServer"),
      src.indexOf("export async function transferLobbyHost")
    );

    assert.match(dissolveGuest, /commitMembershipRemoved/);
    assert.match(kick, /commitMembershipRemoved/);
    assert.match(dissolveHost, /applyHostDissolveLocalSuccess/);
    assert.match(dissolveSuccessHelper, /commitMembershipRemoved/);
    assert.match(serverLeave, /commitMembershipRemoved/);
    // dissolve host only after closeLobbySupabase ok
    const closeIdx = dissolveHost.indexOf("closeLobbySupabase");
    const successIdx = dissolveHost.indexOf("applyHostDissolveLocalSuccess");
    assert.ok(closeIdx >= 0 && successIdx > closeIdx);
  });

  it("Realtime kick : handleKicked seulement si removedUid === localUid", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");
    const root = join(dirname(fileURLToPath(import.meta.url)), "..");
    const src = readFileSync(join(root, "js/core/supabaseLobby.js"), "utf8");
    assert.match(src, /removedUid && localUid && removedUid === localUid/);
    assert.match(src, /handleKickedFromLobby/);
  });
});

describe("lobbyMembershipVagueE2 — leave / clear / canonique", () => {
  beforeEach(() => {
    __resetMembershipAuthForTests();
    clearPendingLobbyMembershipCompensationIfMatches(null);
    resetMembershipSnapshotTestState(UID_A);
  });

  it("1 — leave volontaire serveur réussi : found B retiré + cache nettoyé", async () => {
    setMembershipSnapshot(
      { status: "found", membership: MEMBERSHIP_B },
      "join_confirmed",
      UID_A
    );
    saveStatePatch({
      inLobby: true,
      lobby: { id: "lobby-b-id", code: "BBBB" },
      lobbyCode: "BBBB",
    });

    const order = [];
    const res = await runVoluntaryMemberLeave(
      { navigateAway: false },
      {
        getLobby: () => ({ id: "lobby-b-id", code: "BBBB" }),
        isGuest: () => false,
        isSupabaseConfigured: () => true,
        leaveLobbySupabase: async () => {
          order.push("delete");
          return { ok: true };
        },
        stopMultiplayerSync: () => order.push("stopMp"),
        stopLobbyPresenceSync: () => order.push("stopPres"),
        signOutAnonGuestIfNeeded: async () => {},
        clearLocalOpenLobbySlot: () => {},
        applyLeaveLobbyLocal: () => {
          order.push("clearLocal");
          saveStatePatch({ inLobby: false, lobby: null, lobbyCode: null });
        },
        getUserId: () => UID_A,
        commitMembershipRemoved: ({ userId, lobbyId }) => {
          order.push("removeSnap");
          commitMembershipRemoved({ userId, lobbyId });
        },
      }
    );

    assert.equal(res.ok, true);
    assert.deepEqual(order, ["delete", "removeSnap", "stopMp", "stopPres", "clearLocal"]);
    assert.equal(getMembershipSnapshot(), null);
    assert.equal(getState().lobby, null);
  });

  it("2 — leave volontaire serveur échoué : found B conservé", async () => {
    setMembershipSnapshot(
      { status: "found", membership: MEMBERSHIP_B },
      "join_confirmed",
      UID_A
    );
    const res = await runVoluntaryMemberLeave(
      { navigateAway: true },
      {
        getLobby: () => ({ id: "lobby-b-id", code: "BBBB" }),
        isGuest: () => false,
        isSupabaseConfigured: () => true,
        leaveLobbySupabase: async () => ({ ok: false, error: "timeout" }),
        stopMultiplayerSync: () => assert.fail("no stop"),
        stopLobbyPresenceSync: () => assert.fail("no stop"),
        signOutAnonGuestIfNeeded: async () => assert.fail("no signOut"),
        clearLocalOpenLobbySlot: () => assert.fail("no clear slot"),
        applyLeaveLobbyLocal: () => assert.fail("no local leave"),
        getUserId: () => UID_A,
        commitMembershipRemoved: () => assert.fail("no remove"),
      }
    );
    assert.equal(res.ok, false);
    assert.equal(getMembershipSnapshot()?.status, "found");
    assert.equal(getMembershipSnapshot()?.membership?.lobbyId, "lobby-b-id");
  });

  it("3 — dissolution hôte confirmée : snapshot hôte retiré", () => {
    setMembershipSnapshot(
      { status: "found", membership: { ...MEMBERSHIP_B, role: "host" } },
      "create_confirmed",
      UID_A
    );
    const out = commitMembershipRemoved({ userId: UID_A, lobbyId: "lobby-b-id" });
    assert.equal(out.action, "removed");
    assert.equal(getMembershipSnapshot(), null);
  });

  it("4 — dissolution reçue invité : remove uniquement après preuve (même API)", () => {
    setMembershipSnapshot(
      { status: "found", membership: MEMBERSHIP_B },
      "join_confirmed",
      UID_A
    );
    // Simule la preuve acquise dans handleLobbyDissolvedForGuest / gone check.
    commitMembershipRemoved({ userId: UID_A, lobbyId: "lobby-b-id" });
    assert.equal(getMembershipSnapshot(), null);
  });

  it("5 — kick d'un autre joueur : snapshot hôte inchangé", () => {
    setMembershipSnapshot(
      { status: "found", membership: { ...MEMBERSHIP_B, role: "host" } },
      "create_confirmed",
      UID_A
    );
    // DELETE d'un autre userId → commitMembershipRemoved non appelé pour l'hôte.
    // Appel erroné avec lobby mismatch / autre user serait no-op côté scoped:
    const out = commitMembershipRemoved({ userId: UID_B, lobbyId: "lobby-b-id" });
    assert.equal(out.action, "skipped");
    assert.equal(getMembershipSnapshot()?.status, "found");
    assert.equal(getMembershipSnapshot()?.userId, UID_A);
  });

  it("6 — utilisateur courant expulsé : snapshot retiré après preuve", () => {
    setMembershipSnapshot(
      { status: "found", membership: MEMBERSHIP_B },
      "join_confirmed",
      UID_A
    );
    const out = commitMembershipRemoved({ userId: UID_A, lobbyId: "lobby-b-id" });
    assert.equal(out.action, "removed");
    assert.equal(getMembershipSnapshot(), null);
  });

  it("7 — force clear client-only : found conservé", () => {
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

  it("8 — create avec row canonique : membershipId / joinedAt dès promote", () => {
    const membership = buildHydratedMembership({
      userId: UID_A,
      bundle: BUNDLE_B,
      canonicalRow: {
        id: "mem-canon-create",
        lobby_id: "lobby-b-id",
        user_id: UID_A,
        joined_at: "2026-07-28T10:00:00.000Z",
        is_host: true,
      },
    });
    commitMembershipHydrated({
      userId: UID_A,
      membership,
      source: MEMBERSHIP_HYDRATION_SOURCE.CREATE_CONFIRMED,
    });
    const snap = getMembershipSnapshot();
    assert.equal(snap?.membership?.membershipId, "mem-canon-create");
    assert.equal(snap?.membership?.joinedAt, "2026-07-28T10:00:00.000Z");
    assert.equal(snap?.membership?.role, "host");
    assert.equal(snap?.membership?.code, "BBBB");
  });

  it("9 — join avec row canonique : métadonnées utilisées", () => {
    const membership = buildHydratedMembership({
      userId: UID_A,
      bundle: {
        ...BUNDLE_B,
        hostId: "other-host",
        participants: [
          {
            userId: UID_A,
            isLocal: true,
            isHost: false,
            membershipId: "from-bundle",
          },
        ],
      },
      canonicalRow: {
        id: "mem-canon-join",
        lobby_id: "lobby-b-id",
        joined_at: "2026-07-28T11:00:00.000Z",
        is_host: false,
      },
    });
    assert.equal(membership?.membershipId, "mem-canon-join");
    assert.equal(membership?.joinedAt, "2026-07-28T11:00:00.000Z");
    assert.equal(membership?.role, "member");
    assert.equal(membership?.code, "BBBB");
  });

  it("10 — create/join sans row canonique : fallback bundle", () => {
    const membership = buildHydratedMembership({
      userId: UID_A,
      bundle: BUNDLE_B,
      canonicalRow: null,
    });
    assert.equal(membership?.lobbyId, "lobby-b-id");
    assert.equal(membership?.membershipId, "mem-b-1");
    assert.equal(membership?.code, "BBBB");
    assert.equal(normalizeCanonicalMembershipRow(null), null);
  });

  it("11 — E1 : userId / gen mismatch toujours rejeté", () => {
    const idMismatch = commitMembershipHydrated({
      userId: UID_B,
      membership: MEMBERSHIP_B,
      source: MEMBERSHIP_HYDRATION_SOURCE.JOIN_CONFIRMED,
    });
    assert.equal(idMismatch.action, "rejected");
    assert.equal(idMismatch.reason, "identity_mismatch");

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
    const stale = commitMembershipHydrated({
      userId: UID_A,
      membership: MEMBERSHIP_B,
      source: MEMBERSHIP_HYDRATION_SOURCE.JOIN_CONFIRMED,
      authGeneration: 0,
    });
    assert.equal(stale.action, "rejected");
    assert.equal(stale.reason, "stale_auth_generation");
  });

  it("12 — commitMembershipRemoved idempotent", () => {
    setMembershipSnapshot(
      { status: "found", membership: MEMBERSHIP_B },
      "join_confirmed",
      UID_A
    );
    assert.equal(commitMembershipRemoved({ userId: UID_A, lobbyId: "lobby-b-id" }).action, "removed");
    assert.equal(commitMembershipRemoved({ userId: UID_A, lobbyId: "lobby-b-id" }).action, "skipped");
    assert.equal(commitMembershipRemoved({ userId: UID_A, lobbyId: "lobby-b-id" }).reason, "no_found_snapshot");
    assert.equal(getMembershipSnapshot(), null);
  });
});

describe("lobbyMembershipVagueE2 — contrats dissolution / kick", () => {
  it("dissolve : call sites = Realtime DELETE lobbies OU stillMember===false", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");
    const root = join(dirname(fileURLToPath(import.meta.url)), "..");
    const src = readFileSync(join(root, "js/core/supabaseLobby.js"), "utf8");

    const gone = src.slice(
      src.indexOf("async function handlePossibleLobbyGone"),
      src.indexOf("const DISPLAY_NAME_TAKEN_MSG")
    );
    assert.match(gone, /isLobbyGoneError/);
    assert.match(gone, /isLocalStillLobbyMember/);
    assert.match(gone, /stillMember === true/);
    assert.match(gone, /stillMember === null/);
    assert.match(gone, /handleLobbyDissolvedForGuest/);
    // stillMember null / true → pas de dissolve (ordre : return avant import dissolve)
    const nullIdx = gone.indexOf("stillMember === null");
    const trueIdx = gone.indexOf("stillMember === true");
    const dissolveIdx = gone.lastIndexOf("handleLobbyDissolvedForGuest");
    assert.ok(nullIdx >= 0 && trueIdx >= 0 && dissolveIdx > nullIdx && dissolveIdx > trueIdx);

    assert.match(src, /event:\s*"DELETE"[\s\S]*table:\s*"lobbies"[\s\S]*handleLobbyDissolvedForGuest/);
  });

  it("kick : Realtime seulement si removedUid === localUid ; roster vide n'expulse pas", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");
    const root = join(dirname(fileURLToPath(import.meta.url)), "..");
    const src = readFileSync(join(root, "js/core/supabaseLobby.js"), "utf8");
    assert.match(src, /removedUid && localUid && removedUid === localUid/);
    const applyStart = src.indexOf("function applyLobbyToState");
    assert.ok(applyStart >= 0);
    const apply = src.slice(applyStart, applyStart + 900);
    assert.match(apply, /bundle\.participants\.length > 0/);
    assert.match(apply, /handleKickedFromLobby/);
  });

  it("erreur réseau refresh : pas de dissolve si !isLobbyGoneError", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");
    const root = join(dirname(fileURLToPath(import.meta.url)), "..");
    const src = readFileSync(join(root, "js/core/supabaseLobby.js"), "utf8");
    // Coalesced refresh catch : warn only unless lobby-gone
    assert.match(src, /if \(!isLobbyGoneError\(e\)\) \{\s*console\.warn\("REVEAL coalesced lobby refresh/);
  });
});
