/**
 * Lancement Spot the Fake : pas de publication en deal si la distribution
 * privée n'est pas confirmée pour next.alive.
 */
import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SYNC_PATCH_TIMEOUT_MS } from "../js/config/syncConfig.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const store = new Map();
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
};

let supabaseConfigured = true;
const distributeCalls = [];
let distributeImpl = async () => ({ ok: true, written: 0, skippedNames: [] });
const launchCalls = [];
const alerts = [];

mock.module("../js/core/supabaseClient.js", {
  namedExports: {
    isSupabaseConfigured: () => supabaseConfigured,
    supabase: {
      from() {
        return {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          maybeSingle() {
            return Promise.resolve({ data: null, error: null });
          },
          upsert() {
            return Promise.resolve({ error: null });
          },
          delete() {
            return { eq: () => Promise.resolve({ error: null }) };
          },
        };
      },
    },
  },
});

async function asyncNoop() {
  return { ok: true };
}

mock.module("../js/core/traitrePrivate.js", {
  namedExports: {
    hostDistributeTraitreRoles: async (matchId, pairId, impostorName, playerNames) => {
      const names = [...(playerNames || [])];
      distributeCalls.push({ matchId, pairId, impostorName, playerNames: names });
      return distributeImpl(matchId, pairId, impostorName, names);
    },
    fetchMyTraitrePrivate: async () => null,
    clearTraitrePrivateForLobby: async () => {},
    clearTraitrePrivateLocalForLobby: () => {},
    syncTraitrePrivateRole: async () => false,
  },
});

mock.module("../js/core/mpLaunch.js", {
  namedExports: {
    launchGameWithSync: async (opts) => {
      launchCalls.push(opts);
      return { ok: true };
    },
    commitHostGamePlay: asyncNoop,
    commitPrepReadyToggle: asyncNoop,
    commitMultiplayerLaunch: asyncNoop,
    runLaunchButton: async (_btn, fn) => fn(),
    runPrepGameLaunch: asyncNoop,
    navigateAfterGameLaunch: () => {},
    prepGuestFollowOnSession: () => () => false,
    gamePatchOpts: () => ({}),
    computePrepReadyToggle: () => ({ nextReady: {}, changed: false }),
    SYNC_PATCH_TIMEOUT_MS: 20000,
    SYNC_SLOW_LAUNCH_MESSAGE: "sync lente",
  },
});

mock.module("../js/core/dialog.js", {
  namedExports: {
    isAppDialogOpen: () => false,
    showAppAlert: async (message) => {
      alerts.push(message);
    },
    showAppConfirm: async () => false,
    showAppRichDialog: async () => {},
    showClaimHostDialog: async () => false,
    showAppEmailPrompt: async () => null,
    showTransferHostDialog: async () => null,
    showLobbyPlayersManageDialog: async () => {},
    showEmojiPickerDialog: async () => null,
  },
});

const { markTraitreLobbyStarted, getTraitreSession, getMyTraitreWord } = await import(
  "../js/core/traitreSession.js"
);
const { saveStatePatch } = await import("../js/core/state.js");
const { isTraitrePrivateRoleCurrent, traitreKnownImpostorFlag } = await import(
  "../js/core/sessionMerge.js"
);

const ROSTER = ["Alice", "Bob", "Chloé"];

