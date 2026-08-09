/**
 * FEATURE-TIERNIGHT-04F — progression multi-listes Rank Live (finalize / advance / routing).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it, beforeEach, mock } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");

const navigations = [];
const patchCalls = [];
const clearRpcCalls = [];
let gameSyncActive = true;

mock.module("../js/core/supabaseClient.js", {
  namedExports: {
    isSupabaseConfigured: () => false,
    supabase: { rpc: async () => ({ data: null, error: null }) },
  },
});
mock.module("../js/core/supabaseAuth.js", {
  namedExports: { getSupabaseUserId: () => "uid-host" },
});
mock.module("../js/core/players.js", {
  namedExports: {
    getActivePlayerNames: () => ["Host", "Guest"],
    getActivePlayers: () => [
      { name: "Host", userId: "uid-host", isLocal: true, emoji: "😀", color: "#111" },
      { name: "Guest", userId: "uid-guest", isLocal: false, emoji: "😎", color: "#222" },
    ],
  },
});
mock.module("../js/core/router.js", {
  namedExports: {
    navigate: (screen, opts) => {
      navigations.push({ screen, opts });
    },
    getScreenParams: () => ({}),
    getNavStack: () => [],
  },
});
mock.module("../js/core/gameSessionRpc.js", {
  namedExports: {
    rpcClearTierNightCustomLiveTierLists: async (args) => {
      clearRpcCalls.push(args);
      return { ok: true, code: "CLEARED", epoch: 1, writable: true };
    },
    rpcStartTierNightLiveSeries: async () => null,
  },
});

const gameSyncExports = {
  isGameSyncActive: () => gameSyncActive,
  isLobbyHost: () => true,
  canActAsHost: () => true,
  patchGameState: async (stateMerge, opts) => {
    patchCalls.push({ stateMerge, opts });
    return { screen: opts?.screen || null, state: stateMerge, game_id: "tiernight" };
  },
  getCachedGameSession: () => ({ id: "session-04f", lobby_id: "lobby-04f" }),
  refreshGameSession: async () => ({ id: "session-04f", lobby_id: "lobby-04f" }),
  tierNightLiveToRemote: (session) => ({ ...(session || {}) }),
  tierNightRecapToRemote: (session) => {
    if (!session?.recaps?.length) return null;
    return {
      runId: session.runId ?? null,
      topicId: session.topicId ?? null,
      listName: session.listName ?? "",
      recaps: session.recaps,
      consensus: session.consensus || null,
      controversialItem: session.controversialItem ?? null,
      controversialSpread: session.controversialSpread ?? 0,
      scoresApplied: Boolean(session.scoresApplied),
    };
  },
  getTierNightRemote: () => ({}),
  requireLocalParticipantUid: () => "uid-host",
  applyRemoteSession: () => {},
  allMembersReady: () => true,
  tierNightPrepToRemote: (s) => s,
  tierNightPrepFromRemote: (r) => r || {},
};

mock.module("../js/core/gameSync.js", {
  namedExports: gameSyncExports,
});

const { getState, saveStatePatch, addScore, bumpPlayerStat } = await import(
  "../js/core/state.js"
);
const {
  buildTierNightLiveSeriesLaunchState,
  clearInFlightTierNightLiveLaunchAttempt,
} = await import("../js/core/tierNightLiveSeriesLaunch.js");
const {
  TIER_NIGHT_LIVE_SERIES_PHASE_BETWEEN,
  TIER_NIGHT_LIVE_SERIES_PHASE_END,
  TIER_NIGHT_LIVE_SERIES_PHASE_PLAYING,
  projectTierNightLiveSeriesRound,
  projectTierNightLiveSeriesRound0,
  isTierNightLiveSeriesLastRound,
} = await import("../js/core/tierNightLiveSeriesRuntime.js");
const {
  hostFinalizeTierNightLiveSeriesList,
  hostAdvanceTierNightLiveSeriesList,
  resolveTierNightLiveSeriesScreenFromPhase,
  __testGetLiveSeriesPlayLocks,
} = await import("../js/core/tierNightLiveSeriesPlaySession.js");
const {
  buildRecapsFromPlacements,
  getTierNightSession,
  applyTierNightLiveSeriesListScores,
} = await import("../js/core/tierNightSession.js");
const { finishedTierNightLiveRemote, shouldPreferTierNightEndRoute } = await import(
  "../js/core/tierNightConfig.js"
);
const { clearCustomLiveTierListsLocal } = await import(
  "../js/core/customLiveTierListSession.js"
);

function seqRng(values) {
  let i = 0;
  return () => {
    const v = values[i % values.length];
    i += 1;
    return v;
  };
}

function placeAll(items, tier = "A") {
  return {
    Host: { S: [], A: [...items], B: [], C: [], D: [] },
    Guest: { S: [], A: [...items], B: [], C: [], D: [] },
  };
}

function seedLiveSeriesPlaying(series, livePartial = {}) {
  const idx = Number.isInteger(Number(series?.roundIndex)) ? Number(series.roundIndex) : 0;
  const projected = projectTierNightLiveSeriesRound(series, idx, [], () => 0.2);
  assert.equal(projected.ok, true);
  const live = {
    ...projected.live,
    placements: placeAll(projected.live.deck),
    ...livePartial,
  };
  saveStatePatch({
    tierNightLiveGame: live,
    tierNightGame: {
      recaps: [],
      topicId: live.topicId,
      listName: live.listName,
      scoresApplied: false,
    },
    customLiveTierLists: [
      {
        id: "custom-live-0001-0000-0000-0000-000000000001",
        name: "Temp",
        emoji: "🎯",
        items: ["a", "b", "c", "d"],
        author: "Host",
        authorUid: "uid-host",
        custom: true,
      },
    ],
    lobby: { id: "lobby-04f" },
  });
  return live;
}

beforeEach(() => {
  navigations.length = 0;
  patchCalls.length = 0;
  clearRpcCalls.length = 0;
  gameSyncActive = true;
  clearInFlightTierNightLiveLaunchAttempt();
  saveStatePatch({
    tierNightLiveGame: {
      runId: null,
      lobbyStarted: false,
      finished: false,
    },
    tierNightGame: { recaps: [], scoresApplied: false },
    customLiveTierLists: [],
    gameScores: {},
    playerStats: {},
    lobby: { id: "lobby-04f" },
  });
});

describe("FEATURE-TIERNIGHT-04F — wiring", () => {
  it("doc + package + nextRound series path", () => {
    assert.ok(read("docs/FEATURE-TIERNIGHT-04F.md").includes("between_lists"));
    assert.ok(read("package.json").includes("featureTierNight04f.test.js"));
    const game = read("js/games/tierNightLive.js");
    assert.match(game, /hostFinalizeTierNightLiveSeriesList/);
    assert.match(game, /series\?\.kind === ["']live["']/);
  });

  it("resolveActivePlayScreen priorise phases live", () => {
    const src = read("js/core/gameSync.js");
    assert.match(src, /liveSeries\.phase === ["']between_lists["']/);
    assert.match(src, /liveSeries\.phase === ["']series_end["']/);
    assert.equal(
      resolveTierNightLiveSeriesScreenFromPhase(TIER_NIGHT_LIVE_SERIES_PHASE_BETWEEN),
      "tiernight-between"
    );
    assert.equal(
      resolveTierNightLiveSeriesScreenFromPhase(TIER_NIGHT_LIVE_SERIES_PHASE_END),
      "tiernight-end"
    );
    assert.equal(
      resolveTierNightLiveSeriesScreenFromPhase(TIER_NIGHT_LIVE_SERIES_PHASE_PLAYING),
      "tiernight-live"
    );
  });
});

describe("FEATURE-TIERNIGHT-04F — domain projection", () => {
  it("projectTierNightLiveSeriesRound0 wraps index 0 ; items from snapshot only", () => {
    const built = buildTierNightLiveSeriesLaunchState({
      roundCount: 3,
      customLists: [],
      random: seqRng([0.1, 0.2, 0.3, 0.4, 0.5]),
      deckRandom: () => 0.3,
    });
    assert.equal(built.ok, true);
    const snapItems = built.series.queue[1].listSnapshot.items.slice();
    const p1 = projectTierNightLiveSeriesRound(built.series, 1, [], () => 0.1);
    assert.equal(p1.ok, true);
    assert.deepEqual([...p1.live.deck].sort(), [...snapItems].sort());
    assert.equal(p1.live.topicId, built.series.queue[1].listId);
    const p0 = projectTierNightLiveSeriesRound0(built.series, [], () => 0.1);
    assert.equal(p0.ok, true);
    assert.equal(p0.live.topicId, built.series.queue[0].listId);
  });
});

describe("FEATURE-TIERNIGHT-04F — série 3 listes", () => {
  it("finalize0 → between ; advance → round1 ; finalize1 → between ; finalize2 → series_end + clear", async () => {
    const built = buildTierNightLiveSeriesLaunchState({
      roundCount: 3,
      customLists: [],
      random: seqRng([0.15, 0.25, 0.35, 0.45, 0.55, 0.65]),
      deckRandom: () => 0.2,
      runId: "run-04f-3",
    });
    assert.equal(built.ok, true);
    const queueIds = built.series.queue.map((e) => e.listId);

    seedLiveSeriesPlaying(built.series);

    const f0 = await hostFinalizeTierNightLiveSeriesList();
    assert.equal(f0.ok, true);
    assert.equal(f0.phase, TIER_NIGHT_LIVE_SERIES_PHASE_BETWEEN);
    assert.equal(getState().tierNightLiveGame.series.phase, "between_lists");
    assert.deepEqual(getState().tierNightLiveGame.series.scoredRoundIds, ["run-04f-3:0"]);
    assert.equal(navigations.at(-1)?.screen, "tiernight-between");

    const queueAfterF0 = getState().tierNightLiveGame.series.queue.map((e) => e.listId);
    assert.deepEqual(queueAfterF0, queueIds);

    const adv = await hostAdvanceTierNightLiveSeriesList();
    assert.equal(adv.ok, true);
    assert.equal(adv.roundIndex, 1);
    assert.equal(getState().tierNightLiveGame.series.phase, "playing_list");
    assert.equal(getState().tierNightLiveGame.series.roundIndex, 1);
    assert.equal(getState().tierNightLiveGame.phase, "voting");
    assert.deepEqual(
      getState().tierNightLiveGame.series.queue.map((e) => e.listId),
      queueIds
    );
    assert.equal(navigations.at(-1)?.screen, "tiernight-live");

    // Remplir placements liste 1
    const live1 = getState().tierNightLiveGame;
    saveStatePatch({
      tierNightLiveGame: {
        ...live1,
        placements: placeAll(live1.deck),
      },
    });

    const f1 = await hostFinalizeTierNightLiveSeriesList();
    assert.equal(f1.ok, true);
    assert.equal(f1.phase, TIER_NIGHT_LIVE_SERIES_PHASE_BETWEEN);
    assert.deepEqual(getState().tierNightLiveGame.series.scoredRoundIds, [
      "run-04f-3:0",
      "run-04f-3:1",
    ]);

    const adv2 = await hostAdvanceTierNightLiveSeriesList();
    assert.equal(adv2.ok, true);
    assert.equal(getState().tierNightLiveGame.series.roundIndex, 2);
    assert.ok(isTierNightLiveSeriesLastRound(getState().tierNightLiveGame.series));

    const live2 = getState().tierNightLiveGame;
    saveStatePatch({
      tierNightLiveGame: {
        ...live2,
        placements: placeAll(live2.deck),
      },
    });

    clearRpcCalls.length = 0;
    const f2 = await hostFinalizeTierNightLiveSeriesList();
    assert.equal(f2.ok, true);
    assert.equal(f2.phase, TIER_NIGHT_LIVE_SERIES_PHASE_END);
    assert.equal(getState().tierNightLiveGame.series.phase, "series_end");
    assert.equal(getState().tierNightLiveGame.finished, true);
    assert.equal(getState().tierNightLiveGame.lobbyStarted, false);
    assert.equal(navigations.at(-1)?.screen, "tiernight-end");
    assert.ok(clearRpcCalls.length >= 1);
    assert.equal(clearRpcCalls[0].lobbyId, "lobby-04f");
    assert.equal(clearRpcCalls[0].expectedSessionId, "session-04f");
    assert.equal(clearRpcCalls[0].reopen, true);
    assert.deepEqual(getState().customLiveTierLists, []);
    assert.equal(getState().customLiveTierListsWritable, true);
  });

  it("clear customs refuse STALE sans expectedSessionId (contrat SQL)", async () => {
    const src = read("js/core/tierNightLiveSeriesPlaySession.js");
    assert.match(src, /expectedSessionId:\s*sessionId/);
    assert.match(src, /result\?\.ok !== true/);
    assert.match(src, /NO_SESSION_ID/);
  });

  it("anti-double finalize (scoredRoundIds)", async () => {
    const built = buildTierNightLiveSeriesLaunchState({
      roundCount: 3,
      customLists: [],
      random: seqRng([0.2, 0.3, 0.4, 0.5]),
      deckRandom: () => 0.25,
      runId: "run-04f-dup",
    });
    seedLiveSeriesPlaying(built.series);
    const a = await hostFinalizeTierNightLiveSeriesList();
    assert.equal(a.ok, true);
    assert.equal(a.applied, true);
    navigations.length = 0;
    const b = await hostFinalizeTierNightLiveSeriesList();
    assert.equal(b.ok, true);
    assert.equal(b.applied, false);
    assert.equal(b.code, "ALREADY_APPLIED");
    assert.equal(getState().tierNightLiveGame.series.scoredRoundIds.length, 1);
  });

  it("double advance lock skipped", async () => {
    const built = buildTierNightLiveSeriesLaunchState({
      roundCount: 3,
      customLists: [],
      random: seqRng([0.21, 0.31, 0.41, 0.51]),
      deckRandom: () => 0.22,
      runId: "run-04f-lock",
    });
    seedLiveSeriesPlaying(built.series);
    await hostFinalizeTierNightLiveSeriesList();

    // Bloquer le verrou advance manuellement pendant un run concurrent.
    const { advanceLock } = __testGetLiveSeriesPlayLocks();
    const blocker = advanceLock.run(
      () => new Promise((r) => setTimeout(r, 40))
    );
    const skipped = await hostAdvanceTierNightLiveSeriesList();
    assert.equal(skipped.ok, false);
    assert.equal(skipped.skipped, true);
    assert.equal(skipped.code, "TNS_LIVE_IN_FLIGHT");
    await blocker;
  });
});

describe("FEATURE-TIERNIGHT-04F — scoring", () => {
  it("applyScores:false ne pose pas scoresApplied bloquant", () => {
    const items = ["x", "y", "z", "w"];
    const placements = placeAll(items);
    saveStatePatch({
      tierNightGame: { recaps: [], scoresApplied: false },
    });
    buildRecapsFromPlacements("t1", "List", items, placements, { applyScores: false });
    assert.equal(getTierNightSession().scoresApplied, false);

    // Deuxième liste : encore appliquable via helper série.
    const series = { scoredRoundIds: [] };
    const r1 = applyTierNightLiveSeriesListScores({
      roundId: "r:0",
      recaps: getTierNightSession().recaps,
      isSeriesEnd: false,
      series,
    });
    assert.equal(r1.applied, true);
    const r2 = applyTierNightLiveSeriesListScores({
      roundId: "r:0",
      recaps: getTierNightSession().recaps,
      isSeriesEnd: false,
      series: { scoredRoundIds: ["r:0"] },
    });
    assert.equal(r2.alreadyScored, true);
    assert.equal(getTierNightSession().scoresApplied, false);
  });
});

describe("FEATURE-TIERNIGHT-04F — config / finish blob", () => {
  it("finishedTierNightLiveRemote preserve series", () => {
    const out = finishedTierNightLiveRemote({
      runId: "r1",
      topicId: "l1",
      listName: "L",
      series: { kind: "live", phase: "series_end", queue: [] },
    });
    assert.equal(out.finished, true);
    assert.equal(out.lobbyStarted, false);
    assert.equal(out.series.phase, "series_end");
  });

  it("between_lists compte comme run actif (end route)", () => {
    const prefer = shouldPreferTierNightEndRoute({
      state: {
        tierNightLive: {
          lobbyStarted: true,
          finished: false,
          series: { kind: "live", phase: "between_lists" },
        },
      },
      declared: "tiernight-end",
    });
    // Run actif → ne pas préférer end.
    assert.equal(prefer, false);
  });

  it("series_end + declared live-prep → ne préfère PAS end (guest follow prep)", () => {
    assert.equal(
      shouldPreferTierNightEndRoute({
        state: {
          tierNightLive: {
            lobbyStarted: false,
            finished: true,
            series: { kind: "live", phase: "series_end", queue: [{}] },
          },
          tierNight: {
            lobbyStarted: false,
            recap: {
              recaps: [{ player: "Host", placed: { A: ["x"] } }],
            },
          },
        },
        declared: "tiernight-live-prep",
      }),
      false
    );
  });
});

/**
 * BUG-TIERNIGHT-04F-QA-01 — advance ne doit pas être détourné vers series_end / classement.
 */
