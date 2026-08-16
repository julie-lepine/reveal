/**
 * BUG-DRAWIT-CUSTOM-10 — sync symétrique de la notification custom (prep).
 */
import { describe, it, beforeEach, afterEach, mock } from "node:test";
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
  applyRemoteSession,
  drawItFromRemote,
  drawItToRemote,
  onGameSessionChange,
  __resetCachedGameSessionForTests,
} = await import("../js/core/gameSync.js");
const {
  defaultDrawItPrepSession,
  getDrawItSession,
  addDrawItCustomWord,
  removeDrawItCustomWord,
  listMyDrawItCustomWords,
  summarizeOthersDrawItCustomAdds,
  setDrawItReady,
  markDrawItLobbyStarted,
} = await import("../js/core/drawItSession.js");
const { mergeDrawItCustomWords } = await import("../js/core/sessionMerge.js");
const { saveStatePatch, getState } = await import("../js/core/state.js");
const { initRouter, registerScreen, resetNav } = await import("../js/core/router.js");

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HOST_UID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const GUEST_UID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const LOBBY_ID = "11111111-1111-1111-1111-111111111111";
const TEST_CATEGORY = "Facile";
const SECRET_HOST = "chat";
const SECRET_GUEST = "maison";

function read(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

function twoPlayers(localUid) {
  return [
    { userId: HOST_UID, name: "Alice", isHost: true, isLocal: localUid === HOST_UID },
    { userId: GUEST_UID, name: "Bob", isHost: false, isLocal: localUid === GUEST_UID },
  ];
}

function resetViewer({ name = "Alice", uid = HOST_UID, extra = {} } = {}) {
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

let rowSeq = 0;
function sessionRow(drawIt, extra = {}) {
  rowSeq += 1;
  return {
    lobby_id: LOBBY_ID,
    game_id: "drawit",
    screen: extra.screen || "drawit-prep",
    updated_at: extra.updatedAt || `2026-08-16T19:${String(rowSeq).padStart(2, "0")}:00.000Z`,
    state: { drawIt },
  };
}

function custom(id, text, author, authorUid) {
  return { id, text, author, authorUid };
}

function hintLine(author, count) {
  const label = count > 1 ? "mots" : "mot";
  return `${author} a ajouté ${count} ${label} au jeu`;
}

function othersHint(session = getDrawItSession()) {
  const local = getState().user?.name;
  const uid = getState().supabaseUserId;
  return summarizeOthersDrawItCustomAdds(session.customWords || [], local, uid).map(
    ({ author, count }) => hintLine(author, count)
  );
}

function othersTexts(session = getDrawItSession()) {
  const local = getState().user?.name;
  const uid = getState().supabaseUserId;
  return (session.customWords || [])
    .filter((item) => item.authorUid !== uid && item.author !== local)
    .map((item) => item.text)
    .filter(Boolean);
}

function fakeApp() {
  return {
    innerHTML: "",
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
  };
}

function ensureScreens() {
  initRouter(fakeApp());
  for (const id of ["home", "lobby", "game-select", "drawit-prep", "drawit"]) {
    registerScreen(id, () => {});
  }
}

describe("BUG-DRAWIT-CUSTOM-10 — sync notification", () => {
  let unsub = () => {};
  const notifies = [];

  beforeEach(() => {
    globalThis.requestAnimationFrame = (fn) => {
      fn(0);
      return 0;
    };
    ensureScreens();
    resetNav();
    unsub();
    unsub = onGameSessionChange(() => {
      notifies.push(true);
    });
    resetViewer();
    notifies.length = 0;
  });

  afterEach(() => {
    unsub();
    unsub = () => {};
  });

  it("A. Host ajoute → guest reçoit la notification sans action", () => {
    resetViewer({ name: "Bob", uid: GUEST_UID });
    applyRemoteSession(
      sessionRow({
        lobbyStarted: false,
        selectedCategoryId: TEST_CATEGORY,
        roundCount: 5,
        ready: {},
        customWords: [custom("c-host-1", SECRET_HOST, "Alice", HOST_UID)],
      })
    );
    assert.equal(notifies.length >= 1, true);
    assert.deepEqual(othersHint(), [hintLine("Alice", 1)]);
    assert.equal(othersTexts().includes(SECRET_HOST), false);
  });

  it("B. Guest ajoute → host reçoit la notification sans action", () => {
    resetViewer({ name: "Alice", uid: HOST_UID });
    applyRemoteSession(
      sessionRow({
        lobbyStarted: false,
        selectedCategoryId: TEST_CATEGORY,
        roundCount: 5,
        ready: {},
        customWords: [custom("c-guest-1", SECRET_GUEST, "Bob", GUEST_UID)],
      })
    );
    assert.equal(notifies.length >= 1, true);
    assert.deepEqual(othersHint(), [hintLine("Bob", 1)]);
    assert.equal(othersTexts().includes(SECRET_GUEST), false);
  });

  it("C. Guest ajoute → host ne reçoit pas le texte du mot", () => {
    resetViewer({ name: "Alice", uid: HOST_UID });
    applyRemoteSession(
      sessionRow({
        lobbyStarted: false,
        selectedCategoryId: TEST_CATEGORY,
        roundCount: 5,
        customWords: [custom("c-guest-1", SECRET_GUEST, "Bob", GUEST_UID)],
      })
    );
    const local = getDrawItSession().customWords || [];
    assert.equal(local.length, 1);
    assert.equal(local[0].author, "Bob");
    assert.equal(local[0].text, undefined);
    assert.equal(JSON.stringify(local).includes(SECRET_GUEST), false);
  });

  it("D. Host ajoute → guest ne reçoit pas le texte du mot", () => {
    resetViewer({ name: "Bob", uid: GUEST_UID });
    const hydrated = drawItFromRemote({
      lobbyStarted: false,
      selectedCategoryId: TEST_CATEGORY,
      roundCount: 5,
      customWords: [custom("c-host-1", SECRET_HOST, "Alice", HOST_UID)],
    });
    assert.equal(hydrated.customWords[0].text, undefined);
    assert.equal(JSON.stringify(hydrated).includes(SECRET_HOST), false);
  });

  it("E. Owner voit immédiatement son propre mot", async () => {
    const res = await addDrawItCustomWord(SECRET_HOST);
    assert.equal(res.ok, true);
    assert.equal(listMyDrawItCustomWords()[0].text, SECRET_HOST);
  });

  it("F. Plusieurs mots ajoutés par host → guest converge", () => {
    resetViewer({ name: "Bob", uid: GUEST_UID });
    applyRemoteSession(
      sessionRow({
        lobbyStarted: false,
        selectedCategoryId: TEST_CATEGORY,
        roundCount: 5,
        customWords: [
          custom("c-h-1", "alpha", "Alice", HOST_UID),
          custom("c-h-2", "beta", "Alice", HOST_UID),
          custom("c-h-3", "gamma", "Alice", HOST_UID),
        ],
      })
    );
    assert.deepEqual(othersHint(), [hintLine("Alice", 3)]);
    assert.equal(othersTexts().length, 0);
  });

  it("G. Plusieurs mots ajoutés par guest → host converge", () => {
    resetViewer({ name: "Alice", uid: HOST_UID });
    applyRemoteSession(
      sessionRow({
        lobbyStarted: false,
        selectedCategoryId: TEST_CATEGORY,
        roundCount: 5,
        customWords: [
          custom("c-g-1", "maison", "Bob", GUEST_UID),
          custom("c-g-2", "voiture", "Bob", GUEST_UID),
          custom("c-g-3", "plage", "Bob", GUEST_UID),
        ],
      })
    );
    assert.deepEqual(othersHint(), [hintLine("Bob", 3)]);
    assert.equal(othersTexts().length, 0);
  });

  it("H. Ajout + Ready → Ready reste inchangé", async () => {
    await setDrawItReady("Alice", true);
    applyRemoteSession(
      sessionRow({
        lobbyStarted: false,
        selectedCategoryId: TEST_CATEGORY,
        roundCount: 5,
        ready: { [HOST_UID]: true },
        customWords: [custom("c-guest-1", SECRET_GUEST, "Bob", GUEST_UID)],
      })
    );
    assert.equal(getDrawItSession().ready.Alice, true);
  });

  it("I. Suppression → synchronisation correcte", () => {
    resetViewer({
      name: "Alice",
      uid: HOST_UID,
      extra: {
        customWords: [
          { id: "c-g-1", author: "Bob", authorUid: GUEST_UID },
          { id: "c-g-2", author: "Bob", authorUid: GUEST_UID },
        ],
      },
    });
    applyRemoteSession(
      sessionRow({
        lobbyStarted: false,
        selectedCategoryId: TEST_CATEGORY,
        roundCount: 5,
        customWords: [custom("c-g-2", "voiture", "Bob", GUEST_UID)],
      })
    );
    const ids = (getDrawItSession().customWords || []).map((item) => item.id);
    assert.deepEqual(ids, ["c-g-2"]);
    assert.deepEqual(othersHint(), [hintLine("Bob", 1)]);
  });

  it("J. Suppression owner → les autres ne voient jamais son texte", () => {
    resetViewer({ name: "Bob", uid: GUEST_UID });
    applyRemoteSession(
      sessionRow({
        lobbyStarted: false,
        selectedCategoryId: TEST_CATEGORY,
        roundCount: 5,
        customWords: [custom("c-h-1", SECRET_HOST, "Alice", HOST_UID)],
      })
    );
    applyRemoteSession(
      sessionRow({
        lobbyStarted: false,
        selectedCategoryId: TEST_CATEGORY,
        roundCount: 5,
        customWords: [],
      })
    );
    assert.deepEqual(getDrawItSession().customWords || [], []);
    assert.equal(JSON.stringify(getDrawItSession()).includes(SECRET_HOST), false);
  });

  it("K. Patch distant stale → ne réintroduit pas un custom supprimé", async () => {
    const added = await addDrawItCustomWord("neige");
    await removeDrawItCustomWord(added.id);
    const merged = mergeDrawItCustomWords(
      getDrawItSession().customWords || [],
      [custom(added.id, "neige", "Alice", HOST_UID)],
      "Alice",
      HOST_UID
    );
    assert.equal(merged.some((item) => item.id === added.id), false);
  });

  it("L. Reconnexion → état cohérent", () => {
    resetViewer({ name: "Alice", uid: HOST_UID });
    const asHost = drawItFromRemote({
      lobbyStarted: false,
      selectedCategoryId: TEST_CATEGORY,
      roundCount: 5,
      customWords: [
        custom("mine", "neige", "Alice", HOST_UID),
        custom("theirs", SECRET_GUEST, "Bob", GUEST_UID),
      ],
    });
    assert.equal(asHost.customWords.find((item) => item.id === "mine").text, "neige");
    assert.equal(asHost.customWords.find((item) => item.id === "theirs").text, undefined);

    resetViewer({ name: "Bob", uid: GUEST_UID });
    const asGuest = drawItFromRemote({
      lobbyStarted: false,
      selectedCategoryId: TEST_CATEGORY,
      roundCount: 5,
      customWords: [
        custom("mine", "neige", "Alice", HOST_UID),
        custom("theirs", SECRET_GUEST, "Bob", GUEST_UID),
      ],
    });
    assert.equal(asGuest.customWords.find((item) => item.id === "mine").text, undefined);
    assert.equal(asGuest.customWords.find((item) => item.id === "theirs").text, SECRET_GUEST);
    assert.deepEqual(
      summarizeOthersDrawItCustomAdds(asGuest.customWords, "Bob", GUEST_UID),
      [{ author: "Alice", count: 1 }]
    );
  });

  it("M. Deux ajouts rapprochés → snapshot durable, pas de +1 perdu", () => {
    resetViewer({ name: "Alice", uid: HOST_UID });
    applyRemoteSession(
      sessionRow({
        lobbyStarted: false,
        selectedCategoryId: TEST_CATEGORY,
        roundCount: 5,
        customWords: [custom("c-g-1", "maison", "Bob", GUEST_UID)],
      })
    );
    applyRemoteSession(
      sessionRow({
        lobbyStarted: false,
        selectedCategoryId: TEST_CATEGORY,
        roundCount: 5,
        customWords: [
          custom("c-g-1", "maison", "Bob", GUEST_UID),
          custom("c-g-2", "voiture", "Bob", GUEST_UID),
        ],
      })
    );
    assert.deepEqual(othersHint(), [hintLine("Bob", 2)]);
    assert.equal(notifies.length >= 2, true);
  });

  it("N. Le rendu prep est déclenché sans clic secondaire", () => {
    const src = read("js/screens/drawItPrep.js");
    assert.match(src, /function refreshFromSync\(\)/);
    assert.match(
      src,
      /function refreshFromSync\(\) \{[\s\S]*renderCustomWordsList\(\);[\s\S]*restoreDraft\(draft\);/
    );
    assert.doesNotMatch(
      src,
      /activeElement\?\.id !== "new-drawit-word"/
    );
    assert.match(src, /onGameSessionChange\(\(\) => \{[\s\S]*refreshFromSync\(\);/);
    assert.match(src, /syncPrepOnMount\(refreshFromSync\)/);
    applyRemoteSession(
      sessionRow({
        lobbyStarted: false,
        selectedCategoryId: TEST_CATEGORY,
        roundCount: 5,
        customWords: [custom("c-g-1", SECRET_GUEST, "Bob", GUEST_UID)],
      })
    );
    assert.equal(notifies.length >= 1, true);
  });

  it("O. Aucun lobby_messages", () => {
    const prep = read("js/screens/drawItPrep.js");
    const words = read("js/core/drawItCustomWords.js");
    assert.doesNotMatch(prep, /lobby_messages/);
    assert.doesNotMatch(words, /lobby_messages/);
  });

  it("P. Aucun texte d'autrui dans toRemote / payload public", async () => {
    await addDrawItCustomWord(SECRET_HOST);
    const remote = drawItToRemote(getDrawItSession());
    assert.equal("customWords" in remote, false);
    assert.equal(JSON.stringify(remote).includes(SECRET_HOST), false);
  });

  it("Q. Aucun impact sur launch", async () => {
    await addDrawItCustomWord("ski");
    const launched = await markDrawItLobbyStarted({ rosterNames: ["Alice", "Bob"] });
    assert.ok(launched);
    assert.equal(getDrawItSession().lobbyStarted, true);
    assert.deepEqual(getDrawItSession().customWords || [], []);
  });

  it("R. Après launch, aucun custom prep ne réapparaît", async () => {
    await addDrawItCustomWord("ski");
    await markDrawItLobbyStarted({ rosterNames: ["Alice", "Bob"] });
    applyRemoteSession(
      sessionRow(
        {
          lobbyStarted: true,
          selectedCategoryId: TEST_CATEGORY,
          roundCount: 5,
          runId: getDrawItSession().runId,
          customWords: [custom("stale", SECRET_GUEST, "Bob", GUEST_UID)],
        },
        { screen: "drawit" }
      )
    );
    assert.deepEqual(getDrawItSession().customWords || [], []);
    assert.equal(JSON.stringify(getDrawItSession().customWords || []).includes(SECRET_GUEST), false);
  });

  it("applyRemoteSession notifie même si seul customWords change", () => {
    applyRemoteSession(
      sessionRow({
        lobbyStarted: false,
        selectedCategoryId: TEST_CATEGORY,
        roundCount: 5,
        customWords: [],
      })
    );
    const before = notifies.length;
    applyRemoteSession(
      sessionRow({
        lobbyStarted: false,
        selectedCategoryId: TEST_CATEGORY,
        roundCount: 5,
        customWords: [custom("c-g-1", SECRET_GUEST, "Bob", GUEST_UID)],
      })
    );
    assert.equal(notifies.length > before, true);
    assert.deepEqual(othersHint(), [hintLine("Bob", 1)]);
  });
});
