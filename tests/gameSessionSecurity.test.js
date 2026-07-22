import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  HOST_PRESENCE_STALE_SECONDS,
  isActingHostServerLike,
  isContributePairAllowed,
  resolveActingHostServerLike,
  resolveNonHostEveningScoresPolicy,
  EVENING_SCORES_RESERVED_MSG,
  validateActingHostPlayPatch,
} from "../js/core/gameSessionSecurity.js";
import { pickRemotePlayFields } from "../js/core/playPatch.js";

const NOW = 1_000_000_000_000;
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();

describe("is_acting_host (miroir serveur)", () => {
  it("hôte présent (last_seen null = présent) → tous les invités false", () => {
    const hostId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const guestA = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
    const guestB = "cccccccc-cccc-cccc-cccc-cccccccccccc";
    const members = [
      { userId: hostId, lastSeenAt: null },
      { userId: guestA, lastSeenAt: iso(1000) },
      { userId: guestB, lastSeenAt: iso(1000) },
    ];
    assert.equal(resolveActingHostServerLike(members, hostId, NOW), hostId);
    assert.equal(isActingHostServerLike(guestA, members, hostId, NOW), false);
    assert.equal(isActingHostServerLike(guestB, members, hostId, NOW), false);
    assert.equal(isActingHostServerLike(hostId, members, hostId, NOW), true);
  });

  it("hôte stale >120s → un seul invité élu (ORDER BY user_id::text)", () => {
    const stale = HOST_PRESENCE_STALE_SECONDS * 1000 + 1;
    const hostId = "ffffffff-ffff-ffff-ffff-ffffffffffff";
    const guestHigh = "dddddddd-dddd-dddd-dddd-dddddddddddd";
    const guestLow = "11111111-1111-1111-1111-111111111111";
    const guestMid = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const members = [
      { userId: hostId, lastSeenAt: iso(stale) },
      { userId: guestHigh, lastSeenAt: iso(1000) },
      { userId: guestMid, lastSeenAt: iso(2000) },
      { userId: guestLow, lastSeenAt: iso(500) },
    ];
    const elected = resolveActingHostServerLike(members, hostId, NOW);
    assert.equal(elected, guestLow);
    const flags = [guestLow, guestMid, guestHigh, hostId].map((uid) =>
      isActingHostServerLike(uid, members, hostId, NOW)
    );
    assert.deepEqual(flags, [true, false, false, false]);
    assert.equal(flags.filter(Boolean).length, 1);
  });

  it("retour hôte réel → ancien acting obtient false", () => {
    const hostId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const guestLow = "11111111-1111-1111-1111-111111111111";
    const stale = HOST_PRESENCE_STALE_SECONDS * 1000 + 1;

    const whileHostGone = [
      { userId: hostId, lastSeenAt: iso(stale) },
      { userId: guestLow, lastSeenAt: iso(1000) },
    ];
    assert.equal(isActingHostServerLike(guestLow, whileHostGone, hostId, NOW), true);

    const hostBack = [
      { userId: hostId, lastSeenAt: iso(1000) },
      { userId: guestLow, lastSeenAt: iso(1000) },
    ];
    assert.equal(resolveActingHostServerLike(hostBack, hostId, NOW), hostId);
    assert.equal(isActingHostServerLike(guestLow, hostBack, hostId, NOW), false);
    assert.equal(isActingHostServerLike(hostId, hostBack, hostId, NOW), true);
  });
});

describe("whitelist contribute game/kind", () => {
  it("autorise les paires nominales", () => {
    assert.equal(isContributePairAllowed("hottake", "ready"), true);
    assert.equal(isContributePairAllowed("hottake", "vote"), true);
    assert.equal(isContributePairAllowed("clutch", "tap"), true);
    assert.equal(isContributePairAllowed("traitre", "deal_ack"), true);
    assert.equal(isContributePairAllowed("guesslie", "submission"), true);
    assert.equal(isContributePairAllowed("tiernight", "placement"), true);
    assert.equal(isContributePairAllowed("tiernight", "finished"), true);
  });

  it("refuse les paires dangereuses", () => {
    assert.equal(isContributePairAllowed("hottake", "tap"), false);
    assert.equal(isContributePairAllowed("clutch", "vote"), false);
    assert.equal(isContributePairAllowed("tiernightlive", "placement"), false);
    assert.equal(isContributePairAllowed("menu", "ready"), false);
  });
});

describe("resolveNonHostEveningScoresPolicy (ARCH-03)", () => {
  it("sans flag evening → OK, pas de drop", () => {
    const r = resolveNonHostEveningScoresPolicy({
      withEveningScores: false,
      canActAsHost: false,
    });
    assert.equal(r.ok, true);
    assert.equal(r.dropEveningScores, false);
  });

  it("acting host + flag evening → OK play, drop evening (pas de popup)", () => {
    const r = resolveNonHostEveningScoresPolicy({
      withEveningScores: true,
      canActAsHost: true,
    });
    assert.equal(r.ok, true);
    assert.equal(r.dropEveningScores, true);
    assert.equal(r.error, undefined);
  });

  it("invité ordinaire + flag evening → erreur exacte de la popup QA", () => {
    const r = resolveNonHostEveningScoresPolicy({
      withEveningScores: true,
      canActAsHost: false,
    });
    assert.equal(r.ok, false);
    assert.equal(r.error, EVENING_SCORES_RESERVED_MSG);
    assert.equal(r.error, "Scores de soirée réservés à l'hôte.");
  });
});

describe("validateActingHostPlayPatch (Hot Take reveal)", () => {
  it("accepte le payload reveal Hot Take (phase + takeScored + matchScores + lastRound)", () => {
    const playPatch = pickRemotePlayFields(
      {
        phase: "reveal",
        takeScored: true,
        votes: { u1: "A" },
        voteEndsAt: null,
        matchScores: { u1: 2 },
        lastRound: { majority: "A", deltas: { u1: 2 } },
        deck: [{ id: 1 }],
        lobbyStarted: true,
      },
      {
        phase: "reveal",
        takeScored: true,
        votes: { u1: "A" },
        voteEndsAt: null,
        matchScores: { u1: 2 },
        lastRound: { majority: "A", deltas: { u1: 2 } },
      }
    );
    assert.deepEqual(Object.keys(playPatch).sort(), [
      "lastRound",
      "matchScores",
      "phase",
      "takeScored",
      "voteEndsAt",
      "votes",
    ]);
    assert.equal(validateActingHostPlayPatch(playPatch).ok, true);
  });

  it("accepte next Hot Take (intermissionEndsAt + takeScored)", () => {
    const playPatch = {
      phase: "voting",
      takeIdx: 1,
      votes: {},
      takeScored: false,
      voteEndsAt: "2026-01-01T00:00:00.000Z",
      intermissionEndsAt: null,
      pausedBy: null,
    };
    assert.equal(validateActingHostPlayPatch(playPatch).ok, true);
  });

  it("refuse un champ evening / hors whitelist", () => {
    assert.equal(validateActingHostPlayPatch({ scores: { a: 1 } }).ok, false);
    assert.equal(validateActingHostPlayPatch({ scores: { a: 1 } }).key, "scores");
    assert.equal(validateActingHostPlayPatch({ unknownField: 1 }).ok, false);
  });
});
