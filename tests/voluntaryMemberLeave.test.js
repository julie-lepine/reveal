/**
 * UX-NAV-LOBBY — contrat d’échec leave membre (comportemental).
 * Module pur : js/core/voluntaryMemberLeave.js (pas de chargement Supabase).
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  runVoluntaryMemberLeave,
  notifyVoluntaryLeaveFailure,
  isVoluntaryLeaveInFlight,
  resetVoluntaryLeaveLockForTests,
} from "../js/core/voluntaryMemberLeave.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeLobbyState(overrides = {}) {
  return {
    id: "lobby-1",
    code: "ABCD",
    participants: [
      { userId: "u-member", name: "Alex", isLocal: true, isHost: false },
      { userId: "u-host", name: "Host", isLocal: false, isHost: true },
    ],
    hostId: "u-host",
    status: "playing",
    ...overrides,
  };
}

function makeTrackingDeps(overrides = {}) {
  const order = [];
  const lobbyRef = { current: makeLobbyState() };
  const guestMembership = { current: { membershipId: "m1", lobbyId: "lobby-1" } };
  const navigations = [];
  const localState = {
    inLobby: true,
    lobby: lobbyRef.current,
    cleared: false,
  };

  const innerLeave =
    overrides.leaveLobbySupabase ||
    (async () => ({ ok: true }));

  const deps = {
    getLobby: () => lobbyRef.current,
    isGuest: () => Boolean(overrides.wasGuest),
    isSupabaseConfigured: () => true,
    leaveLobbySupabase: async () => {
      order.push("leaveLobbySupabase");
      return innerLeave();
    },
    stopMultiplayerSync: () => {
      order.push("stopMultiplayerSync");
    },
    stopLobbyPresenceSync: () => {
      order.push("stopLobbyPresenceSync");
    },
    signOutAnonGuestIfNeeded: async (wasGuest) => {
      order.push(`signOut:${wasGuest ? "guest" : "account"}`);
    },
    clearGuestMembership: () => {
      order.push("clearGuestMembership");
      guestMembership.current = null;
    },
    clearLocalOpenLobbySlot: () => {
      order.push("clearLocalOpenLobbySlot");
    },
    applyLeaveLobbyLocal: ({ navigateAway }) => {
      order.push("applyLeaveLobbyLocal");
      localState.inLobby = false;
      localState.lobby = null;
      localState.cleared = true;
      guestMembership.current = null;
      if (navigateAway) {
        order.push("navigate:home:reset");
        navigations.push({ screen: "home", reset: true });
      }
    },
    getUserId: () => "u-member",
    commitMembershipRemoved: ({ userId, lobbyId }) => {
      order.push(`commitMembershipRemoved:${userId}:${lobbyId}`);
    },
    beginPostLeaveHomeTransition: () => {
      order.push("beginPostLeaveHomeTransition");
      return 1;
    },
    invalidateCurrentLobbySessionCache: () => {
      order.push("invalidateCurrentLobbySessionCache");
    },
  };

  for (const [k, v] of Object.entries(overrides)) {
    if (k === "leaveLobbySupabase" || k === "wasGuest") continue;
    deps[k] = v;
  }

  return { deps, order, lobbyRef, guestMembership, navigations, localState };
}

describe("runVoluntaryMemberLeave — contrat échec", () => {
  beforeEach(() => {
    resetVoluntaryLeaveLockForTests();
  });

  afterEach(() => {
    resetVoluntaryLeaveLockForTests();
  });

  it("A — succès distant : ordre DELETE → stop → signOut → cleanup → nav", async () => {
    const { deps, order, localState, navigations, guestMembership } = makeTrackingDeps({
      wasGuest: true,
    });

    const res = await runVoluntaryMemberLeave({ navigateAway: true }, deps);

    assert.equal(res.ok, true);
    assert.deepEqual(order, [
      "leaveLobbySupabase",
      "beginPostLeaveHomeTransition",
      "commitMembershipRemoved:u-member:lobby-1",
      "invalidateCurrentLobbySessionCache",
      "stopMultiplayerSync",
      "stopLobbyPresenceSync",
      "signOut:guest",
      "clearGuestMembership",
      "applyLeaveLobbyLocal",
      "navigate:home:reset",
    ]);
    assert.equal(localState.inLobby, false);
    assert.equal(localState.lobby, null);
    assert.equal(guestMembership.current, null);
    assert.deepEqual(navigations, [{ screen: "home", reset: true }]);
    assert.equal(isVoluntaryLeaveInFlight(), false);
  });

  it("A — succès : un seul DELETE ; pas de stop avant résolution", async () => {
    const gate = deferred();
    let deleteCalls = 0;
    const { deps, order } = makeTrackingDeps({
      leaveLobbySupabase: async () => {
        deleteCalls += 1;
        await gate.promise;
        return { ok: true };
      },
    });

    const p = runVoluntaryMemberLeave({ navigateAway: true }, deps);
    await Promise.resolve();
    assert.equal(deleteCalls, 1);
    assert.deepEqual(order, ["leaveLobbySupabase"]);
    assert.equal(order.includes("stopMultiplayerSync"), false);

    gate.resolve();
    const res = await p;
    assert.equal(res.ok, true);
    assert.ok(order.indexOf("leaveLobbySupabase") < order.indexOf("stopMultiplayerSync"));
  });

  it("B — échec soft : aucun cleanup / sync / nav ; état intact", async () => {
    const { deps, order, localState, lobbyRef, guestMembership, navigations } = makeTrackingDeps({
      wasGuest: true,
      leaveLobbySupabase: async () => ({ ok: false, error: "network down" }),
    });
    const before = structuredClone(lobbyRef.current);

    const res = await runVoluntaryMemberLeave({ navigateAway: true }, deps);

    assert.equal(res.ok, false);
    assert.equal(res.error, "network down");
    assert.deepEqual(order, ["leaveLobbySupabase"]);
    assert.equal(localState.inLobby, true);
    assert.deepEqual(lobbyRef.current, before);
    assert.ok(guestMembership.current?.membershipId);
    assert.equal(navigations.length, 0);
    assert.equal(isVoluntaryLeaveInFlight(), false);
  });

  it("C — exception distante : même invariant que soft fail", async () => {
    const { deps, order, localState, navigations } = makeTrackingDeps({
      leaveLobbySupabase: async () => {
        throw new Error("boom");
      },
    });

    const res = await runVoluntaryMemberLeave({ navigateAway: true }, deps);

    assert.equal(res.ok, false);
    assert.match(res.error, /boom/);
    assert.deepEqual(order, ["leaveLobbySupabase"]);
    assert.equal(localState.inLobby, true);
    assert.equal(navigations.length, 0);
    assert.equal(isVoluntaryLeaveInFlight(), false);
  });

  it("D — annulation confirm : leave jamais appelé + pas d’alerte échec", async () => {
    // Miroir confirmAndLeaveLobby membre : confirm false → cancelled avant leave.
    let leaveCalls = 0;
    const confirmed = false;
    const out = !confirmed
      ? { ok: false, cancelled: true }
      : await (async () => {
          leaveCalls += 1;
          return { ok: true };
        })();

    assert.deepEqual(out, { ok: false, cancelled: true });
    assert.equal(leaveCalls, 0);

    let alertCalls = 0;
    await notifyVoluntaryLeaveFailure(out, {
      showAppAlert: async () => {
        alertCalls += 1;
      },
    });
    assert.equal(alertCalls, 0);
  });

  it("B+ — notifyVoluntaryLeaveFailure : alerte sur échec ; busy/cancel silencieux", async () => {
    const alerts = [];
    const alertDeps = {
      showAppAlert: async (msg, opts) => {
        alerts.push({ msg, opts });
      },
    };

    await notifyVoluntaryLeaveFailure({ ok: false, error: "x" }, alertDeps);
    assert.equal(alerts.length, 1);
    assert.match(alerts[0].msg, /connexion a empêché/i);
    assert.equal(alerts[0].opts.title, "Impossible de quitter le lobby");

    await notifyVoluntaryLeaveFailure({ ok: false, busy: true }, alertDeps);
    await notifyVoluntaryLeaveFailure({ ok: false, cancelled: true }, alertDeps);
    await notifyVoluntaryLeaveFailure({ ok: true }, alertDeps);
    assert.equal(alerts.length, 1);
  });

  it("E — deux appels concurrents : un seul DELETE, second busy, verrou libéré", async () => {
    const gate = deferred();
    let deleteCalls = 0;

    const { deps, order } = makeTrackingDeps({
      wasGuest: true,
      leaveLobbySupabase: async () => {
        deleteCalls += 1;
        await gate.promise;
        return { ok: true };
      },
    });

    const p1 = runVoluntaryMemberLeave({ navigateAway: true }, deps);
    await Promise.resolve();
    assert.equal(isVoluntaryLeaveInFlight(), true);

    const r2 = await runVoluntaryMemberLeave({ navigateAway: true }, deps);
    assert.equal(r2.ok, false);
    assert.equal(r2.busy, true);
    assert.equal(deleteCalls, 1);

    gate.resolve();
    const r1 = await p1;
    assert.equal(r1.ok, true);
    assert.equal(deleteCalls, 1);
    assert.equal(order.filter((x) => x === "applyLeaveLobbyLocal").length, 1);
    assert.equal(order.filter((x) => x === "navigate:home:reset").length, 1);
    assert.equal(order.filter((x) => x === "signOut:guest").length, 1);
    assert.equal(isVoluntaryLeaveInFlight(), false);

    deleteCalls = 0;
    const r3 = await runVoluntaryMemberLeave({ navigateAway: false }, {
      ...deps,
      leaveLobbySupabase: async () => {
        deleteCalls += 1;
        return { ok: true };
      },
      applyLeaveLobbyLocal: () => {},
      signOutAnonGuestIfNeeded: async () => {},
    });
    assert.equal(r3.ok, true);
    assert.equal(deleteCalls, 1);
  });

  it("E — concurrent sur échec : verrou libéré pour retry", async () => {
    const gate = deferred();
    let deleteCalls = 0;
    const { deps } = makeTrackingDeps({
      leaveLobbySupabase: async () => {
        deleteCalls += 1;
        await gate.promise;
        return { ok: false, error: "fail" };
      },
    });

    const p1 = runVoluntaryMemberLeave({}, deps);
    await Promise.resolve();
    const r2 = await runVoluntaryMemberLeave({}, deps);
    assert.equal(r2.busy, true);

    gate.resolve();
    const r1 = await p1;
    assert.equal(r1.ok, false);
    assert.equal(isVoluntaryLeaveInFlight(), false);

    deleteCalls = 0;
    const r3 = await runVoluntaryMemberLeave({}, {
      ...deps,
      leaveLobbySupabase: async () => {
        deleteCalls += 1;
        return { ok: false, error: "again" };
      },
    });
    assert.equal(r3.ok, false);
    assert.equal(deleteCalls, 1);
  });

  it("F — cleanup kick/dissolve non bloqué par le verrou volontaire", async () => {
    const gate = deferred();
    const { deps, localState } = makeTrackingDeps({
      leaveLobbySupabase: async () => {
        await gate.promise;
        return { ok: true };
      },
    });

    const pLeave = runVoluntaryMemberLeave({ navigateAway: true }, deps);
    await Promise.resolve();
    assert.equal(isVoluntaryLeaveInFlight(), true);

    // Miroir handleKickedFromLobby : applyLeaveLobbyLocal hors verrou.
    deps.applyLeaveLobbyLocal({ wasGuest: false, navigateAway: false });
    assert.equal(localState.cleared, true);
    assert.equal(localState.inLobby, false);

    gate.resolve();
    const res = await pLeave;
    assert.equal(res.ok, true);
    assert.equal(isVoluntaryLeaveInFlight(), false);
  });

  it("branche locale offline : pas de leaveLobbySupabase, cleanup immédiat", async () => {
    const { deps, order } = makeTrackingDeps();
    deps.isSupabaseConfigured = () => false;
    deps.getLobby = () => ({ code: "DEMO", participants: [{ isLocal: true }] });

    const res = await runVoluntaryMemberLeave({ navigateAway: true }, deps);
    assert.equal(res.ok, true);
    assert.equal(order.includes("leaveLobbySupabase"), false);
    assert.ok(order.includes("clearLocalOpenLobbySlot"));
    assert.ok(order.includes("applyLeaveLobbyLocal"));
  });
});
