/**
 * QA-CUSTOM — guest lock stale runId + confidentialité des textes.
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
  removeDrawItCustomWord,
  listMyDrawItCustomWords,
  markDrawItLobbyStarted,
  setDrawItReady,
  canMutateDrawItCustomWords,
  summarizeOthersDrawItCustomAdds,
} = await import("../js/core/drawItSession.js");
const { redactDrawItCustomWordsForViewer } = await import("../js/core/sessionMerge.js");
const { drawItFromRemote, drawItToRemote } = await import("../js/core/gameSync.js");
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

function twoPlayers() {
  return [
    { userId: HOST_UID, name: "Alice", isHost: true, isLocal: true },
    { userId: GUEST_UID, name: "Bob", isHost: false, isLocal: false },
  ];
}

function resetPrep({ name = "Alice", uid = HOST_UID, extra = {} } = {}) {
  saveStatePatch({
    user: { name },
    supabaseUserId: uid,
    inLobby: true,
    lobby: {
      id: LOBBY_ID,
      code: "ABCD",
      hostId: HOST_UID,
      participants: twoPlayers().map((p) => ({
        ...p,
        isLocal: p.userId === uid,
        isHost: p.userId === HOST_UID,
      })),
    },
    drawItGame: {
      ...defaultDrawItPrepSession(),
      selectedCategoryId: TEST_CATEGORY,
      roundCount: 5,
      ...extra,
    },
  });
}

describe("DRAWIT CUSTOM WORDS — QA fix", () => {
  beforeEach(() => {
    resetPrep();
  });

  it("A. guest prep + session non lancée (runId stale) → add accepté", async () => {
    resetPrep({
      name: "Bob",
      uid: GUEST_UID,
      extra: { lobbyStarted: false, runId: "stale-from-previous-game" },
    });
    assert.equal(canMutateDrawItCustomWords(getDrawItSession()), true);
    const res = await addDrawItCustomWord("MotInvité");
    assert.equal(res.ok, true);
    assert.equal(listMyDrawItCustomWords()[0].text, "MotInvité");
  });

  it("B. host prep → add accepté", async () => {
    const res = await addDrawItCustomWord("MotHôte");
    assert.equal(res.ok, true);
    assert.equal(listMyDrawItCustomWords()[0].text, "MotHôte");
  });

  it("C. guest après vrai launch → add refusé", async () => {
    await markDrawItLobbyStarted({ rosterNames: ["Alice", "Bob"] });
    assert.equal(getDrawItSession().lobbyStarted, true);
    assert.equal(canMutateDrawItCustomWords(getDrawItSession()), false);
    const res = await addDrawItCustomWord("Trop tard");
    assert.equal(res.ok, false);
    assert.match(res.error, /déjà commencé/);
  });

  it("D. ready + add → reste ready", async () => {
    await setDrawItReady("Alice", true);
    const res = await addDrawItCustomWord("Après prêt");
    assert.equal(res.ok, true);
    assert.equal(getDrawItSession().ready.Alice, true);
  });

  it("E. ready + delete own → reste ready", async () => {
    const added = await addDrawItCustomWord("À retirer");
    await setDrawItReady("Alice", true);
    const res = await removeDrawItCustomWord(added.id);
    assert.equal(res.ok, true);
    assert.equal(getDrawItSession().ready.Alice, true);
  });

  it("F. owner voit son propre texte", async () => {
    await addDrawItCustomWord(SECRET);
    assert.equal(listMyDrawItCustomWords()[0].text, SECRET);
  });

  it("G. autre joueur ne reçoit PAS le texte", () => {
    const redacted = redactDrawItCustomWordsForViewer(
      [{ id: "c1", text: SECRET, author: "Alice", authorUid: HOST_UID }],
      "Bob",
      GUEST_UID
    );
    assert.equal(redacted.length, 1);
    assert.equal(redacted[0].text, undefined);
    assert.equal(redacted[0].author, "Alice");
    assert.equal(JSON.stringify(redacted).includes(SECRET), false);
  });

  it("H. autre joueur reçoit uniquement l'info générique d'ajout", () => {
    const summary = summarizeOthersDrawItCustomAdds(
      [
        { id: "c1", text: SECRET, author: "Alice", authorUid: HOST_UID },
        { id: "c2", author: "Alice", authorUid: HOST_UID },
      ],
      "Bob",
      GUEST_UID
    );
    assert.deepEqual(summary, [{ author: "Alice", count: 2 }]);
  });

  it("I. le message d'ajout ne contient jamais le texte du mot", () => {
    const src = read("js/screens/drawItPrep.js");
    assert.match(src, /a ajouté \$\{count\}/);
    assert.doesNotMatch(src, /item\.text.*autres|others.*item\.text/);
    const summary = summarizeOthersDrawItCustomAdds(
      [{ id: "c1", text: SECRET, author: "Alice", authorUid: HOST_UID }],
      "Bob",
      GUEST_UID
    );
    const msg = `${summary[0].author} a ajouté ${summary[0].count} mot au jeu`;
    assert.equal(msg.includes(SECRET), false);
  });

  it("J. fromRemote guest : texte d'autrui absent du state local", () => {
    resetPrep({ name: "Bob", uid: GUEST_UID });
    const remote = drawItFromRemote({
      lobbyStarted: false,
      selectedCategoryId: TEST_CATEGORY,
      roundCount: 5,
      ready: {},
      customWords: [
        { id: "c1", text: SECRET, author: "Alice", authorUid: HOST_UID },
        { id: "c2", text: "MotBob", author: "Bob", authorUid: GUEST_UID },
      ],
    });
    const alice = remote.customWords.find((w) => w.id === "c1");
    const bob = remote.customWords.find((w) => w.id === "c2");
    assert.equal(alice.text, undefined);
    assert.equal(bob.text, "MotBob");
    assert.equal(JSON.stringify(remote).includes(SECRET), false);
  });

  it("K. reconnect owner : son texte reste", () => {
    const remote = drawItFromRemote({
      lobbyStarted: false,
      selectedCategoryId: TEST_CATEGORY,
      roundCount: 5,
      ready: {},
      customWords: [{ id: "c1", text: SECRET, author: "Alice", authorUid: HOST_UID }],
    });
    assert.equal(remote.customWords[0].text, SECRET);
  });

  it("L. reconnect other : texte d'autrui inaccessible", () => {
    resetPrep({ name: "Bob", uid: GUEST_UID });
    const remote = drawItFromRemote({
      lobbyStarted: false,
      selectedCategoryId: TEST_CATEGORY,
      roundCount: 5,
      ready: {},
      customWords: [{ id: "c1", text: SECRET, author: "Alice", authorUid: HOST_UID }],
    });
    assert.equal(remote.customWords[0].text, undefined);
    assert.equal(JSON.stringify(remote).includes(SECRET), false);
  });

  it("M. suppression owner", async () => {
    const added = await addDrawItCustomWord(SECRET);
    const res = await removeDrawItCustomWord(added.id);
    assert.equal(res.ok, true);
    assert.equal(listMyDrawItCustomWords().length, 0);
  });

  it("N. suppression par un autre joueur refusée", async () => {
    saveStatePatch({
      drawItGame: {
        ...getDrawItSession(),
        customWords: [{ id: "c-bob", text: "BobWord", author: "Bob", authorUid: GUEST_UID }],
      },
    });
    const res = await removeDrawItCustomWord("c-bob");
    assert.equal(res.ok, false);
  });

  it("O. launch : customWords absent du public", async () => {
    await addDrawItCustomWord(SECRET);
    await markDrawItLobbyStarted({ rosterNames: ["Alice", "Bob"] });
    const remote = drawItToRemote(getDrawItSession());
    assert.equal("customWords" in remote, false);
    assert.equal(JSON.stringify(remote).includes(SECRET), false);
  });

  it("P. après launch aucun custom public ne revient", async () => {
    await addDrawItCustomWord(SECRET);
    await markDrawItLobbyStarted({ rosterNames: ["Alice", "Bob"] });
    const hydrated = drawItFromRemote({
      ...drawItToRemote(getDrawItSession()),
      customWords: [{ id: "c1", text: SECRET, author: "Alice", authorUid: HOST_UID }],
    });
    assert.equal("customWords" in hydrated, false);
    assert.deepEqual(getDrawItSession().customWords, []);
  });

  it("merge prep : runId local stale ignoré si remote non lancé", () => {
    resetPrep({ extra: { runId: "stale-local" } });
    const remote = drawItFromRemote({
      lobbyStarted: false,
      selectedCategoryId: TEST_CATEGORY,
      roundCount: 5,
      ready: {},
    });
    assert.equal(remote.runId, undefined);
    assert.equal(canMutateDrawItCustomWords({ ...remote, runId: "stale-local" }), true);
  });

  it("SQL 09 : lock = lobbyStarted, plus runId seul", () => {
    const sql = read("supabase/feature-drawit-09-custom-lock-privacy.sql");
    assert.match(sql, /DRAWIT_CUSTOM_LOCKED/);
    assert.match(sql, /lobbyStarted/);
    assert.doesNotMatch(
      sql,
      /lobbyStarted'\)::boolean, false\) is true\s+or length\(trim\(coalesce\(v_row\.state -> 'drawIt' ->> 'runId'/
    );
    assert.doesNotMatch(sql, /create or replace function public\.launch_drawit_game/);
  });

  it("client n'assimile plus DRAWIT_WRONG_GAME à partie commencée", () => {
    const src = read("js/core/drawItCustomWords.js");
    assert.doesNotMatch(src, /DRAWIT_WRONG_GAME/);
    assert.match(src, /!session\?\.lobbyStarted/);
  });

  it("toRemote prep n'embarque pas les textes custom", async () => {
    await addDrawItCustomWord(SECRET);
    const remote = drawItToRemote(getDrawItSession());
    assert.equal("customWords" in remote, false);
    assert.equal(JSON.stringify(remote).includes(SECRET), false);
  });
});
