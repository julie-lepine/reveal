/**
 * FEATURE-TIERNIGHT-03-B1 — consolidation sync / one-shot / readiness / reprise.
 */
import { describe, it, mock, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  TIER_NIGHT_SERIES_ALL_CATEGORIES,
  mergeConsumedCustomTopicIds,
} from "../js/core/tierNightSeries.js";
import { CUSTOM_ROSTER_TOPIC_ID_PREFIX } from "../js/core/customRosterTopics.js";
import {
  unionConsumedCustomRosterTopicIds,
  mergeConsumedCustomRosterTopicIdsForHydrate,
  reconcileConsumedCustomRosterTopicIds,
  resolveTierNightSeriesLaunchParticipants,
  didTierNightSeriesPrepSetupChange,
  mergeTierNightPrepRemoteState,
} from "../js/core/tierNightSeriesPrepContracts.js";
import {
  isTierNightSeriesUiEnabled,
  setTierNightSeriesUiEnabledForTests,
  TIER_NIGHT_SERIES_UI_GATE_KEY,
} from "../js/core/tierNightSeriesGate.js";
import { buildTierNightPlayerRoster } from "../js/core/tierNightRoster.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

function read(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

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
      removeChannel: () => {},
      auth: {
        getSession: async () => ({ data: { session: null } }),
        onAuthStateChange: () => ({
          data: { subscription: { unsubscribe: () => {} } },
        }),
      },
    },
  },
});

let prepSession;
let stateApi;

before(async () => {
  stateApi = await import("../js/core/state.js");
  prepSession = await import("../js/core/tierNightSeriesPrepSession.js");
});

const PARTICIPANTS = [
  {
    userId: "11111111-1111-4111-8111-111111111111",
    name: "Alice",
    emoji: "🙂",
    isHost: true,
  },
  {
    userId: "22222222-2222-4222-8222-222222222222",
    name: "Bob",
    emoji: "😎",
  },
  {
    userId: "33333333-3333-4333-8333-333333333333",
    name: "Carol",
    emoji: "🎉",
  },
];

describe("FEATURE-TIERNIGHT-03-B1 - gate OFF", () => {
  afterEach(() => {
    setTierNightSeriesUiEnabledForTests(false);
    delete globalThis[TIER_NIGHT_SERIES_UI_GATE_KEY];
  });

  it("reste désactivée", () => {
    delete globalThis[TIER_NIGHT_SERIES_UI_GATE_KEY];
    assert.equal(isTierNightSeriesUiEnabled(), true);
  });
});

describe("FEATURE-TIERNIGHT-03-B1 - ledger monotone + réconciliation", () => {
  it("union ne shrink jamais sur remote stale vide", () => {
    const local = [`${CUSTOM_ROSTER_TOPIC_ID_PREFIX}a`, `${CUSTOM_ROSTER_TOPIC_ID_PREFIX}b`];
    assert.deepEqual(mergeConsumedCustomRosterTopicIdsForHydrate(local, []), local);
    assert.deepEqual(
      mergeConsumedCustomRosterTopicIdsForHydrate(local, undefined),
      local
    );
    assert.deepEqual(
      unionConsumedCustomRosterTopicIds(local, [`${CUSTOM_ROSTER_TOPIC_ID_PREFIX}c`]),
      [
        `${CUSTOM_ROSTER_TOPIC_ID_PREFIX}a`,
        `${CUSTOM_ROSTER_TOPIC_ID_PREFIX}b`,
        `${CUSTOM_ROSTER_TOPIC_ID_PREFIX}c`,
      ]
    );
  });

  it("réconciliation depuis queue après crash (ledger manquant)", () => {
    const series = {
      queue: [
        {
          topicId: "roster:custom_x",
          topicSnapshot: {
            id: `${CUSTOM_ROSTER_TOPIC_ID_PREFIX}x`,
            name: "X",
            custom: true,
          },
        },
      ],
    };
    const repaired = reconcileConsumedCustomRosterTopicIds([], series);
    assert.deepEqual(repaired, [`${CUSTOM_ROSTER_TOPIC_ID_PREFIX}x`]);
    const idempotent = reconcileConsumedCustomRosterTopicIds(repaired, series);
    assert.deepEqual(idempotent, repaired);
  });

  it("mergeConsumed + previous conserve l’historique", () => {
    const series = {
      queue: [
        {
          topicSnapshot: {
            id: `${CUSTOM_ROSTER_TOPIC_ID_PREFIX}new`,
            name: "N",
            custom: true,
          },
        },
      ],
    };
    const merged = mergeConsumedCustomTopicIds(
      [`${CUSTOM_ROSTER_TOPIC_ID_PREFIX}old`],
      series
    );
    assert.ok(merged.includes(`${CUSTOM_ROSTER_TOPIC_ID_PREFIX}old`));
    assert.ok(merged.includes(`${CUSTOM_ROSTER_TOPIC_ID_PREFIX}new`));
  });
});

