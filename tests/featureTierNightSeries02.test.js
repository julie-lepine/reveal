/**
 * FEATURE-TIERNIGHT-SERIES-02 — sérialisation / hydratation / préservation série.
 * Exercice des helpers runtime purs (pas d’import gameSync / Supabase).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildTierNightSeriesQueue,
  createTierNightSeriesState,
  tierNightSeriesToRemote,
  hydrateTierNightSeriesFromRemote,
  resolveTierNightSeriesMerge,
  mergeTierNightRemoteBlob,
  applySeriesDecisionToTierNightGame,
  assertTierNightSeriesActiveTopicInvariant,
  doTierNightSeriesQueuesMatch,
  tierNightSeriesQueueFingerprint,
  withTierNightSeriesRemote,
  TIER_NIGHT_SERIES_ALL_CATEGORIES,
} from "../js/core/tierNightSeries.js";
import { TIER_NIGHT_ROSTER_TOPICS } from "../data/tierTopics.js";
import { ROSTER_TOPIC_PREFIX } from "../js/core/rosterTopic.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

function identityRng() {
  return () => 0;
}

function makeSeries(runId = "run-s2", roundCount = 3) {
  const built = buildTierNightSeriesQueue({
    runId,
    topics: TIER_NIGHT_ROSTER_TOPICS,
    categoryIds: [TIER_NIGHT_SERIES_ALL_CATEGORIES],
    roundCount,
    rng: identityRng(),
  });
  assert.equal(built.ok, true, built.code);
  const created = createTierNightSeriesState({
    runId,
    categoryIds: [TIER_NIGHT_SERIES_ALL_CATEGORIES],
    roundCount,
    queue: built.queue,
  });
  assert.equal(created.ok, true, created.code);
  return created.series;
}

/** Miroir minimal des champs classic (hors series) — wiring series via withTierNightSeriesRemote. */
function classicRemoteBase(overrides = {}) {
  return {
    runId: "run-s2",
    topicId: `${ROSTER_TOPIC_PREFIX}apocalypse`,
    mode: "roster",
    modifier: "normal",
    lobbyStarted: true,
    game: true,
    items: ["Alice", "Bob"],
    playerRoster: [
      { userId: "u1", displayName: "Alice" },
      { userId: "u2", displayName: "Bob" },
    ],
    listName: "Qui survit à l'apocalypse ?",
    topicEmoji: "🧟",
    placements: {},
    finished: {},
    recap: null,
    ...overrides,
  };
}

describe("FEATURE-TIERNIGHT-SERIES-02 - round-trip", () => {
  it("série valide local → remote → local sans perte ni mutation", () => {
    const series = makeSeries();
    const before = JSON.stringify(series);
    const wired = tierNightSeriesToRemote(series, { runId: "run-s2" });
    assert.equal(wired.ok, true);
    const hydrated = hydrateTierNightSeriesFromRemote(wired.series, {
      runId: "run-s2",
    });
    assert.equal(hydrated.kind, "series");
    assert.equal(JSON.stringify(hydrated.series), before);
    assert.equal(JSON.stringify(series), before);
    assert.equal(
      tierNightSeriesQueueFingerprint(hydrated.series),
      tierNightSeriesQueueFingerprint(series)
    );
  });

  it("withTierNightSeriesRemote embarque series valide et omet invalide", () => {
    const series = makeSeries();
    const active = series.queue[0];
    const remote = withTierNightSeriesRemote(
      classicRemoteBase({
        topicId: active.topicId,
        listName: active.topicSnapshot.name,
        topicEmoji: active.topicSnapshot.emoji,
      }),
      series,
      { runId: "run-s2" }
    );
    assert.ok(remote.series);
    assert.equal(remote.series.roundCount, 3);
    assert.deepEqual(remote.series.queue, series.queue);

    const remoteLegacy = withTierNightSeriesRemote(classicRemoteBase(), undefined);
    assert.equal(Object.prototype.hasOwnProperty.call(remoteLegacy, "series"), false);

    const remoteBad = withTierNightSeriesRemote(
      classicRemoteBase(),
      { ...series, version: 99 },
      { runId: "run-s2" }
    );
    assert.equal(Object.prototype.hasOwnProperty.call(remoteBad, "series"), false);
  });
});

