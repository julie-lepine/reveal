import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  CHAT_FAB_ALLOWED_SCREENS,
  isChatFabAllowedScreen,
} from "../js/core/chatFabScreens.js";
import {
  compareChatCursors,
  countUnreadMessages,
  formatUnreadBadge,
  getChatLobbyKey,
  getReadCursor,
  isLocalChatMessage,
  isMessageAfterCursor,
  markMessagesRead,
  messageCursorOf,
  resetChatUnreadStoreForTests,
  setReadCursor,
} from "../js/core/chatUnread.js";
import { validateChatText, CHAT_MAX_LENGTH } from "../js/core/chatPanel.js";

const GAME_ROUTES = [
  "traitre",
  "hottake",
  "speedvote",
  "clutch",
  "wronganswer",
  "truthmeter",
  "dilemma",
  "trivia",
  "consensus",
  "guesslie",
  "tiernight",
  "tiernight-live",
];

describe("chat FAB whitelist Vague A", () => {
  it("autorise game-select, results, leaderboard", () => {
    assert.equal(isChatFabAllowedScreen("game-select"), true);
    assert.equal(isChatFabAllowedScreen("results"), true);
    assert.equal(isChatFabAllowedScreen("leaderboard"), true);
  });

  it("autorise les prépas et setups listés", () => {
    for (const id of [
      "traitre-prep",
      "hottake-prep",
      "speedvote-prep",
      "clutch-prep",
      "wronganswer-prep",
      "truthmeter-prep",
      "dilemma-prep",
      "trivia-prep",
      "consensus-prep",
      "guesslie-setup",
      "guesslie-menu",
      "guesslie-wait",
      "tiernight-select",
      "tiernight-create",
      "tiernight-end",
    ]) {
      assert.equal(isChatFabAllowedScreen(id), true, id);
      assert.ok(CHAT_FAB_ALLOWED_SCREENS.has(id), id);
    }
  });

  it("refuse lobby", () => {
    assert.equal(isChatFabAllowedScreen("lobby"), false);
  });

  it("refuse home / welcome / settings", () => {
    assert.equal(isChatFabAllowedScreen("home"), false);
    assert.equal(isChatFabAllowedScreen("welcome"), false);
    assert.equal(isChatFabAllowedScreen("settings"), false);
  });

  it("refuse toutes les routes jeu quelle que soit la phase", () => {
    for (const id of GAME_ROUTES) {
      assert.equal(isChatFabAllowedScreen(id), false, id);
    }
  });
});

describe("formatUnreadBadge", () => {
  it("cache à zéro", () => {
    assert.equal(formatUnreadBadge(0), "");
    assert.equal(formatUnreadBadge(-1), "");
  });

  it("affiche 1–9", () => {
    for (let i = 1; i <= 9; i++) {
      assert.equal(formatUnreadBadge(i), String(i));
    }
  });

  it("affiche 9+ au-delà", () => {
    assert.equal(formatUnreadBadge(10), "9+");
    assert.equal(formatUnreadBadge(99), "9+");
  });
});

describe("chat unread cursor", () => {
  beforeEach(() => {
    resetChatUnreadStoreForTests();
  });

  it("différencie deux messages même timestamp via id", () => {
    const a = { at: 1000, id: "a" };
    const b = { at: 1000, id: "b" };
    assert.ok(compareChatCursors(a, b) < 0);
    assert.equal(isMessageAfterCursor({ at: 1000, id: "b" }, a), true);
    assert.equal(isMessageAfterCursor({ at: 1000, id: "a" }, b), false);
  });

  it("curseur de lecture idempotent", () => {
    const key = "id:lobby-1";
    const messages = [
      { id: "1", from: "A", text: "x", at: 10, userId: "u1" },
      { id: "2", from: "B", text: "y", at: 20, userId: "u2" },
    ];
    const c1 = markMessagesRead(messages, key);
    const c2 = markMessagesRead(messages, key);
    assert.deepEqual(c1, messageCursorOf(messages[1]));
    assert.deepEqual(c2, c1);
    assert.deepEqual(getReadCursor(key), c1);
  });

  it("sépare les curseurs par lobby", () => {
    setReadCursor("id:L1", { at: 50, id: "m1" });
    setReadCursor("id:L2", { at: 10, id: "m0" });
    assert.deepEqual(getReadCursor("id:L1"), { at: 50, id: "m1" });
    assert.deepEqual(getReadCursor("id:L2"), { at: 10, id: "m0" });
  });

  it("getChatLobbyKey préfère id puis code", () => {
    assert.equal(getChatLobbyKey({ id: "abc", code: "ZZ" }), "id:abc");
    assert.equal(getChatLobbyKey({ id: null, code: "ab" }), "code:AB");
    assert.equal(getChatLobbyKey(null), null);
  });
});