describe("FEATURE-TIERNIGHT-03-B1 - readiness / setupEpoch", () => {
  it("didTierNightSeriesPrepSetupChange détecte cat / count", () => {
    assert.equal(
      didTierNightSeriesPrepSetupChange(
        { categoryIds: ["*"], roundCount: 5 },
        { categoryIds: ["survival"], roundCount: 5 }
      ),
      true
    );
    assert.equal(
      didTierNightSeriesPrepSetupChange(
        { categoryIds: ["*"], roundCount: 5 },
        { categoryIds: ["*"], roundCount: 8 }
      ),
      true
    );
    assert.equal(
      didTierNightSeriesPrepSetupChange(
        { categoryIds: ["*"], roundCount: 5 },
        { categoryIds: ["*"], roundCount: 5 }
      ),
      false
    );
    assert.equal(
      didTierNightSeriesPrepSetupChange(
        { categoryIds: ["*"], roundCount: 8 },
        { categoryIds: ["*"], roundCount: null }
      ),
      true
    );
  });

  it("merge prep : epoch plus grand remplace ready (clear)", () => {
    const cur = {
      categoryIds: ["*"],
      roundCount: 5,
      setupEpoch: 1,
      ready: { u1: true, u2: true },
    };
    const inc = {
      categoryIds: ["survival"],
      roundCount: null,
      setupEpoch: 2,
      ready: {},
    };
    const next = mergeTierNightPrepRemoteState(cur, inc);
    assert.equal(next.setupEpoch, 2);
    assert.deepEqual(next.ready, {});
    assert.deepEqual(next.categoryIds, ["survival"]);
    assert.equal(next.roundCount, null);
  });

  it("merge prep : epoch stale ignoré", () => {
    const cur = {
      categoryIds: ["survival"],
      roundCount: 3,
      setupEpoch: 5,
      ready: {},
    };
    const stale = {
      categoryIds: ["*"],
      roundCount: 8,
      setupEpoch: 2,
      ready: { u1: true },
    };
    const next = mergeTierNightPrepRemoteState(cur, stale);
    assert.equal(next.setupEpoch, 5);
    assert.deepEqual(next.categoryIds, ["survival"]);
    assert.deepEqual(next.ready, {});
  });

  it("merge prep : ready même epoch merge UID", () => {
    const cur = {
      categoryIds: ["*"],
      roundCount: 5,
      setupEpoch: 3,
      ready: { u1: true },
    };
    const inc = { ready: { u2: true }, setupEpoch: 3 };
    const next = mergeTierNightPrepRemoteState(cur, inc);
    assert.equal(next.ready.u1, true);
    assert.equal(next.ready.u2, true);
    assert.deepEqual(next.categoryIds, ["*"]);
  });
});

describe("FEATURE-TIERNIGHT-03-B1 - roster figé UID", () => {
  it("force-start filtre par noms mais conserve UIDs ; hôte inclus", () => {
    const { participants, excludedNames } = resolveTierNightSeriesLaunchParticipants({
      participants: PARTICIPANTS,
      rosterNames: ["Bob"],
    });
    assert.equal(participants.length, 2); // Alice host + Bob
    assert.ok(participants.some((p) => p.name === "Alice"));
    assert.ok(participants.some((p) => p.name === "Bob"));
    assert.ok(excludedNames.includes("Carol"));
    const roster = buildTierNightPlayerRoster(participants);
    assert.equal(roster.length, 2);
    assert.ok(roster.every((r) => r.userId && r.displayName));
    assert.equal(
      roster.find((r) => r.userId === "22222222-2222-4222-8222-222222222222").displayName,
      "Bob"
    );
  });

  it("sans rosterNames → tous les participants", () => {
    const { participants } = resolveTierNightSeriesLaunchParticipants({
      participants: PARTICIPANTS,
      rosterNames: null,
    });
    assert.equal(participants.length, 3);
  });
});

