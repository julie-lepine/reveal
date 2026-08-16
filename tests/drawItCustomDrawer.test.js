/**
 * FEATURE-DRAWIT-14 — custom rounds : drawer = authorUid.
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
  buildDrawItSeries,
  addDrawItCustomWord,
  markDrawItLobbyStarted,
  buildDrawItDeck,
  applyDrawItNextRound,
  buildDrawItLaunchState,
  buildDrawItPrivateRounds,
  resolveDrawItRoundDrawerUid,
  drawerUidForRound,
  buildDrawItDrawerOrder,
} = await import("../js/core/drawItSession.js");
const {
  countUniqueDrawItCustomWords,
  filterPlayableDrawItCustomWords,
  clearDrawItCustomWords,
} = await import("../js/core/drawItCustomWords.js");
const {
  drawItFromRemote,
  drawItToRemote,
  applyRemoteSession,
  __resetCachedGameSessionForTests,
} = await import("../js/core/gameSync.js");
const { peekLocalDrawItPrivate } = await import("../js/core/drawItPrivate.js");
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

function orderThree() {
  return [HOST_UID, GUEST_UID, THIRD_UID];
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

function privateRoundsFromCustoms(customs, drawerOrder, roundCount = 5) {
  const series = buildDrawItDeck({
    categoryId: TEST_CATEGORY,
    roundCount,
    customWords: customs,
    catalogWords: makeWords(20, TEST_CATEGORY),
    random: mulberry32(7),
    presentUids: drawerOrder,
  });
  return { series, rounds: buildDrawItPrivateRounds(series, drawerOrder) };
}

describe("FEATURE-DRAWIT-14 — custom drawer = author", () => {
  beforeEach(() => {
    resetPrep();
  });

  it("custom → drawer = author", () => {
    const word = {
      id: "c1",
      label: SECRET,
      custom: true,
      source: "custom",
      authorUid: GUEST_UID,
    };
    assert.equal(
      resolveDrawItRoundDrawerUid(word, [HOST_UID, GUEST_UID], 0),
      GUEST_UID
    );
  });

  it("custom host → host drawer", () => {
    const { rounds } = privateRoundsFromCustoms(
      [custom("c1", SECRET, "Alice", HOST_UID)],
      [HOST_UID, GUEST_UID]
    );
    const customRound = rounds.find((r) => r.wordSource === "custom");
    assert.equal(customRound.drawerUid, HOST_UID);
    assert.equal(customRound.customAuthorUid, HOST_UID);
    assert.equal(customRound.wordLabel, SECRET);
  });

  it("custom guest → guest drawer", () => {
    const { rounds } = privateRoundsFromCustoms(
      [custom("c1", SECRET, "Bob", GUEST_UID)],
      [HOST_UID, GUEST_UID]
    );
    const customRound = rounds.find((r) => r.wordSource === "custom");
    assert.equal(customRound.drawerUid, GUEST_UID);
    assert.equal(customRound.customAuthorUid, GUEST_UID);
  });

  it("custom autre joueur → autre joueur ne peut pas drawer", () => {
    const word = {
      id: "c1",
      label: SECRET,
      custom: true,
      authorUid: HOST_UID,
    };
    assert.equal(resolveDrawItRoundDrawerUid(word, [HOST_UID, GUEST_UID], 1), HOST_UID);
    assert.notEqual(resolveDrawItRoundDrawerUid(word, [HOST_UID, GUEST_UID], 1), GUEST_UID);
  });

  it("plusieurs customs → chaque round respecte son owner", () => {
    const { rounds } = privateRoundsFromCustoms(
      [
        custom("a", "Alpha", "Alice", HOST_UID),
        custom("b", "Beta", "Bob", GUEST_UID),
        custom("c", "Gamma", "Charlie", THIRD_UID),
      ],
      orderThree()
    );
    const customs = rounds.filter((r) => r.wordSource === "custom");
    assert.equal(customs.length, 3);
    assert.equal(customs.find((r) => r.customId === "a").drawerUid, HOST_UID);
    assert.equal(customs.find((r) => r.customId === "b").drawerUid, GUEST_UID);
    assert.equal(customs.find((r) => r.customId === "c").drawerUid, THIRD_UID);
    for (const round of customs) {
      assert.equal(round.drawerUid, round.customAuthorUid);
    }
  });

  it("plusieurs customs du même auteur", () => {
    const { rounds } = privateRoundsFromCustoms(
      [
        custom("a", "Alpha", "Alice", HOST_UID),
        custom("b", "Beta", "Alice", HOST_UID),
        custom("c", "Gamma", "Bob", GUEST_UID),
      ],
      [HOST_UID, GUEST_UID]
    );
    assert.equal(rounds.find((r) => r.customId === "a").drawerUid, HOST_UID);
    assert.equal(rounds.find((r) => r.customId === "b").drawerUid, HOST_UID);
    assert.equal(rounds.find((r) => r.customId === "c").drawerUid, GUEST_UID);
  });

  it("custom + catalogue → catalogue conserve la rotation", () => {
    const drawerOrder = orderThree();
    const { series, rounds } = privateRoundsFromCustoms(
      [custom("a", SECRET, "Bob", GUEST_UID)],
      drawerOrder
    );
    assert.equal(rounds.length, 5);
    rounds.forEach((round, i) => {
      if (round.wordSource === "custom") {
        assert.equal(round.drawerUid, GUEST_UID);
        assert.equal(series[i].custom, true);
      } else {
        assert.equal(round.wordSource, "catalog");
        assert.equal(round.drawerUid, drawerUidForRound(drawerOrder, i));
        assert.equal(round.customAuthorUid, undefined);
      }
    });
  });

  it("deux customs du même auteur sur positions compatibles", () => {
    const drawerOrder = [HOST_UID, GUEST_UID];
    const series = [
      { id: "a", label: "Un", custom: true, authorUid: HOST_UID },
      { id: "cat", label: "Facile-1", categoryId: TEST_CATEGORY },
      { id: "b", label: "Deux", custom: true, authorUid: HOST_UID },
    ];
    const rounds = buildDrawItPrivateRounds(series, drawerOrder);
    assert.equal(rounds.length, 3);
    assert.equal(rounds[0].drawerUid, HOST_UID);
    assert.equal(rounds[1].drawerUid, GUEST_UID);
    assert.equal(rounds[2].drawerUid, HOST_UID);
  });

  it("drawer conservé après hydrate / fromRemote", () => {
    const remote = drawItFromRemote({
      lobbyStarted: true,
      runId: "run-1",
      roundIdx: 0,
      phase: "drawing",
      drawerUid: GUEST_UID,
      drawerOrder: [HOST_UID, GUEST_UID],
      selectedCategoryId: TEST_CATEGORY,
      roundCount: 5,
    });
    assert.equal(remote.drawerUid, GUEST_UID);
  });

  it("drawer conservé après patch Realtime", () => {
    saveStatePatch({
      drawItGame: {
        ...getDrawItSession(),
        lobbyStarted: true,
        runId: "run-1",
        roundIdx: 0,
        phase: "drawing",
        drawerUid: GUEST_UID,
        drawerOrder: [HOST_UID, GUEST_UID],
      },
    });
    applyRemoteSession({
      lobby_id: LOBBY_ID,
      game_id: "drawit",
      screen: "drawit",
      updated_at: "2026-08-16T21:40:00.000Z",
      state: {
        drawIt: {
          lobbyStarted: true,
          runId: "run-1",
          roundIdx: 0,
          phase: "drawing",
          drawerUid: GUEST_UID,
          drawerOrder: [HOST_UID, GUEST_UID],
          selectedCategoryId: TEST_CATEGORY,
          roundCount: 5,
        },
      },
    });
    assert.equal(getDrawItSession().drawerUid, GUEST_UID);
  });

  it("drawer conservé après reconnect (identité publique, pas de re-tirage)", () => {
    const launched = buildDrawItLaunchState({
      session: getDrawItSession(),
      participants: twoPlayers(),
      runId: "run-1",
      drawerUid: GUEST_UID,
    });
    assert.equal(launched.drawerUid, GUEST_UID);
    const hydrated = drawItFromRemote(drawItToRemote(launched));
    assert.equal(hydrated.drawerUid, GUEST_UID);
  });

  it("aucune fuite du texte aux non-drawers", async () => {
    await addDrawItCustomWord(SECRET);
    await markDrawItLobbyStarted({ rosterNames: ["Alice", "Bob"] });
    const remote = drawItToRemote(getDrawItSession());
    assert.equal("customWords" in remote, false);
    assert.equal(JSON.stringify(remote).includes(SECRET), false);
    const fromRemote = drawItFromRemote(remote);
    assert.equal(JSON.stringify(fromRemote).includes(SECRET), false);
  });

  it("authorUid absent / invalide → custom non sélectionnable", () => {
    const words = [
      { id: "a", text: SECRET, author: "Alice" },
      custom("b", "Neige", "Bob", "not-a-uuid"),
    ];
    assert.equal(countUniqueDrawItCustomWords(words), 0);
    assert.equal(filterPlayableDrawItCustomWords(words, [HOST_UID, GUEST_UID]).length, 0);
    const deck = buildDrawItDeck({
      categoryId: TEST_CATEGORY,
      roundCount: 5,
      customWords: words,
      catalogWords: makeWords(10, TEST_CATEGORY),
      random: mulberry32(1),
    });
    assert.equal(deck.every((w) => !w.custom), true);
  });

  it("auteur absent → aucun fallback vers un autre drawer", () => {
    const words = [custom("a", SECRET, "Charlie", THIRD_UID)];
    assert.equal(filterPlayableDrawItCustomWords(words, [HOST_UID, GUEST_UID]).length, 0);
    const { rounds } = privateRoundsFromCustoms(words, [HOST_UID, GUEST_UID]);
    assert.equal(rounds.some((r) => r.wordSource === "custom"), false);
    assert.equal(
      resolveDrawItRoundDrawerUid(
        { id: "a", label: SECRET, custom: true, authorUid: THIRD_UID },
        [HOST_UID, GUEST_UID],
        0
      ),
      null
    );
  });

  it("restart / nouvel epoch → aucun owner stale", () => {
    const cleared = clearDrawItCustomWords({
      ...getDrawItSession(),
      customWords: [custom("old", SECRET)],
      lobbyStarted: false,
      runId: "stale",
    });
    assert.deepEqual(cleared.customWords, []);
    const fresh = buildDrawItLaunchState({
      session: cleared,
      participants: twoPlayers(),
      runId: "run-2",
    });
    assert.equal(fresh.runId, "run-2");
    assert.equal(fresh.drawerUid, HOST_UID);
    const restart = read("js/core/restartGame.js");
    assert.match(restart, /customWords: \[\]/);
    assert.match(restart, /runId: null/);
  });

  it("structure privée des rounds customs", () => {
    const rounds = buildDrawItPrivateRounds(
      [
        { id: "cat", label: "Facile-1", categoryId: TEST_CATEGORY },
        { id: "c1", label: SECRET, custom: true, authorUid: GUEST_UID },
      ],
      [HOST_UID, GUEST_UID]
    );
    assert.equal(rounds[1].wordSource, "custom");
    assert.equal(rounds[1].customId, "c1");
    assert.equal(rounds[1].customAuthorUid, GUEST_UID);
    assert.equal(rounds[1].drawerUid, GUEST_UID);
    assert.equal(rounds[1].wordLabel, SECRET);
  });

  it("next round custom utilise le drawer privé, pas la rotation", () => {
    const drawerOrder = [HOST_UID, GUEST_UID];
    const session = {
      ...buildDrawItLaunchState({
        session: { ...getDrawItSession(), roundCount: 3 },
        participants: twoPlayers(),
        runId: "run-1",
        drawerUid: HOST_UID,
      }),
      phase: "reveal",
      roundIdx: 0,
      roundCount: 3,
      drawerOrder,
      roundEndsAt: "2026-08-16T21:00:00.000Z",
    };
    assert.equal(drawerUidForRound(drawerOrder, 1), GUEST_UID);
    const next = applyDrawItNextRound(session, {
      nowMs: Date.parse("2026-08-16T21:00:01.000Z"),
      drawerUid: HOST_UID,
    });
    assert.equal(next.ok, true);
    assert.equal(next.session.drawerUid, HOST_UID);
  });

  it("launch local : peek privé aligne drawer et mot", async () => {
    await addDrawItCustomWord(SECRET);
    const launched = await markDrawItLobbyStarted({ rosterNames: ["Alice", "Bob"] });
    assert.equal(launched.ok, true);
    const session = getDrawItSession();
    const row = peekLocalDrawItPrivate(LOBBY_ID, session.runId, 0);
    assert.ok(row);
    assert.equal(session.drawerUid, row.drawerUid);
    if (row.wordSource === "custom") {
      assert.equal(row.drawerUid, HOST_UID);
      assert.equal(row.wordLabel, SECRET);
    }
  });

  it("SQL 14 : launch n'exige plus drawerOrder[0] ; advance lit drawit_private", () => {
    const sql = read("supabase/feature-drawit-14-custom-drawer.sql");
    assert.match(sql, /10 → 13 → 14/);
    assert.doesNotMatch(sql, /drawerOrder'->>0\) is distinct from v_drawer/);
    assert.match(sql, /p_rounds->0->>'drawerUid'/);
    assert.match(sql, /DRAWIT_CUSTOM_DRAWER/);
    assert.match(sql, /drawit_custom_words/);
    const advance = sql.slice(sql.indexOf("create or replace function public.advance_drawit_round"));
    assert.match(advance, /from public\.drawit_private p/);
    assert.doesNotMatch(advance, /v_order ->> \(v_next % v_len\)/);
    assert.match(advance, /is_lobby_host\(p_lobby_id\) or public\.is_acting_host/);
  });

  it("catalogue seul : rotation inchangée", () => {
    const drawerOrder = buildDrawItDrawerOrder(twoPlayers());
    const series = buildDrawItSeries(
      { selectedCategoryId: TEST_CATEGORY, roundCount: 5, customWords: [] },
      makeWords(10, TEST_CATEGORY),
      mulberry32(2)
    );
    const rounds = buildDrawItPrivateRounds(series, drawerOrder);
    rounds.forEach((round, i) => {
      assert.equal(round.wordSource, "catalog");
      assert.equal(round.drawerUid, drawerUidForRound(drawerOrder, i));
    });
  });

  it("texte custom absent du blob public / toRemote", () => {
    const src = read("js/core/gameSync.js");
    assert.match(src, /export function drawItToRemote/);
    const toRemote = src.slice(src.indexOf("export function drawItToRemote"));
    assert.doesNotMatch(toRemote.slice(0, 800), /customWords/);
  });
});