describe("FEATURE-TIERNIGHT-SERIES-02 - legacy", () => {
  it("absence de series → legacy", () => {
    assert.equal(hydrateTierNightSeriesFromRemote(null).kind, "legacy");
    assert.equal(hydrateTierNightSeriesFromRemote(undefined).kind, "legacy");
    const decision = resolveTierNightSeriesMerge({
      remoteHasSeriesKey: false,
      remoteRunId: "r1",
      localSeries: null,
      localRunId: null,
      source: "full",
    });
    assert.equal(decision.action, "clear");
    assert.equal(decision.kind, "legacy");
  });

  it("blob mono-thème sans série artificielle", () => {
    const remote = withTierNightSeriesRemote(
      classicRemoteBase({ runId: "r-mono", topicId: `${ROSTER_TOPIC_PREFIX}soiree` }),
      null
    );
    assert.equal(Object.prototype.hasOwnProperty.call(remote, "series"), false);
  });
});

describe("FEATURE-TIERNIGHT-SERIES-02 - corruption", () => {
  it("ne convertit pas une série invalide en legacy republishable", () => {
    const series = makeSeries();
    const bad = { ...series, version: 9 };
    const wired = tierNightSeriesToRemote(bad, { runId: "run-s2" });
    assert.equal(wired.ok, false);
    const hyd = hydrateTierNightSeriesFromRemote(bad, { runId: "run-s2" });
    assert.equal(hyd.kind, "invalid");
  });

  it("divergence topicId / manche active rejetée ; local valide conservé", () => {
    const series = makeSeries();
    const decision = resolveTierNightSeriesMerge({
      remoteHasSeriesKey: true,
      remoteSeries: series,
      remoteRunId: "run-s2",
      localSeries: series,
      localRunId: "run-s2",
      remoteTopicId: `${ROSTER_TOPIC_PREFIX}not-the-active-one`,
      source: "full",
    });
    assert.equal(decision.action, "keep_local_reject_remote");
    assert.equal(decision.diagnostic.code, "ACTIVE_TOPIC_MISMATCH");
    assert.ok(decision.series);
  });

  it("queue divergente même runId rejetée", () => {
    const a = makeSeries("run-s2", 3);
    const b = makeSeries("run-s2", 5);
    assert.equal(doTierNightSeriesQueuesMatch(a, b), false);
    const decision = resolveTierNightSeriesMerge({
      remoteHasSeriesKey: true,
      remoteSeries: b,
      remoteRunId: "run-s2",
      localSeries: a,
      localRunId: "run-s2",
      remoteTopicId: b.queue[0].topicId,
      source: "full",
    });
    assert.equal(decision.action, "keep_local_reject_remote");
    assert.equal(decision.diagnostic.code, "QUEUE_DIVERGENCE_SAME_RUN");
  });

  it("invariant thème actif", () => {
    const series = makeSeries();
    const ok = assertTierNightSeriesActiveTopicInvariant({
      topicId: series.queue[0].topicId,
      listName: series.queue[0].topicSnapshot.name,
      topicEmoji: series.queue[0].topicSnapshot.emoji,
      series,
      runId: "run-s2",
    });
    assert.equal(ok.ok, true);
    const bad = assertTierNightSeriesActiveTopicInvariant({
      topicId: `${ROSTER_TOPIC_PREFIX}__nope__`,
      series,
      runId: "run-s2",
    });
    assert.equal(bad.ok, false);
    assert.equal(bad.code, "ACTIVE_TOPIC_MISMATCH");
  });
});