describe("countUnreadMessages", () => {
  const local = { localUserId: "me", localName: "Alice" };

  it("n'incrémente pas un message local (userId)", () => {
    const messages = [{ id: "1", from: "Alice", text: "hi", at: 1, userId: "me" }];
    assert.equal(countUnreadMessages(messages, null, local), 0);
  });

  it("n'incrémente pas un message local (from) sans userId", () => {
    const messages = [{ id: "1", from: "Alice", text: "hi", at: 1 }];
    assert.equal(countUnreadMessages(messages, null, { localName: "Alice" }), 0);
  });

  it("incrémente un message d'un autre joueur", () => {
    const messages = [{ id: "1", from: "Bob", text: "yo", at: 1, userId: "bob" }];
    assert.equal(countUnreadMessages(messages, null, local), 1);
  });

  it("ignore les messages déjà lus via curseur", () => {
    const messages = [
      { id: "1", from: "Bob", text: "a", at: 10, userId: "bob" },
      { id: "2", from: "Bob", text: "b", at: 20, userId: "bob" },
    ];
    const cursor = { at: 10, id: "1" };
    assert.equal(countUnreadMessages(messages, cursor, local), 1);
  });

  it("conserve les non-lus après curseur figé (FAB masqué simulé)", () => {
    const messages = [
      { id: "1", from: "Bob", text: "a", at: 10, userId: "bob" },
      { id: "2", from: "Bob", text: "b", at: 20, userId: "bob" },
      { id: "3", from: "Bob", text: "c", at: 30, userId: "bob" },
    ];
    setReadCursor("id:game", { at: 10, id: "1" });
    const unread = countUnreadMessages(messages, getReadCursor("id:game"), local);
    assert.equal(unread, 2);
    assert.equal(formatUnreadBadge(unread), "2");
  });

  it("ouverture/rendu sheet → marque lu → compteur 0", () => {
    const key = "id:sheet";
    const messages = [
      { id: "1", from: "Bob", text: "a", at: 10, userId: "bob" },
      { id: "2", from: "Bob", text: "b", at: 20, userId: "bob" },
    ];
    assert.equal(countUnreadMessages(messages, null, local), 2);
    markMessagesRead(messages, key);
    assert.equal(countUnreadMessages(messages, getReadCursor(key), local), 0);
  });

  it("message système (texte hôte) suit la règle auteur local", () => {
    const sys = {
      id: "s1",
      from: "Alice",
      text: "👑 Bob est maintenant l'hôte de la soirée.",
      at: 5,
      userId: "me",
    };
    assert.equal(isLocalChatMessage(sys, local), true);
    assert.equal(countUnreadMessages([sys], null, local), 0);
    assert.equal(
      countUnreadMessages([sys], null, { localUserId: "other", localName: "Bob" }),
      1
    );
  });
});

describe("validateChatText", () => {
  it("rejette vide", () => {
    assert.equal(validateChatText("   ").ok, false);
  });

  it("accepte jusqu'à la limite", () => {
    const ok = validateChatText("x".repeat(CHAT_MAX_LENGTH));
    assert.equal(ok.ok, true);
    assert.equal(ok.text.length, CHAT_MAX_LENGTH);
  });

  it("rejette au-delà de 200", () => {
    assert.equal(validateChatText("x".repeat(CHAT_MAX_LENGTH + 1)).ok, false);
  });
});
