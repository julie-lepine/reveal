/**
 * AUDIT-004 — delete dernière custom TierNight : [] doit se propager chez le Guest.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveCustomRosterTopicsFromRemote } from "../js/core/tierNightCustomRosterClear.js";
import { resolveCustomLiveTierListsFromRemote } from "../js/core/customLiveTierListsSyncGuard.js";
import { CUSTOM_ROSTER_TOPIC_ID_PREFIX } from "../js/core/customRosterTopics.js";

function rosterTopic(id, name, author, authorUid) {
  return {
    id: `${CUSTOM_ROSTER_TOPIC_ID_PREFIX}${id}`,
    name,
    custom: true,
    author,
    authorUid,
  };
}

function liveList(n, authorUid = `uid-${n}`) {
  return {
    id: `custom-live-${n}`,
    name: `List${n}`,
    emoji: "✨",
    items: ["a", "b", "c", "d"],
    author: `Author${n}`,
    authorUid,
    custom: true,
  };
}

describe("AUDIT-004 roster hydrate [B]→[]", () => {
  const hostUid = "uid-host";
  const guestUid = "uid-guest";
  const A = rosterTopic("a", "ThemeA", "Host", hostUid);
  const B = rosterTopic("b", "ThemeB", "Host", hostUid);

  it("A — [A,B] → incoming [B] → [B]", () => {
    const out = resolveCustomRosterTopicsFromRemote({
      remoteList: [B],
      localBefore: [A, B],
      localAuthor: "Guest",
      localAuthorUid: guestUid,
      localEpoch: 1,
      remoteState: { customRosterTopicsEpoch: 1 },
    });
    assert.equal(out.mode, "merge");
    assert.deepEqual(
      out.topics.map((t) => t.id),
      [B.id]
    );
  });

  it("B — [B] → incoming [] (epoch égale, delete sans bump) → []", () => {
    const out = resolveCustomRosterTopicsFromRemote({
      remoteList: [],
      localBefore: [B],
      localAuthor: "Guest",
      localAuthorUid: guestUid,
      localEpoch: 1,
      remoteState: { customRosterTopicsEpoch: 1 },
    });
    assert.equal(out.mode, "merge");
    assert.deepEqual(out.topics, []);
  });

  it("C — [] stale (epoch remote < local) → conserve local", () => {
    const out = resolveCustomRosterTopicsFromRemote({
      remoteList: [],
      localBefore: [B],
      localAuthor: "Guest",
      localAuthorUid: guestUid,
      localEpoch: 5,
      remoteState: { customRosterTopicsEpoch: 2 },
    });
    assert.equal(out.mode, "keep_local_stale_empty");
    assert.deepEqual(
      out.topics.map((t) => t.id),
      [B.id]
    );
  });

  it("D — delete dernière custom Host → Guest voit []", () => {
    const out = resolveCustomRosterTopicsFromRemote({
      remoteList: [],
      localBefore: [B],
      localAuthor: "Guest",
      localAuthorUid: guestUid,
      localEpoch: 0,
      remoteState: { customRosterTopicsEpoch: 0 },
    });
    assert.equal(out.topics.length, 0);
  });

  it("E — delete partiel A laisse B", () => {
    const out = resolveCustomRosterTopicsFromRemote({
      remoteList: [B],
      localBefore: [A, B],
      localAuthor: "Guest",
      localAuthorUid: guestUid,
      localEpoch: 0,
      remoteState: { customRosterTopicsEpoch: 0 },
    });
    assert.equal(out.topics.length, 1);
    assert.equal(out.topics[0].id, B.id);
  });

  it("F — rejoin après clear : remote [] + local [] → []", () => {
    const out = resolveCustomRosterTopicsFromRemote({
      remoteList: [],
      localBefore: [],
      localAuthor: "Guest",
      localAuthorUid: guestUid,
      localEpoch: 0,
      remoteState: { customRosterTopicsEpoch: 0 },
    });
    assert.deepEqual(out.topics, []);
  });

  it("epoch remote plus récent accepte [] autoritaire (anti-stale exit clear)", () => {
    const out = resolveCustomRosterTopicsFromRemote({
      remoteList: [],
      localBefore: [A, B],
      localAuthor: "Guest",
      localAuthorUid: guestUid,
      localEpoch: 1,
      remoteState: { customRosterTopicsEpoch: 4 },
    });
    assert.equal(out.mode, "authoritative");
    assert.deepEqual(out.topics, []);
  });

  it("writable false + [] accepte même epoch égale", () => {
    const out = resolveCustomRosterTopicsFromRemote({
      remoteList: [],
      localBefore: [B],
      localAuthor: "Guest",
      localAuthorUid: guestUid,
      localEpoch: 2,
      remoteState: {
        customRosterTopicsEpoch: 2,
        customRosterTopicsWritable: false,
      },
    });
    assert.equal(out.mode, "authoritative");
    assert.deepEqual(out.topics, []);
  });

  it("own optimisme survit à [] epoch égale (merge)", () => {
    const own = rosterTopic("g", "Mine", "Guest", guestUid);
    const out = resolveCustomRosterTopicsFromRemote({
      remoteList: [],
      localBefore: [B, own],
      localAuthor: "Guest",
      localAuthorUid: guestUid,
      localEpoch: 1,
      remoteState: { customRosterTopicsEpoch: 1 },
    });
    assert.equal(out.mode, "merge");
    assert.equal(out.topics.length, 1);
    assert.equal(out.topics[0].id, own.id);
  });
});

describe("AUDIT-004 live hydrate [B]→[]", () => {
  const hostUid = "uid-host";
  const guestUid = "uid-guest";
  const A = liveList(1, hostUid);
  const B = liveList(2, hostUid);

  it("A — [A,B] → [B]", () => {
    const out = resolveCustomLiveTierListsFromRemote({
      remoteList: [B],
      localBefore: [A, B],
      localAuthor: "Guest",
      localAuthorUid: guestUid,
      localEpoch: 1,
      remoteState: { customLiveTierListsEpoch: 1 },
    });
    assert.deepEqual(
      out.lists.map((t) => t.id),
      [B.id]
    );
  });

  it("B — [B] → [] epoch égale", () => {
    const out = resolveCustomLiveTierListsFromRemote({
      remoteList: [],
      localBefore: [B],
      localAuthor: "Guest",
      localAuthorUid: guestUid,
      localEpoch: 1,
      remoteState: { customLiveTierListsEpoch: 1 },
    });
    assert.deepEqual(out.lists, []);
  });

  it("C — [] stale epoch basse → keep local", () => {
    const out = resolveCustomLiveTierListsFromRemote({
      remoteList: [],
      localBefore: [B],
      localAuthor: "Guest",
      localAuthorUid: guestUid,
      localEpoch: 7,
      remoteState: { customLiveTierListsEpoch: 3 },
    });
    assert.equal(out.mode, "keep_local_stale_empty");
    assert.equal(out.lists[0].id, B.id);
  });
});
