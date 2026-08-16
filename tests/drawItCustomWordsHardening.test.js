/**
 * FEATURE-DRAWIT-12 — hardening customs : confidentialité transport, launch
 * fail-closed, déduplication C/N, concurrence, reconnexion.
 */
import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const supabaseState = { configured: false };
const rpcState = {
  launch: async () => ({ data: [], error: null }),
  mine: async () => ({ data: [], error: null }),
};

mock.module("../js/core/supabaseClient.js", {
  namedExports: {
    isSupabaseConfigured: () => supabaseState.configured,
    supabase: {
      rpc: async (name, args) => {
        if (name === "fetch_drawit_custom_words_for_launch") return rpcState.launch(args);
        if (name === "fetch_my_drawit_custom_words") return rpcState.mine(args);
        if (name === "clear_drawit_custom_words") return { data: null, error: null };
        return { data: null, error: { message: `unexpected rpc ${name}` } };
      },
    },
  },
});

const {
  defaultDrawItPrepSession,
  getDrawItSession,
  validateDrawItPrep,
  buildDrawItSeries,
  addDrawItCustomWord,
  removeDrawItCustomWord,
  listMyDrawItCustomWords,
  markDrawItLobbyStarted,
  setDrawItReady,
  buildDrawItDeck,
  summarizeOthersDrawItCustomAdds,
} = await import("../js/core/drawItSession.js");
const {
  mergeDrawItCustomWords,
  redactDrawItCustomWordsForViewer,
  stripDrawItCustomWordTexts,
  nextDrawItCustomWordsFromPrepPatch,
} = await import("../js/core/sessionMerge.js");
const {
  countUniqueDrawItCustomWords,
  loadDrawItCustomWordsForLaunch,
  clearDrawItCustomWords,
} = await import("../js/core/drawItCustomWords.js");
const {
  applyRemoteSession,
  drawItFromRemote,
  drawItToRemote,
  __resetCachedGameSessionForTests,
} = await import("../js/core/gameSync.js");
const { saveStatePatch } = await import("../js/core/state.js");

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HOST_UID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const GUEST_UID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const LOBBY_ID = "11111111-1111-1111-1111-111111111111";
const TEST_CATEGORY = "Facile";
const SECRET_HOST = "Faire du ski à poil";

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

function twoPlayers(localUid = HOST_UID) {
  return [
    { userId: HOST_UID, name: "Alice", isHost: true, isLocal: localUid === HOST_UID },
    { userId: GUEST_UID, name: "Bob", isHost: false, isLocal: localUid === GUEST_UID },
  ];
}

function resetPrep({ name = "Alice", uid = HOST_UID, extra = {} } = {}) {
  supabaseState.configured = false;
  rpcState.launch = async () => ({ data: [], error: null });
  rpcState.mine = async () => ({ data: [], error: null });
  __resetCachedGameSessionForTests();
  saveStatePatch({
    user: { name },
    supabaseUserId: uid,
    inLobby: true,
    lobby: {
      id: LOBBY_ID,
      code: "ABCD",
      hostId: HOST_UID,
      participants: twoPlayers(uid),
    },
    drawItGame: {
      ...defaultDrawItPrepSession(),
      selectedCategoryId: TEST_CATEGORY,
      roundCount: 5,
      ...extra,
    },
  });
}

function sessionRow(drawIt, extra = {}) {
  return {
    lobby_id: LOBBY_ID,
    game_id: "drawit",
    screen: extra.screen || "drawit-prep",
    updated_at: extra.updatedAt || "2026-08-16T20:00:00.000Z",
    state: { drawIt },
  };
}

