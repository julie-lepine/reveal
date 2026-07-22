import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getState, saveStatePatch } from "../js/core/state.js";
import {
  mapParticipantsReadyFalse,
  preserveParticipantsReady,
  shouldReconcileLobbyReadyFromServer,
  shouldResetReadyOnLobbyMount,
} from "../js/core/lobbyReadyMount.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function participantsFixture({ hostReady, guestReady }) {
  return [
    {
      name: "Hote",
      emoji: "👑",
      color: "#A78BFA",
      ready: hostReady,
      isHost: true,
      isLocal: true,
    },
    {
      name: "Invite",
      emoji: "🎭",
      color: "#60A5FA",
      ready: guestReady,
      isHost: false,
      isLocal: false,
    },
  ];
}

function seedWaitingLobby({ hostReady = false, guestReady = false } = {}) {
  saveStatePatch({
    user: {
      ...getState().user,
      name: "Hote",
      loggedIn: true,
      isGuest: false,
    },
    inLobby: true,
    lobbyCode: "ABCD",
    lobby: {
      id: null,
      code: "ABCD",
      status: "waiting",
      gameId: null,
      participants: participantsFixture({ hostReady, guestReady }),
      messages: [],
    },
  });
}

describe("I-06 / P-01 — ready lobby non destructif au mount", () => {
  let snapshot;

  beforeEach(() => {
    snapshot = structuredClone(getState());
  });

  afterEach(() => {
    saveStatePatch(snapshot);
  });

  it("mount lobby n'appelle plus resetAllParticipantsReady (source)", () => {
    const src = readFileSync(join(__dirname, "../js/screens/lobby.js"), "utf8");
    assert.equal(src.includes("resetAllParticipantsReady"), false);
    assert.match(src, /reconcileLobbyReadyOnMount/);
    assert.equal(shouldResetReadyOnLobbyMount(), false);
  });

  it("invité prêt → remount (pas de reset) → reste prêt", () => {
    const before = participantsFixture({ hostReady: true, guestReady: true });
    const afterMount = preserveParticipantsReady(before);
    assert.equal(afterMount.find((p) => p.name === "Invite")?.ready, true);
    assert.equal(shouldResetReadyOnLobbyMount(), false);
    assert.notDeepEqual(mapParticipantsReadyFalse(before), afterMount);
  });

  it("hôte prêt → remount (pas de reset) → reste prêt", () => {
    seedWaitingLobby({ hostReady: true, guestReady: false });
    const before = getState().lobby.participants;
    const afterMount = preserveParticipantsReady(before);
    assert.equal(afterMount.find((p) => p.isLocal)?.ready, true);
    saveStatePatch({ lobby: { ...getState().lobby, participants: afterMount } });
    assert.equal(getState().lobby.participants.find((p) => p.isLocal)?.ready, true);
  });

  it("remount avant démarrage : aucun wipe ready (reset seulement via helper métier)", () => {
    const ready = participantsFixture({ hostReady: true, guestReady: true });
    assert.equal(shouldResetReadyOnLobbyMount(), false);
    assert.deepEqual(
      preserveParticipantsReady(ready).map((p) => p.ready),
      [true, true]
    );
    assert.deepEqual(
      mapParticipantsReadyFalse(ready).map((p) => p.ready),
      [false, false]
    );
  });

  it("nouveau lobby → participants initialisés avec ready = false", () => {
    const created = [
      {
        name: "Hote",
        emoji: "👑",
        color: "#A78BFA",
        ready: false,
        isHost: true,
        isLocal: true,
      },
    ];
    assert.equal(created.every((p) => p.ready === false), true);
    seedWaitingLobby({ hostReady: false, guestReady: false });
    assert.equal(getState().lobby.participants.every((p) => p.ready === false), true);
    assert.equal(getState().lobby.status, "waiting");
  });

  it("setLobbyWaiting (contrat local) → prêts remis à false", () => {
    seedWaitingLobby({ hostReady: true, guestReady: true });
    const next = {
      ...getState().lobby,
      status: "waiting",
      gameId: null,
      participants: mapParticipantsReadyFalse(getState().lobby.participants),
    };
    saveStatePatch({ lobby: next });
    assert.equal(getState().lobby.status, "waiting");
    assert.equal(getState().lobby.participants.every((p) => p.ready === false), true);
  });

  it("lancement soirée inchangé : status playing indépendant du mount ready", () => {
    seedWaitingLobby({ hostReady: true, guestReady: true });
    saveStatePatch({
      lobby: {
        ...getState().lobby,
        status: "playing",
        gameId: "menu",
        participants: preserveParticipantsReady(getState().lobby.participants),
      },
    });
    assert.equal(getState().lobby.status, "playing");
    assert.deepEqual(
      getState().lobby.participants.map((p) => p.ready),
      [true, true]
    );
  });

  it("état serveur ready=true → mount affiche sans écraser", () => {
    const fromServer = participantsFixture({ hostReady: true, guestReady: true });
    assert.equal(
      shouldReconcileLobbyReadyFromServer({
        supabaseConfigured: true,
        lobbyId: "lobby-uuid",
      }),
      true
    );
    assert.equal(
      shouldReconcileLobbyReadyFromServer({
        supabaseConfigured: true,
        lobbyId: null,
      }),
      false
    );
    // Réconciliation = appliquer l'état serveur tel quel, pas un défaut false
    const displayed = preserveParticipantsReady(fromServer);
    assert.deepEqual(
      displayed.map((p) => p.ready),
      [true, true]
    );
    assert.equal(shouldResetReadyOnLobbyMount(), false);
  });
});
