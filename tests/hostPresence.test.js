import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { HOST_PRESENCE_STALE_MS } from "../js/config/lobbyLifecycle.js";
import { isMemberPresent, resolveActingHostUserId } from "../js/core/hostPresence.js";

const NOW = 1_000_000_000_000;
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();

describe("isMemberPresent", () => {
  it("considère présent un membre sans lastSeenAt (legacy)", () => {
    assert.equal(isMemberPresent({ userId: "a" }, NOW), true);
    assert.equal(isMemberPresent({ userId: "a", lastSeenAt: null }, NOW), true);
  });

  it("présent si heartbeat récent, absent si périmé", () => {
    assert.equal(isMemberPresent({ lastSeenAt: iso(10_000) }, NOW), true);
    assert.equal(isMemberPresent({ lastSeenAt: iso(HOST_PRESENCE_STALE_MS + 1) }, NOW), false);
  });

  it("tolère une date invalide en la traitant comme présente", () => {
    assert.equal(isMemberPresent({ lastSeenAt: "pas-une-date" }, NOW), true);
  });
});

describe("resolveActingHostUserId", () => {
  it("renvoie l'hôte réel quand il est présent", () => {
    const participants = [
      { userId: "host", isHost: true, lastSeenAt: iso(5_000) },
      { userId: "guest-1", lastSeenAt: iso(5_000) },
    ];
    assert.equal(resolveActingHostUserId(participants, "host", NOW), "host");
  });

  it("bascule sur le membre présent au plus petit userId si l'hôte est absent", () => {
    const participants = [
      { userId: "host", isHost: true, lastSeenAt: iso(HOST_PRESENCE_STALE_MS + 1) },
      { userId: "guest-b", lastSeenAt: iso(2_000) },
      { userId: "guest-a", lastSeenAt: iso(2_000) },
    ];
    assert.equal(resolveActingHostUserId(participants, "host", NOW), "guest-a");
  });

  it("ignore les invités également absents pour le repli", () => {
    const participants = [
      { userId: "host", isHost: true, lastSeenAt: iso(HOST_PRESENCE_STALE_MS + 1) },
      { userId: "guest-a", lastSeenAt: iso(HOST_PRESENCE_STALE_MS + 1) },
      { userId: "guest-b", lastSeenAt: iso(1_000) },
    ];
    assert.equal(resolveActingHostUserId(participants, "host", NOW), "guest-b");
  });

  it("retombe sur l'hôte si personne n'est présent", () => {
    const participants = [
      { userId: "host", isHost: true, lastSeenAt: iso(HOST_PRESENCE_STALE_MS + 1) },
      { userId: "guest-a", lastSeenAt: iso(HOST_PRESENCE_STALE_MS + 1) },
    ];
    assert.equal(resolveActingHostUserId(participants, "host", NOW), "host");
  });

  it("est déterministe : même résultat quel que soit l'ordre des participants", () => {
    const a = { userId: "guest-a", lastSeenAt: iso(2_000) };
    const b = { userId: "guest-b", lastSeenAt: iso(2_000) };
    const host = { userId: "host", isHost: true, lastSeenAt: iso(HOST_PRESENCE_STALE_MS + 1) };
    assert.equal(resolveActingHostUserId([host, a, b], "host", NOW), "guest-a");
    assert.equal(resolveActingHostUserId([b, host, a], "host", NOW), "guest-a");
  });

  it("renvoie hostId si la liste de participants est vide", () => {
    assert.equal(resolveActingHostUserId([], "host", NOW), "host");
  });
});