describe("FEATURE-DRAWIT-12 — hardening customs", () => {
  beforeEach(() => {
    resetPrep();
  });

  it("A. owner reçoit son texte (local / liste perso)", async () => {
    const res = await addDrawItCustomWord(SECRET_HOST);
    assert.equal(res.ok, true);
    assert.equal(listMyDrawItCustomWords()[0].text, SECRET_HOST);
  });

  it("B. guest ne reçoit pas le texte d'un autre", () => {
    const redacted = redactDrawItCustomWordsForViewer(
      [custom("c1", SECRET_HOST, "Alice", HOST_UID)],
      "Bob",
      GUEST_UID
    );
    assert.equal(redacted[0].text, undefined);
    assert.equal(JSON.stringify(redacted).includes(SECRET_HOST), false);
  });

  it("C. payload Realtime guest sans texte", () => {
    resetPrep({ name: "Bob", uid: GUEST_UID });
    applyRemoteSession(
      sessionRow({
        lobbyStarted: false,
        selectedCategoryId: TEST_CATEGORY,
        roundCount: 5,
        ready: {},
        customWords: [custom("c1", SECRET_HOST, "Alice", HOST_UID)],
      })
    );
    assert.equal(JSON.stringify(getDrawItSession()).includes(SECRET_HOST), false);
    assert.equal(getDrawItSession().customWords[0].text, undefined);
  });

  it("D. fetch guest sans texte (fromRemote / blob public)", () => {
    resetPrep({ name: "Bob", uid: GUEST_UID });
    const remote = drawItFromRemote({
      lobbyStarted: false,
      selectedCategoryId: TEST_CATEGORY,
      roundCount: 5,
      customWords: [custom("c1", SECRET_HOST, "Alice", HOST_UID)],
    });
    assert.equal(remote.customWords[0].text, undefined);
    assert.equal(JSON.stringify(remote).includes(SECRET_HOST), false);
  });

  it("E. Broadcast drawing sans texte custom", () => {
    const live = read("js/core/drawItLive.js");
    assert.doesNotMatch(live, /customWords/);
    const toRemote = drawItToRemote({
      ...defaultDrawItPrepSession(),
      customWords: [custom("c1", SECRET_HOST)],
    });
    assert.equal("customWords" in toRemote, false);
    assert.equal(JSON.stringify(toRemote).includes(SECRET_HOST), false);
  });

  it("F. lobby_messages sans texte custom", () => {
    const lobby = read("js/core/supabaseLobby.js");
    assert.doesNotMatch(lobby, /customWords/);
    const session = read("js/core/drawItSession.js");
    assert.doesNotMatch(session, /lobby_messages/);
  });

  it("G. DOM guest : liste perso uniquement + hint générique", () => {
    const src = read("js/screens/drawItPrep.js");
    assert.match(src, /listMyDrawItCustomWords/);
    assert.match(src, /summarizeOthersDrawItCustomAdds/);
    assert.doesNotMatch(src, /listDrawItCustomWords\(\)/);
    const hint = summarizeOthersDrawItCustomAdds(
      [custom("c1", SECRET_HOST, "Alice", HOST_UID)],
      "Bob",
      GUEST_UID
    );
    const msg = `${hint[0].author} a ajouté ${hint[0].count} mot au jeu`;
    assert.equal(msg.includes(SECRET_HOST), false);
  });

  it("H. reconnexion guest sans texte", () => {
    resetPrep({ name: "Bob", uid: GUEST_UID });
    applyRemoteSession(
      sessionRow({
        lobbyStarted: false,
        selectedCategoryId: TEST_CATEGORY,
        roundCount: 5,
        customWords: [custom("c1", SECRET_HOST, "Alice", HOST_UID)],
      })
    );
    const again = drawItFromRemote({
      lobbyStarted: false,
      selectedCategoryId: TEST_CATEGORY,
      roundCount: 5,
      customWords: [custom("c1", SECRET_HOST, "Alice", HOST_UID)],
    });
    assert.equal(JSON.stringify(getDrawItSession()).includes(SECRET_HOST), false);
    assert.equal(JSON.stringify(again).includes(SECRET_HOST), false);
  });

  it("I. absence de flash du texte avant résolution UID", () => {
    saveStatePatch({ supabaseUserId: null, user: { name: "" } });
    const remote = drawItFromRemote({
      lobbyStarted: false,
      selectedCategoryId: TEST_CATEGORY,
      roundCount: 5,
      customWords: [custom("c1", SECRET_HOST, "Alice", HOST_UID)],
    });
    assert.equal(remote.customWords[0].text, undefined);
    assert.equal(JSON.stringify(remote).includes(SECRET_HOST), false);
    const stripped = stripDrawItCustomWordTexts([
      custom("c1", SECRET_HOST, "Alice", HOST_UID),
    ]);
    assert.equal(stripped[0].text, undefined);
  });

  it("J. host launch local avec customs host + guest (textes présents)", async () => {
    saveStatePatch({
      drawItGame: {
        ...getDrawItSession(),
        customWords: [
          custom("h1", "Neige", "Alice", HOST_UID),
          custom("g1", "Igloo", "Bob", GUEST_UID),
        ],
      },
    });
    const loaded = await loadDrawItCustomWordsForLaunch(getDrawItSession());
    assert.equal(loaded.ok, true);
    const deck = buildDrawItDeck({
      categoryId: TEST_CATEGORY,
      roundCount: 5,
      customWords: loaded.customWords,
      catalogWords: makeWords(10, TEST_CATEGORY),
      random: mulberry32(3),
    });
    assert.equal(deck.filter((w) => w.custom).length, 2);
    assert.ok(deck.some((w) => w.label === "Neige"));
    assert.ok(deck.some((w) => w.label === "Igloo"));
  });

  it("K. fetch complet → tous les customs correctement joués", async () => {
    supabaseState.configured = true;
    saveStatePatch({
      drawItGame: {
        ...getDrawItSession(),
        customWords: [
          custom("h1", null, "Alice", HOST_UID),
          custom("g1", null, "Bob", GUEST_UID),
        ],
      },
    });
    rpcState.launch = async () => ({
      data: [
        { id: "h1", text: "Neige", authorUid: HOST_UID, author: "Alice" },
        { id: "g1", text: "Igloo", authorUid: GUEST_UID, author: "Bob" },
      ],
      error: null,
    });
    const loaded = await loadDrawItCustomWordsForLaunch(getDrawItSession());
    assert.equal(loaded.ok, true);
    assert.equal(loaded.customWords.find((w) => w.id === "g1").text, "Igloo");
    const deck = buildDrawItDeck({
      categoryId: TEST_CATEGORY,
      roundCount: 5,
      customWords: loaded.customWords,
      catalogWords: makeWords(8, TEST_CATEGORY),
      random: mulberry32(4),
    });
    assert.ok(deck.some((w) => w.label === "Neige"));
    assert.ok(deck.some((w) => w.label === "Igloo"));
  });

  it("L. fetch échoué → launch refusé proprement", async () => {
    supabaseState.configured = true;
    saveStatePatch({
      drawItGame: {
        ...getDrawItSession(),
        customWords: [custom("g1", null, "Bob", GUEST_UID)],
      },
    });
    rpcState.launch = async () => ({ data: null, error: { message: "network" } });
    const loaded = await loadDrawItCustomWordsForLaunch(getDrawItSession());
    assert.equal(loaded.ok, false);
    const launched = await markDrawItLobbyStarted({ rosterNames: ["Alice", "Bob"] });
    assert.equal(launched.ok, false);
    assert.equal(getDrawItSession().lobbyStarted, false);
  });

  it("M. custom sans text → launch refusé, jamais ignoré silencieusement", async () => {
    saveStatePatch({
      drawItGame: {
        ...getDrawItSession(),
        customWords: [custom("g1", null, "Bob", GUEST_UID)],
      },
    });
    const loaded = await loadDrawItCustomWordsForLaunch(getDrawItSession());
    assert.equal(loaded.ok, false);
    const launched = await markDrawItLobbyStarted({ rosterNames: ["Alice", "Bob"] });
    assert.equal(launched.ok, false);
    assert.equal(getDrawItSession().lobbyStarted, false);
  });

  it("N. retry réussi → launch possible", async () => {
    supabaseState.configured = true;
    saveStatePatch({
      drawItGame: {
        ...getDrawItSession(),
        customWords: [custom("h1", null, "Alice", HOST_UID)],
      },
    });
    rpcState.launch = async () => ({ data: null, error: { message: "timeout" } });
    const first = await loadDrawItCustomWordsForLaunch(getDrawItSession());
    assert.equal(first.ok, false);
    rpcState.launch = async () => ({
      data: [{ id: "h1", text: "Neige", authorUid: HOST_UID, author: "Alice" }],
      error: null,
    });
    const second = await loadDrawItCustomWordsForLaunch(getDrawItSession());
    assert.equal(second.ok, true);
    assert.equal(second.customWords[0].text, "Neige");
  });

  it("O. chat + CHAT = 1 custom unique", () => {
    const words = [
      custom("c1", "chat"),
      custom("c2", "CHAT"),
      custom("c3", "Chat"),
    ];
    assert.equal(countUniqueDrawItCustomWords(words), 1);
    const check = validateDrawItPrep(
      { selectedCategoryId: TEST_CATEGORY, roundCount: 5, customWords: words },
      makeWords(10, TEST_CATEGORY)
    );
    assert.equal(check.customCount, 1);
  });

  it("P. doublons entre joueurs", () => {
    const words = [
      custom("a", "chat", "Alice", HOST_UID),
      custom("b", "CHAT", "Bob", GUEST_UID),
      custom("c", "chien", "Claire", "cccccccc-cccc-cccc-cccc-cccccccccccc"),
    ];
    assert.equal(countUniqueDrawItCustomWords(words), 2);
  });

  it("Q. C unique ≥ N → uniquement customs uniques", () => {
    const words = [
      custom("c1", "chat"),
      custom("c2", "CHAT"),
      custom("c3", "chien"),
      custom("c4", "voiture"),
      custom("c5", "maison"),
      custom("c6", "soleil"),
    ];
    const deck = buildDrawItDeck({
      categoryId: TEST_CATEGORY,
      roundCount: 5,
      customWords: words,
      catalogWords: makeWords(20, TEST_CATEGORY),
      random: mulberry32(9),
    });
    assert.equal(deck.length, 5);
    assert.ok(deck.every((w) => w.custom));
  });

  it("R. C unique < N → customs uniques + catalogue", () => {
    const words = [
      custom("c1", "chat"),
      custom("c2", "CHAT"),
      custom("c3", "Chat"),
      custom("c4", "chien"),
      custom("c5", "voiture"),
    ];
    assert.equal(countUniqueDrawItCustomWords(words), 3);
    const deck = buildDrawItDeck({
      categoryId: TEST_CATEGORY,
      roundCount: 5,
      customWords: words,
      catalogWords: makeWords(10, TEST_CATEGORY),
      random: mulberry32(2),
    });
    assert.equal(deck.length, 5);
    assert.equal(deck.filter((w) => w.custom).length, 3);
    assert.equal(deck.filter((w) => !w.custom).length, 2);
  });

  it("S. C = 0 → comportement catalogue inchangé", () => {
    const catalog = makeWords(8, TEST_CATEGORY);
    const series = buildDrawItSeries(
      { selectedCategoryId: TEST_CATEGORY, roundCount: 5, customWords: [] },
      catalog,
      mulberry32(1)
    );
    assert.equal(series.length, 5);
    assert.ok(series.every((w) => w.categoryId === TEST_CATEGORY));
  });

  it("T. guest add pendant changement catégorie host", () => {
    const guest = custom("g1", null, "Bob", GUEST_UID);
    const next = nextDrawItCustomWordsFromPrepPatch(
      [guest],
      { selectedCategoryId: "Animaux", roundCount: 5 },
      false
    );
    assert.equal(next.some((w) => w.id === "g1"), true);
  });

  it("U. guest add pendant changement roundCount host", () => {
    const guest = custom("g1", null, "Bob", GUEST_UID);
    const next = nextDrawItCustomWordsFromPrepPatch(
      [guest],
      { roundCount: 8, selectedCategoryId: TEST_CATEGORY },
      false
    );
    assert.equal(next[0].id, "g1");
  });

  it("V. guest add pendant Ready host", () => {
    const guest = custom("g1", null, "Bob", GUEST_UID);
    const next = nextDrawItCustomWordsFromPrepPatch(
      [guest],
      { ready: { Alice: true } },
      false
    );
    assert.equal(next[0].id, "g1");
  });

  it("W. deux guests add simultanément", () => {
    const claire = "cccccccc-cccc-cccc-cccc-cccccccccccc";
    const merged = mergeDrawItCustomWords(
      [custom("g1", "Alpha", "Bob", GUEST_UID)],
      [custom("g2", "Beta", "Claire", claire)],
      "Bob",
      GUEST_UID
    );
    assert.equal(merged.some((w) => w.id === "g1"), true);
    assert.equal(merged.some((w) => w.id === "g2"), true);
  });

  it("X. add + delete concurrent", () => {
    const afterDelete = mergeDrawItCustomWords(
      [custom("keep", "Neige", "Alice", HOST_UID)],
      [
        custom("keep", "Neige", "Alice", HOST_UID),
        custom("gone", "Igloo", "Alice", HOST_UID),
      ],
      "Alice",
      HOST_UID
    );
    assert.equal(afterDelete.some((w) => w.id === "gone"), false);
    assert.equal(afterDelete.some((w) => w.id === "keep"), true);
  });

  it("Y. suppression owner + snapshot stale → pas de résurrection", () => {
    const merged = mergeDrawItCustomWords(
      [],
      [custom("c1", SECRET_HOST, "Alice", HOST_UID)],
      "Alice",
      HOST_UID
    );
    assert.equal(merged.length, 0);
    const patch = nextDrawItCustomWordsFromPrepPatch(
      [],
      { selectedCategoryId: TEST_CATEGORY, customWords: [custom("c1", SECRET_HOST)] },
      false
    );
    assert.equal(patch.length, 0);
  });

  it("Z. owner reconnect → texte récupéré (merge local + hydrate privée)", async () => {
    await addDrawItCustomWord(SECRET_HOST);
    const id = listMyDrawItCustomWords()[0].id;
    applyRemoteSession(
      sessionRow({
        lobbyStarted: false,
        selectedCategoryId: TEST_CATEGORY,
        roundCount: 5,
        customWords: [custom(id, SECRET_HOST, "Alice", HOST_UID)],
      })
    );
    assert.equal(listMyDrawItCustomWords()[0].text, SECRET_HOST);
    assert.equal(
      JSON.stringify(
        drawItFromRemote({
          lobbyStarted: false,
          selectedCategoryId: TEST_CATEGORY,
          roundCount: 5,
          customWords: [custom(id, SECRET_HOST, "Alice", HOST_UID)],
        })
      ).includes(SECRET_HOST),
      false
    );
    const restored = mergeDrawItCustomWords(
      [custom(id, SECRET_HOST, "Alice", HOST_UID)],
      stripDrawItCustomWordTexts([custom(id, SECRET_HOST, "Alice", HOST_UID)]),
      "Alice",
      HOST_UID
    );
    assert.equal(restored.find((item) => item.id === id).text, SECRET_HOST);
    const src = read("js/core/gameSync.js");
    assert.match(src, /hydrateOwnDrawItCustomWordsIfNeeded/);
    const customSrc = read("js/core/drawItCustomWords.js");
    assert.match(customSrc, /rpcFetchMyDrawItCustomWords/);
  });

  it("AA. guest reconnect → metadata uniquement", () => {
    resetPrep({ name: "Bob", uid: GUEST_UID });
    applyRemoteSession(
      sessionRow({
        lobbyStarted: false,
        selectedCategoryId: TEST_CATEGORY,
        roundCount: 5,
        customWords: [custom("c1", SECRET_HOST, "Alice", HOST_UID)],
      })
    );
    assert.equal(getDrawItSession().customWords[0].id, "c1");
    assert.equal(getDrawItSession().customWords[0].text, undefined);
    assert.equal(listMyDrawItCustomWords().length, 0);
  });

  it("AB. guest reconnect après delete → absent", () => {
    resetPrep({ name: "Bob", uid: GUEST_UID, extra: { customWords: [custom("c1", null, "Alice", HOST_UID)] } });
    applyRemoteSession(
      sessionRow({
        lobbyStarted: false,
        selectedCategoryId: TEST_CATEGORY,
        roundCount: 5,
        customWords: [],
      })
    );
    assert.equal(getDrawItSession().customWords.length, 0);
  });

  it("AC. nouveau run → anciens customs absents", () => {
    const next = clearDrawItCustomWords({
      ...getDrawItSession(),
      customWords: [custom("old", SECRET_HOST)],
      lobbyStarted: false,
      runId: null,
    });
    assert.deepEqual(next.customWords, []);
    const src = read("js/core/restartGame.js");
    assert.match(src, /customWords: \[\]/);
    assert.match(src, /clearRemoteDrawItCustomWords/);
  });

  it("AD. ready + add → ready conservé", async () => {
    await setDrawItReady("Alice", true);
    const res = await addDrawItCustomWord("Après prêt");
    assert.equal(res.ok, true);
    assert.equal(getDrawItSession().ready.Alice, true);
  });

  it("AE. ready + delete → ready conservé", async () => {
    const added = await addDrawItCustomWord("À retirer");
    await setDrawItReady("Alice", true);
    const res = await removeDrawItCustomWord(added.id);
    assert.equal(res.ok, true);
    assert.equal(getDrawItSession().ready.Alice, true);
  });

  it("AF. completion → customs supprimés", () => {
    const src = read("js/core/gameSync.js");
    assert.match(src, /if \(key === "drawIt"\) next\.customWords = \[\]/);
    assert.match(src, /clearRemoteDrawItCustomWords/);
  });

  it("AG. restart → customs supprimés", () => {
    const src = read("js/core/restartGame.js");
    assert.match(src, /drawIt: \{ \.\.\.drawItToRemote\(di\), customWords: \[\], runId: null \}/);
  });

  it("AH. nouvelle prep → aucun ancien custom", async () => {
    await addDrawItCustomWord(SECRET_HOST);
    await markDrawItLobbyStarted({ rosterNames: ["Alice", "Bob"] });
    assert.deepEqual(getDrawItSession().customWords, []);
    saveStatePatch({ drawItGame: defaultDrawItPrepSession() });
    assert.deepEqual(getDrawItSession().customWords, []);
  });

  it("SQL 10 : table privée + lock lobbyStarted + lectures filtrées", () => {
    const sql = read("supabase/feature-drawit-10-custom-hardening.sql");
    assert.match(sql, /02 → 03 → 04 → 05 → 06 → 07 → 08 → 09 → 10/);
    assert.match(sql, /create table if not exists public\.drawit_custom_words/);
    assert.match(sql, /fetch_my_drawit_custom_words/);
    assert.match(sql, /fetch_drawit_custom_words_for_launch/);
    assert.match(sql, /clear_drawit_custom_words/);
    assert.match(sql, /game_sessions_preserve_drawit_custom_words/);
    assert.match(
      sql,
      /if coalesce\(\(v_row\.state -> 'drawIt' ->> 'lobbyStarted'\)::boolean, false\) is true then\s+raise exception 'DRAWIT_CUSTOM_LOCKED'/
    );
  });

  it("toRemote prep n'embarque jamais customWords", async () => {
    await addDrawItCustomWord(SECRET_HOST);
    const remote = drawItToRemote(getDrawItSession());
    assert.equal("customWords" in remote, false);
    assert.equal(JSON.stringify(remote).includes(SECRET_HOST), false);
  });

  it("patch stale non vide ignoré ; tableau vide = clear", () => {
    const guest = custom("g1", null, "Bob", GUEST_UID);
    const ignored = nextDrawItCustomWordsFromPrepPatch(
      [guest],
      { selectedCategoryId: "Animaux", customWords: [custom("old", SECRET_HOST)] },
      false
    );
    assert.equal(ignored[0].id, "g1");
    const cleared = nextDrawItCustomWordsFromPrepPatch(
      [guest],
      { customWords: [] },
      false
    );
    assert.deepEqual(cleared, []);
  });
});
