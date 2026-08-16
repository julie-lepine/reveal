/**
 * FEATURE-DRAWIT-15 — customs par créneau de drawer + freeze fin de manche.
 */
import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

mock.module("../js/core/supabaseClient.js", {
  namedExports: {
    isSupabaseConfigured: () => false,
    supabase: null,
  },
});

const {
  defaultDrawItPrepSession,
  getDrawItSession,
  addDrawItCustomWord,
  markDrawItLobbyStarted,
  buildDrawItDeck,
  applyDrawItNextRound,
  applyDrawItReveal,
  canCommitDrawItReveal,
  buildDrawItLaunchState,
  buildDrawItPrivateRounds,
  drawerUidForRound,
} = await import("../js/core/drawItSession.js");
const { buildDrawItSlottedDeck, filterPlayableDrawItCustomWords } = await import(
  "../js/core/drawItCustomWords.js"
);
const {
  drawItFromRemote,
  drawItToRemote,
  applyRemoteSession,
  __resetCachedGameSessionForTests,
} = await import("../js/core/gameSync.js");
const { peekLocalDrawItPrivate } = await import("../js/core/drawItPrivate.js");
const { isStaleDrawItRound, DRAW_IT_PHASE_REVEAL } = await import("../js/core/drawItRound.js");
const { saveStatePatch } = await import("../js/core/state.js");

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HOST_UID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const GUEST_UID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const THIRD_UID = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const LOBBY_ID = "11111111-1111-1111-1111-111111111111";
const TEST_CATEGORY = "Facile";
const SECRET = "Titanic";

