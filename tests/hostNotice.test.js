/**
 * Toast « Tu es maintenant l'hôte » : même lobby seulement, pas au switch d'invite.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { decideHostNotice } from "../js/core/hostNoticeLogic.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

describe("hostNotice — toast hôte", () => {
  it("même lobby : membre → hôte déclenche ; déjà hôte non", () => {
    const shown = decideHostNotice({
      inLobby: true,
      lobbyId: "A",
      lastLobbyId: "A",
      wasHost: false,
      isHost: true,
    });
    assert.equal(shown.show, true);
    assert.equal(shown.hide, false);
    const stay = decideHostNotice({
      inLobby: true,
      lobbyId: "A",
      lastLobbyId: "A",
      wasHost: true,
      isHost: true,
    });
    assert.equal(stay.show, false);
  });

  it("changer de salon : cacher, jamais re-déclencher même si hôte à l’arrivée", () => {
    const sw = decideHostNotice({
      inLobby: true,
      lobbyId: "B",
      lastLobbyId: "A",
      wasHost: true,
      isHost: true,
    });
    assert.equal(sw.show, false);
    assert.equal(sw.hide, true);
    assert.equal(sw.lastLobbyId, "B");
    const memberJoin = decideHostNotice({
      inLobby: true,
      lobbyId: "B",
      lastLobbyId: "A",
      wasHost: false,
      isHost: false,
    });
    assert.equal(memberJoin.show, false);
    assert.equal(memberJoin.hide, true);
  });

  it("hors lobby : reset + hide (création de salon ne toast pas via null)", () => {
    const left = decideHostNotice({
      inLobby: false,
      lobbyId: null,
      lastLobbyId: "A",
      wasHost: false,
      isHost: false,
    });
    assert.equal(left.wasHost, null);
    assert.equal(left.hide, true);
    assert.equal(left.show, false);
  });

  it("invite leave+join reset le toast ; hydrate ne recopie pas l’ancien roster", () => {
    const join = read("js/core/lobbyInviteJoin.js");
    assert.match(join, /resetHostNoticeOnLobbySwitch/);
    assert.match(join, /sameLobby/);
    assert.match(join, /participants: \[\]/);
    const notice = read("js/core/hostNotice.js");
    assert.match(notice, /decideHostNotice/);
    assert.match(read("js/core/hostNoticeLogic.js"), /lobbyId !== prevLobbyId/);
  });
});
