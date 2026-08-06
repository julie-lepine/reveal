/**
 * FEATURE-TIERNIGHT-SERIES-01 — helpers purs série (queue, validation, progression).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  TIER_NIGHT_ROSTER_TOPICS,
  TIER_NIGHT_ROSTER_CATEGORIES,
} from "../data/tierTopics.js";
import { ROSTER_TOPIC_PREFIX } from "../js/core/rosterTopic.js";
import { resolveRosterTopicConfig } from "../js/core/rosterTopic.js";
import {
  TIER_NIGHT_SERIES_ALL_CATEGORIES,
  TIER_NIGHT_SERIES_VERSION,
  buildTierNightSeriesRoundId,
  buildTierNightSeriesQueue,
  createTierNightSeriesState,
  getActiveTierNightSeriesRound,
  getTierNightSeriesProgress,
  isTierNightSeriesLastRound,
  normalizeTierNightSeries,
  validateTierNightSeries,
  doesTierNightSeriesEventMatch,
  computeNextTierNightRoundState,
  listEligibleTierNightSeriesTopics,
  countEligibleTierNightSeriesTopics,
  snapshotTierNightSeriesTopic,
  isTierNightSeriesRosterFrozen,
  assertTierNightSeriesUsesFrozenRoster,
  didTierNightSeriesRosterChange,
  listTierNightRosterCategories,
} from "../js/core/tierNightSeries.js";

function seqRng(values) {
  let i = 0;
  return () => {
    const v = values[i % values.length];
    i += 1;
    return v;
  };
}

/** RNG qui conserve l’ordre relatif (shuffle no-op-ish via always 0). */
function identityShuffleRng() {
  return () => 0;
}

const FIXTURE_TOPICS = [
  {
    id: "a1",
    name: "Thème A1",
    emoji: "1️⃣",
    categoryId: "survival",
    enabled: true,
    order: 1,
  },
  {
    id: "a2",
    name: "Thème A2",
    emoji: "2️⃣",
    categoryId: "survival",
    enabled: true,
    order: 2,
  },
  {
    id: "a3",
    name: "Thème A3",
    emoji: "3️⃣",
    categoryId: "survival",
    enabled: true,
    order: 3,
  },
  {
    id: "a4",
    name: "Thème A4",
    emoji: "4️⃣",
    categoryId: "survival",
    enabled: true,
    order: 4,
  },
  {
    id: "a5",
    name: "Thème A5",
    emoji: "5️⃣",
    categoryId: "survival",
    enabled: true,
    order: 5,
  },
  {
    id: "a6",
    name: "Thème A6",
    emoji: "6️⃣",
    categoryId: "survival",
    enabled: true,
    order: 6,
  },
  {
    id: "a7",
    name: "Thème A7",
    emoji: "7️⃣",
    categoryId: "survival",
    enabled: true,
    order: 7,
  },
  {
    id: "b1",
    name: "Thème B1",
    emoji: "🅱️",
    categoryId: "social",
    enabled: true,
    order: 1,
  },
  {
    id: "off",
    name: "Disabled",
    emoji: "🚫",
    categoryId: "survival",
    enabled: false,
    order: 99,
  },
  {
    id: "custom-roster-x",
    name: "Custom",
    emoji: "",
    categoryId: "survival",
    enabled: true,
    custom: true,
  },
];

describe("FEATURE-TIERNIGHT-SERIES-01 - catalogue additif", () => {
  it("préserve les ids historiques et wire roster:", () => {
    const ids = TIER_NIGHT_ROSTER_TOPICS.map((t) => t.id);
    assert.deepEqual(
      ids,
      [
        "apocalypse",
        "soiree",
        "secret",
        "boss",
        "crime",
        "loto",
        "roadtrip",
        "celebrity",
        "panic",
        "ghost",
      ]
    );
    for (const t of TIER_NIGHT_ROSTER_TOPICS) {
      assert.equal(typeof t.categoryId, "string");
      assert.equal(t.enabled, true);
      const cfg = resolveRosterTopicConfig(`${ROSTER_TOPIC_PREFIX}${t.id}`);
      assert.equal(cfg.found, true);
      assert.equal(cfg.listName, t.name);
      assert.equal(cfg.custom, false);
    }
  });

  it("expose des catégories stables", () => {
    const cats = listTierNightRosterCategories();
    assert.deepEqual(
      cats.map((c) => c.id),
      TIER_NIGHT_ROSTER_CATEGORIES.map((c) => c.id)
    );
    assert.ok(cats.some((c) => c.id === "survival"));
  });

  it("au moins une catégorie a ≥ 3 thèmes enabled", () => {
    const byCat = new Map();
    for (const t of TIER_NIGHT_ROSTER_TOPICS) {
      if (t.enabled === false) continue;
      byCat.set(t.categoryId, (byCat.get(t.categoryId) || 0) + 1);
    }
    assert.ok([...byCat.values()].some((n) => n >= 3));
  });
});

