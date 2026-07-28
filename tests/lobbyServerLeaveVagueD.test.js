import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  LOBBY_SERVER_LEAVE_ERROR,
  makeLobbyServerLeaveError,
  validateServerLeaveInput,
  resolveServerLeaveAction,
  leaveLobbyMembershipFromServer,
  leaveServerActionLabel,
  SERVER_LEAVE_CONFIRM,
} from "../js/core/lobbyServerLeave.js";
import { deriveHomeMembershipChrome } from "../js/core/homeMembershipChrome.js";
import {
  decideMembershipSnapshotWrite,
  canCreateLobbyFromInputs,
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
import {
  createMountGuard,
  advanceMountGeneration,
  resetMountGenerationForTests,
} from "../js/core/mountLifecycle.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const MEMBER = {
  lobbyId: "L-member",
  code: "ABCD",
  role: "member",
};
const HOST = {
  lobbyId: "L-host",
  code: "HOST",
  role: "host",
};
const UID = "user-d-leave-1111-2222";

function makeDeps(overrides = {}) {
  const calls = {
    fetch: 0,
    delete: 0,
    close: 0,
  };
  const deps = {
    getUserId: () => "user-1",
    fetchLobbyHostId: async (lobbyId) => {
      calls.fetch += 1;
      return overrides.serverHostId !== undefined
        ? overrides.serverHostId
        : lobbyId === HOST.lobbyId
          ? "user-1"
          : "other-host";
    },
    deleteOwnMembership: async () => {
      calls.delete += 1;
      return overrides.deleteResult || { ok: true };
    },
    closeLobbyAsHost: async () => {
      calls.close += 1;
      return overrides.closeResult || { ok: true };
    },
    ...overrides.deps,
  };
  return { deps, calls };
}

