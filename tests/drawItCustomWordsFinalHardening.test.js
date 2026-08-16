/**
 * FEATURE-DRAWIT-13 — hardening final customs (migration, complete, launch, hydrate, pool).
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
  canMutateDrawItCustomWords,
} = await import("../js/core/drawItSession.js");
const {
  mergeDrawItCustomWords,
  nextDrawItCustomWordsFromPrepPatch,
  stripDrawItCustomWordTexts,
} = await import("../js/core/sessionMerge.js");
const {
  countUniqueDrawItCustomWords,
  drawItAvailablePoolSize,
  mergePlayableDrawItCustomWordsForLaunch,
  applyOwnPrivateCustomWords,
  loadDrawItCustomWordsForLaunch,
  hydrateOwnDrawItCustomWordsIfNeeded,
  resetDrawItCustomHydrateCacheForTests,
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
const SECRET = "Faire du ski à poil";

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
  resetDrawItCustomHydrateCacheForTests();
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
    updated_at: extra.updatedAt || "2026-08-16T21:00:00.000Z",
    state: { drawIt },
  };
}

describe("FEATURE-DRAWIT-13 — hardening final customs", () => {
  beforeEach(() => {
    resetPrep();
  });

  it("A. ancien custom avec UUID valide → privé + méta publique sans texte", () => {
    const sql = read("supabase/feature-drawit-13-custom-migration-repair.sql");
    assert.match(sql, /insert into public\.drawit_custom_words \(lobby_id, entry_id, user_id, word_text\)/);
    assert.match(sql, /authorUid'[\s\S]{0,80}~\*/);
    assert.match(sql, /jsonb_build_object\(\s*'id', e\.elem ->> 'id'/);
    const rebuild = sql.split("Reconstruire le blob public")[1] || "";
    assert.doesNotMatch(rebuild, /'text', e\.elem ->> 'text'/);
  });

  it("B/C. ancien custom sans UUID / UUID invalide → quarantaine, pas d'attribution", () => {
    const sql = read("supabase/feature-drawit-13-custom-migration-repair.sql");
    assert.match(sql, /drawit_custom_words_unassigned/);
    assert.match(sql, /n'invente JAMAIS un authorUid|On n'invente JAMAIS un authorUid/);
    assert.match(sql, /!~\*/);
    assert.doesNotMatch(sql, /host_id::uuid.*word_text|authorUid.*=.*host/);
  });

  it("D. migration 13 idempotente", () => {
    const sql = read("supabase/feature-drawit-13-custom-migration-repair.sql");
    assert.match(sql, /create table if not exists public\.drawit_custom_words_unassigned/);
    assert.match(sql, /on conflict \(lobby_id, entry_id\) do update/);
    assert.match(sql, /on conflict \(lobby_id, entry_id\) do nothing/);
    assert.match(sql, /02 → 03 → 04 → 05 → 06 → 07 → 08 → 09 → 10 → 13/);
  });

  it("E. aucune perte silencieuse (texte legacy conservé en quarantaine)", () => {
    const sql = read("supabase/feature-drawit-13-custom-migration-repair.sql");
    assert.match(sql, /word_text text not null/);
    assert.match(sql, /quarantaine/);
    const sql10 = read("supabase/feature-drawit-10-custom-hardening.sql");
    assert.doesNotMatch(sql10, /drawit_custom_words_unassigned/);
  });

  it("F. complete normal vide customWords", () => {
    const src = read("js/core/gameSync.js");
    assert.match(src, /if \(key === "drawIt"\) next\.customWords = \[\]/);
    assert.match(src, /clearRemoteDrawItCustomWords/);
  });

  it("G. complete acting host : drawIt + DELETE privé", () => {
    const sql = read("supabase/feature-drawit-13-custom-migration-repair.sql");
    const marker = "create or replace function public.complete_game_session_as_actor";
    const actor = sql.slice(sql.indexOf(marker));
    assert.match(actor, /'drawIt'/);
    assert.match(actor, /customWords', '\[\]'::jsonb/);
    assert.match(actor, /delete from public\.drawit_custom_words where lobby_id = p_lobby_id/);
    assert.match(actor, /tierNightLive/);
    assert.match(actor, /tiernight-end/);
  });

  it("H. complete double idempotent (DELETE + customWords [])", () => {
    const sql = read("supabase/feature-drawit-13-custom-migration-repair.sql");
    assert.match(sql, /delete from public\.drawit_custom_words where lobby_id = p_lobby_id/);
    assert.match(sql, /delete from public\.drawit_custom_words_unassigned where lobby_id = p_lobby_id/);
    assert.match(sql, /to_regclass\('public\.drawit_custom_words'\)/);
  });

  it("I/J. complete → nouvelle prep, privés anciens absents", () => {
    const next = clearDrawItCustomWords({
      ...getDrawItSession(),
      customWords: [custom("old", SECRET)],
      lobbyStarted: false,
    });
    assert.deepEqual(next.customWords, []);
    assert.equal(canMutateDrawItCustomWords({ lobbyStarted: false, runId: "stale" }), true);
    const restart = read("js/core/restartGame.js");
    assert.match(restart, /clearRemoteDrawItCustomWords/);
  });

  it("K. public + private correspondant → OK", () => {
    const res = mergePlayableDrawItCustomWordsForLaunch(
      [custom("c1", null, "Alice", HOST_UID), custom("c2", null, "Bob", GUEST_UID)],
      [
        custom("c1", "Neige", "Alice", HOST_UID),
        custom("c2", "Igloo", "Bob", GUEST_UID),
      ]
    );
    assert.equal(res.ok, true);
    assert.equal(res.customWords.find((w) => w.id === "c1").text, "Neige");
    assert.equal(res.customWords.find((w) => w.id === "c2").text, "Igloo");
  });

  it("L. public sans private → fail-closed", () => {
    const res = mergePlayableDrawItCustomWordsForLaunch(
      [custom("c1", null, "Bob", GUEST_UID)],
      []
    );
    assert.equal(res.ok, false);
    assert.deepEqual(res.customWords, []);
  });

  it("M/N. private sans public / private ancien → jamais joué", () => {
    const res = mergePlayableDrawItCustomWordsForLaunch(
      [],
      [custom("orphan", "Fantôme", "Bob", GUEST_UID)]
    );
    assert.equal(res.ok, true);
    assert.deepEqual(res.customWords, []);
  });

  it("O. deux parties successives → aucune fuite extras", () => {
    const src = read("js/core/drawItCustomWords.js");
    assert.doesNotMatch(src, /extras/);
    const first = mergePlayableDrawItCustomWordsForLaunch(
      [custom("new", null, "Alice", HOST_UID)],
      [
        custom("new", "Neige", "Alice", HOST_UID),
        custom("old", SECRET, "Bob", GUEST_UID),
      ]
    );
    assert.equal(first.ok, true);
    assert.equal(first.customWords.length, 1);
    assert.equal(first.customWords[0].id, "new");
    assert.equal(JSON.stringify(first).includes(SECRET), false);
  });

  it("P. owner reconnect → texte via merge local", async () => {
    await addDrawItCustomWord(SECRET);
    const id = listMyDrawItCustomWords()[0].id;
    applyRemoteSession(
      sessionRow({
        lobbyStarted: false,
        selectedCategoryId: TEST_CATEGORY,
        roundCount: 5,
        customWords: [custom(id, SECRET, "Alice", HOST_UID)],
      })
    );
    assert.equal(listMyDrawItCustomWords()[0].text, SECRET);
  });

  it("Q. owner hydrate sans méta publique", async () => {
    const applied = applyOwnPrivateCustomWords(
      [],
      [{ id: "priv-only", text: SECRET, authorUid: HOST_UID, author: "Alice" }],
      "Alice",
      HOST_UID
    );
    assert.equal(applied.changed, true);
    assert.equal(applied.customWords[0].id, "priv-only");
    assert.equal(applied.customWords[0].text, SECRET);
    const src = read("js/core/drawItCustomWords.js");
    assert.match(src, /lobbyChanged/);
    assert.match(src, /rpcFetchMyDrawItCustomWords/);
  });

  it("R. guest hydrate sans texte", () => {
    resetPrep({ name: "Bob", uid: GUEST_UID });
    applyRemoteSession(
      sessionRow({
        lobbyStarted: false,
        selectedCategoryId: TEST_CATEGORY,
        roundCount: 5,
        customWords: [custom("c1", SECRET, "Alice", HOST_UID)],
      })
    );
    assert.equal(getDrawItSession().customWords[0].text, undefined);
    assert.equal(JSON.stringify(getDrawItSession()).includes(SECRET), false);
    assert.equal(listMyDrawItCustomWords().length, 0);
  });

  it("S/T. early UID + aucun flash de texte", () => {
    saveStatePatch({ supabaseUserId: null, user: { name: "" } });
    const remote = drawItFromRemote({
      lobbyStarted: false,
      selectedCategoryId: TEST_CATEGORY,
      roundCount: 5,
      customWords: [custom("c1", SECRET, "Alice", HOST_UID)],
    });
    assert.equal(remote.customWords[0].text, undefined);
    assert.equal(JSON.stringify(remote).includes(SECRET), false);
    assert.equal(stripDrawItCustomWordTexts([custom("c1", SECRET)])[0].text, undefined);
  });

  it("U. chat + CHAT + Chat = 1", () => {
    const words = [custom("a", "chat"), custom("b", "CHAT"), custom("c", "Chat")];
    assert.equal(countUniqueDrawItCustomWords(words), 1);
  });

  it("V. entrées sans texte non comptées", () => {
    const words = [
      custom("a", "chat"),
      custom("b", null, "Bob", GUEST_UID),
      { id: "c", author: "Claire", authorUid: "cccccccc-cccc-cccc-cccc-cccccccccccc" },
    ];
    assert.equal(countUniqueDrawItCustomWords(words), 1);
    assert.equal(
      drawItAvailablePoolSize({
        categoryId: TEST_CATEGORY,
        customWords: words,
        catalogWords: makeWords(4, TEST_CATEGORY),
      }),
      5
    );
  });

  it("W. C unique ≥ N → uniquement customs", () => {
    const words = Array.from({ length: 6 }, (_, i) => custom(`c${i}`, `Mot-${i}`));
    const deck = buildDrawItDeck({
      categoryId: TEST_CATEGORY,
      roundCount: 5,
      customWords: words,
      catalogWords: makeWords(20, TEST_CATEGORY),
      random: mulberry32(3),
    });
    assert.equal(deck.length, 5);
    assert.ok(deck.every((w) => w.custom));
  });

  it("X. C unique < N → customs + catalogue", () => {
    const words = [custom("a", "chat"), custom("b", "CHAT"), custom("c", "chien")];
    const deck = buildDrawItDeck({
      categoryId: TEST_CATEGORY,
      roundCount: 5,
      customWords: words,
      catalogWords: makeWords(10, TEST_CATEGORY),
      random: mulberry32(4),
    });
    assert.equal(countUniqueDrawItCustomWords(words), 2);
    assert.equal(deck.filter((w) => w.custom).length, 2);
    assert.equal(deck.filter((w) => !w.custom).length, 3);
  });

  it("Y. C = 0 → catalogue", () => {
    const catalog = makeWords(8, TEST_CATEGORY);
    const series = buildDrawItSeries(
      { selectedCategoryId: TEST_CATEGORY, roundCount: 5, customWords: [] },
      catalog,
      mulberry32(1)
    );
    assert.equal(series.length, 5);
  });

  it("Z/AA. guest add pendant category / ready host", () => {
    const guest = custom("g1", null, "Bob", GUEST_UID);
    assert.equal(
      nextDrawItCustomWordsFromPrepPatch([guest], { selectedCategoryId: "Animaux" }, false)[0].id,
      "g1"
    );
    assert.equal(
      nextDrawItCustomWordsFromPrepPatch([guest], { ready: { Alice: true } }, false)[0].id,
      "g1"
    );
  });

  it("AB. guest delete + snapshot stale → pas de résurrection", () => {
    const merged = mergeDrawItCustomWords(
      [],
      [custom("c1", SECRET, "Alice", HOST_UID)],
      "Alice",
      HOST_UID
    );
    assert.equal(merged.length, 0);
  });

  it("AC. deux guests add simultanément", () => {
    const merged = mergeDrawItCustomWords(
      [custom("g1", "Alpha", "Bob", GUEST_UID)],
      [custom("g2", "Beta", "Claire", "cccccccc-cccc-cccc-cccc-cccccccccccc")],
      "Bob",
      GUEST_UID
    );
    assert.equal(merged.some((w) => w.id === "g1"), true);
    assert.equal(merged.some((w) => w.id === "g2"), true);
  });

  it("AD. reconnect pendant modification : strip remote conserve local owned", async () => {
    await addDrawItCustomWord("Neige");
    const id = listMyDrawItCustomWords()[0].id;
    const remote = drawItFromRemote({
      lobbyStarted: false,
      selectedCategoryId: TEST_CATEGORY,
      roundCount: 5,
      customWords: [custom(id, "Neige", "Alice", HOST_UID), custom("g1", SECRET, "Bob", GUEST_UID)],
    });
    assert.equal(JSON.stringify(remote).includes(SECRET), false);
    const merged = mergeDrawItCustomWords(
      getDrawItSession().customWords,
      remote.customWords,
      "Alice",
      HOST_UID
    );
    assert.equal(merged.find((w) => w.id === id).text, "Neige");
    assert.equal(merged.find((w) => w.id === "g1")?.text, undefined);
  });

  it("AE. add → launch → complete → prep", async () => {
    await addDrawItCustomWord("Kangourou");
    await markDrawItLobbyStarted({ rosterNames: ["Alice", "Bob"] });
    assert.equal(getDrawItSession().lobbyStarted, true);
    assert.deepEqual(getDrawItSession().customWords, []);
    saveStatePatch({ drawItGame: defaultDrawItPrepSession() });
    assert.equal(canMutateDrawItCustomWords(getDrawItSession()), true);
    assert.deepEqual(getDrawItSession().customWords, []);
  });

  it("AF. add → restart → prep", async () => {
    await addDrawItCustomWord("Igloo");
    const src = read("js/core/restartGame.js");
    assert.match(src, /customWords: \[\]/);
    assert.match(src, /runId: null/);
  });

  it("AG. old private row → new game jamais joué", () => {
    const res = mergePlayableDrawItCustomWordsForLaunch(
      [custom("fresh", null, "Alice", HOST_UID)],
      [
        custom("fresh", "Neige", "Alice", HOST_UID),
        custom("legacy", SECRET, "Bob", GUEST_UID),
      ]
    );
    assert.equal(res.customWords.some((w) => w.id === "legacy"), false);
  });

  it("AH. delete → reconnect → launch sans le mot", async () => {
    const added = await addDrawItCustomWord(SECRET);
    await removeDrawItCustomWord(added.id);
    applyRemoteSession(
      sessionRow({
        lobbyStarted: false,
        selectedCategoryId: TEST_CATEGORY,
        roundCount: 5,
        customWords: [],
      })
    );
    assert.equal(listMyDrawItCustomWords().length, 0);
    const loaded = await loadDrawItCustomWordsForLaunch(getDrawItSession());
    assert.equal(loaded.ok, true);
    assert.equal(loaded.customWords.some((w) => w.id === added.id), false);
  });

  it("AI. delete autre joueur refusé", async () => {
    saveStatePatch({
      drawItGame: {
        ...getDrawItSession(),
        customWords: [custom("c-bob", "BobWord", "Bob", GUEST_UID)],
      },
    });
    const res = await removeDrawItCustomWord("c-bob");
    assert.equal(res.ok, false);
  });

  it("AJ. forged authorUid refusé (serveur force auth.uid)", () => {
    const sql = read("supabase/feature-drawit-10-custom-hardening.sql");
    assert.match(sql, /'authorUid', v_uid::text/);
    assert.match(sql, /where public\.drawit_custom_words\.user_id = excluded\.user_id/);
  });

  it("AK. custom texte absent du blob public / fromRemote", () => {
    const remote = drawItFromRemote({
      lobbyStarted: false,
      selectedCategoryId: TEST_CATEGORY,
      roundCount: 5,
      customWords: [custom("c1", SECRET, "Alice", HOST_UID)],
    });
    assert.equal(remote.customWords[0].text, undefined);
    assert.equal(JSON.stringify(remote).includes(SECRET), false);
  });

  it("AL. custom texte absent de drawItToRemote", async () => {
    await addDrawItCustomWord(SECRET);
    const remote = drawItToRemote(getDrawItSession());
    assert.equal("customWords" in remote, false);
    assert.equal(JSON.stringify(remote).includes(SECRET), false);
  });

  it("validateDrawItPrep customCount = uniques avec texte", () => {
    const check = validateDrawItPrep(
      {
        selectedCategoryId: TEST_CATEGORY,
        roundCount: 5,
        customWords: [
          custom("a", "chat"),
          custom("b", "CHAT"),
          custom("c", null, "Bob", GUEST_UID),
        ],
      },
      makeWords(10, TEST_CATEGORY)
    );
    assert.equal(check.customCount, 1);
    assert.equal(check.valid, true);
  });
});
