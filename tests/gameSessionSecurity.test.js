import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  HOST_PRESENCE_STALE_SECONDS,
  isActingHostServerLike,
  isContributePairAllowed,
  resolveActingHostServerLike,
} from "../js/core/gameSessionSecurity.js";

const NOW = 1_000_000_000_000;
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();

describe("is_acting_host (miroir serveur)", () => {
  it("hôte présent (last_seen null = présent) reste l'acting", () => {
    const members = [
      { userId: "host", lastSeenAt: null },
      { userId: "aaa", lastSeenAt: iso(1000) },
    ];
    assert.equal(resolveActingHostServerLike(members, "host", NOW), "host");
    assert.equal(isActingHostServerLike("aaa", members, "host", NOW), false);
    assert.equal(isActingHostServerLike("host", members, "host", NOW), true);
  });

  it("hôte stale → min uuid présent", () => {
    const stale = HOST_PRESENCE_STALE_SECONDS * 1000 + 1;
    const members = [
      { userId: "host", lastSeenAt: iso(stale) },
      { userId: "bbb", lastSeenAt: iso(1000) },
      { userId: "aaa", lastSeenAt: iso(1000) },
    ];
    assert.equal(resolveActingHostServerLike(members, "host", NOW), "aaa");
    assert.equal(isActingHostServerLike("aaa", members, "host", NOW), true);
    assert.equal(isActingHostServerLike("host", members, "host", NOW), false);
  });

  it("retour hôte réel retire acting", () => {
    const members = [
      { userId: "host", lastSeenAt: iso(1000) },
      { userId: "aaa", lastSeenAt: iso(1000) },
    ];
    assert.equal(resolveActingHostServerLike(members, "host", NOW), "host");
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
