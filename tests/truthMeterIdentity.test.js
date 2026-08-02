/**
 * BUG-TRUTHMETER-02 — helpers identité auteur (purs).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildTruthMeterAuthorOrderUids,
  classifyTruthMeterIdentityEntry,
  normalizeTruthMeterAuthorOrder,
  resolveTruthMeterAuthorUid,
  isLocalTruthMeterAuthor,
  getTruthMeterAuthorDisplayName,
  mergeTruthMeterIdentityFields,
  migrateTruthMeterIdentityOnRename,
  assertTruthMeterAuthorOrderWire,
} from "../js/core/truthMeterIdentity.js";

const roster = [
  { userId: "uid-a", name: "Alice" },
  { userId: "uid-b", name: "Bob" },
  { userId: "uid-c", name: "Cam" },
];

describe("BUG-TRUTHMETER-02 truthMeterIdentity", () => {
  it("buildTruthMeterAuthorOrderUids: UIDs uniques, refuse UID manquant", () => {
    const ok = buildTruthMeterAuthorOrderUids([
      { userId: "uid-a", name: "Alice" },
      { userId: "uid-b", name: "Alice" }, // doublon display OK
      { userId: "uid-a", name: "Alice" }, // doublon UID skip
    ]);
    assert.equal(ok.ok, true);
    assert.deepEqual(ok.uids, ["uid-a", "uid-b"]);

    const bad = buildTruthMeterAuthorOrderUids([
      { userId: "uid-a" },
      { userId: "", name: "X" },
    ]);
    assert.equal(bad.ok, false);
  });

  it("1 ordre entièrement UID", () => {
    const n = normalizeTruthMeterAuthorOrder(["uid-a", "uid-b"], { roster });
    assert.equal(n.ok, true);
    assert.deepEqual(n.order, ["uid-a", "uid-b"]);
    assert.equal(n.changed, false);
  });

  it("2 ordre entièrement legacy résoluble", () => {
    const n = normalizeTruthMeterAuthorOrder(["Alice", "Bob"], { roster });
    assert.equal(n.ok, true);
    assert.deepEqual(n.order, ["uid-a", "uid-b"]);
    assert.equal(n.changed, true);
  });

  it("3 ordre mixte", () => {
    const n = normalizeTruthMeterAuthorOrder(["uid-a", "Bob"], { roster });
    assert.equal(n.ok, true);
    assert.deepEqual(n.order, ["uid-a", "uid-b"]);
  });

  it("4 pseudo absent → unresolved", () => {
    const n = normalizeTruthMeterAuthorOrder(["Alice", "Zed"], { roster });
    assert.equal(n.ok, false);
    assert.equal(n.unresolved.length, 1);
    assert.equal(n.unresolved[0].value, "Zed");
  });

  it("5 pseudo dupliqué → ambiguous, pas de choix arbitraire", () => {
    const dupRoster = [
      { userId: "uid-a", name: "Sam" },
      { userId: "uid-b", name: "Sam" },
    ];
    const c = classifyTruthMeterIdentityEntry("Sam", dupRoster);
    assert.equal(c.kind, "ambiguous");
    assert.equal(c.uid, null);
    const n = normalizeTruthMeterAuthorOrder(["Sam"], { roster: dupRoster });
    assert.equal(n.ok, false);
  });

  it("6 renames sans preuve unique → unresolved", () => {
    const n = normalizeTruthMeterAuthorOrder(["OldAlice"], {
      roster,
      renames: [],
    });
    assert.equal(n.ok, false);
  });

  it("7 hint local même run / même longueur résout", () => {
    const n = normalizeTruthMeterAuthorOrder(["Alice", "Bob"], {
      roster,
      localHintOrder: ["uid-a", "uid-b"],
    });
    // déjà résolu via names ; avec noms absents :
    const n2 = normalizeTruthMeterAuthorOrder(["OldA", "OldB"], {
      roster,
      localHintOrder: ["uid-a", "uid-b"],
    });
    assert.equal(n2.ok, true);
    assert.deepEqual(n2.order, ["uid-a", "uid-b"]);
    assert.equal(n.ok, true);
  });

  it("8 hint d'un autre run / longueur différente refusé", () => {
    const n = normalizeTruthMeterAuthorOrder(["OldA", "OldB", "OldC"], {
      roster,
      localHintOrder: ["uid-a", "uid-b"],
    });
    assert.equal(n.ok, false);
  });

  it("9 longueur d'ordre différente refusée pour hints", () => {
    const n = normalizeTruthMeterAuthorOrder(["OldA"], {
      roster,
      localHintOrder: ["uid-a", "uid-b"],
    });
    assert.equal(n.ok, false);
  });

  it("10 normalisation idempotente", () => {
    const once = normalizeTruthMeterAuthorOrder(["Alice", "uid-b"], { roster });
    const twice = normalizeTruthMeterAuthorOrder(once.order, { roster });
    assert.deepEqual(twice.order, once.order);
    assert.equal(twice.changed, false);
  });

  it("11 authorUid prioritaire sur author", () => {
    const r = resolveTruthMeterAuthorUid(
      {
        authorOrder: ["uid-b"],
        roundIdx: 0,
        affirmation: { authorUid: "uid-a", author: "Bob", text: "x" },
      },
      { roster }
    );
    assert.equal(r.uid, "uid-a");
    assert.equal(r.unresolved, false);
  });

  it("12 désaccord UID / snapshot de nom : identité = UID", () => {
    const name = getTruthMeterAuthorDisplayName(
      {
        affirmation: { authorUid: "uid-a", author: "Bob", text: "x" },
        authorOrder: ["uid-a"],
        roundIdx: 0,
      },
      { roster, nameForUid: () => null }
    );
    assert.equal(name, "Alice");
  });

  it("13 ambiguïté : aucun choix arbitraire", () => {
    const r = resolveTruthMeterAuthorUid(
      {
        authorOrder: ["Sam"],
        roundIdx: 0,
        affirmation: { author: "Sam", text: "x" },
      },
      {
        roster: [
          { userId: "u1", name: "Sam" },
          { userId: "u2", name: "Sam" },
        ],
      }
    );
    assert.equal(r.unresolved, true);
    assert.equal(r.uid, null);
  });

  it("isLocalTruthMeterAuthor par UID après rename cosmétique", () => {
    const session = {
      authorOrder: ["uid-a", "uid-b"],
      roundIdx: 0,
      affirmation: null,
    };
    assert.equal(isLocalTruthMeterAuthor(session, "uid-a", { roster }), true);
    assert.equal(isLocalTruthMeterAuthor(session, "uid-b", { roster }), false);
    // roster renommé
    const renamed = [{ userId: "uid-a", name: "Alicia" }, { userId: "uid-b", name: "Bob" }];
    assert.equal(isLocalTruthMeterAuthor(session, "uid-a", { roster: renamed }), true);
  });

  it("merge : remote UID autoritaire ; legacy + hint local même run", () => {
    const local = {
      runId: "run-1",
      authorOrder: ["uid-a", "uid-b"],
      affirmation: { authorUid: "uid-a", author: "Alicia", text: "hi" },
      phase: "writing",
    };
    const remote = {
      runId: "run-1",
      authorOrder: ["Alice", "Bob"],
      affirmation: { author: "Alice", text: "hi" },
      phase: "writing",
    };
    const merged = mergeTruthMeterIdentityFields(local, remote, { roster });
    assert.deepEqual(merged.authorOrder, ["uid-a", "uid-b"]);
    assert.equal(merged.affirmation.authorUid, "uid-a");
  });

  it("merge : autre runId n'applique pas les hints locaux", () => {
    const local = {
      runId: "run-old",
      authorOrder: ["uid-a", "uid-b"],
      affirmation: { authorUid: "uid-a", author: "Alice", text: "old" },
    };
    const remote = {
      runId: "run-new",
      authorOrder: ["Ghost", "Bob"],
      affirmation: { author: "Ghost", text: "new" },
    };
    const merged = mergeTruthMeterIdentityFields(local, remote, { roster });
    assert.ok(merged.authorOrder.includes("Ghost") || merged.authorOrder[0] === "Ghost");
    assert.notEqual(merged.affirmation?.authorUid, "uid-a");
  });

  it("assertTruthMeterAuthorOrderWire refuse un ordre 100% noms", () => {
    const a = assertTruthMeterAuthorOrderWire(["Alice", "Bob"], ["uid-a", "uid-b"]);
    assert.equal(a.ok, false);
    const b = assertTruthMeterAuthorOrderWire(["uid-a", "uid-b"], ["uid-a", "uid-b"]);
    assert.equal(b.ok, true);
  });

  it("I-09 migrate : UID order inchangé ; legacy → UID si localUid", () => {
    const tm = {
      authorOrder: ["uid-a", "Bob"],
      affirmation: { author: "Alice", text: "x" },
    };
    const out = migrateTruthMeterIdentityOnRename(tm, {
      oldName: "Alice",
      newName: "Alicia",
      localUid: "uid-a",
      knownUids: ["uid-a", "uid-b"],
    });
    assert.deepEqual(out.authorOrder, ["uid-a", "Bob"]);
    assert.equal(out.affirmation.authorUid, "uid-a");
    assert.equal(out.affirmation.author, "Alicia");

    const uidOnly = migrateTruthMeterIdentityOnRename(
      { authorOrder: ["uid-a", "uid-b"], affirmation: { authorUid: "uid-a", author: "Alice", text: "x" } },
      { oldName: "Alice", newName: "Alicia", localUid: "uid-a", knownUids: ["uid-a", "uid-b"] }
    );
    assert.deepEqual(uidOnly.authorOrder, ["uid-a", "uid-b"]);
    assert.equal(uidOnly.affirmation.authorUid, "uid-a");
    assert.equal(uidOnly.affirmation.author, "Alicia");
  });
});