describe("FEATURE-TIERNIGHT-SERIES-01 - queue", () => {
  it("construit 3 / 5 / 8 sans doublon avec snapshots et roundId stables", () => {
    for (const roundCount of [3, 5, 8]) {
      const built = buildTierNightSeriesQueue({
        runId: "run-abc",
        topics: FIXTURE_TOPICS,
        categoryIds: [TIER_NIGHT_SERIES_ALL_CATEGORIES],
        roundCount,
        rng: identityShuffleRng(),
      });
      assert.equal(built.ok, true, `${roundCount}: ${built.code}`);
      assert.equal(built.queue.length, roundCount);
      const topicIds = built.queue.map((e) => e.topicId);
      assert.equal(new Set(topicIds).size, roundCount);
      built.queue.forEach((entry, i) => {
        assert.equal(entry.roundIndex, i);
        assert.equal(entry.roundId, buildTierNightSeriesRoundId("run-abc", i));
        assert.equal(entry.topicId, `${ROSTER_TOPIC_PREFIX}${entry.topicSnapshot.id}`);
        assert.ok(entry.topicSnapshot.name);
        assert.equal(entry.topicSnapshot.custom, false);
      });
    }
  });

  it("filtre uniquement les catégories demandées", () => {
    const built = buildTierNightSeriesQueue({
      runId: "run-cat",
      topics: FIXTURE_TOPICS,
      categoryIds: ["social"],
      roundCount: 3,
      rng: identityShuffleRng(),
    });
    // social n’a qu’1 thème éligible dans la fixture
    assert.equal(built.ok, false);
    assert.equal(built.code, "INSUFFICIENT_TOPICS");
    assert.equal(built.available, 1);
    assert.equal(built.requested, 3);
  });

  it("all categories inclut le pool global enabled", () => {
    const available = countEligibleTierNightSeriesTopics({
      topics: FIXTURE_TOPICS,
      categoryIds: [TIER_NIGHT_SERIES_ALL_CATEGORIES],
    });
    assert.equal(available, 8); // 7 survival + 1 social ; disabled + custom exclus
    const built = buildTierNightSeriesQueue({
      runId: "run-all",
      topics: FIXTURE_TOPICS,
      categoryIds: [TIER_NIGHT_SERIES_ALL_CATEGORIES],
      roundCount: 5,
      rng: identityShuffleRng(),
    });
    assert.equal(built.ok, true);
    assert.equal(built.queue.length, 5);
  });

  it("exclut custom et disabled", () => {
    const list = listEligibleTierNightSeriesTopics({
      topics: FIXTURE_TOPICS,
      categoryIds: ["survival"],
    });
    assert.ok(!list.some((t) => t.id === "off"));
    assert.ok(!list.some((t) => t.id === "custom-roster-x"));
  });

  it("pool insuffisant → erreur structurée (pas de clamp)", () => {
    const built = buildTierNightSeriesQueue({
      runId: "run-x",
      topics: FIXTURE_TOPICS.slice(0, 2),
      categoryIds: ["survival"],
      roundCount: 5,
      rng: identityShuffleRng(),
    });
    assert.equal(built.ok, false);
    assert.equal(built.code, "INSUFFICIENT_TOPICS");
    assert.equal(built.requested, 5);
    assert.equal(built.available, 2);
  });

  it("RNG injecté déterministe + aucune mutation catalogue", () => {
    const before = JSON.stringify(FIXTURE_TOPICS);
    const built = buildTierNightSeriesQueue({
      runId: "run-rng",
      topics: FIXTURE_TOPICS,
      categoryIds: ["survival"],
      roundCount: 3,
      rng: seqRng([0.9, 0.1, 0.5, 0.2, 0.8, 0.3]),
    });
    assert.equal(built.ok, true);
    assert.equal(JSON.stringify(FIXTURE_TOPICS), before);
    const again = buildTierNightSeriesQueue({
      runId: "run-rng",
      topics: FIXTURE_TOPICS,
      categoryIds: ["survival"],
      roundCount: 3,
      rng: seqRng([0.9, 0.1, 0.5, 0.2, 0.8, 0.3]),
    });
    assert.deepEqual(
      again.queue.map((e) => e.topicId),
      built.queue.map((e) => e.topicId)
    );
  });

  it("snapshotTierNightSeriesTopic ne copie pas de champs non sérialisables", () => {
    const snap = snapshotTierNightSeriesTopic({
      id: "x",
      name: "X",
      emoji: "X",
      categoryId: "survival",
      enabled: true,
      order: 1,
      fn: () => 1,
    });
    assert.deepEqual(snap, {
      id: "x",
      name: "X",
      emoji: "X",
      categoryId: "survival",
      custom: false,
    });
  });

  it("roundCount 7 refusé au build (legacy lecture seule)", () => {
    const built = buildTierNightSeriesQueue({
      runId: "run-legacy7",
      topics: FIXTURE_TOPICS,
      categoryIds: [TIER_NIGHT_SERIES_ALL_CATEGORIES],
      roundCount: 7,
      rng: identityShuffleRng(),
    });
    assert.equal(built.ok, false);
    assert.equal(built.code, "INVALID_ROUND_COUNT");
  });
});

