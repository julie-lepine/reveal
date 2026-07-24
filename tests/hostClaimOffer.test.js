import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { HOST_TRANSFER_STALE_MS } from "../js/config/lobbyLifecycle.js";
import { resolveActingHostUserId } from "../js/core/hostPresence.js";
import {
  HOST_TRANSFER_STALE_SECONDS,
  isClaimHostCandidateServerLike,
  resolveActingHostServerLike,
} from "../js/core/gameSessionSecurity.js";

const NOW = 1_000_000_000_000;
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();

describe("ARCH-03b claim host eligibility (5 min)", () => {
  const hostId = "ffffffff-ffff-ffff-ffff-ffffffffffff";
  const guestLow = "11111111-1111-1111-1111-111111111111";
  const guestHigh = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

  it("HOST_TRANSFER_STALE = 5 minutes", () => {
    assert.equal(HOST_TRANSFER_STALE_MS, 5 * 60 * 1000);
    assert.equal(HOST_TRANSFER_STALE_SECONDS, 300);
  });

  it("hôte stale 2 min : encore présent au seuil transfert → pas de claim guest", () => {
    const members = [
      { userId: hostId, lastSeenAt: iso(2 * 60 * 1000) },
      { userId: guestLow, lastSeenAt: iso(1000) },
    ];
    assert.equal(
      resolveActingHostServerLike(members, hostId, NOW, HOST_TRANSFER_STALE_MS),
      hostId
    );
    assert.equal(isClaimHostCandidateServerLike(guestLow, members, hostId, NOW), false);
  });

  it("hôte stale 6 min : guest déterministe éligible au claim", () => {
    const members = [
      { userId: hostId, lastSeenAt: iso(6 * 60 * 1000) },
      { userId: guestHigh, lastSeenAt: iso(1000) },
      { userId: guestLow, lastSeenAt: iso(2000) },
    ];
    assert.equal(
      resolveActingHostUserId(members, hostId, NOW, HOST_TRANSFER_STALE_MS),
      guestLow
    );
    assert.equal(isClaimHostCandidateServerLike(guestLow, members, hostId, NOW), true);
    assert.equal(isClaimHostCandidateServerLike(guestHigh, members, hostId, NOW), false);
  });

  it("lastSeenAt null (legacy) : hôte traité présent → pas de claim", () => {
    const members = [
      { userId: hostId, lastSeenAt: null },
      { userId: guestLow, lastSeenAt: iso(1000) },
    ];
    assert.equal(
      resolveActingHostServerLike(members, hostId, NOW, HOST_TRANSFER_STALE_MS),
      hostId
    );
    assert.equal(isClaimHostCandidateServerLike(guestLow, members, hostId, NOW), false);
  });

  it("acting 120s ≠ claim 5min : guest acting technique mais pas encore claimable", () => {
    const members = [
      { userId: hostId, lastSeenAt: iso(150_000) }, // >120s, <5min
      { userId: guestLow, lastSeenAt: iso(1000) },
    ];
    assert.equal(resolveActingHostUserId(members, hostId, NOW), guestLow);
    assert.equal(
      resolveActingHostUserId(members, hostId, NOW, HOST_TRANSFER_STALE_MS),
      hostId
    );
    assert.equal(isClaimHostCandidateServerLike(guestLow, members, hostId, NOW), false);
  });
});