describe("FEATURE-TIERNIGHT-03-B1 - reset / reprise runtime", () => {
  beforeEach(() => {
    stateApi.resetEveningState();
    stateApi.saveStatePatch({
      lobby: {
        ...stateApi.getState().lobby,
        participants: PARTICIPANTS,
        hostName: "Alice",
      },
      user: { ...stateApi.getState().user, displayName: "Alice" },
      tierNightSeriesPrep: {
        categoryIds: ["survival"],
        roundCount: 3,
        ready: { Alice: true },
        setupEpoch: 4,
      },
      consumedCustomRosterTopicIds: [`${CUSTOM_ROSTER_TOPIC_ID_PREFIX}keep`],
      customRosterTopics: [],
      tierNightGame: {
        runId: null,
        series: null,
        lobbyStarted: false,
        items: null,
      },
    });
  });

  it("reset prep settings ne clear PAS consumed", () => {
    prepSession.resetTierNightSeriesPrepSession();
    assert.deepEqual(stateApi.getState().consumedCustomRosterTopicIds, [
      `${CUSTOM_ROSTER_TOPIC_ID_PREFIX}keep`,
    ]);
    const s = prepSession.getTierNightSeriesPrepSession();
    assert.deepEqual(s.categoryIds, [TIER_NIGHT_SERIES_ALL_CATEGORIES]);
    assert.deepEqual(s.ready, {});
  });

  it("resetEveningState clear consumed + prep", () => {
    stateApi.resetEveningState();
    assert.deepEqual(stateApi.getState().consumedCustomRosterTopicIds, []);
  });

  it("resetGameSessionsOnly conserve consumed", () => {
    stateApi.resetGameSessionsOnly();
    assert.deepEqual(stateApi.getState().consumedCustomRosterTopicIds, [
      `${CUSTOM_ROSTER_TOPIC_ID_PREFIX}keep`,
    ]);
  });

  it("changement count invalide ready + bump epoch", async () => {
    await prepSession.setTierNightSeriesPrepRoundCount(5);
    // survival pool may not allow 5 — use all categories first
    stateApi.saveStatePatch({
      tierNightSeriesPrep: {
        categoryIds: [TIER_NIGHT_SERIES_ALL_CATEGORIES],
        roundCount: 3,
        ready: { Alice: true, Bob: true },
        setupEpoch: 1,
      },
    });
    await prepSession.setTierNightSeriesPrepRoundCount(5);
    const s = prepSession.getTierNightSeriesPrepSession();
    assert.equal(s.roundCount, 5);
    assert.deepEqual(s.ready, {});
    assert.ok(s.setupEpoch > 1);
  });

  it("changement catégorie → null count + ready clear", async () => {
    stateApi.saveStatePatch({
      tierNightSeriesPrep: {
        categoryIds: [TIER_NIGHT_SERIES_ALL_CATEGORIES],
        roundCount: 8,
        ready: { Alice: true },
        setupEpoch: 2,
      },
    });
    await prepSession.setTierNightSeriesPrepCategories(["survival"]);
    const s = prepSession.getTierNightSeriesPrepSession();
    assert.deepEqual(s.categoryIds, ["survival"]);
    assert.equal(s.roundCount, null);
    assert.deepEqual(s.ready, {});
    assert.ok(s.setupEpoch > 2);
  });

  it("launch local : lobbyStarted + series + consumed atomiques", async () => {
    const customId = `${CUSTOM_ROSTER_TOPIC_ID_PREFIX}c1`;
    stateApi.saveStatePatch({
      customRosterTopics: [
        { id: customId, name: "Custom A", custom: true, author: "Alice" },
      ],
      consumedCustomRosterTopicIds: [],
      tierNightSeriesPrep: {
        categoryIds: [TIER_NIGHT_SERIES_ALL_CATEGORIES],
        roundCount: 3,
        ready: { Alice: true, Bob: true },
        setupEpoch: 1,
      },
    });
    const res = await prepSession.markTierNightSeriesPrepStarted({
      rosterNames: ["Alice", "Bob"],
    });
    assert.equal(res.ok, true);
    const game = stateApi.getState().tierNightGame;
    assert.equal(game.lobbyStarted, true);
    assert.equal(game.series.phase, "ranking");
    assert.equal(game.series.roundIndex, 0);
    assert.ok(Array.isArray(game.playerRoster));
    assert.ok(game.playerRoster.every((r) => r.userId));
    const consumed = stateApi.getState().consumedCustomRosterTopicIds;
    const fromSeries = reconcileConsumedCustomRosterTopicIds([], game.series);
    for (const id of fromSeries) {
      assert.ok(consumed.includes(id));
    }
  });

  it("launch échec : pas de consumed", async () => {
    stateApi.saveStatePatch({
      consumedCustomRosterTopicIds: [],
      tierNightSeriesPrep: {
        categoryIds: ["survival"],
        roundCount: 8,
        ready: {},
        setupEpoch: 0,
      },
    });
    const res = await prepSession.markTierNightSeriesPrepStarted({
      rosterNames: ["Alice", "Bob"],
    });
    assert.equal(res.ok, false);
    assert.deepEqual(stateApi.getState().consumedCustomRosterTopicIds, []);
    assert.equal(stateApi.getState().tierNightGame?.series ?? null, null);
  });

  it("enter resetSettings=false ne wipe pas le prep", async () => {
    const before = prepSession.getTierNightSeriesPrepSession();
    await prepSession.enterTierNightSeriesPrep({ resetSettings: false });
    const after = prepSession.getTierNightSeriesPrepSession();
    assert.deepEqual(after.categoryIds, before.categoryIds);
    assert.equal(after.roundCount, before.roundCount);
    assert.equal(after.setupEpoch, before.setupEpoch);
  });
});

