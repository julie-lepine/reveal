import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { HOST_PRESENCE_STALE_MS } from "../js/config/lobbyLifecycle.js";
import {
  isMemberPresent,
  resolveActingHostUserId,
  didActingHostChange,
  detectActingHostTransition,
  needsActingHostUiRefresh,
} from "../js/core/hostPresence.js";

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

  it("aligne le tri UUID sur ORDER BY user_id::text (cas QA Mozilla/Brave)", () => {
    // Brave < Mozilla en ordre lexicographique uuid::text
    const mozilla = "e3e8e71f-1d27-4c2c-a8df-b062c531155d";
    const brave = "6c690ad3-7485-4352-bd78-7f27d756ba05";
    const participants = [
      { userId: "host", isHost: true, lastSeenAt: iso(HOST_PRESENCE_STALE_MS + 1) },
      { userId: mozilla, lastSeenAt: iso(1_000) },
      { userId: brave, lastSeenAt: iso(1_000) },
    ];
    assert.equal(resolveActingHostUserId(participants, "host", NOW), brave);
  });
});

describe("didActingHostChange", () => {
  it("false si l'hôte reste présent", () => {
    const participants = [
      { userId: "host", isHost: true, lastSeenAt: iso(5_000) },
      { userId: "guest-a", lastSeenAt: iso(5_000) },
    ];
    assert.equal(
      didActingHostChange(participants, "host", participants, "host", NOW),
      false
    );
  });

  it("true quand l'hôte passe de présent à stale", () => {
    const prev = [
      { userId: "host", isHost: true, lastSeenAt: iso(5_000) },
      { userId: "guest-a", lastSeenAt: iso(5_000) },
    ];
    const next = [
      { userId: "host", isHost: true, lastSeenAt: iso(HOST_PRESENCE_STALE_MS + 1) },
      { userId: "guest-a", lastSeenAt: iso(5_000) },
    ];
    assert.equal(didActingHostChange(prev, "host", next, "host", NOW), true);
  });

  it("true quand l'hôte revient (acting host rebascule)", () => {
    const prev = [
      { userId: "host", isHost: true, lastSeenAt: iso(HOST_PRESENCE_STALE_MS + 1) },
      { userId: "guest-a", lastSeenAt: iso(5_000) },
    ];
    const next = [
      { userId: "host", isHost: true, lastSeenAt: iso(1_000) },
      { userId: "guest-a", lastSeenAt: iso(5_000) },
    ];
    assert.equal(didActingHostChange(prev, "host", next, "host", NOW), true);
  });

  it("false si seul un heartbeat d'invité change sans bascule d'acting host", () => {
    const prev = [
      { userId: "host", isHost: true, lastSeenAt: iso(HOST_PRESENCE_STALE_MS + 1) },
      { userId: "guest-a", lastSeenAt: iso(5_000) },
      { userId: "guest-b", lastSeenAt: iso(5_000) },
    ];
    const next = [
      { userId: "host", isHost: true, lastSeenAt: iso(HOST_PRESENCE_STALE_MS + 1) },
      { userId: "guest-a", lastSeenAt: iso(1_000) },
      { userId: "guest-b", lastSeenAt: iso(2_000) },
    ];
    assert.equal(didActingHostChange(prev, "host", next, "host", NOW), false);
  });

  it("PIÈGE QA v95 : même lastSeenAt hôte figé + now qui avance → didActingHostChange avale la transition", () => {
    // Hôte lastSeen figé à t0 ; invité continue de battre. Seul `now` avance (poll 100s → 120s).
    const t0 = NOW;
    const hostLastSeen = new Date(t0).toISOString();
    const t100 = t0 + 100_000;
    const t120 = t0 + 120_001;
    const snapAt = (now) => [
      { userId: "host", isHost: true, lastSeenAt: hostLastSeen },
      { userId: "guest-a", lastSeenAt: new Date(now - 1_000).toISOString() },
    ];
    const at100 = snapAt(t100);
    const at120 = snapAt(t120);
    // Même logique que le bug : re-resolve(prev, now) === resolve(next, now) avec le même now
    assert.equal(
      didActingHostChange(at100, "host", at120, "host", t120),
      false,
      "re-resolve des deux côtés avec le même now avale la bascule"
    );
    assert.equal(resolveActingHostUserId(at100, "host", t100), "host");
    assert.equal(resolveActingHostUserId(at120, "host", t120), "guest-a");
  });
});

describe("detectActingHostTransition", () => {
  it("détecte ancien hôte → candidat au premier poll stale (100s→120s, lastSeen hôte figé)", () => {
    const t0 = NOW;
    const hostLastSeen = new Date(t0).toISOString();
    const t100 = t0 + 100_000;
    const t120 = t0 + 120_001;
    const snapAt = (now) => [
      { userId: "host", isHost: true, lastSeenAt: hostLastSeen },
      { userId: "guest-a", lastSeenAt: new Date(now - 1_000).toISOString() },
    ];

    // Poll ~100s : host encore acting, mémoriser
    const at100 = detectActingHostTransition("host", snapAt(t100), "host", t100);
    assert.equal(at100.before, "host");
    assert.equal(at100.after, "host");
    assert.equal(at100.changed, false);

    // Poll ~120s : stored before = ancien hôte, after = candidat
    const at120 = detectActingHostTransition("host", snapAt(t120), "host", t120);
    assert.equal(at120.before, "host", "actingHostBefore doit rester l'ancien hôte");
    assert.equal(at120.after, "guest-a");
    assert.equal(at120.changed, true);

    // Échoue si on avait déjà mémorisé le candidat (bug QA v95)
    const swallowed = detectActingHostTransition("guest-a", snapAt(t120), "host", t120);
    assert.equal(swallowed.before, "guest-a");
    assert.equal(swallowed.after, "guest-a");
    assert.equal(swallowed.changed, false);
  });

  it("ne nudge pas au premier apply (stored null)", () => {
    const participants = [
      { userId: "host", isHost: true, lastSeenAt: iso(5_000) },
      { userId: "guest-a", lastSeenAt: iso(5_000) },
    ];
    const t = detectActingHostTransition(null, participants, "host", NOW);
    assert.equal(t.before, null);
    assert.equal(t.after, "host");
    assert.equal(t.changed, false);
  });

  it("ne mute pas d'état externe (resolve pur)", () => {
    const participants = [
      { userId: "host", isHost: true, lastSeenAt: iso(HOST_PRESENCE_STALE_MS + 1) },
      { userId: "guest-a", lastSeenAt: iso(1_000) },
    ];
    const snapshot = JSON.stringify(participants);
    detectActingHostTransition("host", participants, "host", NOW);
    assert.equal(JSON.stringify(participants), snapshot);
  });
});

describe("needsActingHostUiRefresh", () => {
  it("nudge 0→1 force un full-render tant que non acquitté", () => {
    assert.equal(needsActingHostUiRefresh(0, 1), true);
    assert.equal(needsActingHostUiRefresh(1, 1), false);
    assert.equal(needsActingHostUiRefresh(1, 2), true);
  });

  it("après ack du token courant, les cycles suivants skippent", () => {
    const acked = 1;
    assert.equal(needsActingHostUiRefresh(acked, 1), false);
  });
});
