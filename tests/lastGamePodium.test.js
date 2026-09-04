import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  lastGamePodiumHtml,
  serializeLastGameStandings,
} from "../js/core/lastGamePodium.js";

describe("lastGamePodium", () => {
  it("serializeLastGameStandings ne garde que les champs UI", () => {
    const out = serializeLastGameStandings([
      { name: "Ada", score: 30, rank: 1, emoji: "🦊", color: "#f00", id: "x" },
      { name: "Bob", score: 10, rank: 2, emoji: "🐱", color: "#0f0" },
    ]);
    assert.deepEqual(out, [
      { name: "Ada", score: 30, rank: 1, emoji: "🦊", color: "#f00", nameColor: null, signature: false },
      { name: "Bob", score: 10, rank: 2, emoji: "🐱", color: "#0f0", nameColor: null, signature: false },
    ]);
  });

  it("lastGamePodiumHtml affiche top 3 seulement", () => {
    const html = lastGamePodiumHtml({
      standings: [
        { name: "Ada", score: 30, rank: 1, emoji: "🦊", color: "#f00" },
        { name: "Bob", score: 20, rank: 2, emoji: "🐱", color: "#0f0" },
        { name: "Cara", score: 10, rank: 3, emoji: "🐻", color: "#00f" },
        { name: "Dan", score: 5, rank: 4, emoji: "🐼", color: "#000" },
      ],
    });
    assert.match(html, /Ada/);
    assert.match(html, /Bob/);
    assert.match(html, /Cara/);
    assert.doesNotMatch(html, /Dan/);
    assert.match(html, /Podium/);
  });

  it("sans standings : chaîne vide", () => {
    assert.equal(lastGamePodiumHtml({ summary: "ok" }), "");
    assert.equal(lastGamePodiumHtml(null), "");
  });
});