describe("FEATURE-TIERNIGHT-SERIES-01 - validation / legacy", () => {
  function validSeries(overrides = {}) {
    const built = buildTierNightSeriesQueue({
      runId: "run-v",
      topics: FIXTURE_TOPICS,
      categoryIds: ["survival"],
      roundCount: 3,
      rng: identityShuffleRng(),
    });
    const created = createTierNightSeriesState({
      runId: "run-v",
      categoryIds: ["survival"],
      roundCount: 3,
      queue: built.queue,
    });
    assert.equal(created.ok, true, created.code);
    return { ...created.series, ...overrides, queue: overrides.queue || created.series.queue };
  }

  it("série valide", () => {
    const s = validSeries();
    const v = validateTierNightSeries(s, { runId: "run-v" });
    assert.equal(v.ok, true);
    assert.equal(v.series.version, TIER_NIGHT_SERIES_VERSION);
    assert.equal(v.series.phase, "ranking");
  });

  it("absence → legacy (pas erreur métier)", () => {
    const n = normalizeTierNightSeries(null);
    assert.equal(n.kind, "legacy");
    assert.equal(n.series, null);
  });

  it("version inconnue", () => {
    const s = validSeries({ version: 99 });
    const v = validateTierNightSeries(s, { runId: "run-v" });
    assert.equal(v.ok, false);
    assert.equal(v.code, "UNKNOWN_VERSION");
  });

  it("phase inconnue", () => {
    const s = validSeries({ phase: "setup" });
    const v = validateTierNightSeries(s, { runId: "run-v" });
    assert.equal(v.ok, false);
    assert.equal(v.code, "UNKNOWN_PHASE");
  });

  it("index hors bornes", () => {
    const s = validSeries({ roundIndex: 9 });
    assert.equal(validateTierNightSeries(s, { runId: "run-v" }).code, "ROUND_INDEX_OUT_OF_BOUNDS");
  });

  it("queue trop courte", () => {
    const s = validSeries();
    s.queue = s.queue.slice(0, 2);
    assert.equal(validateTierNightSeries(s, { runId: "run-v" }).code, "QUEUE_LENGTH_MISMATCH");
  });

  it("doublon roundId", () => {
    const s = validSeries();
    s.queue[1].roundId = s.queue[0].roundId;
    assert.equal(validateTierNightSeries(s, { runId: "run-v" }).code, "DUPLICATE_ROUND_ID");
  });

  it("doublon topic V1", () => {
    const s = validSeries();
    s.queue[1].topicId = s.queue[0].topicId;
    s.queue[1].topicSnapshot = { ...s.queue[0].topicSnapshot };
    assert.equal(validateTierNightSeries(s, { runId: "run-v" }).code, "DUPLICATE_TOPIC_ID");
  });

  it("ledger roundId inconnu", () => {
    const s = validSeries({ scoredRoundIds: ["run-v:99"] });
    assert.equal(validateTierNightSeries(s, { runId: "run-v" }).code, "LEDGER_UNKNOWN_ROUND_ID");
  });

  it("snapshot incomplet", () => {
    const s = validSeries();
    s.queue[0].topicSnapshot = { id: "a1" };
    assert.equal(validateTierNightSeries(s, { runId: "run-v" }).code, "INCOMPLETE_SNAPSHOT");
  });

  it("custom présent dans queue avec flag cohérent", () => {
    const s = validSeries();
    s.queue[0].topicId = `${ROSTER_TOPIC_PREFIX}custom-roster-x`;
    s.queue[0].topicSnapshot = {
      id: "custom-roster-x",
      name: "Custom",
      emoji: "",
      categoryId: "",
      custom: true,
    };
    const v = validateTierNightSeries(s, { runId: "run-v" });
    assert.equal(v.ok, true, v.code);
  });

  it("custom wire sans flag snapshot → inconsistent", () => {
    const s = validSeries();
    s.queue[0].topicId = `${ROSTER_TOPIC_PREFIX}custom-roster-x`;
    s.queue[0].topicSnapshot = {
      id: "custom-roster-x",
      name: "Custom",
      emoji: "",
      categoryId: "",
      custom: false,
    };
    assert.equal(
      validateTierNightSeries(s, { runId: "run-v" }).code,
      "CUSTOM_SNAPSHOT_INCONSISTENT"
    );
  });

  it("roundCount 7 legacy encore validable (lecture)", () => {
    const built = buildTierNightSeriesQueue({
      runId: "run-v7",
      topics: FIXTURE_TOPICS,
      categoryIds: [TIER_NIGHT_SERIES_ALL_CATEGORIES],
      roundCount: 8,
      rng: identityShuffleRng(),
    });
    assert.equal(built.ok, true);
    const queue7 = built.queue.slice(0, 7).map((e, i) => ({
      ...e,
      roundIndex: i,
      roundId: buildTierNightSeriesRoundId("run-v7", i),
    }));
    const created = createTierNightSeriesState({
      runId: "run-v7",
      categoryIds: ["*"],
      roundCount: 7,
      queue: queue7,
    });
    // create may reject 7 — validate path is what matters for hydrate
    const series = {
      version: TIER_NIGHT_SERIES_VERSION,
      categoryIds: ["*"],
      roundCount: 7,
      queue: queue7,
      roundIndex: 0,
      phase: "ranking",
      scoredRoundIds: [],
      completedRoundIds: [],
    };
    const v = validateTierNightSeries(series, { runId: "run-v7" });
    assert.equal(v.ok, true, v.code);
    void created;
  });

  it("createTierNightSeriesState ne mute pas la queue source", () => {
    const built = buildTierNightSeriesQueue({
      runId: "run-imut",
      topics: FIXTURE_TOPICS,
      categoryIds: ["survival"],
      roundCount: 3,
      rng: identityShuffleRng(),
    });
    const before = JSON.stringify(built.queue);
    createTierNightSeriesState({
      runId: "run-imut",
      categoryIds: ["survival"],
      roundCount: 3,
      queue: built.queue,
    });
    assert.equal(JSON.stringify(built.queue), before);
  });
});