describe("BUG-TIERNIGHT-04F-QA-01 — advance vs series_end", () => {
  const midSeriesRecap = {
    recaps: [{ player: "Host", placed: { A: ["x"] } }],
  };

  function buildPlayingSeries(roundCount, roundIndex, extras = {}) {
    const built = buildTierNightLiveSeriesLaunchState({
      roundCount,
      customLists: [],
      random: seqRng([0.11, 0.22, 0.33, 0.44, 0.55, 0.66, 0.77, 0.88]),
      deckRandom: () => 0.2,
      runId: `run-qa01-${roundCount}`,
    });
    assert.equal(built.ok, true);
    const scored = [];
    const completed = [];
    // Between après finalisation de la manche `roundIndex` → ledgers 0..roundIndex inclus.
    for (let i = 0; i <= roundIndex; i += 1) {
      scored.push(`${built.series.runId}:${i}`);
      completed.push(`${built.series.runId}:${i}`);
    }
    return {
      ...built.series,
      roundIndex,
      phase: TIER_NIGHT_LIVE_SERIES_PHASE_BETWEEN,
      scoredRoundIds: scored,
      completedRoundIds: completed,
      ...extras,
    };
  }

  it("A — série 3 : roundIndex 0 → advance → roundIndex 1 playing_list", async () => {
    const series = buildPlayingSeries(3, 0);
    // Finalize path marks round 0 scored; seed as between after list 0.
    const between = {
      ...series,
      scoredRoundIds: [`${series.runId}:0`],
      completedRoundIds: [`${series.runId}:0`],
      phase: TIER_NIGHT_LIVE_SERIES_PHASE_BETWEEN,
    };
    seedLiveSeriesPlaying(between);
    saveStatePatch({
      tierNightLiveGame: {
        ...getState().tierNightLiveGame,
        series: between,
        phase: "between",
      },
    });
    const adv = await hostAdvanceTierNightLiveSeriesList();
    assert.equal(adv.ok, true);
    assert.equal(adv.phase, TIER_NIGHT_LIVE_SERIES_PHASE_PLAYING);
    assert.equal(getState().tierNightLiveGame.series.roundIndex, 1);
    assert.equal(getState().tierNightLiveGame.series.phase, "playing_list");
    assert.notEqual(adv.phase, TIER_NIGHT_LIVE_SERIES_PHASE_END);
  });

  it("B — série 3 : roundIndex 1 → advance → roundIndex 2 playing_list", async () => {
    const series = buildPlayingSeries(3, 1);
    seedLiveSeriesPlaying(series);
    saveStatePatch({
      tierNightLiveGame: {
        ...getState().tierNightLiveGame,
        series,
        phase: "between",
      },
    });
    const adv = await hostAdvanceTierNightLiveSeriesList();
    assert.equal(adv.ok, true);
    assert.equal(getState().tierNightLiveGame.series.roundIndex, 2);
    assert.equal(getState().tierNightLiveGame.series.phase, "playing_list");
  });

  it("C — série 3 : roundIndex 2 finalize → series_end", async () => {
    const series = {
      ...buildPlayingSeries(3, 2),
      phase: TIER_NIGHT_LIVE_SERIES_PHASE_PLAYING,
      scoredRoundIds: ["run-qa01-3:0", "run-qa01-3:1"],
      completedRoundIds: ["run-qa01-3:0", "run-qa01-3:1"],
    };
    seedLiveSeriesPlaying(series);
    const f = await hostFinalizeTierNightLiveSeriesList();
    assert.equal(f.ok, true);
    assert.equal(f.phase, TIER_NIGHT_LIVE_SERIES_PHASE_END);
    assert.equal(getState().tierNightLiveGame.series.phase, "series_end");
  });

  it("D — guard : roundIndex 0 ne produit jamais series_end", async () => {
    const series = {
      ...buildPlayingSeries(3, 0),
      phase: TIER_NIGHT_LIVE_SERIES_PHASE_PLAYING,
      scoredRoundIds: [],
      completedRoundIds: [],
    };
    seedLiveSeriesPlaying(series);
    const f = await hostFinalizeTierNightLiveSeriesList();
    assert.equal(f.ok, true);
    assert.equal(f.phase, TIER_NIGHT_LIVE_SERIES_PHASE_BETWEEN);
    assert.notEqual(f.phase, TIER_NIGHT_LIVE_SERIES_PHASE_END);
    assert.equal(isTierNightLiveSeriesLastRound(getState().tierNightLiveGame.series), false);

    const adv = await hostAdvanceTierNightLiveSeriesList();
    assert.equal(adv.ok, true);
    assert.notEqual(adv.phase, TIER_NIGHT_LIVE_SERIES_PHASE_END);
    assert.equal(getState().tierNightLiveGame.series.roundIndex, 1);
  });

  it("E — projection après advance 0→1 = queue[1]", async () => {
    const series = {
      ...buildPlayingSeries(3, 0),
      scoredRoundIds: ["run-qa01-3:0"],
      completedRoundIds: ["run-qa01-3:0"],
    };
    const q1 = series.queue[1];
    seedLiveSeriesPlaying(series);
    saveStatePatch({
      tierNightLiveGame: {
        ...getState().tierNightLiveGame,
        series,
        phase: "between",
      },
    });
    const adv = await hostAdvanceTierNightLiveSeriesList();
    assert.equal(adv.ok, true);
    const live = getState().tierNightLiveGame;
    assert.equal(live.topicId, q1.listId);
    assert.equal(live.listName, q1.listSnapshot.name);
    assert.deepEqual([...live.deck].sort(), [...q1.listSnapshot.items].map(String).sort());
    assert.equal(live.roundIdx, 0);
  });

  it("F — ledgers conservés après advance", async () => {
    const series = {
      ...buildPlayingSeries(3, 0),
      scoredRoundIds: ["run-qa01-3:0"],
      completedRoundIds: ["run-qa01-3:0"],
    };
    seedLiveSeriesPlaying(series);
    saveStatePatch({
      tierNightLiveGame: {
        ...getState().tierNightLiveGame,
        series,
        phase: "between",
      },
    });
    const adv = await hostAdvanceTierNightLiveSeriesList();
    assert.equal(adv.ok, true);
    const s = getState().tierNightLiveGame.series;
    assert.deepEqual(s.scoredRoundIds, ["run-qa01-3:0"]);
    assert.deepEqual(s.completedRoundIds, ["run-qa01-3:0"]);
    assert.equal(s.queue.length, 3);
    assert.equal(s.runId, "run-qa01-3");
  });

  it("G — guest suit playing_list + roundIndex=1 (follow between)", async () => {
    const { followTierNightLiveSeriesBetweenScreen } = await import(
      "../js/core/tierNightLiveSeriesPlaySession.js"
    );
    navigations.length = 0;
    const followed = followTierNightLiveSeriesBetweenScreen({
      state: {
        tierNightLive: {
          series: { kind: "live", phase: "playing_list", roundIndex: 1, queue: [{}, {}, {}] },
        },
      },
    });
    assert.equal(followed, true);
    assert.equal(navigations.at(-1)?.screen, "tiernight-live");
  });

  it("H — série 5 : 0→1→2→3→4 puis series_end", async () => {
    const built = buildTierNightLiveSeriesLaunchState({
      roundCount: 5,
      customLists: [],
      random: seqRng([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]),
      deckRandom: () => 0.25,
      runId: "run-qa01-5",
    });
    assert.equal(built.ok, true);
    seedLiveSeriesPlaying(built.series);

    for (let i = 0; i < 5; i += 1) {
      const live = getState().tierNightLiveGame;
      saveStatePatch({
        tierNightLiveGame: { ...live, placements: placeAll(live.deck) },
      });
      const f = await hostFinalizeTierNightLiveSeriesList();
      assert.equal(f.ok, true);
      if (i < 4) {
        assert.equal(f.phase, TIER_NIGHT_LIVE_SERIES_PHASE_BETWEEN);
        const adv = await hostAdvanceTierNightLiveSeriesList();
        assert.equal(adv.ok, true);
        assert.equal(getState().tierNightLiveGame.series.roundIndex, i + 1);
        assert.equal(getState().tierNightLiveGame.series.phase, "playing_list");
      } else {
        assert.equal(f.phase, TIER_NIGHT_LIVE_SERIES_PHASE_END);
      }
    }
  });

  it("I — série 7 : 0→…→6 puis series_end", async () => {
    const built = buildTierNightLiveSeriesLaunchState({
      roundCount: 7,
      customLists: [],
      random: seqRng([0.12, 0.23, 0.34, 0.45, 0.56, 0.67, 0.78, 0.89]),
      deckRandom: () => 0.3,
      runId: "run-qa01-7",
    });
    assert.equal(built.ok, true);
    seedLiveSeriesPlaying(built.series);

    for (let i = 0; i < 7; i += 1) {
      const live = getState().tierNightLiveGame;
      saveStatePatch({
        tierNightLiveGame: { ...live, placements: placeAll(live.deck) },
      });
      const f = await hostFinalizeTierNightLiveSeriesList();
      assert.equal(f.ok, true);
      if (i < 6) {
        assert.equal(f.phase, TIER_NIGHT_LIVE_SERIES_PHASE_BETWEEN);
        const adv = await hostAdvanceTierNightLiveSeriesList();
        assert.equal(adv.ok, true);
        assert.equal(getState().tierNightLiveGame.series.roundIndex, i + 1);
      } else {
        assert.equal(f.phase, TIER_NIGHT_LIVE_SERIES_PHASE_END);
      }
    }
  });

  it("routing : declared tiernight-live + récap mid-série ≠ end", () => {
    assert.equal(
      shouldPreferTierNightEndRoute({
        declared: "tiernight-live",
        local: "tiernight-between",
        state: {
          tierNight: { lobbyStarted: false, recap: midSeriesRecap },
          tierNightLive: {
            lobbyStarted: true,
            finished: false,
            series: {
              kind: "live",
              phase: "playing_list",
              roundIndex: 1,
              roundCount: 3,
              queue: [{}, {}, {}],
            },
          },
        },
      }),
      false
    );
    assert.equal(
      shouldPreferTierNightEndRoute({
        declared: "tiernight-live",
        local: "tiernight-between",
        state: {
          tierNight: { lobbyStarted: false, recap: midSeriesRecap },
          tierNightLive: {
            lobbyStarted: true,
            finished: false,
            series: {
              kind: "live",
              phase: "between_lists",
              roundIndex: 0,
              roundCount: 3,
              queue: [{}, {}, {}],
            },
          },
        },
      }),
      false
    );
  });

  it("last-round helper : queue.length prime sur roundCount stale", () => {
    assert.equal(
      isTierNightLiveSeriesLastRound({
        roundIndex: 0,
        roundCount: 1,
        queue: [{}, {}, {}],
      }),
      false
    );
    assert.equal(
      isTierNightLiveSeriesLastRound({
        roundIndex: 2,
        roundCount: 99,
        queue: [{}, {}, {}],
      }),
      true
    );
  });
});

describe("FEATURE-TIERNIGHT-04F — screens", () => {
  it("between live + end live branchés", () => {
    const between = read("js/screens/tierNightBetween.js");
    assert.match(between, /Rank Live/);
    assert.match(between, /hostAdvanceTierNightLiveSeriesList/);
    assert.match(between, /between_lists/);
    const end = read("js/screens/tierNightEnd.js");
    assert.match(end, /replayTierNightLiveAfterSeriesEnd/);
    assert.match(end, /Recommencer/);
    assert.match(end, /Changer de mode/);
    assert.match(end, /Autre jeu/);
  });
});

// silence unused imports in lint-less env
void addScore;
void bumpPlayerStat;
void clearCustomLiveTierListsLocal;