describe("lobbyServerLeaveVagueD — API", () => {
  beforeEach(() => {
    invalidateMembershipSnapshot();
    resetMountGenerationForTests();
  });

  it("1 — membre server-only → suppression membership uniquement", async () => {
    const { deps, calls } = makeDeps();
    const res = await leaveLobbyMembershipFromServer(
      { ...MEMBER, hasActiveLobby: false },
      deps
    );
    assert.equal(res.ok, true);
    assert.equal(res.action, "left");
    assert.equal(res.lobbyId, MEMBER.lobbyId);
    assert.equal(calls.delete, 1);
    assert.equal(calls.close, 0);
  });

  it("2 — hôte server-only → primitive dissolution", async () => {
    const { deps, calls } = makeDeps();
    const res = await leaveLobbyMembershipFromServer(
      { ...HOST, hasActiveLobby: false },
      deps
    );
    assert.equal(res.ok, true);
    assert.equal(res.action, "dissolved");
    assert.equal(calls.close, 1);
    assert.equal(calls.delete, 0);
  });

  it("3 — membre ne déclenche pas dissolution", async () => {
    const { deps, calls } = makeDeps();
    await leaveLobbyMembershipFromServer({ ...MEMBER, hasActiveLobby: false }, deps);
    assert.equal(calls.close, 0);
    assert.equal(calls.delete, 1);
  });

  it("4 — hôte ne passe pas par leave membre", async () => {
    const { deps, calls } = makeDeps();
    await leaveLobbyMembershipFromServer({ ...HOST, hasActiveLobby: false }, deps);
    assert.equal(calls.delete, 0);
    assert.equal(calls.close, 1);
  });

  it("5 — rôle invalide → refus", async () => {
    const { deps, calls } = makeDeps();
    await assert.rejects(
      () =>
        leaveLobbyMembershipFromServer(
          { lobbyId: "L1", role: "admin", hasActiveLobby: false },
          deps
        ),
      (err) => err.code === LOBBY_SERVER_LEAVE_ERROR.INVALID_ROLE
    );
    assert.equal(calls.delete + calls.close, 0);
  });

  it("6 — auth absente → refus", async () => {
    const { deps, calls } = makeDeps({
      deps: { getUserId: () => null },
    });
    await assert.rejects(
      () =>
        leaveLobbyMembershipFromServer({ ...MEMBER, hasActiveLobby: false }, deps),
      (err) => err.code === LOBBY_SERVER_LEAVE_ERROR.AUTH_REQUIRED
    );
    assert.equal(calls.delete + calls.close, 0);
  });

  it("7 — lobbyId absent → refus", async () => {
    const { deps } = makeDeps();
    await assert.rejects(
      () =>
        leaveLobbyMembershipFromServer(
          { lobbyId: "", role: "member", hasActiveLobby: false },
          deps
        ),
      (err) => err.code === LOBBY_SERVER_LEAVE_ERROR.INVALID_MEMBERSHIP
    );
  });

  it("8 — cache actif → pipeline server-only refusé", async () => {
    const { deps, calls } = makeDeps();
    await assert.rejects(
      () =>
        leaveLobbyMembershipFromServer({ ...MEMBER, hasActiveLobby: true }, deps),
      (err) => err.code === LOBBY_SERVER_LEAVE_ERROR.CACHE_ACTIVE
    );
    assert.equal(calls.delete + calls.close, 0);
  });

  it("9 — confirmation annulée → zéro mutation (contrat confirm)", () => {
    // Home n'appelle leaveLobbyMembershipFromServer si confirm false —
    // documenté ici : API pure n'a pas de confirm ; zéro appel = zéro mutation.
    const { calls } = makeDeps();
    assert.equal(calls.delete + calls.close, 0);
    assert.ok(SERVER_LEAVE_CONFIRM.member.message);
    assert.ok(SERVER_LEAVE_CONFIRM.host.message);
  });

  it("10 — double clic / une seule mutation (flag inFlight simulé)", async () => {
    let inFlight = false;
    const { deps, calls } = makeDeps();
    async function guardedLeave() {
      if (inFlight) return null;
      inFlight = true;
      try {
        return await leaveLobbyMembershipFromServer(
          { ...MEMBER, hasActiveLobby: false },
          deps
        );
      } finally {
        inFlight = false;
      }
    }
    const [a, b] = await Promise.all([guardedLeave(), guardedLeave()]);
    const oks = [a, b].filter(Boolean);
    assert.equal(oks.length, 1);
    assert.equal(calls.delete, 1);
  });

  it("11 — erreur réseau leave → pas de succès", async () => {
    const { deps } = makeDeps({
      deleteResult: { ok: false, error: "network" },
    });
    await assert.rejects(
      () =>
        leaveLobbyMembershipFromServer({ ...MEMBER, hasActiveLobby: false }, deps),
      (err) => err.code === LOBBY_SERVER_LEAVE_ERROR.FAILED
    );
  });

  it("12 — erreur dissolution → pas de succès", async () => {
    const { deps } = makeDeps({
      closeResult: { ok: false, error: "rls" },
    });
    await assert.rejects(
      () =>
        leaveLobbyMembershipFromServer({ ...HOST, hasActiveLobby: false }, deps),
      (err) => err.code === LOBBY_SERVER_LEAVE_ERROR.DISSOLVE_FAILED
    );
  });

  it("13 — succès + query none → snapshot none / Créer possible", () => {
    resetMembershipSnapshotTestState(UID);
    setMembershipSnapshot(
      {
        status: "found",
        membership: {
          lobbyId: MEMBER.lobbyId,
          code: MEMBER.code,
          lobbyStatus: "waiting",
          gameId: null,
          role: "member",
        },
      },
      "src",
      UID
    );
    invalidateMembershipSnapshot();
    setMembershipSnapshot({ status: "none" }, "confirm", UID);
    assert.equal(getMembershipSnapshot()?.status, "none");
    assert.equal(
      canCreateLobbyFromInputs({
        loggedIn: true,
        hasActiveLobby: false,
        authReady: true,
        supabaseConfigured: true,
        snapshot: getMembershipSnapshot(),
      }),
      true
    );
  });

  it("14 — succès + query found → nouvelle membership affichée", () => {
    resetMembershipSnapshotTestState(UID);
    invalidateMembershipSnapshot();
    const next = {
      status: "found",
      membership: {
        lobbyId: "L2",
        code: "NEXT",
        lobbyStatus: "waiting",
        gameId: null,
        role: "member",
      },
      extraCount: 0,
    };
    setMembershipSnapshot(next, "confirm", UID);
    const chrome = deriveHomeMembershipChrome({
      hasActiveLobby: false,
      snapshot: getMembershipSnapshot(),
      authReady: true,
      supabaseConfigured: true,
      loggedIn: true,
      shouldCheckMembership: true,
    });
    assert.equal(chrome.membershipCode, "NEXT");
    assert.equal(chrome.createEnabled, false);
  });

  it("15 — succès + query unknown → Créer disabled + leave_confirmation_pending", () => {
    const chrome = deriveHomeMembershipChrome({
      hasActiveLobby: false,
      snapshot: { status: "unknown" },
      leaveConfirmationPending: true,
      authReady: true,
      supabaseConfigured: true,
      loggedIn: true,
      shouldCheckMembership: true,
    });
    assert.equal(chrome.state, "leave_confirmation_pending");
    assert.equal(chrome.createEnabled, false);
    assert.equal(chrome.showRetry, true);
  });

  it("16 — rôle obsolète → ROLE_MISMATCH", async () => {
    const { deps, calls } = makeDeps({
      // Intention member mais serveur dit hôte
      serverHostId: "user-1",
    });
    await assert.rejects(
      () =>
        leaveLobbyMembershipFromServer({ ...MEMBER, hasActiveLobby: false }, deps),
      (err) => err.code === LOBBY_SERVER_LEAVE_ERROR.ROLE_MISMATCH
    );
    assert.equal(calls.delete + calls.close, 0);
  });

  it("17 — aucun faux none après mutation non confirmée", () => {
    const decision = decideMembershipSnapshotWrite(
      null,
      { status: "unknown" },
      "confirm",
      sameIdentity(UID)
    );
    assert.equal(decision.action, "write");
    assert.notEqual(decision.result.status, "none");
    const chrome = deriveHomeMembershipChrome({
      hasActiveLobby: false,
      snapshot: { status: "unknown" },
      leaveConfirmationPending: true,
      loggedIn: true,
      supabaseConfigured: true,
      shouldCheckMembership: true,
      authReady: true,
    });
    assert.notEqual(chrome.state, "none");
    assert.equal(chrome.createEnabled, false);
  });

  it("18 — Reprendre n'appelle pas leave (source Home)", () => {
    const home = readFileSync(join(ROOT, "js/screens/home.js"), "utf8");
    const resumeBlock = home.slice(
      home.indexOf('if (e.target.closest("#btn-resume-evening"))'),
      home.indexOf('if (e.target.closest("#btn-membership-retry"))')
    );
    assert.equal(resumeBlock.includes("leaveLobbyMembershipFromServer"), false);
    assert.equal(resumeBlock.includes("deleteOwnMembership"), false);
  });

  it("19 — bouton membre libellé Quitter le lobby", () => {
    assert.equal(leaveServerActionLabel("member"), "Quitter le lobby");
    const chrome = deriveHomeMembershipChrome({
      hasActiveLobby: false,
      snapshot: {
        status: "found",
        membership: {
          lobbyId: "L1",
          code: "ABCD",
          lobbyStatus: "waiting",
          gameId: null,
          role: "member",
        },
      },
      authReady: true,
      supabaseConfigured: true,
      loggedIn: true,
      shouldCheckMembership: true,
    });
    assert.equal(chrome.leaveServerLabel, "Quitter le lobby");
  });

  it("20 — bouton hôte libellé Fermer le lobby", () => {
    assert.equal(leaveServerActionLabel("host"), "Fermer le lobby");
    const chrome = deriveHomeMembershipChrome({
      hasActiveLobby: false,
      snapshot: {
        status: "found",
        membership: {
          lobbyId: "L1",
          code: "HOST",
          lobbyStatus: "waiting",
          gameId: null,
          role: "host",
        },
      },
      authReady: true,
      supabaseConfigured: true,
      loggedIn: true,
      shouldCheckMembership: true,
    });
    assert.equal(chrome.leaveServerLabel, "Fermer le lobby");
  });

  it("21 — ancien bouton bientôt absent", () => {
    const home = readFileSync(join(ROOT, "js/screens/home.js"), "utf8");
    assert.equal(home.includes("Quitter / Fermer (bientôt)"), false);
    assert.equal(home.includes("arrive bientôt (Vague D)"), false);
  });

  it("22 — handler inactif après unmount (mount guard)", async () => {
    advanceMountGeneration();
    const mount = createMountGuard();
    const shouldContinue = () => mount.isMounted() && mount.isCurrentMount();
    let uiApplied = false;
    mount.dispose();
    if (shouldContinue()) uiApplied = true;
    assert.equal(uiApplied, false);
  });

  it("23 — retry possible après échec (flag libéré)", async () => {
    let inFlight = false;
    const { deps, calls } = makeDeps({
      deleteResult: { ok: false, error: "fail" },
    });
    async function attempt() {
      if (inFlight) return "blocked";
      inFlight = true;
      try {
        await leaveLobbyMembershipFromServer(
          { ...MEMBER, hasActiveLobby: false },
          deps
        );
        return "ok";
      } catch {
        return "err";
      } finally {
        inFlight = false;
      }
    }
    assert.equal(await attempt(), "err");
    // Second attempt with ok delete
    deps.deleteOwnMembership = async () => {
      calls.delete += 1;
      return { ok: true };
    };
    assert.equal(await attempt(), "ok");
    assert.ok(calls.delete >= 1);
  });

  it("24 — membership multiple → passage à la suivante (found post-leave)", () => {
    // Après leave de L1, query peut renvoyer L2 (extraCount) — found, pas none.
    const chrome = deriveHomeMembershipChrome({
      hasActiveLobby: false,
      snapshot: {
        status: "found",
        membership: {
          lobbyId: "L2",
          code: "NEXT",
          lobbyStatus: "waiting",
          gameId: null,
          role: "host",
        },
        extraCount: 0,
      },
      authReady: true,
      supabaseConfigured: true,
      loggedIn: true,
      shouldCheckMembership: true,
    });
    assert.equal(chrome.membershipCode, "NEXT");
    assert.equal(chrome.createEnabled, false);
  });

  it("25 — flow cache-actif leaveLobby inchangé (source)", () => {
    const lobby = readFileSync(join(ROOT, "js/core/lobby.js"), "utf8");
    assert.match(lobby, /export async function leaveLobby\(/);
    assert.match(lobby, /export async function dissolveLobbyAsHost\(/);
    assert.match(lobby, /export async function confirmAndLeaveLobby\(/);
    assert.match(
      lobby,
      /export async function leaveLobbyMembershipFromServer\(/
    );
    // Pipelines séparés
    const leaveIdx = lobby.indexOf("export async function leaveLobby(");
    const serverIdx = lobby.indexOf(
      "export async function leaveLobbyMembershipFromServer("
    );
    assert.ok(leaveIdx > 0 && serverIdx > leaveIdx);
  });

  it("26 — createLobby C inchangé (assertCanInsertLobby toujours présent)", () => {
    const lobby = readFileSync(join(ROOT, "js/core/lobby.js"), "utf8");
    assert.match(lobby, /assertCanInsertLobby/);
    assert.match(lobby, /queryActiveLobbyMembership/);
  });

  it("27 — offline inchangé (canCreateLobbyFromInputs sans supabase)", () => {
    assert.equal(
      canCreateLobbyFromInputs({
        loggedIn: true,
        hasActiveLobby: false,
        authReady: true,
        supabaseConfigured: false,
        snapshot: null,
      }),
      true
    );
  });

  it("28 — aucune navigation automatique après leave server-only (source)", () => {
    const home = readFileSync(join(ROOT, "js/screens/home.js"), "utf8");
    const block = home.slice(
      home.indexOf('if (e.target.closest("#btn-leave-lobby-server"))'),
      home.indexOf('if (e.target.closest("#btn-leave-lobby"))')
    );
    assert.equal(block.includes('navigate("'), false);
    assert.equal(block.includes("navigate("), false);
  });

  it("29 — Créer actif uniquement après none confirmé", () => {
    assert.equal(
      canCreateLobbyFromInputs({
        loggedIn: true,
        hasActiveLobby: false,
        authReady: true,
        supabaseConfigured: true,
        snapshot: {
          status: "found",
          userId: UID,
          membership: {
            lobbyId: "L1",
            code: "X",
            role: "member",
            lobbyStatus: null,
            gameId: null,
          },
          checkedAt: Date.now(),
        },
      }),
      false
    );
    assert.equal(
      canCreateLobbyFromInputs({
        loggedIn: true,
        hasActiveLobby: false,
        authReady: true,
        supabaseConfigured: true,
        snapshot: { status: "none", userId: UID, checkedAt: Date.now() },
      }),
      true
    );
  });

  it("30 — query de confirmation systématique après succès (source Home)", () => {
    const home = readFileSync(join(ROOT, "js/screens/home.js"), "utf8");
    const block = home.slice(
      home.indexOf('if (e.target.closest("#btn-leave-lobby-server"))'),
      home.indexOf('if (e.target.closest("#btn-leave-lobby"))')
    );
    assert.match(block, /leaveLobbyMembershipFromServer/);
    assert.match(block, /commitMembershipRemoved/);
    assert.match(block, /queryActiveLobbyMembership/);
  });
});

describe("lobbyServerLeaveVagueD — QA source", () => {
  it("flow membre ne lit pas lobbyId depuis getState().lobby", () => {
    const mod = readFileSync(join(ROOT, "js/core/lobbyServerLeave.js"), "utf8");
    assert.equal(mod.includes("getState()"), false);
    assert.equal(mod.includes("getState().lobby"), false);
    const sb = readFileSync(join(ROOT, "js/core/supabaseLobby.js"), "utf8");
    assert.match(sb, /export async function deleteOwnLobbyMembershipById/);
    const start = sb.indexOf("export async function deleteOwnLobbyMembershipById");
    const end = sb.indexOf("export async function closeLobbyByIdAsHost", start);
    assert.ok(start >= 0 && end > start);
    const fn = sb.slice(start, end);
    assert.equal(fn.includes("getState()"), false);
    assert.equal(fn.includes("getState().lobby"), false);
  });

  it("flow hôte ne dépend pas de state.lobby.hostId", () => {
    const sb = readFileSync(join(ROOT, "js/core/supabaseLobby.js"), "utf8");
    const fn = sb.slice(
      sb.indexOf("export async function closeLobbyByIdAsHost"),
      sb.indexOf("export async function closeLobbySupabase")
    );
    assert.equal(fn.includes("getState()"), false);
    assert.equal(fn.includes("lobby?.hostId"), false);
    assert.match(fn, /dissolve_lobby_atomically/);
    assert.equal(fn.includes("deleteGameSession"), false);
    assert.equal(fn.includes("from(\"lobbies\").delete"), false);
  });

  it("leave server-only n'appelle pas forceClearClientLobbyState", () => {
    const home = readFileSync(join(ROOT, "js/screens/home.js"), "utf8");
    const block = home.slice(
      home.indexOf('if (e.target.closest("#btn-leave-lobby-server"))'),
      home.indexOf('if (e.target.closest("#btn-leave-lobby"))')
    );
    assert.equal(block.includes("forceClearClientLobbyState"), false);
    const leave = readFileSync(join(ROOT, "js/core/lobbyServerLeave.js"), "utf8");
    assert.equal(leave.includes("forceClearClientLobbyState"), false);
  });

  it("validate + resolveServerLeaveAction purs", () => {
    assert.equal(
      validateServerLeaveInput({
        lobbyId: "L",
        role: "member",
        userId: "u",
      }).ok,
      true
    );
    assert.equal(
      resolveServerLeaveAction({
        intendedRole: "host",
        serverHostId: "u",
        userId: "u",
      }).action,
      "dissolved"
    );
    assert.equal(
      resolveServerLeaveAction({
        intendedRole: "member",
        serverHostId: "other",
        userId: "u",
      }).action,
      "left"
    );
  });

  it("makeLobbyServerLeaveError code testable", () => {
    const err = makeLobbyServerLeaveError(
      LOBBY_SERVER_LEAVE_ERROR.FAILED,
      "x"
    );
    assert.equal(err.code, LOBBY_SERVER_LEAVE_ERROR.FAILED);
    assert.equal(err.name, "LobbyServerLeaveError");
  });
});

describe("lobbyServerLeaveVagueD — concurrence documentée", () => {
  it("DELETE OK puis autre membership avant confirm → found pas none", () => {
    resetMembershipSnapshotTestState(UID);
    invalidateMembershipSnapshot();
    setMembershipSnapshot(
      {
        status: "found",
        membership: {
          lobbyId: "L-new",
          code: "NEW1",
          lobbyStatus: "waiting",
          gameId: null,
          role: "member",
        },
      },
      "confirm-after-race",
      UID
    );
    assert.equal(getMembershipSnapshot()?.status, "found");
    assert.notEqual(getMembershipSnapshot()?.status, "none");
  });
});
