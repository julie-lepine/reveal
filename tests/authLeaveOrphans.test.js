/**
 * AUTH leave orphans - contrat leave serveur + finalize guest + source wiring.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  LOBBY_LEAVE_ERROR,
  interpretMembershipDeleteProof,
  validateLeaveLobbySupabaseIdentity,
  lobbyLeaveUserMessage,
} from "../js/core/lobbyLeaveContract.js";
import { deleteOwnLobbyMembershipByIdWithDeps } from "../js/core/lobbyMembershipDelete.js";
import { finalizeGuestAfterAuthoritativeLeave } from "../js/core/finalizeGuestLeave.js";
import {
  runVoluntaryMemberLeave,
  resetVoluntaryLeaveLockForTests,
} from "../js/core/voluntaryMemberLeave.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

function read(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

describe("AUTH-LEAVE-SILENT-OK-01 - identité leaveLobbySupabase", () => {
  it("lobby ID absent → ok:false + code stable", () => {
    const r = validateLeaveLobbySupabaseIdentity(null, "u-1");
    assert.equal(r.ok, false);
    assert.equal(r.code, LOBBY_LEAVE_ERROR.MISSING_LOBBY_ID);
    assert.ok(r.error);
  });

  it("user ID absent → ok:false + code stable", () => {
    const r = validateLeaveLobbySupabaseIdentity("lobby-1", "");
    assert.equal(r.ok, false);
    assert.equal(r.code, LOBBY_LEAVE_ERROR.MISSING_USER_ID);
  });

  it("les deux absents → MISSING_IDENTITY", () => {
    const r = validateLeaveLobbySupabaseIdentity(null, null);
    assert.equal(r.ok, false);
    assert.equal(r.code, LOBBY_LEAVE_ERROR.MISSING_IDENTITY);
  });

  it("identité valide", () => {
    const r = validateLeaveLobbySupabaseIdentity("lobby-1", "u-1");
    assert.equal(r.ok, true);
    assert.equal(r.lobbyId, "lobby-1");
    assert.equal(r.userId, "u-1");
  });

  it("source leaveLobbySupabase : jamais ok:true si identité manquante", () => {
    const src = read("js/core/supabaseLobby.js");
    const start = src.indexOf("export async function leaveLobbySupabase");
    const end = src.indexOf("export async function setLocalReadySupabase", start);
    const fn = src.slice(start, end);
    assert.match(fn, /validateLeaveLobbySupabaseIdentity/);
    assert.equal(fn.includes("return { ok: true }"), false);
    assert.equal(/if\s*\(\s*!lobbyId\s*\|\|\s*!userId\s*\)\s*return\s*\{\s*ok:\s*true/.test(fn), false);
  });
});

describe("AUTH-LEAVE-SILENT-OK-01 - preuve DELETE", () => {
  it("rows deleted → ok deleted", () => {
    const r = interpretMembershipDeleteProof({ deletedRows: [{ id: "m1" }] });
    assert.equal(r.ok, true);
    assert.equal(r.deleted, true);
    assert.equal(r.membershipAbsent, false);
  });

  it("0 rows + absent → succès idempotent", () => {
    const r = interpretMembershipDeleteProof({
      deletedRows: [],
      verifyStatus: "absent",
    });
    assert.equal(r.ok, true);
    assert.equal(r.membershipAbsent, true);
    assert.equal(r.deleted, false);
  });

  it("0 rows + present → !ok STILL_PRESENT", () => {
    const r = interpretMembershipDeleteProof({
      deletedRows: [],
      verifyStatus: "present",
    });
    assert.equal(r.ok, false);
    assert.equal(r.code, LOBBY_LEAVE_ERROR.STILL_PRESENT);
  });

  it("0 rows + unknown → !ok VERIFY_FAILED", () => {
    const r = interpretMembershipDeleteProof({
      deletedRows: [],
      verifyStatus: "unknown",
    });
    assert.equal(r.ok, false);
    assert.equal(r.code, LOBBY_LEAVE_ERROR.VERIFY_FAILED);
  });

  it("delete deps : lobby/user manquants → pas de DELETE", async () => {
    let deletes = 0;
    const r = await deleteOwnLobbyMembershipByIdWithDeps("", {
      getUserId: () => "u-1",
      deleteAndReturnRows: async () => {
        deletes += 1;
        return { ok: true, rows: [] };
      },
      verifyMembershipAbsent: async () => ({ status: "absent" }),
    });
    assert.equal(r.ok, false);
    assert.equal(r.code, LOBBY_LEAVE_ERROR.MISSING_LOBBY_ID);
    assert.equal(deletes, 0);
  });

  it("delete deps : user manquant → pas de DELETE", async () => {
    let deletes = 0;
    const r = await deleteOwnLobbyMembershipByIdWithDeps("lobby-1", {
      getUserId: () => null,
      deleteAndReturnRows: async () => {
        deletes += 1;
        return { ok: true, rows: [] };
      },
      verifyMembershipAbsent: async () => ({ status: "absent" }),
    });
    assert.equal(r.ok, false);
    assert.equal(r.code, LOBBY_LEAVE_ERROR.MISSING_USER_ID);
    assert.equal(deletes, 0);
  });

  it("delete deps : rows renvoyées → ok sans verify", async () => {
    let verifies = 0;
    const r = await deleteOwnLobbyMembershipByIdWithDeps("lobby-1", {
      getUserId: () => "u-1",
      deleteAndReturnRows: async () => ({ ok: true, rows: [{ id: "m1" }] }),
      verifyMembershipAbsent: async () => {
        verifies += 1;
        return { status: "absent" };
      },
    });
    assert.equal(r.ok, true);
    assert.equal(r.deleted, true);
    assert.equal(verifies, 0);
  });

  it("delete deps : 0 rows + absent → idempotent", async () => {
    const r = await deleteOwnLobbyMembershipByIdWithDeps("lobby-1", {
      getUserId: () => "u-1",
      deleteAndReturnRows: async () => ({ ok: true, rows: [] }),
      verifyMembershipAbsent: async () => ({ status: "absent" }),
    });
    assert.equal(r.ok, true);
    assert.equal(r.membershipAbsent, true);
  });

  it("delete deps : 0 rows + still present → !ok", async () => {
    const r = await deleteOwnLobbyMembershipByIdWithDeps("lobby-1", {
      getUserId: () => "u-1",
      deleteAndReturnRows: async () => ({ ok: true, rows: [] }),
      verifyMembershipAbsent: async () => ({ status: "present" }),
    });
    assert.equal(r.ok, false);
    assert.equal(r.code, LOBBY_LEAVE_ERROR.STILL_PRESENT);
  });

  it("delete deps : verify unknown → !ok", async () => {
    const r = await deleteOwnLobbyMembershipByIdWithDeps("lobby-1", {
      getUserId: () => "u-1",
      deleteAndReturnRows: async () => ({ ok: true, rows: [] }),
      verifyMembershipAbsent: async () => ({ status: "unknown" }),
    });
    assert.equal(r.ok, false);
    assert.equal(r.code, LOBBY_LEAVE_ERROR.VERIFY_FAILED);
  });

  it("delete deps : erreur réseau DELETE → !ok, pas de wipe (niveau primitive)", async () => {
    const r = await deleteOwnLobbyMembershipByIdWithDeps("lobby-1", {
      getUserId: () => "u-1",
      deleteAndReturnRows: async () => ({ ok: false, error: "network" }),
      verifyMembershipAbsent: async () => assert.fail("no verify"),
    });
    assert.equal(r.ok, false);
    assert.equal(r.code, LOBBY_LEAVE_ERROR.DELETE_FAILED);
  });

  it("source deleteOwn utilise .select après DELETE + verify ciblée", () => {
    const src = read("js/core/supabaseLobby.js");
    const start = src.indexOf("export async function deleteOwnLobbyMembershipById");
    const end = src.indexOf("export async function closeLobbyByIdAsHost", start);
    const fn = src.slice(start, end);
    assert.match(fn, /deleteOwnLobbyMembershipByIdWithDeps/);
    assert.match(fn, /\.select\(\s*["']id["']\s*\)/);
    assert.match(fn, /verifyMembershipAbsent/);
    assert.match(fn, /maybeSingle/);
    assert.equal(fn.includes("getState()"), false);
  });
});

describe("AUTH-SERVER-LEAVE-GUEST-01 - finalize guest", () => {
  it("guest succès : signOut puis clear hint", async () => {
    const order = [];
    const r = await finalizeGuestAfterAuthoritativeLeave(
      { wasGuest: true },
      {
        signOutAnonGuestIfNeeded: async (g) => {
          order.push(`signOut:${g}`);
        },
        clearGuestMembership: () => order.push("clearHint"),
      }
    );
    assert.equal(r.ok, true);
    assert.deepEqual(order, ["signOut:true", "clearHint"]);
  });

  it("non-guest : signOut reçoit false (helper décide via auth)", async () => {
    const order = [];
    await finalizeGuestAfterAuthoritativeLeave(
      { wasGuest: false },
      {
        signOutAnonGuestIfNeeded: async (g) => order.push(`signOut:${g}`),
        clearGuestMembership: () => order.push("clearHint"),
      }
    );
    assert.deepEqual(order, ["signOut:false", "clearHint"]);
  });

  it("CANONICAL_ELSEWHERE : no-op (pas signOut, pas clear)", async () => {
    const r = await finalizeGuestAfterAuthoritativeLeave(
      { wasGuest: true, canonicalElsewhere: true },
      {
        signOutAnonGuestIfNeeded: async () => assert.fail("no signOut"),
        clearGuestMembership: () => assert.fail("no clear"),
      }
    );
    assert.equal(r.skipped, true);
    assert.equal(r.reason, "canonical_elsewhere");
  });

  it("double finalize : idempotent (pas d'exception)", async () => {
    let clears = 0;
    const deps = {
      signOutAnonGuestIfNeeded: async () => {},
      clearGuestMembership: () => {
        clears += 1;
      },
    };
    await finalizeGuestAfterAuthoritativeLeave({ wasGuest: true }, deps);
    await finalizeGuestAfterAuthoritativeLeave({ wasGuest: true }, deps);
    assert.equal(clears, 2);
  });

  it("source leaveLobbyMembershipFromServer câble finalize après succès", () => {
    const src = read("js/core/lobby.js");
    const start = src.indexOf("export async function leaveLobbyMembershipFromServer");
    const end = src.indexOf("/** Hôte MP : transfère", start);
    const fn = src.slice(start, end);
    assert.match(fn, /finalizeGuestAfterAuthoritativeLeave/);
    assert.match(fn, /wasGuest\s*=\s*isGuest\(\)/);
    assert.match(fn, /canonical_elsewhere/);
    assert.ok(
      fn.indexOf("canonical_elsewhere") < fn.indexOf("finalizeGuestAfterAuthoritativeLeave")
    );
  });

  it("échec leave volontaire : pas de finalize guest", async () => {
    resetVoluntaryLeaveLockForTests();
    let finalizeSide = 0;
    const res = await runVoluntaryMemberLeave(
      { navigateAway: true },
      {
        getLobby: () => ({ id: "lobby-1", code: "ABCD" }),
        isGuest: () => true,
        isSupabaseConfigured: () => true,
        leaveLobbySupabase: async () => ({ ok: false, error: "timeout" }),
        stopMultiplayerSync: () => assert.fail("no stop"),
        stopLobbyPresenceSync: () => assert.fail("no stop"),
        signOutAnonGuestIfNeeded: async () => {
          finalizeSide += 1;
        },
        clearGuestMembership: () => {
          finalizeSide += 1;
        },
        clearLocalOpenLobbySlot: () => assert.fail("no slot"),
        applyLeaveLobbyLocal: () => assert.fail("no local"),
        getUserId: () => "u-1",
      }
    );
    assert.equal(res.ok, false);
    assert.equal(finalizeSide, 0);
    resetVoluntaryLeaveLockForTests();
  });
});

describe("AUTH-LOGOUT-MEMBER-01 - source logout", () => {
  it("membre : résultat leave contrôlé avant signOut", () => {
    const src = read("js/core/auth.js");
    const start = src.indexOf("export async function logout");
    const fn = src.slice(start, start + 2200);
    assert.match(fn, /leaveLobby\(\{\s*navigateAway:\s*false\s*\}\)/);
    assert.match(fn, /res\?\.ok\s*!==\s*true|res\.ok\s*!==\s*true/);
    assert.match(fn, /cancelled/);
    // Sur !ok / cancelled / throw : return avant signOut (pas de fire-and-forget leave).
    const failReturns = fn.match(/return\s*\{\s*ok:\s*false/g) || [];
    assert.ok(failReturns.length >= 2, "au moins cancelled + !ok member/host");
    const memberElse = fn.indexOf("} else {");
    const memberLeave = fn.indexOf("leaveLobby({ navigateAway: false })", memberElse);
    const memberFailReturn = fn.indexOf(
      "la déconnexion n'a pas été effectuée",
      memberLeave
    );
    assert.ok(memberLeave > 0 && memberFailReturn > memberLeave);
    const between = fn.slice(memberLeave, memberFailReturn + 80);
    assert.equal(between.includes("await signOutSupabase"), false);
  });

  it("hôte : garde confirmAndLeaveLobby intacte", () => {
    const src = read("js/core/auth.js");
    const fn = src.slice(src.indexOf("export async function logout"));
    assert.match(fn, /confirmAndLeaveLobby/);
    assert.match(fn, /isLobbyHost\(\)/);
  });

  it("home possède le feedback (pas de double notify dans logout)", () => {
    const auth = read("js/core/auth.js");
    const logout = auth.slice(auth.indexOf("export async function logout"));
    assert.equal(logout.includes("notifyVoluntaryLeaveFailure"), false);
    const home = read("js/screens/home.js");
    assert.match(home, /#btn-logout/);
    assert.match(home, /showAppAlert\(res\.error/);
  });

  it("messages utilisateur sans codes techniques bruts exposés comme seul texte", () => {
    assert.match(lobbyLeaveUserMessage(LOBBY_LEAVE_ERROR.MISSING_USER_ID), /connexion/i);
    assert.equal(lobbyLeaveUserMessage(LOBBY_LEAVE_ERROR.MISSING_USER_ID).includes("LEAVE_"), false);
  });
});

describe("AUTH-JOIN-GUEST-LEAVE-01 - joinLobbyAsGuest", () => {
  it("source : leave précédent contrôlé avant joinLobby", () => {
    const src = read("js/core/lobby.js");
    const start = src.indexOf("export async function joinLobbyAsGuest");
    const end = src.indexOf("/** Évite de rester", start);
    const fn = src.slice(start, end);
    assert.match(fn, /leaveLobby\(\{\s*navigateAway:\s*false\s*\}\)/);
    assert.match(fn, /leaveRes/);
    assert.match(fn, /leaveRes\.ok\s*!==\s*true|!leaveRes/);
    assert.ok(fn.indexOf("leaveRes") < fn.indexOf("joinLobby(joinCode)"));
  });

  it("échec leave → return avant joinLobby (contrat source)", () => {
    const src = read("js/core/lobby.js");
    const start = src.indexOf("export async function joinLobbyAsGuest");
    const end = src.indexOf("async function clearGuestSessionAfterFailedJoin", start);
    const fn = src.slice(start, end);
    assert.match(
      fn,
      /Impossible de quitter le lobby actuel avant d'en rejoindre un autre/
    );
    const leaveBlock = fn.slice(
      fn.indexOf("currentCode !== nextCode"),
      fn.indexOf("const res = await joinLobby")
    );
    assert.match(leaveBlock, /return\s*\{/);
    assert.match(leaveBlock, /cancelled/);
  });
});

describe("AUTH leave orphans - CANONICAL_ELSEWHERE non-régression source", () => {
  it("reconcile CANONICAL_ELSEWHERE n'appelle pas finalize guest full wipe auth", () => {
    const src = read("js/core/lobby.js");
    const start = src.indexOf("async function reconcileHostDissolveCanonicalElsewhere");
    const end = src.indexOf("async function reconcileHostDissolveNotAllowed", start);
    const block = src.slice(start, end);
    assert.equal(block.includes("finalizeGuestAfterAuthoritativeLeave"), false);
    assert.equal(block.includes("signOutAnonGuestIfNeeded"), false);
    assert.match(block, /recoverLobbyFromServer/);
  });
});
