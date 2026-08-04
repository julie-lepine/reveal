import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildClutchParticipantsSnapshot,
  normalizeClutchParticipantEntries,
  resolveClutchParticipantNames,
  sessionHasClutchParticipantSnapshot,
  clutchAllTapsIn,
  rankClutchEntries,
  migrateClutchParticipantsRename,
} from "../js/core/clutchParticipants.js";
import { buildLaunchRoster } from "../js/core/prepRoster.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const lobby3 = [
  { name: "Alice", userId: "u-a", isHost: true },
  { name: "Bob", userId: "u-b", isHost: false },
  { name: "Charlie", userId: "u-c", isHost: false },
];

describe("UX-CLUTCH-01 - snapshot participants", () => {
  it("1. force-start Alice+Bob : taps complets → allIn ; Charlie hors verdict", () => {
    const { roster, excluded } = buildLaunchRoster(lobby3, {
      Alice: true,
      Bob: true,
    });
    assert.deepEqual(roster.sort(), ["Alice", "Bob"]);
    assert.deepEqual(excluded, ["Charlie"]);

    const participants = buildClutchParticipantsSnapshot(roster, lobby3);
    const session = { participants };
    const taps = {
      Alice: { ms: 4000, at: 1 },
      Bob: { ms: 4100, at: 2 },
      Charlie: { ms: 100, at: 0 }, // parasite
    };
    const activeNow = ["Alice", "Bob", "Charlie"];

    assert.equal(
      clutchAllTapsIn(session, taps, { activeNames: activeNow }),
      true
    );

    const ranking = rankClutchEntries(
      taps,
      4000,
      resolveClutchParticipantNames(session, { activeNames: activeNow })
    );
    assert.deepEqual(
      ranking.map((r) => r.name),
      ["Alice", "Bob"]
    );
    assert.equal(ranking.some((r) => r.name === "Charlie"), false);
  });

  it("2. lancement normal : snapshot persisté, pas le fallback legacy", () => {
    const { roster } = buildLaunchRoster(lobby3, {
      Alice: true,
      Bob: true,
      Charlie: true,
    });
    const participants = buildClutchParticipantsSnapshot(roster, lobby3);
    assert.equal(sessionHasClutchParticipantSnapshot({ participants }), true);
    assert.deepEqual(
      participants.map((p) => p.name).sort(),
      ["Alice", "Bob", "Charlie"]
    );
    assert.ok(participants.every((p) => p.userId));

    // Même si le lobby live change, le snapshot reste la source.
    const names = resolveClutchParticipantNames(
      { participants },
      { activeNames: ["Alice", "Bob", "Charlie", "Dave"] }
    );
    assert.deepEqual(names.sort(), ["Alice", "Bob", "Charlie"]);
  });

  it("3. participant sans tap → allIn false ; ranking non tapé", () => {
    const participants = buildClutchParticipantsSnapshot(["Alice", "Bob"], lobby3);
    const session = { participants };
    const taps = { Alice: { ms: 3000, at: 1 } };
    assert.equal(clutchAllTapsIn(session, taps, { activeNames: ["Alice", "Bob"] }), false);
    const ranking = rankClutchEntries(taps, 3000, ["Alice", "Bob"]);
    const bob = ranking.find((r) => r.name === "Bob");
    assert.equal(bob.tapped, false);
    assert.equal(bob.gap, Infinity);
  });

  it("4. join mid-manche : nouveau lobby n’élargit pas le snapshot", () => {
    const participants = buildClutchParticipantsSnapshot(["Alice", "Bob"], lobby3);
    const session = { participants };
    const taps = {
      Alice: { ms: 1, at: 1 },
      Bob: { ms: 2, at: 2 },
    };
    const activeWithJoiner = ["Alice", "Bob", "Dave"];
    assert.equal(
      clutchAllTapsIn(session, taps, { activeNames: activeWithJoiner }),
      true
    );
    const names = resolveClutchParticipantNames(session, {
      activeNames: activeWithJoiner,
    });
    assert.equal(names.includes("Dave"), false);
  });

  it("5. leave mid-manche : participant reste ; sans tap → toujours attendu", () => {
    const participants = buildClutchParticipantsSnapshot(["Alice", "Bob"], lobby3);
    const session = { participants };
    const taps = { Alice: { ms: 1, at: 1 } };
    // Bob a quitté le lobby live
    const activeAfterLeave = ["Alice"];
    assert.equal(
      clutchAllTapsIn(session, taps, { activeNames: activeAfterLeave }),
      false
    );
    const ranking = rankClutchEntries(
      taps,
      1000,
      resolveClutchParticipantNames(session, { activeNames: activeAfterLeave })
    );
    assert.ok(ranking.some((r) => r.name === "Bob" && !r.tapped));
  });

  it("6. reconnexion : pas de doublon ; tap conservé sous le même nom", () => {
    const participants = buildClutchParticipantsSnapshot(["Alice", "Bob"], lobby3);
    const again = normalizeClutchParticipantEntries([
      ...participants,
      { userId: "u-a", name: "Alice" },
    ]);
    assert.equal(again.filter((p) => p.userId === "u-a").length, 1);
    assert.equal(again.filter((p) => p.name === "Alice").length, 1);

    const taps = { Alice: { ms: 4123, at: 99 } };
    const ranking = rankClutchEntries(taps, 4000, ["Alice", "Bob"]);
    assert.equal(ranking.find((r) => r.name === "Alice").ms, 4123);
  });

  it("7. ranking/scores bornés au snapshot ; tap parasite ignoré", () => {
    const names = ["Alice", "Bob"];
    const taps = {
      Alice: { ms: 5000, at: 1 },
      Bob: { ms: 5100, at: 2 },
      Charlie: { ms: 1, at: 0 },
    };
    const ranking = rankClutchEntries(taps, 5000, names);
    assert.equal(ranking.length, 2);
    assert.equal(ranking[0].name, "Alice");
  });

  it("8. chips / listes : uniquement snapshot ∩ taps", () => {
    const names = resolveClutchParticipantNames(
      {
        participants: buildClutchParticipantsSnapshot(["Alice", "Bob"], lobby3),
      },
      { activeNames: ["Alice", "Bob", "Charlie"] }
    );
    const taps = { Alice: { ms: 1, at: 1 }, Charlie: { ms: 2, at: 2 } };
    const chips = names.filter((n) => taps[n]?.ms != null);
    assert.deepEqual(chips, ["Alice"]);
  });

  it("9. wire shape round-trip participants (uid/name)", () => {
    const local = buildClutchParticipantsSnapshot(["Alice", "Bob"], lobby3);
    const remote = local.map((p) => ({ uid: p.userId, name: p.name }));
    const back = normalizeClutchParticipantEntries(
      remote.map((p) => ({ userId: p.uid, name: p.name }))
    );
    assert.deepEqual(back, local);
  });

  it("10. session legacy sans snapshot → fallback actifs, pas d’exception", () => {
    const session = { participants: [] };
    assert.equal(sessionHasClutchParticipantSnapshot(session), false);
    const names = resolveClutchParticipantNames(session, {
      activeNames: ["Alice", "Bob"],
    });
    assert.deepEqual(names, ["Alice", "Bob"]);
    assert.equal(
      clutchAllTapsIn(session, { Alice: { ms: 1, at: 1 }, Bob: { ms: 2, at: 2 } }, {
        activeNames: ["Alice", "Bob"],
      }),
      true
    );
  });

  it("11. rename mid-Clutch : résolution UID → un seul nom ; taps sous nouveau pseudo", () => {
    const participants = [
      { userId: "u-a", name: "Alice" },
      { userId: "u-b", name: "Bob" },
    ];
    const resolve = (uid) => (uid === "u-a" ? "Alicia" : uid === "u-b" ? "Bob" : null);
    const names = resolveClutchParticipantNames(
      { participants },
      { resolveNameByUserId: resolve, activeNames: ["Alicia", "Bob", "Alice"] }
    );
    assert.deepEqual(names, ["Alicia", "Bob"]);
    assert.equal(names.includes("Alice"), false);

    const migrated = migrateClutchParticipantsRename(participants, "Alice", "Alicia");
    assert.equal(migrated.find((p) => p.userId === "u-a").name, "Alicia");

    const taps = { Alicia: { ms: 2000, at: 1 } };
    assert.equal(
      clutchAllTapsIn(
        { participants: migrated },
        taps,
        { resolveNameByUserId: resolve, activeNames: ["Alicia", "Bob"] }
      ),
      false
    );
    assert.equal(
      clutchAllTapsIn(
        { participants: migrated },
        { Alicia: { ms: 1, at: 1 }, Bob: { ms: 2, at: 2 } },
        { resolveNameByUserId: resolve }
      ),
      true
    );
  });

  it("12. SYN-26 / first-tap helpers non réécrits dans clutchParticipants", () => {
    const src = readFileSync(join(root, "js/core/clutchParticipants.js"), "utf8");
    assert.equal(src.includes("mergeClutchTapsFrozen"), false);
    assert.equal(src.includes("preferInFlightClutchTap"), false);
  });

  it("markClutchLobbyStarted exige rosterNames (pas de fallback silencieux)", () => {
    const src = readFileSync(join(root, "js/core/clutchSession.js"), "utf8");
    assert.match(src, /CLUTCH_ROSTER_REQUIRED/);
    assert.match(src, /rosterNames/);
    assert.match(src, /buildClutchParticipantsSnapshot/);
  });

  it("executePrepLaunch transmet toujours le roster (force + normal)", () => {
    const src = readFileSync(join(root, "js/core/prepLaunch.js"), "utf8");
    assert.match(src, /const rosterNames = roster/);
    assert.equal(src.includes("force ? roster : undefined"), false);
  });

  it("surfaces Clutch migrées vers getClutchParticipantNames", () => {
    const game = readFileSync(join(root, "js/games/clutch.js"), "utf8");
    const session = readFileSync(join(root, "js/core/clutchSession.js"), "utf8");
    assert.match(game, /getClutchParticipantNames/);
    assert.equal(game.includes("getActivePlayerNames"), false);
    assert.match(session, /clutchAllTapsIn/);
    assert.match(session, /getClutchParticipantNames/);
  });

  it("13. autres jeux : helpers Clutch non branchés dans players.js", () => {
    const players = readFileSync(join(root, "js/core/players.js"), "utf8");
    assert.equal(players.includes("clutchParticipant"), false);
    assert.equal(players.includes("getClutchParticipant"), false);
  });
});
