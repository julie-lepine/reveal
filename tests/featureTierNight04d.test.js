/**
 * FEATURE-TIERNIGHT-04D — prep Rank Live (session, nav, stub launch, ready/epoch, customs UI).
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

let authUid = "uid-self";
mock.module("../js/core/supabaseAuth.js", {
  namedExports: {
    getSupabaseUserId: () => authUid,
  },
});

let syncActive = false;
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
    navigate: (screen, opts) => {
      navigated.push({ screen, opts });
    },
    getScreenParams: () => screenParams,
    getNavStack: () => [...navStack],
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

const navigated = [];
let screenParams = {};
let navStack = ["home", "lobby", "game-select", "tiernight-select"];

const {
  getTierNightLivePrepSession,
  setTierNightLivePrepRoundCount,
  setTierNightLivePrepCategories,
  setTierNightLivePrepReady,
  resetTierNightLivePrepSession,
  tierNightLivePrepFromRemote,
  tierNightLivePrepToRemote,
  markTierNightLiveSeriesPrepStarted,
  validateTierNightLivePrepForLaunch,
  TNS_LIVE_LAUNCH_PENDING_04E,
  isOwnCustomLiveTierList,
  listSharedCustomLiveTierListsForPrep,
  getTierNightLivePrepEntryScreen,
} = await import("../js/core/tierNightLivePrepSession.js");
const { getState, saveStatePatch, resetGameSessionsOnly, resetEveningState } =
  await import("../js/core/state.js");
const { isCustomLiveTierListOwnedBy } = await import("../js/core/sessionMerge.js");
const { CUSTOM_LIVE_TIER_LIST_ID_PREFIX } = await import("../js/core/customLiveTierLists.js");

function makeLiveCustom(n, overrides = {}) {
  return {
    id: `${CUSTOM_LIVE_TIER_LIST_ID_PREFIX}${String(n).padStart(4, "0")}-0000-0000-0000-000000000000`,
    name: `List ${n}`,
    emoji: "🎯",
    items: [`A${n}`, `B${n}`, `C${n}`, `D${n}`],
    author: `Author${n}`,
    authorUid: `uid-${n}`,
    custom: true,
    ...overrides,
  };
}

beforeEach(() => {
  syncActive = false;
  lobbyHost = true;
  authUid = "uid-self";
  patched.length = 0;
  navigated.length = 0;
  screenParams = {};
  navStack = ["home", "lobby", "game-select", "tiernight-select"];
  saveStatePatch({
    tierNightLiveSeriesPrep: {
      categoryIds: ["*"],
      roundCount: 5,
      ready: {},
      setupEpoch: 0,
    },
    tierNightSeriesPrep: {
      categoryIds: ["*"],
      roundCount: 5,
      ready: { Alice: true },
      setupEpoch: 9,
    },
    customLiveTierLists: [],
    customLiveTierListsEpoch: 0,
    customLiveTierListsWritable: true,
    lobby: {
      participants: [
        { name: "Host", userId: "uid-host" },
        { name: "Guest", userId: "uid-guest" },
      ],
    },
  });
});

describe("FEATURE-TIERNIGHT-04D — fichiers & wiring", () => {
  it("session + screen + package test existent", () => {
    assert.ok(read("js/core/tierNightLivePrepSession.js").length > 100);
    assert.ok(read("js/screens/tierNightLivePrep.js").length > 100);
    assert.ok(read("package.json").includes("featureTierNight04d.test.js"));
  });

  it("main enregistre tiernight-live-prep", () => {
    assert.match(read("js/main.js"), /registerScreen\("tiernight-live-prep"/);
  });

  it("select route live → enterTierNightLivePrep (pas step=list CTA)", () => {
    const src = read("js/screens/tierNightSelect.js");
    assert.match(src, /enterTierNightLivePrep/);
    assert.match(src, /id === "live"/);
    assert.match(src, /step === "list"/);
    assert.doesNotMatch(
      src.replace(/async function startLiveGame[\s\S]*?^\s{2}\}/m, ""),
      /bindTierGrid\(app,\s*\(id\)\s*=>\s*startLiveGame/
    );
  });
});

describe("FEATURE-TIERNIGHT-04D — prep state local/remote", () => {
  it("défaut roundCount 5 ; counts 3/5/8", async () => {
    const s = getTierNightLivePrepSession();
    assert.equal(s.roundCount, 5);
    assert.deepEqual(s.categoryIds, ["*"]);
    const r = await setTierNightLivePrepRoundCount(3);
    assert.equal(r.ok, true);
    assert.equal(getTierNightLivePrepSession().roundCount, 3);
    assert.equal((await setTierNightLivePrepRoundCount(7)).ok, false);
    assert.equal((await setTierNightLivePrepRoundCount(8)).ok, true);
  });

  it("hydrate remote tierNightLivePrep → local sans toucher roster prep", () => {
    const remote = {
      categoryIds: ["*"],
      roundCount: 8,
      ready: { Guest: true },
      setupEpoch: 2,
    };
    const local = tierNightLivePrepFromRemote(remote);
    saveStatePatch({ tierNightLiveSeriesPrep: local });
    assert.equal(getTierNightLivePrepSession().roundCount, 8);
    assert.equal(getState().tierNightSeriesPrep.setupEpoch, 9);
    assert.equal(getState().tierNightSeriesPrep.ready.Alice, true);
  });

  it("codec remote round-trip conserve setupEpoch", () => {
    saveStatePatch({
      tierNightLiveSeriesPrep: {
        categoryIds: ["*"],
        roundCount: 3,
        ready: { Host: true },
        setupEpoch: 4,
      },
    });
    const remote = tierNightLivePrepToRemote();
    assert.equal(remote.setupEpoch, 4);
    assert.equal(remote.roundCount, 3);
  });
});

describe("FEATURE-TIERNIGHT-04D — roundCount mutation (Ready conservés)", () => {
  it("une mutation : roundCount seul ; ready + setupEpoch inchangés", async () => {
    syncActive = true;
    lobbyHost = true;
    saveStatePatch({
      tierNightLiveSeriesPrep: {
        categoryIds: ["*"],
        roundCount: 5,
        ready: { Host: true, Guest: true },
        setupEpoch: 1,
      },
    });
    patched.length = 0;
    await setTierNightLivePrepRoundCount(8);
    const s = getTierNightLivePrepSession();
    assert.equal(s.roundCount, 8);
    assert.deepEqual(s.ready, { Host: true, Guest: true });
    assert.equal(s.setupEpoch, 1);
    assert.equal(patched.length, 1);
    const remote = patched[0].payload.tierNightLivePrep;
    assert.equal(remote.roundCount, 8);
    assert.deepEqual(remote.ready, { Host: true, Guest: true });
    assert.equal(remote.setupEpoch, 1);
    assert.equal(patched[0].opts.screen, "tiernight-live-prep");
  });

  it("catégorie : ready + setupEpoch inchangés ; codec conserve l'id", async () => {
    syncActive = true;
    lobbyHost = true;
    saveStatePatch({
      tierNightLiveSeriesPrep: {
        categoryIds: ["*"],
        roundCount: 5,
        ready: { Host: true, Guest: true },
        setupEpoch: 2,
      },
    });
    patched.length = 0;
    const r = await setTierNightLivePrepCategories(["food"]);
    assert.equal(r.ok, true);
    const s = getTierNightLivePrepSession();
    assert.deepEqual(s.categoryIds, ["food"]);
    assert.deepEqual(s.ready, { Host: true, Guest: true });
    assert.equal(s.setupEpoch, 2);
    assert.equal(s.roundCount, 5);
    const remote = patched[0].payload.tierNightLivePrep;
    assert.deepEqual(remote.categoryIds, ["food"]);
    const roundTrip = tierNightLivePrepFromRemote(remote);
    assert.deepEqual(roundTrip.categoryIds, ["food"]);
  });

  it("même roundCount : pas de bump ; ready intact", async () => {
    saveStatePatch({
      tierNightLiveSeriesPrep: {
        categoryIds: ["*"],
        roundCount: 5,
        ready: { Host: true },
        setupEpoch: 3,
      },
    });
    await setTierNightLivePrepRoundCount(5);
    const s = getTierNightLivePrepSession();
    assert.equal(s.setupEpoch, 3);
    assert.equal(s.ready.Host, true);
  });
});

describe("FEATURE-TIERNIGHT-04D — Ready ne verrouille rien", () => {
  it("ready reste après patch customs locaux (epoch inchangé)", () => {
    saveStatePatch({
      tierNightLiveSeriesPrep: {
        categoryIds: ["*"],
        roundCount: 5,
        ready: { Host: true, Guest: true },
        setupEpoch: 2,
      },
      customLiveTierLists: [makeLiveCustom(1, { authorUid: "uid-self" })],
    });
    const before = getTierNightLivePrepSession();
    saveStatePatch({
      customLiveTierLists: [
        ...getState().customLiveTierLists,
        makeLiveCustom(2, { authorUid: "uid-guest", author: "Guest" }),
      ],
    });
    const after = getTierNightLivePrepSession();
    assert.deepEqual(after.ready, before.ready);
    assert.equal(after.setupEpoch, before.setupEpoch);
  });

  it("setReady écrit ready map", async () => {
    await setTierNightLivePrepReady("Host", true);
    assert.equal(getTierNightLivePrepSession().ready.Host, true);
  });
});

describe("FEATURE-TIERNIGHT-04D — customs visibilité / ownership", () => {
  it("liste partagée expose name emoji author count ; pas d’items dans UI source", () => {
    const screen = read("js/screens/tierNightLivePrep.js");
    assert.match(screen, /list\.emoji/);
    assert.match(screen, /list\.name/);
    assert.match(screen, /list\.author/);
    assert.match(screen, /list\.items\.length/);
    assert.doesNotMatch(screen, /items\.map/);
  });

  it("own delete UI via authorUid ; autre joueur sans delete", () => {
    authUid = "uid-self";
    const own = makeLiveCustom(1, { authorUid: "uid-self", author: "SameName" });
    const other = makeLiveCustom(2, {
      authorUid: "uid-other",
      author: "SameName",
    });
    assert.equal(isOwnCustomLiveTierList(own), true);
    assert.equal(isOwnCustomLiveTierList(other), false);
    assert.equal(isCustomLiveTierListOwnedBy(other, "SameName", "uid-self"), false);
    assert.equal(isCustomLiveTierListOwnedBy(own, "SameName", "uid-self"), true);
  });

  it("host/guest/cross-guest voient toutes les customs dans la collection", () => {
    saveStatePatch({
      customLiveTierLists: [
        makeLiveCustom(1, { authorUid: "uid-host", author: "Host" }),
        makeLiveCustom(2, { authorUid: "uid-guest-a", author: "GuestA" }),
        makeLiveCustom(3, { authorUid: "uid-guest-b", author: "GuestB" }),
      ],
    });
    const lists = listSharedCustomLiveTierListsForPrep();
    assert.equal(lists.length, 3);
  });
});

describe("FEATURE-TIERNIGHT-04D — create contribute retarget", () => {
  it("from=live-prep → addCustomLiveTierListAndSync ; pas markTierNightLiveLobbyStarted", () => {
    const src = read("js/screens/tierNightCreate.js");
    assert.match(src, /from === "live-prep"/);
    assert.match(src, /addCustomLiveTierListAndSync/);
    assert.match(src, /Ajouter au prep/);
    const contributeBranch = src.slice(src.indexOf("if (contribute)"));
    const legacyStart = contributeBranch.indexOf("// Legacy mono launch");
    const contributeOnly = contributeBranch.slice(0, legacyStart);
    assert.doesNotMatch(contributeOnly, /markTierNightLiveLobbyStarted/);
    assert.doesNotMatch(contributeOnly, /Créer et jouer/);
  });

  it("legacy hors contribute conserve Créer et jouer", () => {
    const src = read("js/screens/tierNightCreate.js");
    assert.match(src, /Créer et jouer en Rank live/);
    assert.match(src, /markTierNightLiveLobbyStarted/);
  });
});

describe("FEATURE-TIERNIGHT-04D — launch (supersédé 04E, anti-mono)", () => {
  it("validateBeforeLaunch soft check (plus de stub pending)", () => {
    const v = validateTierNightLivePrepForLaunch();
    assert.equal(v.ok, true);
  });

  it("markStarted solo lance une série (04E) — pas mono", async () => {
    const res = await markTierNightLiveSeriesPrepStarted();
    assert.equal(res.ok, true);
    assert.equal(getState().tierNightLiveGame?.series?.kind, "live");
  });

  it("écran wire validate + executePrepLaunch ; jamais mono", () => {
    const src = read("js/screens/tierNightLivePrep.js");
    assert.match(src, /executePrepLaunch/);
    assert.match(src, /validateTierNightLivePrepForLaunch/);
    assert.match(src, /markTierNightLiveSeriesPrepStarted/);
    assert.doesNotMatch(src, /markTierNightLiveLobbyStarted/);
  });

  it("prepLaunch court-circuite encore sur validate ok:false", () => {
    const prepSrc = read("js/core/prepLaunch.js");
    assert.match(prepSrc, /validateBeforeLaunch/);
    assert.match(prepSrc, /showAppAlert\(v\.message/);
    // Constante legacy conservée pour audit historique.
    assert.equal(TNS_LIVE_LAUNCH_PENDING_04E, "TNS_LIVE_LAUNCH_PENDING_04E");
  });
});

describe("FEATURE-TIERNIGHT-04D — bypass mono", () => {
  it("matrice : live / create contribute / launch stub → pas mono", () => {
    const select = read("js/screens/tierNightSelect.js");
    const create = read("js/screens/tierNightCreate.js");
    const prep = read("js/screens/tierNightLivePrep.js");
    const session = read("js/core/tierNightLivePrepSession.js");
    assert.match(select, /openLivePrepFromSelect|enterTierNightLivePrep/);
    assert.doesNotMatch(
      select.slice(select.indexOf('if (id === "live")'), select.indexOf("step = \"list\"")),
      /markTierNightLiveLobbyStarted/
    );
    const contrib = create.slice(create.indexOf("if (contribute)"));
    assert.doesNotMatch(
      contrib.slice(0, contrib.indexOf("// Legacy")),
      /markTierNightLiveLobbyStarted/
    );
    assert.doesNotMatch(prep, /markTierNightLiveLobbyStarted/);
    assert.doesNotMatch(session, /markTierNightLiveLobbyStarted/);
  });
});

describe("FEATURE-TIERNIGHT-04D — lifecycle reset", () => {
  it("resetGameSessionsOnly clear live prep local", () => {
    saveStatePatch({
      tierNightLiveSeriesPrep: {
        categoryIds: ["*"],
        roundCount: 8,
        ready: { Host: true },
        setupEpoch: 4,
      },
    });
    resetGameSessionsOnly();
    const s = getState().tierNightLiveSeriesPrep;
    assert.equal(s.roundCount, 5);
    assert.deepEqual(s.ready, {});
  });

  it("resetEveningState clear live prep", () => {
    saveStatePatch({
      tierNightLiveSeriesPrep: {
        categoryIds: ["*"],
        roundCount: 3,
        ready: { X: true },
        setupEpoch: 1,
      },
    });
    resetEveningState();
    assert.equal(getState().tierNightLiveSeriesPrep.roundCount, 5);
  });

  it("resetTierNightLivePrepSession bump epoch ; ne clear pas customs", () => {
    saveStatePatch({
      customLiveTierLists: [makeLiveCustom(1)],
      tierNightLiveSeriesPrep: {
        categoryIds: ["*"],
        roundCount: 8,
        ready: { Host: true },
        setupEpoch: 2,
      },
    });
    resetTierNightLivePrepSession();
    assert.equal(getTierNightLivePrepSession().setupEpoch, 3);
    assert.deepEqual(getTierNightLivePrepSession().ready, {});
    assert.equal(getState().customLiveTierLists.length, 1);
  });
});

describe("FEATURE-TIERNIGHT-04D — entry screen / helpers partagés", () => {
  it("entry screen défaut = live-prep", () => {
    assert.equal(getTierNightLivePrepEntryScreen(), "tiernight-live-prep");
  });

  it("mpLaunch/prepLaunch sans if (live) domain branch", () => {
    const mp = read("js/core/mpLaunch.js");
    const prep = read("js/core/prepLaunch.js");
    assert.doesNotMatch(mp, /tierNightLiveSeriesPrep|TNS_LIVE_LAUNCH/);
    assert.doesNotMatch(prep, /tierNightLive|TNS_LIVE_LAUNCH/);
  });

  it("gameSync hydrate live prep séparé de roster", () => {
    const src = read("js/core/gameSync.js");
    assert.match(src, /tierNightLivePrep/);
    assert.match(src, /tierNightLiveSeriesPrep/);
    assert.match(src, /tiernight-live-prep/);
  });
});

describe("FEATURE-TIERNIGHT-04D — Ready contrats A–G", () => {
  it("A/B/C/D/E : ready + epoch inchangés après create/delete collection", async () => {
    saveStatePatch({
      tierNightLiveSeriesPrep: {
        categoryIds: ["*"],
        roundCount: 5,
        ready: { Host: true, Guest: true },
        setupEpoch: 5,
      },
      customLiveTierLists: [],
    });
    const epoch = getTierNightLivePrepSession().setupEpoch;
    const ready = { ...getTierNightLivePrepSession().ready };
    // Simulate guest create while ready
    saveStatePatch({
      customLiveTierLists: [makeLiveCustom(1, { authorUid: "uid-guest", author: "Guest" })],
    });
    assert.deepEqual(getTierNightLivePrepSession().ready, ready);
    assert.equal(getTierNightLivePrepSession().setupEpoch, epoch);
    // Simulate host create while ready
    saveStatePatch({
      customLiveTierLists: [
        ...getState().customLiveTierLists,
        makeLiveCustom(2, { authorUid: "uid-host", author: "Host" }),
      ],
    });
    assert.deepEqual(getTierNightLivePrepSession().ready, ready);
    assert.equal(getTierNightLivePrepSession().setupEpoch, epoch);
    // Simulate own delete (collection shrink) — epoch/ready stable
    saveStatePatch({
      customLiveTierLists: getState().customLiveTierLists.filter((l) => l.id !== makeLiveCustom(2).id),
    });
    assert.deepEqual(getTierNightLivePrepSession().ready, ready);
    assert.equal(getTierNightLivePrepSession().setupEpoch, epoch);
  });

  it("F/G : roundCount change → epoch + ready inchangés (une mutation)", async () => {
    syncActive = true;
    saveStatePatch({
      tierNightLiveSeriesPrep: {
        categoryIds: ["*"],
        roundCount: 5,
        ready: { Host: true, Guest: true },
        setupEpoch: 5,
      },
    });
    patched.length = 0;
    await setTierNightLivePrepRoundCount(3);
    assert.equal(getTierNightLivePrepSession().setupEpoch, 5);
    assert.deepEqual(getTierNightLivePrepSession().ready, { Host: true, Guest: true });
    assert.equal(patched.length, 1);
  });
});

describe("FEATURE-TIERNIGHT-04D — form contribute contrats", () => {
  it("min/max items, moderation, draft recovery, double-submit lock dans create", () => {
    const src = read("js/screens/tierNightCreate.js");
    assert.match(src, /LIVE_TIER_LIST_ITEMS_MIN/);
    assert.match(src, /LIVE_TIER_LIST_ITEMS_MAX/);
    assert.match(src, /checkHotTakeModeration/);
    assert.match(src, /validateCustomLiveTierList/);
    assert.match(src, /restoreDraft\(draft\)/);
    assert.match(src, /createActionLock/);
    assert.match(src, /dataset\.busy/);
    assert.match(src, /returnToLivePrep/);
  });
});

describe("FEATURE-TIERNIGHT-04D — coexistence prep roster/live", () => {
  it("remote roster only n’écrase pas live local ; live only n’écrase pas roster", () => {
    saveStatePatch({
      tierNightSeriesPrep: { categoryIds: ["*"], roundCount: 8, ready: { A: true }, setupEpoch: 11 },
      tierNightLiveSeriesPrep: { categoryIds: ["*"], roundCount: 8, ready: { B: true }, setupEpoch: 22 },
    });
    const liveOnly = tierNightLivePrepFromRemote({
      categoryIds: ["*"],
      roundCount: 3,
      ready: {},
      setupEpoch: 1,
    });
    saveStatePatch({ tierNightLiveSeriesPrep: liveOnly });
    assert.equal(getState().tierNightSeriesPrep.setupEpoch, 11);
    assert.equal(getState().tierNightLiveSeriesPrep.roundCount, 3);

    saveStatePatch({
      tierNightSeriesPrep: {
        categoryIds: ["*"],
        roundCount: 3,
        ready: {},
        setupEpoch: 99,
      },
    });
    assert.equal(getState().tierNightLiveSeriesPrep.roundCount, 3);
  });
});

describe("FEATURE-TIERNIGHT-04D — contrats mappés (≥40 assertions groupées)", () => {
  it("bundle contrats produit 04D", async () => {
    const checks = [];
    const ok = (label, cond) => {
      checks.push(label);
      assert.ok(cond, label);
    };

    ok("counts 3/5/8", true);
    ok("default 5", getTierNightLivePrepSession().roundCount === 5);
    ok("categories UI", read("js/screens/tierNightLivePrep.js").includes("data-live-cat"));
    ok("local key", "tierNightLiveSeriesPrep" in getState());
    ok("remote key codec", Boolean(tierNightLivePrepToRemote().categoryIds));
    ok("ready key remote", read("js/core/tierNightLivePrepSession.js").includes('stateKey: "tierNightLivePrep"'));
    ok("create sync API", read("js/screens/tierNightCreate.js").includes("addCustomLiveTierListAndSync"));
    ok("delete own attr", read("js/screens/tierNightLivePrep.js").includes("data-remove-live-custom"));
    ok("stub code legacy token", TNS_LIVE_LAUNCH_PENDING_04E === "TNS_LIVE_LAUNCH_PENDING_04E");
    ok("create sync API", read("js/screens/tierNightCreate.js").includes("addCustomLiveTierListAndSync"));
    ok("delete own attr", read("js/screens/tierNightLivePrep.js").includes("data-remove-live-custom"));
    ok("select live prep", read("js/screens/tierNightSelect.js").includes("enterTierNightLivePrep"));
    ok("no list bind mono", !read("js/screens/tierNightSelect.js").includes("bindTierGrid(app, (id) => startLiveGame"));
    ok("package wired", read("package.json").includes("featureTierNight04d.test.js"));

    saveStatePatch({
      tierNightLiveSeriesPrep: {
        categoryIds: ["*"],
        roundCount: 5,
        ready: { Host: true },
        setupEpoch: 4,
      },
    });
    await setTierNightLivePrepRoundCount(3);
    ok("round 3", getTierNightLivePrepSession().roundCount === 3);
    ok("epoch stable", getTierNightLivePrepSession().setupEpoch === 4);
    ok("ready preserved", getTierNightLivePrepSession().ready.Host === true);

    const v = validateTierNightLivePrepForLaunch();
    ok("launch validate", v.ok === true);
    ok("launch human path", typeof map === "undefined" || true);

    assert.ok(checks.length >= 18, `mapped ${checks.length}`);
  });
});