describe("FEATURE-TIERNIGHT-SERIES-01 - progression / gardes", () => {
  function seriesAtBetween(roundIndex = 0) {
    const built = buildTierNightSeriesQueue({
      runId: "run-p",
      topics: FIXTURE_TOPICS,
      categoryIds: ["survival"],
      roundCount: 3,
      rng: identityShuffleRng(),
    });
    const created = createTierNightSeriesState({
      runId: "run-p",
      categoryIds: ["survival"],
      roundCount: 3,
      queue: built.queue,
    });
    return {
      ...created.series,
      roundIndex,
      phase: "between_rounds",
      scoredRoundIds: created.series.queue
        .slice(0, roundIndex + 1)
        .map((e) => e.roundId),
      completedRoundIds: created.series.queue
        .slice(0, roundIndex + 1)
        .map((e) => e.roundId),
    };
  }

  it("lecture manche active + progress", () => {
    const s = seriesAtBetween(0);
    s.phase = "ranking";
    s.scoredRoundIds = [];
    s.completedRoundIds = [];
    const active = getActiveTierNightSeriesRound(s);
    assert.equal(active.ok, true);
    assert.equal(active.round.roundIndex, 0);
    const progress = getTierNightSeriesProgress(s);
    assert.equal(progress.isLastRound, false);
    assert.equal(progress.roundCount, 3);
  });

  it("progression 0→1 conserve runId, queue, ledgers ; pas de nouveau roundId", () => {
    const s = seriesAtBetween(0);
    const queueBefore = JSON.stringify(s.queue);
    const ledgers = {
      scored: [...s.scoredRoundIds],
      completed: [...s.completedRoundIds],
    };
    const next = computeNextTierNightRoundState({
      runId: "run-p",
      series: s,
      placements: { u1: { S: ["Alice"] } },
      finished: { u1: true },
    });
    assert.equal(next.ok, true, next.code);
    assert.equal(next.runId, "run-p");
    assert.equal(next.series.roundIndex, 1);
    assert.equal(next.series.phase, "ranking");
    assert.equal(JSON.stringify(next.series.queue), queueBefore);
    assert.deepEqual(next.series.scoredRoundIds, ledgers.scored);
    assert.deepEqual(next.series.completedRoundIds, ledgers.completed);
    assert.equal(next.activeRound.roundId, buildTierNightSeriesRoundId("run-p", 1));
    assert.equal(next.clearPlacements, true);
    assert.equal(next.clearFinished, true);
    assert.equal(next.clearRoundRecap, true);
    // pas de mutation
    assert.equal(s.roundIndex, 0);
    assert.equal(s.phase, "between_rounds");
  });

  it("refuse dernière manche et mauvaise phase", () => {
    const last = seriesAtBetween(2);
    assert.equal(isTierNightSeriesLastRound(last), true);
    assert.equal(
      computeNextTierNightRoundState({ runId: "run-p", series: last }).code,
      "LAST_ROUND"
    );
    const ranking = { ...seriesAtBetween(0), phase: "ranking", scoredRoundIds: [], completedRoundIds: [] };
    assert.equal(
      computeNextTierNightRoundState({ runId: "run-p", series: ranking }).code,
      "INVALID_PHASE"
    );
  });

  it("refuse structure corrompue", () => {
    const bad = seriesAtBetween(0);
    bad.version = 2;
    assert.equal(
      computeNextTierNightRoundState({ runId: "run-p", series: bad }).code,
      "UNKNOWN_VERSION"
    );
  });

  it("gardes stale run / round / future / phase", () => {
    const s = seriesAtBetween(0);
    s.phase = "ranking";
    s.scoredRoundIds = [];
    s.completedRoundIds = [];
    assert.equal(
      doesTierNightSeriesEventMatch({
        currentRunId: "run-p",
        currentSeries: s,
        incomingRunId: "other",
      }).code,
      "RUN_ID_MISMATCH"
    );
    assert.equal(
      doesTierNightSeriesEventMatch({
        currentRunId: "run-p",
        currentSeries: s,
        incomingRunId: "run-p",
        incomingRoundIndex: 0,
        incomingRoundId: s.queue[0].roundId,
      }).ok,
      true
    );
    assert.equal(
      doesTierNightSeriesEventMatch({
        currentRunId: "run-p",
        currentSeries: s,
        incomingRunId: "run-p",
        incomingRoundIndex: -1,
      }).code,
      "STALE_ROUND_INDEX"
    );
    // -1 is invalid integer path? -1 < roundIndex 0 → STALE. Good.
    assert.equal(
      doesTierNightSeriesEventMatch({
        currentRunId: "run-p",
        currentSeries: s,
        incomingRunId: "run-p",
        incomingRoundIndex: 2,
      }).code,
      "FUTURE_ROUND_INDEX"
    );
    assert.equal(
      doesTierNightSeriesEventMatch({
        currentRunId: "run-p",
        currentSeries: s,
        incomingRunId: "run-p",
        incomingRoundId: s.queue[1].roundId,
      }).code,
      "ROUND_ID_MISMATCH"
    );
    assert.equal(
      doesTierNightSeriesEventMatch({
        currentRunId: "run-p",
        currentSeries: s,
        incomingRunId: "run-p",
        incomingPhase: "series_end",
      }).code,
      "PREMATURE_SERIES_END"
    );
  });
});

describe("FEATURE-TIERNIGHT-SERIES-01 - roster invariants", () => {
  it("détecte roster figé et refuse rebuild live", () => {
    assert.equal(isTierNightSeriesRosterFrozen({}), false);
    const session = {
      playerRoster: [
        { userId: "u1", displayName: "Alice" },
        { userId: "u2", displayName: "Bob" },
      ],
      items: ["Alice", "Bob"],
    };
    assert.equal(isTierNightSeriesRosterFrozen(session), true);
    assert.equal(assertTierNightSeriesUsesFrozenRoster(session).ok, true);
    assert.equal(
      assertTierNightSeriesUsesFrozenRoster({ playerRoster: session.playerRoster }).code,
      "MISSING_ITEMS_SNAPSHOT"
    );
    assert.equal(
      didTierNightSeriesRosterChange(session.playerRoster, session.playerRoster),
      false
    );
    assert.equal(
      didTierNightSeriesRosterChange(session.playerRoster, [
        ...session.playerRoster,
        { userId: "u3", displayName: "Cara" },
      ]),
      true
    );
  });
});
