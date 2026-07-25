/**
 * Vague 2 — sondages : logique store (votes actifs, droits, égalité).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { GAMES_AVAILABLE } from "../data/games.js";
import { CHAT_FAB_ALLOWED_SCREENS } from "../js/core/chatFabScreens.js";
import {
  normalizeLobbyPollRow,
  normalizeVotesAllByUserId,
  applyVoteUpsert,
  filterActiveVotes,
  tallyActiveResults,
  resolvePollLeader,
  canOfferPollCreate,
  localScreenAllowsPollCreate,
  remotePhaseAllowsPollCreate,
  buildPollOptionsSnapshot,
  validatePollOptionsClient,
} from "../js/core/lobbyPollLogic.js";
import { extractLobbyPollErrorCode, lobbyPollErrorMessage } from "../js/core/lobbyPollErrors.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("lobbyPoll normalize + votes", () => {
  it("normalise poll snake_case", () => {
    const p = normalizeLobbyPollRow({
      id: "p1",
      lobby_id: "L",
      created_by: "u1",
      status: "open",
      options: [{ gameId: "hottake-prep", title: "HotTake", emoji: "🔥" }],
      closed_reason: null,
    });
    assert.equal(p.id, "p1");
    assert.equal(p.lobbyId, "L");
    assert.equal(p.options[0].gameId, "hottake-prep");
  });

  it("changement de vote remplace sans doublon", () => {
    let map = normalizeVotesAllByUserId([
      { user_id: "a", game_id: "hottake-prep" },
      { user_id: "b", game_id: "trivia-prep" },
    ]);
    map = applyVoteUpsert(map, "a", "trivia-prep");
    assert.equal(map.a, "trivia-prep");
    assert.equal(Object.keys(map).length, 2);
  });

  it("joueur sorti non comptabilisé dans votes actifs", () => {
    const all = { a: "hottake-prep", b: "trivia-prep", gone: "clutch-prep" };
    const active = filterActiveVotes(all, ["a", "b"]);
    assert.deepEqual(active, { a: "hottake-prep", b: "trivia-prep" });
    const counts = tallyActiveResults(
      [
        { gameId: "hottake-prep" },
        { gameId: "trivia-prep" },
        { gameId: "clutch-prep" },
      ],
      active
    );
    assert.equal(counts["hottake-prep"], 1);
    assert.equal(counts["trivia-prep"], 1);
    assert.equal(counts["clutch-prep"], 0);
  });

  it("égalité et majorité", () => {
    const tie = resolvePollLeader({ x: 2, y: 2, z: 1 });
    assert.equal(tie.kind, "tie");
    assert.deepEqual(tie.gameIds.sort(), ["x", "y"]);
    const maj = resolvePollLeader({ x: 3, y: 1 });
    assert.equal(maj.kind, "majority");
    assert.deepEqual(maj.gameIds, ["x"]);
  });
});

describe("lobbyPoll création local × distant", () => {
  it("autorise results + session menu/results", () => {
    assert.equal(
      canOfferPollCreate({
        localScreen: "results",
        sessionRow: { game_id: "menu", screen: "results" },
        lobbyGameId: "menu",
        activePoll: null,
      }),
      true
    );
  });

  it("refuse prep même si distant hub", () => {
    assert.equal(localScreenAllowsPollCreate("hottake-prep"), false);
    assert.equal(
      canOfferPollCreate({
        localScreen: "hottake-prep",
        sessionRow: { game_id: "menu", screen: "game-select" },
        lobbyGameId: "menu",
        activePoll: null,
      }),
      false
    );
  });

  it("CTA absent en prep sans poll (pas de create)", () => {
    assert.ok(CHAT_FAB_ALLOWED_SCREENS.has("hottake-prep"));
    assert.equal(localScreenAllowsPollCreate("hottake-prep"), false);
  });

  it("poll votable en prep : create false mais poll open possible", () => {
    const offer = canOfferPollCreate({
      localScreen: "hottake-prep",
      sessionRow: { game_id: "hottake", screen: "hottake-prep" },
      lobbyGameId: "hottake",
      activePoll: { id: "p" },
    });
    assert.equal(offer, false);
    assert.ok(CHAT_FAB_ALLOWED_SCREENS.has("hottake-prep"));
  });

  it("CTA absent en play (FAB hors whitelist)", () => {
    assert.equal(CHAT_FAB_ALLOWED_SCREENS.has("hottake"), false);
    assert.equal(localScreenAllowsPollCreate("hottake"), false);
  });

  it("refuse distant play même local game-select (ARCH-04)", () => {
    assert.equal(
      remotePhaseAllowsPollCreate({ game_id: "hottake", screen: "hottake" }, "hottake"),
      false
    );
    assert.equal(
      canOfferPollCreate({
        localScreen: "game-select",
        sessionRow: { game_id: "hottake", screen: "hottake" },
        lobbyGameId: "hottake",
        activePoll: null,
      }),
      false
    );
  });

  it("session absente + lobby menu autorise", () => {
    assert.equal(remotePhaseAllowsPollCreate(null, "menu"), true);
    assert.equal(remotePhaseAllowsPollCreate(null, "hottake"), false);
  });
});

describe("lobbyPoll snapshot catalogue", () => {
  it("buildPollOptionsSnapshot utilise GAMES_AVAILABLE ids", () => {
    const ids = GAMES_AVAILABLE.slice(0, 3).map((g) => g.id);
    const opts = buildPollOptionsSnapshot(GAMES_AVAILABLE, ids);
    assert.equal(opts.length, 3);
    assert.equal(opts[0].gameId, ids[0]);
    assert.ok(opts[0].title);
    assert.ok(opts[0].emoji);
    const v = validatePollOptionsClient(opts);
    assert.equal(v.ok, true);
  });

  it("refuse moins de 2 options", () => {
    assert.equal(validatePollOptionsClient([{ gameId: "a", title: "A", emoji: "x" }]).ok, false);
  });
});

describe("lobbyPoll erreurs RPC", () => {
  it("mappe codes métier", () => {
    assert.equal(
      extractLobbyPollErrorCode({ message: "poll_creation_not_allowed_in_current_phase" }),
      "poll_creation_not_allowed_in_current_phase"
    );
    assert.match(
      lobbyPollErrorMessage({ message: "poll_already_open" }),
      /déjà en cours/i
    );
  });
});

describe("lobbyPoll close ciblé poll_id (contrat client)", () => {
  it("store appelle close avec reason explicit (source)", () => {
    const src = readFileSync(join(__dirname, "../js/core/lobbyPollStore.js"), "utf8");
    assert.match(src, /reason:\s*[\"']explicit[\"']/);
    assert.match(src, /rpcCloseLobbyPoll\(\{\s*pollId: poll\.id/);
    assert.doesNotMatch(src, /reason:\s*[\"']launch[\"']/);
  });

  it("initLobbyPollSync est idempotent (guard started)", () => {
    const src = readFileSync(join(__dirname, "../js/core/lobbyPollStore.js"), "utf8");
    assert.match(src, /if \(started\) return/);
    assert.match(src, /channelLobbyId === lobbyId/);
  });

  it("changement de lobby nettoie via syncToCurrentLobby", () => {
    const src = readFileSync(join(__dirname, "../js/core/lobbyPollStore.js"), "utf8");
    assert.match(src, /clearChannel/);
    assert.match(src, /nextId !== store\.lobbyId/);
  });

  it("fetch poll n'est pas dans le chemin critique chat (feedbackUi)", () => {
    const src = readFileSync(join(__dirname, "../js/core/feedbackUi.js"), "utf8");
    assert.match(src, /mountLobbyPollInChatSheet/);
    assert.match(src, /mountChatPanel/);
  });
});
