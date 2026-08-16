/**
 * FEATURE-DRAWIT-CUSTOM-WORDS-01 — mots personnalisés Draw it !
 */
import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { HOT_TAKE_FORBIDDEN_WORDS } from "../data/hotTakes.js";

mock.module("../js/core/supabaseClient.js", {
  namedExports: {
    isSupabaseConfigured: () => false,
    supabase: null,
  },
});

const {
  defaultDrawItPrepSession,
  getDrawItSession,
  validateDrawItPrep,
  buildDrawItSeries,
  addDrawItCustomWord,
  removeDrawItCustomWord,
  listDrawItCustomWords,
  markDrawItLobbyStarted,
  commitDrawItComplete,
  setDrawItReady,
  buildDrawItDeck,
} = await import("../js/core/drawItSession.js");
const {
  mergeDrawItCustomWords,
  isDrawItCustomWordOwnedBy,
  sanitizeDrawItCustomWords,
} = await import("../js/core/sessionMerge.js");
const {
  canMutateDrawItCustomWords,
  clearDrawItCustomWords,
  drawItAvailablePoolSize,
} = await import("../js/core/drawItCustomWords.js");
const { drawItFromRemote, drawItToRemote } = await import("../js/core/gameSync.js");
const { publicDrawItHasForbiddenSecrets } = await import("../js/core/drawItRound.js");
const { PLAY_PATCH_EXCLUDE } = await import("../js/core/playPatch.js");
const { saveStatePatch } = await import("../js/core/state.js");

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HOST_UID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const GUEST_UID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const LOBBY_ID = "11111111-1111-1111-1111-111111111111";
const TEST_CATEGORY = "Facile";

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
  return { id, text, author, authorUid };
}

function twoPlayers() {
  return [
    { userId: HOST_UID, name: "Alice", isHost: true, isLocal: true },
    { userId: GUEST_UID, name: "Bob", isHost: false, isLocal: false },
  ];
}