describe("FEATURE-TIERNIGHT-SERIES-02 - patches partiels", () => {
  it("patch placements/finished/recap préserve series", () => {
    const series = makeSeries();
    const current = {
      runId: "run-s2",
      topicId: series.queue[0].topicId,
      lobbyStarted: true,
      series,
      placements: {},
      finished: {},
    };
    const { tierNight, decision } = mergeTierNightRemoteBlob(
      current,
      {
        placements: { u1: { S: ["Alice"] } },
        finished: { u1: true },
      },
      { source: "patch" }
    );
    assert.equal(decision.action, "preserve_local");
    assert.ok(tierNight.series);
    assert.equal(JSON.stringify(tierNight.series), JSON.stringify(series));
    assert.deepEqual(tierNight.placements, { u1: { S: ["Alice"] } });
  });

  it("clear explicite series:null sur patch", () => {
    const series = makeSeries();
    const { tierNight, decision } = mergeTierNightRemoteBlob(
      { runId: "run-s2", series },
      { series: null, lobbyStarted: false },
      { source: "patch" }
    );
    assert.equal(decision.action, "clear");
    assert.equal(Object.prototype.hasOwnProperty.call(tierNight, "series"), false);
  });

  it("full remote sans series clear (legacy / reset)", () => {
    const series = makeSeries();
    const decision = resolveTierNightSeriesMerge({
      remoteHasSeriesKey: false,
      remoteRunId: "run-new",
      localSeries: series,
      localRunId: "run-s2",
      source: "full",
    });
    assert.equal(decision.action, "clear");
    const game = applySeriesDecisionToTierNightGame(
      { runId: "run-s2", series, recaps: [] },
      decision
    );
    assert.equal(Object.prototype.hasOwnProperty.call(game, "series"), false);
  });
});

describe("FEATURE-TIERNIGHT-SERIES-02 - full push / runId", () => {
  it("autre runId : apply remote series (pas de fusion de queues)", () => {
    const oldS = makeSeries("run-old", 3);
    const newS = makeSeries("run-new", 3);
    const decision = resolveTierNightSeriesMerge({
      remoteHasSeriesKey: true,
      remoteSeries: newS,
      remoteRunId: "run-new",
      localSeries: oldS,
      localRunId: "run-old",
      remoteTopicId: newS.queue[0].topicId,
      source: "full",
    });
    assert.equal(decision.action, "apply_remote");
    assert.equal(decision.series.roundCount, 3);
    assert.ok(doTierNightSeriesQueuesMatch(decision.series, newS));
  });
});

describe("FEATURE-TIERNIGHT-SERIES-02 - roster figé", () => {
  it("round-trip conserve playerRoster indépendamment des membres live", () => {
    const series = makeSeries();
    const roster = [
      { userId: "u1", displayName: "Alice" },
      { userId: "u2", displayName: "Bob" },
    ];
    const items = ["Alice", "Bob"];
    const remote = withTierNightSeriesRemote(
      classicRemoteBase({
        topicId: series.queue[0].topicId,
        listName: series.queue[0].topicSnapshot.name,
        topicEmoji: series.queue[0].topicSnapshot.emoji,
        items,
        playerRoster: roster,
      }),
      series,
      { runId: "run-s2" }
    );
    const liveMembers = [...roster, { userId: "u3", displayName: "Cara" }];
    assert.notEqual(liveMembers.length, remote.playerRoster.length);
    assert.deepEqual(remote.playerRoster, roster);
    assert.deepEqual(remote.items, items);
    assert.ok(remote.series);
  });
});

describe("FEATURE-TIERNIGHT-SERIES-02 - wiring gameSync (contrat source)", () => {
  it("tierNightToRemote / patch merge / hydrate branchent les helpers série", () => {
    const src = readFileSync(join(ROOT, "js/core/gameSync.js"), "utf8");
    assert.match(src, /withTierNightSeriesRemote/);
    assert.match(src, /mergeTierNightRemoteBlob/);
    assert.match(src, /resolveTierNightSeriesMerge/);
    assert.match(src, /applySeriesDecisionToTierNightGame/);
    assert.match(src, /FEATURE-TIERNIGHT-SERIES-02/);
  });

  it("contribute_game_session_player utilise jsonb_set nested (préserve series)", () => {
    const sql = readFileSync(
      join(ROOT, "supabase/game-sessions-i08-arch03.sql"),
      "utf8"
    );
    assert.match(sql, /contribute_game_session_player/);
    assert.match(sql, /jsonb_set/);
    assert.match(sql, /v_path := array\[v_state_key, v_map, v_uid_text\]/);
  });
});