function read(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

function participant(name, userId, extra = {}) {
  return {
    name,
    userId,
    isLocal: name === "Alice",
    isHost: name === "Alice",
    ...extra,
  };
}

function seatLobby(participants) {
  saveStatePatch({
    supabaseUserId: "ua",
    user: { name: "Alice" },
    lobby: {
      id: "lobby-role-gate",
      hostId: "ua",
      participants,
    },
    traitreGame: {
      lobbyStarted: false,
      phase: null,
      alive: [],
      privateRoleSynced: false,
      privateRolePairId: null,
      privateRoleMatchId: null,
      isLocalImpostor: null,
      privateRoleNonce: 0,
    },
  });
}

function fullRoster() {
  return [
    participant("Alice", "ua"),
    participant("Bob", "ub"),
    participant("Chloé", "uc"),
  ];
}

function assertNotPublished(result) {
  assert.equal(result.ok, false);
  assert.equal(Object.prototype.hasOwnProperty.call(result, "usedFallback"), false);
  assert.equal(launchCalls.length, 0);
  const session = getTraitreSession();
  assert.equal(session.lobbyStarted, false);
  assert.equal(session.phase, null);
}

describe("Spot the Fake — distribution privée avant publication", () => {
  beforeEach(() => {
    supabaseConfigured = true;
    distributeCalls.length = 0;
    launchCalls.length = 0;
    alerts.length = 0;
    distributeImpl = async (_matchId, _pairId, _impostorName, names) => ({
      ok: true,
      written: names.length,
      skippedNames: [],
    });
    seatLobby(fullRoster());
  });

  it("distribution complète : un seul lancement, localFirst", async () => {
    const result = await markTraitreLobbyStarted({ rosterNames: ROSTER });
    assert.equal(result.ok, true);
    assert.equal(launchCalls.length, 1);
    assert.equal(distributeCalls.length, 1);
    assert.equal(launchCalls[0].localFirst, true);
    assert.equal(launchCalls[0].mode, "push");
    const remote = launchCalls[0].getRemoteState().traitre;
    assert.equal(remote.phase, "deal");
    assert.equal(remote.matchId, distributeCalls[0].matchId);
    assert.deepEqual(distributeCalls[0].playerNames, ROSTER);
  });

  it("zéro rôle écrit : aucun lancement, préparation conservée", async () => {
    distributeImpl = async () => ({
      ok: false,
      written: 0,
      skippedNames: [],
      error: "Aucun rôle enregistré",
    });
    const result = await markTraitreLobbyStarted({ rosterNames: ROSTER });
    assertNotPublished(result);
    assert.equal(result.reason, "distribution_incomplete");
    assert.match(alerts[0], /n'a pas abouti/);
    assert.equal(distributeCalls.length, 1);
  });

  it("écriture partielle puis exception : aucun lancement", async () => {
    let writes = 0;
    distributeImpl = async () => {
      writes += 1;
      throw new Error("upsert RLS");
    };
    const result = await markTraitreLobbyStarted({ rosterNames: ROSTER });
    assert.equal(writes, 1);
    assertNotPublished(result);
    assert.equal(result.reason, "distribution_failed");
    assert.match(alerts[0], /n'a pas abouti/);
  });

  it("UID manquant : refus avant le premier upsert", async () => {
    seatLobby([
      participant("Alice", "ua"),
      participant("Bob", "ub"),
      participant("Chloé", null),
    ]);
    const result = await markTraitreLobbyStarted({ rosterNames: ROSTER });
    assert.equal(distributeCalls.length, 0);
    assertNotPublished(result);
    assert.equal(result.reason, "missing_uid");
    assert.match(alerts[0], /Chloé/);
    assert.match(alerts[0], /identité synchronisée/);
  });

  it("noms dupliqués : refus avant écriture", async () => {
    const result = await markTraitreLobbyStarted({
      rosterNames: ["Alice", "Bob", "Bob"],
    });
    assert.equal(distributeCalls.length, 0);
    assertNotPublished(result);
    assert.equal(result.reason, "duplicate_names");
    assert.match(alerts[0], /Bob/);
    assert.match(alerts[0], /Identité ambiguë/);
  });

  it("UID dupliqué : refus avant écriture", async () => {
    seatLobby([
      participant("Alice", "ua"),
      participant("Bob", "ub"),
      participant("Chloé", "ub"),
    ]);
    const result = await markTraitreLobbyStarted({ rosterNames: ROSTER });
    assert.equal(distributeCalls.length, 0);
    assertNotPublished(result);
    assert.equal(result.reason, "duplicate_uid");
    assert.match(alerts[0], /Bob/);
    assert.match(alerts[0], /Chloé/);
    assert.match(alerts[0], /Identité ambiguë/);
  });

  it("skippedNames non vide : aucun lancement", async () => {
    distributeImpl = async () => ({
      ok: true,
      written: 2,
      skippedNames: ["Chloé"],
      error: "Rôles partiels : joueurs sans compte (Chloé).",
    });
    const result = await markTraitreLobbyStarted({ rosterNames: ROSTER });
    assertNotPublished(result);
    assert.equal(result.reason, "missing_uid");
    assert.match(alerts[0], /Chloé/);
    assert.equal(distributeCalls.length, 1);
  });

  it("timeout : aucun lancement, même si la promesse se résout ensuite", async () => {
    mock.timers.enable({ apis: ["setTimeout"], now: 0 });
    try {
      let resolveDist;
      distributeImpl = () =>
        new Promise((resolve) => {
          resolveDist = resolve;
        });
      const pending = markTraitreLobbyStarted({ rosterNames: ROSTER });
      mock.timers.tick(SYNC_PATCH_TIMEOUT_MS);
      const result = await pending;
      assertNotPublished(result);
      assert.equal(result.reason, "timeout");
      assert.match(alerts[0], /pas été confirmée à temps/);
      resolveDist({ ok: true, written: ROSTER.length, skippedNames: [] });
      await Promise.resolve();
      await Promise.resolve();
      assert.equal(launchCalls.length, 0);
    } finally {
      mock.timers.reset();
    }
  });

  it("résultat nul ou illisible : aucun lancement", async () => {
    distributeImpl = async () => null;
    const missing = await markTraitreLobbyStarted({ rosterNames: ROSTER });
    assertNotPublished(missing);
    assert.equal(missing.reason, "unreadable_result");

    distributeCalls.length = 0;
    alerts.length = 0;
    distributeImpl = async () => ({ ok: true });
    const partialShape = await markTraitreLobbyStarted({ rosterNames: ROSTER });
    assertNotPublished(partialShape);
    assert.equal(partialShape.reason, "distribution_incomplete");
  });

  it("lancement forcé : l'attente est next.alive, pas le lobby entier", async () => {
    seatLobby([
      ...fullRoster(),
      participant("Dan", null, { isLocal: false, isHost: false }),
    ]);
    const result = await markTraitreLobbyStarted({ rosterNames: ROSTER });
    assert.equal(result.ok, true);
    assert.equal(launchCalls.length, 1);
    assert.deepEqual(distributeCalls[0].playerNames, ROSTER);
    assert.equal(distributeCalls[0].playerNames.includes("Dan"), false);
    assert.deepEqual(launchCalls[0].getRemoteState().traitre.alive, ROSTER);
  });

  it("deux refus puis un succès : matchId distincts, seul le succès est publié", async () => {
    let attempt = 0;
    distributeImpl = async (_matchId, _pairId, _impostorName, names) => {
      attempt += 1;
      if (attempt < 3) {
        return { ok: false, written: 0, skippedNames: [] };
      }
      return { ok: true, written: names.length, skippedNames: [] };
    };
    const first = await markTraitreLobbyStarted({ rosterNames: ROSTER });
    const second = await markTraitreLobbyStarted({ rosterNames: ROSTER });
    const third = await markTraitreLobbyStarted({ rosterNames: ROSTER });
    assert.equal(first.ok, false);
    assert.equal(second.ok, false);
    assert.equal(third.ok, true);
    assert.equal(launchCalls.length, 1);
    assert.equal(distributeCalls.length, 3);
    const ids = distributeCalls.map((call) => call.matchId);
    assert.equal(new Set(ids).size, 3);
    assert.equal(launchCalls[0].getRemoteState().traitre.matchId, ids[2]);
    assert.notEqual(ids[0], ids[2]);
    assert.notEqual(ids[1], ids[2]);
  });

  it("hors synchronisation : distribution distante ignorée, lancement local conservé", async () => {
    supabaseConfigured = false;
    const result = await markTraitreLobbyStarted({ rosterNames: ROSTER });
    assert.equal(result.ok, true);
    assert.equal(distributeCalls.length, 0);
    assert.equal(launchCalls.length, 1);
    assert.equal(launchCalls[0].localFirst, true);
    assert.equal(alerts.length, 0);
    assert.equal(launchCalls[0].getRemoteState().traitre.phase, "deal");
  });

  it("le garde de confidentialité du 4 octobre reste en place", () => {
    const unknown = {
      pairId: "social_1",
      matchId: "match-privacy",
      isLocalImpostor: false,
      privateRoleSynced: false,
      privateRolePairId: null,
      privateRoleMatchId: null,
    };
    assert.equal(isTraitrePrivateRoleCurrent(unknown), false);
    assert.equal(traitreKnownImpostorFlag(unknown, { offline: false }), null);
    assert.equal(getMyTraitreWord(unknown), null);

    const ui = read("js/games/traitre.js");
    const readyAt = ui.indexOf("isTraitreWordDealReady");
    const buttonAt = ui.indexOf('id="btn-deal-ack"');
    const loadingAt = ui.indexOf("Chargement de ton mot…");
    assert.ok(readyAt !== -1 && readyAt < buttonAt && buttonAt < loadingAt);
    assert.match(read("js/core/sessionMerge.js"), /privateRoleSynced !== true/);
  });

  it("échec de distribution : aucun repli local ne publie le deal", async () => {
    distributeImpl = async () => {
      throw new Error("réseau");
    };
    const result = await markTraitreLobbyStarted({ rosterNames: ROSTER });
    assertNotPublished(result);
    assert.equal(result.reason, "distribution_failed");
    const launchSrc = read("js/core/mpLaunch.js");
    assert.match(launchSrc, /result\?\.ok === false && !result\?\.usedFallback/);
  });
});
