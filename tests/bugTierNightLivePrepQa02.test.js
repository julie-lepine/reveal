/**
 * BUG-TIERNIGHT-LIVE-PREP-QA-02 — Ready conservé sur 3/5/7 + header game-prep aligné.
 *
 * Ne pas confondre avec QA-01 (refreshFromSync).
 * Roster TierNight (roundCount → clear ready) reste inchangé.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it, beforeEach, mock } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");

mock.module("../js/core/supabaseClient.js", {
  namedExports: {
    isSupabaseConfigured: () => false,
    supabase: {
      rpc: async () => ({ data: null, error: null }),
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        }),
      }),
      channel: () => ({ on: () => ({ subscribe: () => ({}) }), unsubscribe: () => {} }),
    },
  },
});

let authUid = "uid-host";
mock.module("../js/core/supabaseAuth.js", {
  namedExports: {
    getSupabaseUserId: () => authUid,
  },
});

let syncActive = true;
let lobbyHost = true;
const patched = [];
mock.module("../js/core/gameSync.js", {
  namedExports: {
    isGameSyncActive: () => syncActive,
    isLobbyHost: () => lobbyHost,
    canActAsHost: () => lobbyHost,
    allMembersReady: (ready) => {
      const names = ["Host", "Guest"];
      return names.every((n) => ready?.[n]);
    },
    patchGameState: async (payload, opts) => {
      patched.push({ payload, opts });
      return { ok: true };
    },
    tierNightPrepToRemote: (session = {}) => ({
      categoryIds: Array.isArray(session.categoryIds) ? session.categoryIds : ["*"],
      roundCount: session.roundCount ?? 5,
      ready: { ...(session.ready || {}) },
      setupEpoch: Number(session.setupEpoch) || 0,
    }),
    tierNightPrepFromRemote: (remote) => {
      if (!remote || typeof remote !== "object") {
        return { categoryIds: ["*"], roundCount: 5, ready: {}, setupEpoch: 0 };
      }
      return {
        categoryIds: Array.isArray(remote.categoryIds) ? remote.categoryIds.map(String) : ["*"],
        roundCount: remote.roundCount ?? 5,
        ready: { ...(remote.ready || {}) },
        setupEpoch: Number(remote.setupEpoch) || 0,
        poolInvalidateRequestId: remote.poolInvalidateRequestId
          ? String(remote.poolInvalidateRequestId)
          : null,
      };
    },
    requireLocalParticipantUid: () => authUid,
    applyRemoteSession: () => {},
    refreshGameSession: async () => null,
    getCachedGameSession: () => null,
  },
});

mock.module("../js/core/mpLaunch.js", {
  namedExports: {
    commitPrepReadyToggle: async ({ readyKey, ready, getSession, saveLocal }) => {
      const session = getSession();
      saveLocal({ ...session, ready: { ...session.ready, [readyKey]: Boolean(ready) } });
    },
    navigateAfterGameLaunch: () => {},
    prepGuestFollowOnSession: () => () => false,
    runPrepGameLaunch: async () => ({ ok: false }),
  },
});

mock.module("../js/core/router.js", {
  namedExports: {
    navigate: () => {},
    getScreenParams: () => ({}),
    getNavStack: () => ["home", "lobby", "game-select", "tiernight-select"],
  },
});

mock.module("../js/core/players.js", {
  namedExports: {
    getActivePlayerNames: () => ["Host", "Guest"],
    getActivePlayers: () => [
      { name: "Host", userId: "uid-host", isLocal: true },
      { name: "Guest", userId: "uid-guest", isLocal: false },
    ],
  },
});

mock.module("../js/core/lobby.js", {
  namedExports: {
    getLobbyParticipants: () => [
      { name: "Host", userId: "uid-host" },
      { name: "Guest", userId: "uid-guest" },
    ],
    setLobbyPlaying: async () => {},
    hasActiveLobby: () => true,
  },
});

const { saveStatePatch, resetGameSessionsOnly } = await import("../js/core/state.js");
const {
  getTierNightLivePrepSession,
  setTierNightLivePrepRoundCount,
  allTierNightLivePrepReady,
} = await import("../js/core/tierNightLivePrepSession.js");
const {
  obtainTierNightLiveLaunchAttempt,
  clearInFlightTierNightLiveLaunchAttempt,
  prepareTierNightLiveSeriesLaunch,
  validateTierNightLiveSeriesShape,
} = await import("../js/core/tierNightLiveSeriesLaunch.js");
const { getTierNightLiveOfficialPool } = await import("../js/core/tierNightLiveSeriesDomain.js");

beforeEach(() => {
  syncActive = true;
  lobbyHost = true;
  authUid = "uid-host";
  patched.length = 0;
  clearInFlightTierNightLiveLaunchAttempt();
  resetGameSessionsOnly();
  saveStatePatch({
    localPlayer: { name: "Host", userId: "uid-host" },
    tierNightLiveSeriesPrep: {
      categoryIds: ["*"],
      roundCount: 5,
      ready: { Host: true, Guest: true },
      setupEpoch: 4,
    },
    tierNightSeriesPrep: {
      categoryIds: ["*"],
      roundCount: 5,
      ready: { Host: true, Guest: true },
      setupEpoch: 4,
    },
  });
});

function seedLiveReady(roundCount, ready, setupEpoch = 4) {
  saveStatePatch({
    tierNightLiveSeriesPrep: {
      categoryIds: ["*"],
      roundCount,
      ready: { ...ready },
      setupEpoch,
    },
  });
}

describe("BUG-TIERNIGHT-LIVE-PREP-QA-02 — Ready conservé (A–E, H–I)", () => {
  it("A. 5→3 : Ready inchangés", async () => {
    seedLiveReady(5, { Host: true, Guest: true }, 4);
    await setTierNightLivePrepRoundCount(3);
    const s = getTierNightLivePrepSession();
    assert.equal(s.roundCount, 3);
    assert.deepEqual(s.ready, { Host: true, Guest: true });
  });

  it("B. 3→8 : Ready inchangés", async () => {
    seedLiveReady(3, { Host: true, Guest: true }, 2);
    await setTierNightLivePrepRoundCount(8);
    const s = getTierNightLivePrepSession();
    assert.equal(s.roundCount, 8);
    assert.deepEqual(s.ready, { Host: true, Guest: true });
  });

  it("C. 8→5 : Ready inchangés", async () => {
    seedLiveReady(8, { Host: true, Guest: true }, 9);
    await setTierNightLivePrepRoundCount(5);
    const s = getTierNightLivePrepSession();
    assert.equal(s.roundCount, 5);
    assert.deepEqual(s.ready, { Host: true, Guest: true });
  });

  it("D. roundCount change → setupEpoch inchangé", async () => {
    seedLiveReady(5, { Host: true }, 11);
    await setTierNightLivePrepRoundCount(3);
    assert.equal(getTierNightLivePrepSession().setupEpoch, 11);
  });

  it("E. roundCount change → un seul patch cohérent roundCount", async () => {
    seedLiveReady(5, { Host: true, Guest: true }, 4);
    patched.length = 0;
    await setTierNightLivePrepRoundCount(3);
    assert.equal(patched.length, 1);
    const remote = patched[0].payload.tierNightLivePrep;
    assert.equal(remote.roundCount, 3);
    assert.equal(remote.setupEpoch, 4);
    assert.deepEqual(remote.ready, { Host: true, Guest: true });
    assert.equal(patched[0].opts.screen, "tiernight-live-prep");
  });

  it("H. guest Ready reconnu par shell après roundCount change", async () => {
    seedLiveReady(5, { Host: true, Guest: true }, 4);
    assert.equal(allTierNightLivePrepReady(), true);
    await setTierNightLivePrepRoundCount(3);
    assert.equal(getTierNightLivePrepSession().ready.Guest, true);
    assert.equal(allTierNightLivePrepReady(), true);
  });

  it("I. host Ready reconnu par shell après roundCount change", async () => {
    seedLiveReady(7, { Host: true, Guest: true }, 1);
    await setTierNightLivePrepRoundCount(5);
    assert.equal(getTierNightLivePrepSession().ready.Host, true);
    assert.equal(allTierNightLivePrepReady(), true);
  });
});

describe("BUG-TIERNIGHT-LIVE-PREP-QA-02 — launch stale roundCount (F–G)", () => {
  it("F. proposal N=5 puis remote N=3 → mismatch roundCount (rejet contractuel)", () => {
    const sql = read("supabase/feature-tiernight-04e-start-live-series.sql");
    assert.match(
      sql,
      /tiernight_live_jsonb_int\(v_series,\s*'roundCount'\)\s+is distinct from v_round/
    );
    assert.match(sql, /raise exception 'TNS_LIVE_PREP_STALE'/);

    const prepared = prepareTierNightLiveSeriesLaunch({
      prep: { roundCount: 5, setupEpoch: 4 },
      officialLists: getTierNightLiveOfficialPool(),
      customLists: [],
      random: () => 0.35,
    });
    assert.equal(prepared.ok, true);
    assert.equal(prepared.roundCount, 5);
    assert.equal(prepared.series.roundCount, 5);

    // Remote prep after host change 5→3 (epoch unchanged).
    const remoteRound = 3;
    assert.notEqual(prepared.series.roundCount, remoteRound);
    // Same gate as RPC under lock:
    assert.equal(
      Number(prepared.series.roundCount) === remoteRound,
      false,
      "stale proposal must fail roundCount gate"
    );
  });

  it("G. nouvelle proposal N=3 → launch shape OK ; attempt non-reuse stale N=5", () => {
    const stale = obtainTierNightLiveLaunchAttempt({
      prep: { roundCount: 5, setupEpoch: 4 },
      officialLists: getTierNightLiveOfficialPool(),
      customLists: [],
      random: () => 0.2,
    });
    assert.equal(stale.ok, true);
    assert.equal(stale.roundCount, 5);

    const fresh = obtainTierNightLiveLaunchAttempt({
      prep: { roundCount: 3, setupEpoch: 4 },
      officialLists: getTierNightLiveOfficialPool(),
      customLists: [],
      random: () => 0.2,
    });
    assert.equal(fresh.ok, true);
    assert.equal(fresh.roundCount, 3);
    assert.notEqual(fresh.runId, stale.runId);
    assert.equal(validateTierNightLiveSeriesShape(fresh.series).ok, true);
  });

  it("setTierNightLivePrepRoundCount invalide attempt in-flight", async () => {
    const a = obtainTierNightLiveLaunchAttempt({
      prep: { roundCount: 5, setupEpoch: 4 },
      officialLists: getTierNightLiveOfficialPool(),
      customLists: [],
      random: () => 0.5,
    });
    assert.equal(a.ok, true);
    await setTierNightLivePrepRoundCount(3);
    const b = obtainTierNightLiveLaunchAttempt({
      prep: getTierNightLivePrepSession(),
      officialLists: getTierNightLiveOfficialPool(),
      customLists: [],
      random: () => 0.5,
    });
    assert.equal(b.roundCount, 3);
    assert.notEqual(b.runId, a.runId);
  });
});

describe("BUG-TIERNIGHT-LIVE-PREP-QA-02 — J roster INCHANGÉ", () => {
  it("roster roundCount change clear toujours ready + bump epoch", async () => {
    const src = read("js/core/tierNightSeriesPrepSession.js");
    assert.match(src, /ready:\s*changed\s*\?\s*\{\}\s*:\s*prev\.ready/);
    assert.match(
      src,
      /setupEpoch:\s*changed\s*\?\s*\(Number\(prev\.setupEpoch\)\s*\|\|\s*0\)\s*\+\s*1/
    );

    // Behavioral: live preserves ready while roster source still clears.
    seedLiveReady(5, { Host: true, Guest: true }, 4);
    await setTierNightLivePrepRoundCount(3);
    assert.deepEqual(getTierNightLivePrepSession().ready, { Host: true, Guest: true });

    const rosterSrc = read("js/core/tierNightSeriesPrepSession.js");
    assert.match(rosterSrc, /export async function setTierNightSeriesPrepRoundCount/);
    assert.ok(
      /ready:\s*changed\s*\?\s*\{\}/.test(rosterSrc),
      "roster must still clear ready on structural change"
    );
  });
});

describe("BUG-TIERNIGHT-LIVE-PREP-QA-02 — UI header game-prep", () => {
  it("eyebrow Rank Live + titre Préparation + Règles dans screen-title-row", () => {
    const screen = read("js/screens/tierNightLivePrep.js");
    assert.match(screen, /⚡ Rank Live/);
    assert.match(screen, /screen-title-row/);
    assert.match(screen, /<h2 class="screen-title">Préparation<\/h2>/);
    assert.match(screen, /rulesButtonHtml\("tiernight"\)/);
    assert.doesNotMatch(screen, /Préparation série/);
  });

  it("LISTES CUSTOM PARTAGÉES inchangé", () => {
    const screen = read("js/screens/tierNightLivePrep.js");
    assert.match(screen, /Listes custom partagées/);
  });

  it("Hot Take référence conserve screen-title-row + Préparation", () => {
    const hot = read("js/screens/hotTakePrep.js");
    assert.match(hot, /screen-title-row/);
    assert.match(hot, /<h2 class="screen-title">Préparation<\/h2>/);
    assert.match(hot, /rulesButtonHtml\("hottake"\)/);
  });

  it("QA-01 mount contract préservé (pas d'écrasement)", () => {
    const screen = read("js/screens/tierNightLivePrep.js");
    assert.match(screen, /syncPrepOnMount\(\s*refreshFromSync\s*\)/);
    assert.match(
      screen,
      /runPrepRefreshOnLobbyChange\(\s*\{[\s\S]*isActive\s*:\s*isGameSyncActive[\s\S]*refresh\s*:\s*refreshGameSession[\s\S]*refreshFromSync[\s\S]*\}\s*\)/
    );
  });
});

describe("BUG-TIERNIGHT-LIVE-PREP-QA-02 — Ready CTA + controller parité Hot Take", () => {
  it("CTA = asset partagé btn-ready (pas btn-secondary Rank Live)", () => {
    const live = read("js/screens/tierNightLivePrep.js");
    const hot = read("js/screens/hotTakePrep.js");
    assert.match(live, /class="btn btn-ready \$\{localReady \? "btn-ready--active" : ""\}"/);
    assert.match(live, /localReady \? "Prêt ✓" : "Je suis prêt !"/);
    assert.doesNotMatch(live, /Je ne suis plus prêt/);
    assert.doesNotMatch(live, /btn btn-secondary btn--spaced" id="btn-ready"/);
    assert.match(hot, /class="btn btn-ready \$\{localReady \? "btn-ready--active" : ""\}"/);
  });

  it("toggleReady passe render + simulateReady (pas onAfter)", () => {
    const live = read("js/screens/tierNightLivePrep.js");
    const hot = read("js/screens/hotTakePrep.js");
    assert.match(
      live,
      /prepLobby\.toggleReady\(\s*\{[\s\S]*setReady:\s*setTierNightLivePrepReady[\s\S]*simulateReady:\s*simulateTierNightLivePrepReady[\s\S]*render:\s*refreshReadySection[\s\S]*\}\s*\)/
    );
    assert.doesNotMatch(live, /onAfter:\s*refreshReadySection/);
    assert.match(
      hot,
      /prepLobby\.toggleReady\(\s*\{[\s\S]*render:\s*refreshReadySection[\s\S]*\}\s*\)/
    );
  });

  it("bindPrepLaunchButtons reçoit { onLaunch } (pas la fn nue)", () => {
    const live = read("js/screens/tierNightLivePrep.js");
    const hot = read("js/screens/hotTakePrep.js");
    assert.match(live, /bindPrepLaunchButtons\(\s*app,\s*\{\s*onLaunch\s*\}\s*\)/);
    assert.match(hot, /bindPrepLaunchButtons\(\s*app,\s*\{\s*onLaunch\s*\}\s*\)/);
  });

  it("dispose prepLobby au unmount (comme Hot Take/roster)", () => {
    const live = read("js/screens/tierNightLivePrep.js");
    assert.match(live, /prepLobby\.dispose\(\)/);
  });
});

describe("BUG-TIERNIGHT-LIVE-PREP-QA-02 — Ready comportemental (commit + roundCount)", () => {
  it("setReady host → map Ready true ; unready → false", async () => {
    const { setTierNightLivePrepReady } = await import(
      "../js/core/tierNightLivePrepSession.js"
    );
    seedLiveReady(5, {}, 4);
    await setTierNightLivePrepReady("Host", true);
    assert.equal(getTierNightLivePrepSession().ready.Host, true);
    await setTierNightLivePrepReady("Host", false);
    assert.equal(getTierNightLivePrepSession().ready.Host, false);
  });

  it("guest Ready + host Ready → allReady ; roundCount 5→3 conserve allReady", async () => {
    const { setTierNightLivePrepReady } = await import(
      "../js/core/tierNightLivePrepSession.js"
    );
    seedLiveReady(5, {}, 4);
    await setTierNightLivePrepReady("Host", true);
    await setTierNightLivePrepReady("Guest", true);
    assert.equal(allTierNightLivePrepReady(), true);
    await setTierNightLivePrepRoundCount(3);
    assert.equal(allTierNightLivePrepReady(), true);
    assert.deepEqual(getTierNightLivePrepSession().ready, { Host: true, Guest: true });
  });

  it("createPrepLobbyController : localReadyState suit map + inFlight", async () => {
    const { createPrepLobbyController } = await import("../js/core/usePrepLobby.js");
    seedLiveReady(5, { Host: false }, 1);
    let map = { Host: false };
    const ctrl = createPrepLobbyController({
      localKey: "Host",
      getReadyMap: () => map,
    });
    assert.equal(ctrl.localReadyState(), false);
    let renders = 0;
    const pending = ctrl.toggleReady({
      setReady: async (_k, ready) => {
        await new Promise((r) => setTimeout(r, 5));
        map = { ...map, Host: ready };
      },
      render: () => {
        renders += 1;
      },
    });
    assert.equal(ctrl.localReadyState(), true);
    await pending;
    assert.equal(ctrl.localReadyState(), true);
    assert.ok(renders >= 2);
    ctrl.dispose();
  });
});

describe("BUG-TIERNIGHT-LIVE-PREP-QA-02 — SQL race-safe sans bump epoch", () => {
  it("RPC valide roundCount proposal vs prep indépendamment de setupEpoch", () => {
    const sql = read("supabase/feature-tiernight-04e-start-live-series.sql");
    // Epoch gate exists but is separate from roundCount gate.
    assert.match(sql, /p_expected_setup_epoch/);
    assert.match(
      sql,
      /if public\.tiernight_live_jsonb_int\(v_series,\s*'roundCount'\) is distinct from v_round then[\s\S]*?TNS_LIVE_PREP_STALE/
    );
    // Smoke R7 documents the roundCount mismatch path.
    const smoke = read("supabase/feature-tiernight-04e-start-live-series-smoke-tests.sql");
    assert.match(smoke, /roundCount proposition ≠ prep remote/);
  });
});