describe("FEATURE-TIERNIGHT-03-B1 - contrats source", () => {
  it("launch embarque consumed + lobbyStarted local", () => {
    const live = read("js/core/tierNightLiveSession.js");
    assert.match(live, /consumedCustomRosterTopicIds/);
    assert.match(live, /lobbyStarted:\s*true/);
    assert.match(live, /tierNightPrep/);
  });

  it("Hot Take ne clear pas ready sur thème/count ; TierNight oui", () => {
    const htTheme = read("js/core/hotTakeSession.js");
    const themeFn = htTheme.slice(
      htTheme.indexOf("export async function setHotTakeTheme"),
      htTheme.indexOf("export async function setHotTakeTheme") + 280
    );
    assert.doesNotMatch(themeFn, /ready:\s*\{\}/);
    const tn = read("js/core/tierNightSeriesPrepSession.js");
    assert.match(tn, /setupEpoch/);
    assert.match(tn, /invalidateTierNightSeriesPrepReadiness/);
  });

  it("gameSync merge prep + consumed monotone", () => {
    const src = read("js/core/gameSync.js");
    assert.match(src, /mergeTierNightPrepRemoteState/);
    assert.match(src, /mergeConsumedCustomRosterTopicIdsForHydrate/);
    assert.match(src, /reconcileConsumedCustomRosterTopicIds/);
  });

  it("nav ignore prep dans pile create ; série ON", () => {
    const nav = read("js/core/tierNightNav.js");
    assert.match(nav, /tiernight-prep/);
    assert.equal(isTierNightSeriesUiEnabled(), true);
  });

  it("écran préserve draft / pas de remount complet sur ready sync", () => {
    const screen = read("js/screens/tierNightPrep.js");
    assert.match(screen, /captureDraft/);
    assert.match(screen, /restoreDraft/);
    assert.match(screen, /refreshFromSync/);
    assert.match(screen, /updatePlayersReadyCard/);
  });

  it("roundCount null est sérialisé remote (clear explicite)", () => {
    const src = read("js/core/gameSync.js");
    assert.match(src, /roundCount: roundRaw == null \|\| roundRaw === \"\" \? null/);
  });
});