function resetPrep() {
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

describe("FEATURE-DRAWIT-CUSTOM-WORDS-01", () => {
  beforeEach(() => {
    resetPrep();
  });

  it("A. ajout custom valide", async () => {
    const res = await addDrawItCustomWord("Chaussette");
    assert.equal(res.ok, true);
    const words = listDrawItCustomWords();
    assert.equal(words.length, 1);
    assert.equal(words[0].text, "Chaussette");
    assert.equal(words[0].author, "Alice");
  });

  it("B. plusieurs joueurs dans le pool", () => {
    const merged = mergeDrawItCustomWords(
      [custom("c1", "Alpha", "Alice", HOST_UID)],
      [custom("c2", "Beta", "Bob", GUEST_UID)],
      "Alice",
      HOST_UID
    );
    assert.equal(merged.length, 2);
    assert.ok(merged.some((w) => w.id === "c1"));
    assert.ok(merged.some((w) => w.id === "c2"));
  });

  it("C. plusieurs customs par joueur", async () => {
    assert.equal((await addDrawItCustomWord("Un")).ok, true);
    assert.equal((await addDrawItCustomWord("Deux")).ok, true);
    assert.equal((await addDrawItCustomWord("Trois")).ok, true);
    assert.equal(listDrawItCustomWords().length, 3);
  });

  it("D. suppression par owner", async () => {
    const added = await addDrawItCustomWord("Mine");
    const res = await removeDrawItCustomWord(added.id);
    assert.equal(res.ok, true);
    assert.equal(listDrawItCustomWords().length, 0);
  });

  it("E. impossibilité de suppression par autre joueur", async () => {
    saveStatePatch({
      drawItGame: {
        ...getDrawItSession(),
        customWords: [custom("c-bob", "BobWord", "Bob", GUEST_UID)],
      },
    });
    const res = await removeDrawItCustomWord("c-bob");
    assert.equal(res.ok, false);
    assert.equal(listDrawItCustomWords().length, 1);
  });

  it("F. suppression après ready mais avant launch", async () => {
    await setDrawItReady("Alice", true);
    const added = await addDrawItCustomWord("Après prêt");
    assert.equal(getDrawItSession().ready.Alice, true);
    const res = await removeDrawItCustomWord(added.id);
    assert.equal(res.ok, true);
    assert.equal(getDrawItSession().ready.Alice, true);
  });

  it("G. suppression ne force pas un unready", async () => {
    const added = await addDrawItCustomWord("KeepReady");
    await setDrawItReady("Alice", true);
    await removeDrawItCustomWord(added.id);
    assert.equal(getDrawItSession().ready.Alice, true);
  });

  it("H. ajout impossible après launch", async () => {
    await markDrawItLobbyStarted({ rosterNames: ["Alice", "Bob"] });
    const res = await addDrawItCustomWord("Trop tard");
    assert.equal(res.ok, false);
    assert.equal(canMutateDrawItCustomWords(getDrawItSession()), false);
  });

  it("I. suppression impossible après launch", async () => {
    const added = await addDrawItCustomWord("Avant");
    await markDrawItLobbyStarted({ rosterNames: ["Alice", "Bob"] });
    const res = await removeDrawItCustomWord(added.id);
    assert.equal(res.ok, false);
  });

  it("J. modération acceptée", async () => {
    const res = await addDrawItCustomWord("Pingouin");
    assert.equal(res.ok, true);
  });

  it("K. modération refusée", async () => {
    const bad = HOT_TAKE_FORBIDDEN_WORDS[0];
    const res = await addDrawItCustomWord(bad);
    assert.equal(res.ok, false);
    assert.equal(listDrawItCustomWords().length, 0);
  });

  it("L. customs >= roundCount : uniquement des customs", () => {
    const customs = Array.from({ length: 8 }, (_, i) =>
      custom(`c${i}`, `Custom-${i}`)
    );
    const catalog = makeWords(20, TEST_CATEGORY);
    const deck = buildDrawItDeck({
      categoryId: TEST_CATEGORY,
      roundCount: 5,
      customWords: customs,
      catalogWords: catalog,
      random: mulberry32(7),
    });
    assert.equal(deck.length, 5);
    assert.ok(deck.every((w) => w.custom));
  });

  it("M. customs < roundCount : customs + catalogue", () => {
    const customs = Array.from({ length: 4 }, (_, i) =>
      custom(`c${i}`, `Custom-${i}`)
    );
    const catalog = makeWords(10, TEST_CATEGORY);
    const deck = buildDrawItDeck({
      categoryId: TEST_CATEGORY,
      roundCount: 5,
      customWords: customs,
      catalogWords: catalog,
      random: mulberry32(11),
    });
    assert.equal(deck.length, 5);
    assert.equal(deck.filter((w) => w.custom).length, 4);
    assert.equal(deck.filter((w) => !w.custom).length, 1);
  });

  it("N. customs = 0 : catalogue inchangé", () => {
    const catalog = makeWords(8, TEST_CATEGORY);
    const series = buildDrawItSeries(
      { selectedCategoryId: TEST_CATEGORY, roundCount: 5, customWords: [] },
      catalog,
      mulberry32(3)
    );
    assert.equal(series.length, 5);
    assert.ok(series.every((w) => w.categoryId === TEST_CATEGORY));
  });

  it("O/P. sélection aléatoire / deck mélangé", () => {
    const customs = Array.from({ length: 8 }, (_, i) =>
      custom(`c${i}`, `Custom-${i}`)
    );
    const catalog = makeWords(10, TEST_CATEGORY);
    const a = buildDrawItDeck({
      categoryId: TEST_CATEGORY,
      roundCount: 5,
      customWords: customs,
      catalogWords: catalog,
      random: mulberry32(1),
    }).map((w) => w.id);
    const b = buildDrawItDeck({
      categoryId: TEST_CATEGORY,
      roundCount: 5,
      customWords: customs,
      catalogWords: catalog,
      random: mulberry32(99),
    }).map((w) => w.id);
    assert.equal(a.length, 5);
    assert.equal(b.length, 5);
    assert.notDeepEqual(a, b);
  });

  it("Q. customs prioritaires", () => {
    const customs = [custom("c1", "SeulCustom")];
    const catalog = makeWords(20, TEST_CATEGORY);
    const deck = buildDrawItDeck({
      categoryId: TEST_CATEGORY,
      roundCount: 3,
      customWords: customs,
      catalogWords: catalog,
      random: mulberry32(4),
    });
    assert.ok(deck.some((w) => w.id === "c1"));
  });

  it("R. catalogue uniquement pour compléter", () => {
    const customs = Array.from({ length: 8 }, (_, i) =>
      custom(`c${i}`, `Custom-${i}`)
    );
    const catalog = makeWords(20, TEST_CATEGORY);
    const deck = buildDrawItDeck({
      categoryId: TEST_CATEGORY,
      roundCount: 5,
      customWords: customs,
      catalogWords: catalog,
      random: mulberry32(2),
    });
    assert.equal(deck.filter((w) => !w.custom).length, 0);
  });

  it("S. aucun doublon d'id ni de label normalisé", () => {
    const customs = [
      custom("c1", "Chat"),
      custom("c2", " chat "),
      custom("c3", "CHAT"),
    ];
    const catalog = [
      ...makeWords(8, TEST_CATEGORY),
      { id: "cat_chat", label: "Chat", categoryId: TEST_CATEGORY, enabled: true },
    ];
    const deck = buildDrawItDeck({
      categoryId: TEST_CATEGORY,
      roundCount: 5,
      customWords: customs,
      catalogWords: catalog,
      random: mulberry32(5),
    });
    assert.equal(new Set(deck.map((w) => w.id)).size, deck.length);
    assert.equal(deck.filter((w) => /chat/i.test(w.label)).length, 1);
  });

  it("T. custom identique à un mot catalogue", () => {
    const catalog = makeWords(5, TEST_CATEGORY);
    const customs = [custom("c1", catalog[0].label)];
    const deck = buildDrawItDeck({
      categoryId: TEST_CATEGORY,
      roundCount: 5,
      customWords: customs,
      catalogWords: catalog,
      random: mulberry32(8),
    });
    assert.equal(deck.length, 5);
    assert.equal(deck.filter((w) => w.label === catalog[0].label).length, 1);
    assert.ok(deck.some((w) => w.id === "c1"));
  });

  it("U. suppression avant launch retire le mot du deck", async () => {
    const added = await addDrawItCustomWord("TempWord");
    await removeDrawItCustomWord(added.id);
    const deck = buildDrawItSeries({
      selectedCategoryId: TEST_CATEGORY,
      roundCount: 3,
      customWords: getDrawItSession().customWords,
    });
    assert.ok(deck.every((w) => w.label !== "TempWord"));
  });

  it("V. reconnect après ajout (hydrate remote)", () => {
    const remote = drawItFromRemote({
      lobbyStarted: false,
      selectedCategoryId: TEST_CATEGORY,
      roundCount: 5,
      ready: {},
      customWords: [custom("c1", "Hydrate")],
    });
    assert.equal(remote.customWords.length, 1);
    assert.equal(remote.customWords[0].text, "Hydrate");
  });

  it("W. reconnect après suppression (remote sans l'id)", () => {
    const merged = mergeDrawItCustomWords(
      [],
      [custom("c2", "BobKeep", "Bob", GUEST_UID)],
      "Alice",
      HOST_UID
    );
    assert.equal(merged.some((w) => w.id === "c1"), false);
    assert.equal(merged.length, 1);
  });

  it("X. ancien snapshot ne ressuscite pas un custom supprimé", () => {
    const merged = mergeDrawItCustomWords(
      [],
      [custom("c1", "Ghost", "Alice", HOST_UID)],
      "Alice",
      HOST_UID
    );
    assert.equal(merged.some((w) => w.id === "c1"), false);
  });

  it("Y. restart vide les customs", () => {
    const next = defaultDrawItPrepSession();
    assert.deepEqual(next.customWords, []);
  });

  it("Z. fin de partie supprime les customs", async () => {
    await addDrawItCustomWord("Fin");
    await markDrawItLobbyStarted({ rosterNames: ["Alice", "Bob"] });
    const launched = getDrawItSession();
    assert.deepEqual(launched.customWords, []);
    launched.roundIdx = 4;
    launched.phase = "reveal";
    launched.roundCount = 5;
    saveStatePatch({ drawItGame: launched });
    const { canCompleteDrawItGame } = await import("../js/core/drawItRound.js");
    if (canCompleteDrawItGame(getDrawItSession()).ok) {
      await commitDrawItComplete();
    }
    const cleared = clearDrawItCustomWords(getDrawItSession());
    assert.deepEqual(cleared.customWords, []);
  });

  it("AA. cleanup idempotent", () => {
    const once = clearDrawItCustomWords({ customWords: [custom("c1", "A")] });
    const twice = clearDrawItCustomWords(once);
    assert.deepEqual(once.customWords, []);
    assert.deepEqual(twice.customWords, []);
  });

  it("AB. nouvelle partie peut ajouter de nouveaux customs", async () => {
    await addDrawItCustomWord("A");
    saveStatePatch({ drawItGame: defaultDrawItPrepSession() });
    const res = await addDrawItCustomWord("B");
    assert.equal(res.ok, true);
    assert.equal(listDrawItCustomWords()[0].text, "B");
  });

  it("AC. isolation lobby / hotTake", () => {
    const drawIt = sanitizeDrawItCustomWords([custom("c1", "Draw")]);
    assert.equal(drawIt[0].text, "Draw");
    assert.equal("optionA" in drawIt[0], false);
  });

  it("AD. isolation run : launch vide le pool public", async () => {
    await addDrawItCustomWord("Secret");
    await markDrawItLobbyStarted({ rosterNames: ["Alice", "Bob"] });
    const remote = drawItToRemote(getDrawItSession());
    assert.equal("customWords" in remote, false);
    assert.deepEqual(getDrawItSession().customWords, []);
  });

  it("AE. invités + host ownership", () => {
    assert.equal(
      isDrawItCustomWordOwnedBy(custom("c1", "A", "Alice", HOST_UID), "Alice", HOST_UID),
      true
    );
    assert.equal(
      isDrawItCustomWordOwnedBy(custom("c1", "A", "Alice", HOST_UID), "Bob", GUEST_UID),
      false
    );
  });

  it("AF. acting host : RPC membre, pas host-only (SQL)", () => {
    const sql = read("supabase/feature-drawit-08-custom-words.sql");
    assert.match(sql, /assert_lobby_member/);
    assert.match(sql, /v_game = 'drawit'/);
    assert.doesNotMatch(
      sql.split("upsert_player_custom_entry")[1].split("delete_player_custom_entry")[0],
      /is_lobby_host/
    );
  });

  it("AG. confidentialité du deck public", async () => {
    await addDrawItCustomWord("Kangourou");
    await markDrawItLobbyStarted({ rosterNames: ["Alice", "Bob"] });
    const remote = drawItToRemote(getDrawItSession());
    assert.equal(JSON.stringify(remote).includes("Kangourou"), false);
    assert.equal("deck" in remote, false);
    assert.equal("wordLabel" in remote, false);
  });

  it("AH. aucun mot futur exposé aux observateurs", () => {
    const remote = {
      lobbyStarted: true,
      runId: "run-1",
      phase: "drawing",
      customWords: [custom("c1", "Futur")],
    };
    assert.equal(publicDrawItHasForbiddenSecrets(remote), true);
    const stripped = drawItFromRemote(remote);
    assert.equal("customWords" in stripped, false);
  });

  it("AI. série 3 manches", () => {
    const catalog = makeWords(10, TEST_CATEGORY);
    const deck = buildDrawItDeck({
      categoryId: TEST_CATEGORY,
      roundCount: 3,
      customWords: [custom("c1", "A"), custom("c2", "B")],
      catalogWords: catalog,
      random: mulberry32(13),
    });
    assert.equal(deck.length, 3);
    assert.equal(deck.filter((w) => w.custom).length, 2);
  });

  it("AJ. série 5 manches / 4 customs + 1 catalogue", () => {
    const catalog = makeWords(10, TEST_CATEGORY);
    const deck = buildDrawItDeck({
      categoryId: TEST_CATEGORY,
      roundCount: 5,
      customWords: Array.from({ length: 4 }, (_, i) => custom(`c${i}`, `C${i}`)),
      catalogWords: catalog,
      random: mulberry32(17),
    });
    assert.equal(deck.length, 5);
    assert.equal(deck.filter((w) => w.custom).length, 4);
  });

  it("AK. série 8 manches / 4 customs + 4 catalogue", () => {
    const catalog = makeWords(10, TEST_CATEGORY);
    const deck = buildDrawItDeck({
      categoryId: TEST_CATEGORY,
      roundCount: 8,
      customWords: Array.from({ length: 4 }, (_, i) => custom(`c${i}`, `C${i}`)),
      catalogWords: catalog,
      random: mulberry32(19),
    });
    assert.equal(deck.length, 8);
    assert.equal(deck.filter((w) => w.custom).length, 4);
    assert.equal(deck.filter((w) => !w.custom).length, 4);
  });

  it("roundCount 3 / 5 customs → exactement 3 customs", () => {
    const deck = buildDrawItDeck({
      categoryId: TEST_CATEGORY,
      roundCount: 3,
      customWords: Array.from({ length: 5 }, (_, i) => custom(`c${i}`, `C${i}`)),
      catalogWords: makeWords(10, TEST_CATEGORY),
      random: mulberry32(21),
    });
    assert.equal(deck.length, 3);
    assert.ok(deck.every((w) => w.custom));
  });

  it("pool : customs comblent un catalogue insuffisant", () => {
    const check = validateDrawItPrep(
      {
        selectedCategoryId: TEST_CATEGORY,
        roundCount: 5,
        customWords: Array.from({ length: 4 }, (_, i) => custom(`c${i}`, `C${i}`)),
      },
      makeWords(3, TEST_CATEGORY)
    );
    assert.equal(check.valid, true);
    assert.equal(check.poolSize, 7);
  });

  it("toRemote prépa n'envoie pas customWords (anti overwrite hôte)", async () => {
    await addDrawItCustomWord("LocalOnly");
    const remote = drawItToRemote(getDrawItSession());
    assert.equal("customWords" in remote, false);
    assert.equal(listDrawItCustomWords().length, 1);
  });

  it("play patch exclut customWords", () => {
    assert.equal(PLAY_PATCH_EXCLUDE.has("customWords"), true);
  });

  it("SQL : lock + path drawIt.customWords + strip launch", () => {
    const sql = read("supabase/feature-drawit-08-custom-words.sql");
    assert.match(sql, /DRAWIT_CUSTOM_LOCKED/);
    assert.match(sql, /v_array_key := 'customWords'/);
    assert.match(sql, /v_state_key := 'drawIt'/);
    assert.match(sql, /authorUid/);
    assert.match(sql, /p_drawit - 'roundStartAt' - 'roundEndsAt' - 'customWords'/);
    assert.match(sql, /game: "drawit"|p_game text/);
  });

  it("client RPC drawit (hôte = invité)", () => {
    const src = read("js/core/drawItCustomWords.js");
    assert.match(src, /game: "drawit"/);
    assert.match(src, /rpcUpsertPlayerCustomEntry/);
    assert.match(src, /rpcDeletePlayerCustomEntry/);
    assert.doesNotMatch(src, /isLobbyHost\(\)/);
    assert.match(src, /checkHotTakeModeration/);
  });

  it("UI prep : liste owner + hint générique, pas le texte des autres", () => {
    const src = read("js/screens/drawItPrep.js");
    assert.match(src, /id="new-drawit-word"/);
    assert.match(src, /id="add-drawit-word"/);
    assert.match(src, /listMyDrawItCustomWords/);
    assert.match(src, /summarizeOthersDrawItCustomAdds/);
    assert.match(src, /a ajouté/);
    assert.match(src, /syncPrepOnMount\(refreshFromSync\)/);
    assert.doesNotMatch(src, /activeElement\?\.id !== "new-drawit-word"/);
    assert.doesNotMatch(src, /listDrawItCustomWords\(\)/);
  });

  it("available pool 0 customs = catalogue", () => {
    const catalog = makeWords(6, TEST_CATEGORY);
    assert.equal(
      drawItAvailablePoolSize({
        categoryId: TEST_CATEGORY,
        customWords: [],
        catalogWords: catalog,
      }),
      6
    );
  });
});
