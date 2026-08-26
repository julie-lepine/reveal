/**
 * BUG-TRUTHMETER-02 - identité / merge (clear null, cross-run, no hint index).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildTruthMeterAuthorOrderUids,
  classifyTruthMeterIdentityEntry,
  normalizeTruthMeterAuthorOrder,
  getCurrentWritingAuthorUid,
  getSubmittedAffirmationAuthorUid,
  isLocalCurrentWritingAuthor,
  getTruthMeterAuthorDisplayName,
  mergeTruthMeterIdentityFields,
  migrateTruthMeterIdentityOnRename,
  isCanonicalUidAuthorOrder,
  evaluateTruthMeterSkipEligibility,
  classifyTruthMeterAuthorStatus,
} from "../js/core/truthMeterIdentity.js";

const UID_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const UID_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const UID_C = "cccccccc-cccc-cccc-cccc-cccccccccccc";

const roster = [
  { userId: UID_A, name: "Alice" },
  { userId: UID_B, name: "Bob" },
  { userId: UID_C, name: "Cam" },
];

describe("BUG-TRUTHMETER-02 truthMeterIdentity", () => {
  it("buildTruthMeterAuthorOrderUids: UIDs uniques, refuse UID manquant", () => {
    const ok = buildTruthMeterAuthorOrderUids([
      { userId: UID_A, name: "Alice" },
      { userId: UID_B, name: "Alice" },
      { userId: UID_A, name: "Alice" },
    ]);
    assert.equal(ok.ok, true);
    assert.deepEqual(ok.uids, [UID_A, UID_B]);
    const solo = buildTruthMeterAuthorOrderUids([{ userId: UID_A, name: "Alice" }]);
    assert.equal(solo.ok, true);
    assert.deepEqual(solo.uids, [UID_A]);
  });

  it("ordre entièrement UID : identité (roster incomplet OK)", () => {
    const order = [UID_A, UID_B, UID_C];
    assert.equal(isCanonicalUidAuthorOrder(order), true);
    const n = normalizeTruthMeterAuthorOrder(order, { roster: [] });
    assert.equal(n.ok, true);
    assert.deepEqual(n.order, order);
    assert.equal(n.changed, false);
  });

  it("ordre legacy résoluble entrée par entrée", () => {
    const n = normalizeTruthMeterAuthorOrder(["Alice", "Bob"], { roster });
    assert.equal(n.ok, true);
    assert.deepEqual(n.order, [UID_A, UID_B]);
  });

  it("pseudo dupliqué → unresolved, pas de choix", () => {
    const dup = [
      { userId: UID_A, name: "Sam" },
      { userId: UID_B, name: "Sam" },
    ];
    assert.equal(classifyTruthMeterIdentityEntry("Sam", dup).kind, "ambiguous");
    assert.equal(normalizeTruthMeterAuthorOrder(["Sam"], { roster: dup }).ok, false);
  });

  it("interdit hint positionnel : même longueur ne contamine pas", () => {
    const remote = ["OldA", "OldB"];
    const localShuffle = [UID_B, UID_A];
    const n = normalizeTruthMeterAuthorOrder(remote, {
      roster,
      localHintOrder: localShuffle,
    });
    assert.equal(n.ok, false);
    assert.ok(n.unresolved.length >= 1);
  });

  it("writing + affirmation null → auteur via authorOrder[roundIdx]", () => {
    const r = getCurrentWritingAuthorUid(
      {
        phase: "writing",
        affirmation: null,
        authorOrder: [UID_A, UID_B, UID_C],
        roundIdx: 1,
      },
      { roster }
    );
    assert.equal(r.uid, UID_B);
    assert.equal(r.unresolved, false);
  });

  it("affirmation stale ne gouverne pas le writing", () => {
    const r = getCurrentWritingAuthorUid(
      {
        phase: "writing",
        affirmation: null,
        authorOrder: [UID_A, UID_B],
        roundIdx: 1,
      },
      { roster }
    );
    assert.equal(r.uid, UID_B);
    // Même si on inventait une stale côté appelant, null clear = order only
  });

  it("voting + affirmation → auteur via affirmation.authorUid", () => {
    const r = getCurrentWritingAuthorUid(
      {
        phase: "voting",
        affirmation: { authorUid: UID_A, author: "Bob", text: "x" },
        authorOrder: [UID_B, UID_A],
        roundIdx: 0,
      },
      { roster }
    );
    assert.equal(r.uid, UID_A);
    assert.equal(
      getSubmittedAffirmationAuthorUid(
        { affirmation: { authorUid: UID_A, author: "Bob", text: "x" } },
        { roster }
      ).uid,
      UID_A
    );
  });

  it("authorUid prioritaire sur snapshot author (désaccord)", () => {
    const name = getTruthMeterAuthorDisplayName(
      {
        phase: "voting",
        affirmation: { authorUid: UID_A, author: "Bob", text: "x" },
        authorOrder: [UID_A],
        roundIdx: 0,
      },
      { roster, nameForUid: () => null }
    );
    assert.equal(name, "Alice");
  });

  it("merge : remote affirmation null purge la locale", () => {
    const local = {
      runId: "run-1",
      authorOrder: [UID_A, UID_B],
      affirmation: { authorUid: UID_A, author: "Alice", text: "old" },
      phase: "writing",
      roundIdx: 1,
    };
    const remote = {
      runId: "run-1",
      authorOrder: [UID_A, UID_B],
      affirmation: null,
      phase: "writing",
      roundIdx: 1,
    };
    const merged = mergeTruthMeterIdentityFields(local, remote, { roster });
    assert.equal(merged.affirmation, null);
    assert.deepEqual(merged.authorOrder, [UID_A, UID_B]);
    assert.equal(
      getCurrentWritingAuthorUid({ ...remote, ...merged }, { roster }).uid,
      UID_B
    );
  });

  it("merge : cross-run ignore affirmation locale", () => {
    const local = {
      runId: "run-old",
      authorOrder: [UID_A, UID_B],
      affirmation: { authorUid: UID_A, author: "Alice", text: "zombie" },
    };
    const remote = {
      runId: "run-new",
      authorOrder: [UID_B, UID_C, UID_A],
      affirmation: null,
      phase: "writing",
      roundIdx: 0,
    };
    const merged = mergeTruthMeterIdentityFields(local, remote, { roster });
    assert.equal(merged.affirmation, null);
    assert.deepEqual(merged.authorOrder, [UID_B, UID_C, UID_A]);
  });

  it("merge : remote UID exact même roster vide", () => {
    const remote = {
      runId: "r1",
      authorOrder: [UID_C, UID_A, UID_B],
      affirmation: null,
    };
    const local = {
      runId: "r1",
      authorOrder: ["Alice", "Bob", "Cam"],
      affirmation: { authorUid: UID_A, text: "x" },
    };
    const merged = mergeTruthMeterIdentityFields(local, remote, { roster: [] });
    assert.deepEqual(merged.authorOrder, [UID_C, UID_A, UID_B]);
    assert.equal(merged.affirmation, null);
  });

  it("trois clients simulés → même résultat après merge nouveau remote", () => {
    const remote = {
      runId: "run-new",
      authorOrder: [UID_B, UID_A, UID_C],
      affirmation: null,
      phase: "writing",
      roundIdx: 0,
    };
    const hostLocal = {
      runId: "run-new",
      authorOrder: [UID_B, UID_A, UID_C],
      affirmation: null,
    };
    const guest1 = {
      runId: "run-old",
      authorOrder: [UID_A, UID_B, UID_C],
      affirmation: { authorUid: UID_A, author: "Host", text: "old" },
    };
    const guest2 = {
      runId: "run-old",
      authorOrder: ["Alice", "Bob", "Cam"],
      affirmation: { author: "Alice", text: "legacy" },
    };
    const m0 = mergeTruthMeterIdentityFields(hostLocal, remote, { roster });
    const m1 = mergeTruthMeterIdentityFields(guest1, remote, { roster });
    const m2 = mergeTruthMeterIdentityFields(guest2, remote, { roster });
    assert.deepEqual(m0.authorOrder, m1.authorOrder);
    assert.deepEqual(m1.authorOrder, m2.authorOrder);
    assert.equal(m0.affirmation, null);
    assert.equal(m1.affirmation, null);
    assert.equal(m2.affirmation, null);
    const session = { ...remote, ...m1 };
    assert.equal(getCurrentWritingAuthorUid(session, { roster }).uid, UID_B);
  });

  it("rotation : writing round 0/1/2 sans stale", () => {
    const order = [UID_A, UID_B, UID_C];
    for (const idx of [0, 1, 2]) {
      const uid = getCurrentWritingAuthorUid(
        { phase: "writing", affirmation: null, authorOrder: order, roundIdx: idx },
        { roster }
      ).uid;
      assert.equal(uid, order[idx]);
    }
  });

  it("isLocalCurrentWritingAuthor après rename cosmétique", () => {
    const session = {
      phase: "writing",
      affirmation: null,
      authorOrder: [UID_A, UID_B],
      roundIdx: 0,
    };
    const renamed = [{ userId: UID_A, name: "Alicia" }, { userId: UID_B, name: "Bob" }];
    assert.equal(isLocalCurrentWritingAuthor(session, UID_A, { roster: renamed }), true);
    assert.equal(isLocalCurrentWritingAuthor(session, UID_B, { roster: renamed }), false);
  });

  it("I-09 : ordre UID no-op (longueur préservée, pas de dédup)", () => {
    const tm = {
      authorOrder: [UID_B, UID_A, UID_C],
      affirmation: { authorUid: UID_A, author: "Alice", text: "x" },
    };
    const out = migrateTruthMeterIdentityOnRename(tm, {
      oldName: "Alice",
      newName: "Alicia",
      localUid: UID_A,
      knownUids: [UID_A, UID_B, UID_C],
    });
    assert.deepEqual(out.authorOrder, [UID_B, UID_A, UID_C]);
    assert.equal(out.affirmation.authorUid, UID_A);
    assert.equal(out.affirmation.author, "Alicia");
  });

  it("skip : présent → refusé ; absent → ok ; unresolved → pas absent", () => {
    const session = {
      phase: "writing",
      affirmation: null,
      authorOrder: [UID_B, UID_A],
      roundIdx: 0,
      runId: "r1",
    };
    const present = evaluateTruthMeterSkipEligibility(session, {
      canActAsHost: true,
      roster,
      rosterHydrated: true,
      isPresent: () => true,
    });
    assert.equal(present.ok, false);
    assert.equal(present.reason, "author-present");

    const absent = evaluateTruthMeterSkipEligibility(session, {
      canActAsHost: true,
      roster,
      rosterHydrated: true,
      isPresent: (p) => String(p.userId) !== UID_B,
    });
    assert.equal(absent.ok, true);

    const unresolved = evaluateTruthMeterSkipEligibility(
      { ...session, authorOrder: ["Ghost"], roundIdx: 0 },
      { canActAsHost: true, roster, rosterHydrated: true, isPresent: () => false }
    );
    assert.equal(unresolved.ok, false);
    assert.notEqual(unresolved.authorStatus, "resolved-absent");

    assert.equal(
      classifyTruthMeterAuthorStatus(session, {
        roster,
        rosterHydrated: true,
        isPresent: () => true,
      }).status,
      "resolved-present"
    );
  });

  it("skip refusé si affirmation déjà présente", () => {
    const r = evaluateTruthMeterSkipEligibility(
      {
        phase: "writing",
        affirmation: { authorUid: UID_A, text: "x" },
        authorOrder: [UID_A],
        roundIdx: 0,
      },
      { canActAsHost: true, roster, rosterHydrated: true, isPresent: () => false }
    );
    assert.equal(r.ok, false);
    assert.equal(r.reason, "affirmation-present");
  });
});