function read(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeWords(count, categoryId, prefix = categoryId) {
  return Array.from({ length: count }, (_, i) => ({
    id: `${prefix}_${i + 1}`,
    label: `${prefix}-${i + 1}`,
    categoryId,
    enabled: true,
  }));
}

function custom(id, text, author = "Alice", authorUid = HOST_UID) {
  const out = { id, author, authorUid };
  if (text) out.text = text;
  return out;
}

function twoPlayers() {
  return [
    { userId: HOST_UID, name: "Alice", isHost: true, isLocal: true },
    { userId: GUEST_UID, name: "Bob", isHost: false, isLocal: false },
  ];
}

function resetPrep() {
  __resetCachedGameSessionForTests();
  saveStatePatch({
    user: { name: "Alice" },
    supabaseUserId: HOST_UID,
    inLobby: true,
    lobby: {
      id: LOBBY_ID,
      code: "ABCD",
      hostId: HOST_UID,
      participants: twoPlayers(),
    },
    drawItGame: {
      ...defaultDrawItPrepSession(),
      selectedCategoryId: TEST_CATEGORY,
      roundCount: 5,
    },
  });
}

function slotted(customs, drawerOrder, roundCount = 5, seed = 7) {
  return buildDrawItDeck({
    categoryId: TEST_CATEGORY,
    roundCount,
    customWords: customs,
    catalogWords: makeWords(20, TEST_CATEGORY),
    random: mulberry32(seed),
    drawerOrder,
  });
}

describe("FEATURE-DRAWIT-15 — ownership", () => {
  beforeEach(() => resetPrep());

  it("custom host → host drawer", () => {
    const order = [HOST_UID, GUEST_UID];
    const rounds = buildDrawItPrivateRounds(
      slotted([custom("h1", SECRET, "Alice", HOST_UID)], order),
      order
    );
    const customRound = rounds.find((r) => r.wordSource === "custom");
    assert.equal(customRound.drawerUid, HOST_UID);
    assert.equal(customRound.customAuthorUid, HOST_UID);
  });

  it("custom guest → guest drawer", () => {
    const order = [HOST_UID, GUEST_UID];
    const rounds = buildDrawItPrivateRounds(
      slotted([custom("g1", SECRET, "Bob", GUEST_UID)], order),
      order
    );
    const customRound = rounds.find((r) => r.wordSource === "custom");
    assert.equal(customRound.drawerUid, GUEST_UID);
    assert.equal(customRound.customAuthorUid, GUEST_UID);
  });

  it("custom A → drawer B impossible (créneau refusé)", () => {
    const order = [HOST_UID, GUEST_UID];
    const mismatch = buildDrawItPrivateRounds(
      [{ id: "h1", label: SECRET, custom: true, authorUid: HOST_UID }],
      [GUEST_UID, HOST_UID]
    );
    assert.deepEqual(mismatch, []);
  });

  it("auteur absent / authorUid invalide", () => {
    const order = [HOST_UID, GUEST_UID];
    assert.equal(
      filterPlayableDrawItCustomWords(
        [custom("x", SECRET, "Charlie", THIRD_UID)],
        order
      ).length,
      0
    );
    const rounds = buildDrawItPrivateRounds(
      slotted(
        [
          { id: "bad", text: "Nope", author: "Z", authorUid: "not-uuid" },
          custom("gone", "Igloo", "Charlie", THIRD_UID),
        ],
        order
      ),
      order
    );
    assert.equal(rounds.some((r) => r.wordSource === "custom"), false);
  });
});

describe("FEATURE-DRAWIT-15 — distribution", () => {
  beforeEach(() => resetPrep());

  it("5 host customs + 1 guest → pas 5 drawers host", () => {
    const order = [HOST_UID, GUEST_UID];
    const customs = [
      ...Array.from({ length: 5 }, (_, i) => custom(`h${i}`, `Host-${i}`, "Alice", HOST_UID)),
      custom("g1", "Guest-1", "Bob", GUEST_UID),
    ];
    const series = slotted(customs, order, 5, 3);
    const rounds = buildDrawItPrivateRounds(series, order);
    assert.equal(rounds.length, 5);
    const drawers = rounds.map((r) => r.drawerUid);
    assert.deepEqual(drawers, [HOST_UID, GUEST_UID, HOST_UID, GUEST_UID, HOST_UID]);
    assert.equal(rounds.filter((r) => r.wordSource === "custom" && r.customAuthorUid === HOST_UID).length, 3);
    assert.equal(rounds.filter((r) => r.wordSource === "custom" && r.customAuthorUid === GUEST_UID).length, 1);
    assert.equal(rounds.filter((r) => r.wordSource === "catalog").length, 1);
    rounds.forEach((round, i) => {
      assert.equal(round.drawerUid, drawerUidForRound(order, i));
      if (round.wordSource === "custom") {
        assert.equal(round.drawerUid, round.customAuthorUid);
      }
    });
  });

  it("Host 3 + Guest 2 → 5 customs sur rotation A/B/A/B/A", () => {
    const order = [HOST_UID, GUEST_UID];
    const customs = [
      custom("h1", "H1"),
      custom("h2", "H2"),
      custom("h3", "H3"),
      custom("g1", "G1", "Bob", GUEST_UID),
      custom("g2", "G2", "Bob", GUEST_UID),
    ];
    const rounds = buildDrawItPrivateRounds(slotted(customs, order, 5, 8), order);
    assert.equal(rounds.filter((r) => r.wordSource === "custom").length, 5);
    assert.deepEqual(
      rounds.map((r) => r.drawerUid),
      [HOST_UID, GUEST_UID, HOST_UID, GUEST_UID, HOST_UID]
    );
  });

  it("chat / CHAT = un seul custom jouable", () => {
    const order = [HOST_UID, GUEST_UID];
    const rounds = buildDrawItPrivateRounds(
      slotted(
        [custom("a", "chat"), custom("b", "CHAT"), custom("c", "Chat")],
        order
      ),
      order
    );
    assert.equal(rounds.filter((r) => r.wordSource === "custom").length, 1);
  });

  it("RNG déterministe", () => {
    const order = [HOST_UID, GUEST_UID];
    const customs = Array.from({ length: 4 }, (_, i) =>
      custom(`h${i}`, `Mot-${i}`)
    );
    const a = slotted(customs, order, 5, 1).map((w) => w.id);
    const b = slotted(customs, order, 5, 1).map((w) => w.id);
    const c = slotted(customs, order, 5, 99).map((w) => w.id);
    assert.deepEqual(a, b);
    assert.equal(a.length, 5);
    assert.equal(c.length, 5);
  });

  it("buildDrawItSlottedDeck n'assigne jamais un custom au mauvais créneau", () => {
    const order = [HOST_UID, GUEST_UID];
    const customs = [
      {
        id: "h1",
        label: "HostOnly",
        custom: true,
        authorUid: HOST_UID,
        source: "custom",
      },
    ];
    const deck = buildDrawItSlottedDeck(
      customs,
      makeWords(8, TEST_CATEGORY),
      5,
      order,
      mulberry32(4)
    );
    deck.forEach((word, i) => {
      const expected = drawerUidForRound(order, i);
      if (word.custom) assert.equal(word.authorUid, expected);
    });
  });
});

describe("FEATURE-DRAWIT-15 — sync / fin de manche", () => {
  beforeEach(() => resetPrep());

  it("launch local : drawer public = drawer privé = rotation", async () => {
    await addDrawItCustomWord(SECRET);
    const launched = await markDrawItLobbyStarted({ rosterNames: ["Alice", "Bob"] });
    assert.equal(launched.ok, true);
    const session = getDrawItSession();
    const row = peekLocalDrawItPrivate(LOBBY_ID, session.runId, 0);
    assert.equal(session.drawerUid, HOST_UID);
    assert.equal(row.drawerUid, HOST_UID);
    assert.equal(session.drawerUid, row.drawerUid);
    if (row.wordSource === "custom") {
      assert.equal(row.customAuthorUid, HOST_UID);
      assert.equal(row.wordLabel, SECRET);
    }
  });

  it("hydrate / reconnect conserve le drawerUid public", () => {
    const remote = drawItFromRemote({
      lobbyStarted: true,
      runId: "run-1",
      roundIdx: 1,
      phase: "drawing",
      drawerUid: GUEST_UID,
      drawerOrder: [HOST_UID, GUEST_UID],
      selectedCategoryId: TEST_CATEGORY,
      roundCount: 5,
    });
    assert.equal(remote.drawerUid, GUEST_UID);
    applyRemoteSession({
      lobby_id: LOBBY_ID,
      game_id: "drawit",
      screen: "drawit",
      updated_at: "2026-08-16T22:00:00.000Z",
      state: { drawIt: remote },
    });
    assert.equal(getDrawItSession().drawerUid, GUEST_UID);
  });

  it("timer 0 → reveal catalogue / custom (chemin pur)", () => {
    const now = Date.parse("2026-08-16T22:00:00.000Z");
    const session = {
      ...buildDrawItLaunchState({
        session: { ...getDrawItSession(), roundCount: 3 },
        participants: twoPlayers(),
        runId: "run-1",
        nowMs: now - 60_000,
        drawerUid: HOST_UID,
      }),
      phase: "drawing",
      roundEndsAt: "2026-08-16T22:00:00.000Z",
      roundCount: 3,
    };
    assert.equal(canCommitDrawItReveal(session, now).ok, true);
    const revealed = applyDrawItReveal(session, { wordLabel: "Neige", nowMs: now });
    assert.equal(revealed.ok, true);
    assert.equal(revealed.session.phase, DRAW_IT_PHASE_REVEAL);
    const again = applyDrawItReveal(revealed.session, { wordLabel: "Neige", nowMs: now + 1 });
    assert.equal(again.ok, false);
  });

  it("guesses actifs n'empêchent pas shouldEnd (timer)", () => {
    const now = Date.parse("2026-08-16T22:00:00.000Z");
    const session = {
      ...buildDrawItLaunchState({
        session: getDrawItSession(),
        participants: twoPlayers(),
        runId: "run-1",
        nowMs: now - 60_000,
      }),
      phase: "drawing",
      roundEndsAt: "2026-08-16T22:00:00.000Z",
      guesses: [{ uid: GUEST_UID, value: "essai", correct: false, at: "t" }],
    };
    assert.equal(canCommitDrawItReveal(session, now).ok, true);
  });

  it("double advance / stale patch ne ramène pas l'ancien round", () => {
    const order = [HOST_UID, GUEST_UID];
    let session = {
      ...buildDrawItLaunchState({
        session: { ...getDrawItSession(), roundCount: 3 },
        participants: twoPlayers(),
        runId: "run-1",
        drawerUid: HOST_UID,
      }),
      phase: DRAW_IT_PHASE_REVEAL,
      roundIdx: 0,
      roundCount: 3,
      drawerOrder: order,
    };
    const next = applyDrawItNextRound(session, {
      nowMs: Date.parse("2026-08-16T22:01:00.000Z"),
      drawerUid: GUEST_UID,
    });
    assert.equal(next.ok, true);
    assert.equal(next.session.roundIdx, 1);
    assert.equal(
      isStaleDrawItRound(next.session, { runId: "run-1", roundIdx: 0 }),
      true
    );
  });

  it("erreur RPC reveal : catch + pas de throw (anti-freeze)", () => {
    const src = read("js/core/drawItSession.js");
    const fn = src.slice(src.indexOf("export async function commitDrawItReveal"));
    assert.match(fn, /try \{/);
    assert.match(fn, /catch/);
    assert.match(fn, /rpc_failed/);
    const game = read("js/games/drawIt.js");
    assert.match(game, /\.catch\(\(\) => \{/);
  });

  it("SQL 15 : launch impose la rotation ; reveal ne filtre plus par drawer public", () => {
    const sql = read("supabase/feature-drawit-15-custom-drawer-slots.sql");
    assert.match(sql, /14 → 15/);
    assert.match(sql, /with ordinality/);
    assert.match(sql, /DRAWIT_CUSTOM_DRAWER/);
    const reveal = sql.slice(sql.indexOf("create or replace function public.reveal_drawit_round"));
    assert.doesNotMatch(
      reveal,
      /drawer_uid::text = coalesce\(v_di->>'drawerUid'/
    );
    assert.match(reveal, /and round_idx = v_idx/);
  });

  it("texte custom absent du public / toRemote", async () => {
    await addDrawItCustomWord(SECRET);
    await markDrawItLobbyStarted({ rosterNames: ["Alice", "Bob"] });
    const remote = drawItToRemote(getDrawItSession());
    assert.equal(JSON.stringify(remote).includes(SECRET), false);
    assert.equal("customWords" in remote, false);
  });

  it("nouveau run : pas d'owner stale", () => {
    const fresh = buildDrawItLaunchState({
      session: { ...getDrawItSession(), customWords: [], runId: null },
      participants: twoPlayers(),
      runId: "run-2",
    });
    assert.equal(fresh.runId, "run-2");
    assert.deepEqual(fresh.customWords, []);
  });
});
