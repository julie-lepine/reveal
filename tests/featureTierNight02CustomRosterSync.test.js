/**
 * FEATURE-TIERNIGHT-02 — correction lost-update (RPC atomique + strip + préservation).
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  mergeCustomRosterTopics,
  isCustomRosterTopicOwnedBy,
} from "../js/core/sessionMerge.js";
import {
  stripCustomRosterTopicsFromGenericPatch,
  preserveCustomRosterTopicsInFullStateReplace,
  pickRichestCustomRosterTopics,
} from "../js/core/customRosterTopicsSyncGuard.js";
import {
  getState,
  saveStatePatch,
  addCustomRosterTopic,
  getCustomRosterTopics,
  resetEveningState,
  resetGameSessionsOnly,
} from "../js/core/state.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

function read(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

function topic(id, name, author, authorUid = null) {
  const t = { id: `custom-roster-${id}`, name, custom: true, author };
  if (authorUid) t.authorUid = authorUid;
  return t;
}

/** Miroir SQL : FOR UPDATE conserve topics existants puis applique incoming. */
function simulatePreservingReplace(existingTopics, incomingState, rpcAppendDuringLock) {
  let locked = [...(existingTopics || [])];
  if (rpcAppendDuringLock) locked = [...locked, rpcAppendDuringLock];
  return preserveCustomRosterTopicsInFullStateReplace(incomingState, {
    customRosterTopics: locked,
  }).customRosterTopics;
}

describe("FEATURE-TIERNIGHT-02 — A. même RPC hôte/invité", () => {
  it("création/suppression : RPC only, pas patchGameState collection", () => {
    const session = read("js/core/customRosterTopicSession.js");
    assert.match(session, /rpcUpsertPlayerCustomEntry/);
    assert.match(session, /rpcDeletePlayerCustomEntry/);
    assert.match(session, /game:\s*"tiernight"/);
    assert.doesNotMatch(session, /patchGameState\s*\(/);
    assert.doesNotMatch(session, /isLobbyHost\s*\(/);
    assert.match(session, /authorUid/);
  });

  it("UI création sans garde hôte ; lancement reste ensureHost", () => {
    const create = read("js/screens/tierNightCreateRoster.js");
    assert.doesNotMatch(create, /isLobbyHost/);
    const select = read("js/screens/tierNightSelect.js");
    assert.match(select, /ensureHost/);
    assert.match(select, /Seul l'hôte choisit le mode et le thème/);
    assert.match(select, /isCustomRosterTopicOwnedBy/);
  });
});

describe("FEATURE-TIERNIGHT-02 — B. absence republication générique", () => {
  it("eveningStateToRemote n'embarque pas customRosterTopics", () => {
    const evening = read("js/core/gameSync.js").match(
      /function eveningStateToRemote\(\) \{[\s\S]*?\n\}/
    )?.[0];
    assert.ok(evening);
    assert.doesNotMatch(evening, /customRosterTopics:/);
  });

  it("start/complete/push utilisent préservation serveur", () => {
    const sync = read("js/core/gameSync.js");
    assert.match(sync, /upsertSessionPreservingRosterTopics/);
    const start = sync.match(/export async function startGameSession\([\s\S]*?\n\}/)?.[0];
    assert.match(start, /upsertSessionPreservingRosterTopics/);
    const pushIdx = sync.indexOf("async function pushGameSessionInner");
    assert.ok(pushIdx >= 0, "pushGameSessionInner introuvable");
    const pushSlice = sync.slice(pushIdx, pushIdx + 2200);
    assert.match(pushSlice, /upsertSessionPreservingRosterTopics/);
    assert.match(pushSlice, /stripCustomRosterTopicsFromGenericPatch/);
    assert.match(pushSlice, /preserveCustomRosterTopicsInFullStateReplace/);
    assert.doesNotMatch(pushSlice, /updateGameSession\(/);
  });

  it("syncLobbyScores = eveningStateToRemote sans collection", () => {
    const sync = read("js/core/gameSync.js");
    assert.match(
      sync,
      /export async function syncLobbyScores[\s\S]*?patchGameState\(eveningStateToRemote\(\)\)/
    );
  });
});

describe("FEATURE-TIERNIGHT-02 — C. protection patchGameStateInner (strip)", () => {
  it("strip retire la clé ; shallow merge ne peut plus écraser", () => {
    const current = {
      scores: {},
      customRosterTopics: [
        topic("a", "Alpha", "Bob", "uid-b"),
        topic("b", "Bravo", "Bob", "uid-b"),
      ],
    };
    const stalePatch = {
      scores: { Alice: 1 },
      customRosterTopics: [topic("h", "hote", "Alice", "uid-a")],
    };
    const { safePayload, stripped } = stripCustomRosterTopicsFromGenericPatch(stalePatch);
    assert.equal(stripped, true);
    assert.equal("customRosterTopics" in safePayload, false);
    const nextState = { ...current, ...safePayload };
    assert.equal(nextState.customRosterTopics.length, 2);
    assert.ok(nextState.customRosterTopics.some((t) => t.name === "Alpha"));
    assert.equal(nextState.scores.Alice, 1);
  });

  it("source patchGameStateInner appelle strip (pas merge collection)", () => {
    const sync = read("js/core/gameSync.js");
    const idx = sync.indexOf("let nextState = { ...current, ...safeMergePayload };");
    assert.ok(idx > 0, "safeMergePayload attendu après strip");
    const before = sync.slice(idx - 400, idx);
    assert.match(before, /stripCustomRosterTopicsFromGenericPatch/);
    assert.doesNotMatch(
      sync.slice(idx, idx + 200),
      /mergeCustomRosterTopics\(\s*mergePayload\.customRosterTopics/
    );
  });
});

describe("FEATURE-TIERNIGHT-02 — D. course RPC contre replace hôte", () => {
  it("serveur [A] + patch hôte stale + RPC B pendant lock → [A,B]", () => {
    const existing = [topic("a", "A", "Bob", "uid-b")];
    const hostIncoming = {
      scores: {},
      customRosterTopics: [topic("a", "A", "Bob", "uid-b")],
      hotTake: { lobbyStarted: false },
    };
    const rpcB = topic("b", "B", "Bob", "uid-b");
    const final = simulatePreservingReplace(existing, hostIncoming, rpcB);
    const names = final.map((t) => t.name).sort();
    assert.deepEqual(names, ["A", "B"]);
  });
});

describe("FEATURE-TIERNIGHT-02 — QA hydratation hôte vs invité", () => {
  const remoteFull = [
    topic("h1", "H1", "Host", "host-uid"),
    topic("a1", "A1", "Ann", "guest-uid"),
    topic("a2", "A2", "Ann", "guest-uid"),
    topic("a3", "A3", "Ann", "guest-uid"),
  ];

  it("remote complet → hôte et invité voient H1+A1+A2+A3", () => {
    const hostView = mergeCustomRosterTopics(
      [topic("h1", "H1", "Host", "host-uid")],
      remoteFull,
      "Host",
      "host-uid"
    );
    const guestView = mergeCustomRosterTopics(
      [
        topic("a1", "A1", "Ann", "guest-uid"),
        topic("a2", "A2", "Ann", "guest-uid"),
        topic("a3", "A3", "Ann", "guest-uid"),
      ],
      remoteFull,
      "Ann",
      "guest-uid"
    );
    assert.equal(hostView.length, 4);
    assert.equal(guestView.length, 4);
  });

  it("permissions delete : hôte H1 seulement ; invité A*", () => {
    assert.equal(isCustomRosterTopicOwnedBy(remoteFull[0], "Host", "host-uid"), true);
    assert.equal(isCustomRosterTopicOwnedBy(remoteFull[1], "Host", "host-uid"), false);
    assert.equal(isCustomRosterTopicOwnedBy(remoteFull[1], "Ann", "guest-uid"), true);
    assert.equal(isCustomRosterTopicOwnedBy(remoteFull[0], "Ann", "guest-uid"), false);
  });

  it("retour après jeu : local hôte amputé + remote sain → grille complète", () => {
    const hostView = mergeCustomRosterTopics(
      [topic("h1", "H1", "Host", "host-uid")],
      remoteFull,
      "Host",
      "host-uid"
    );
    assert.equal(hostView.length, 4);
    assert.ok(hostView.some((t) => t.name === "A2"));
  });

  it("push stale cache ne doit plus gagner sur la base (préserve le plus riche)", () => {
    const serverTopics = remoteFull;
    const staleHostCache = [topic("h1", "H1", "Host", "host-uid")];
    const pushed = preserveCustomRosterTopicsInFullStateReplace(
      { hotTake: { lobbyStarted: true }, customRosterTopics: staleHostCache },
      { customRosterTopics: serverTopics },
      staleHostCache
    );
    assert.equal(pushed.customRosterTopics.length, 4);
  });

  it("legacy author sans authorUid reste visible pour l'autre joueur", () => {
    const remote = [
      topic("h1", "H1", "Host", "host-uid"),
      { id: "custom-roster-legacy", name: "LegacyGuest", custom: true, author: "Ann" },
    ];
    const hostView = mergeCustomRosterTopics([], remote, "Host", "host-uid");
    assert.equal(hostView.length, 2);
  });

  it("delete distant confirmé : A1 disparaît chez hôte (pas d'union éternelle)", () => {
    const remoteAfter = [
      topic("h1", "H1", "Host", "host-uid"),
      topic("a2", "A2", "Ann", "guest-uid"),
    ];
    const hostLocal = [
      topic("h1", "H1", "Host", "host-uid"),
      topic("a1", "A1", "Ann", "guest-uid"),
      topic("a2", "A2", "Ann", "guest-uid"),
    ];
    const merged = mergeCustomRosterTopics(hostLocal, remoteAfter, "Host", "host-uid");
    assert.equal(merged.some((t) => t.name === "A1"), false);
    assert.equal(merged.length, 2);
  });
});

describe("FEATURE-TIERNIGHT-02 — E/F. multi créations / multi auteurs", () => {
  it("E — A,B,C même auteur via merge hydratation", () => {
    const remote = [
      topic("a", "A-theme", "Bob", "uid-b"),
      topic("b", "B-theme", "Bob", "uid-b"),
      topic("c", "C-theme", "Bob", "uid-b"),
    ];
    const hostView = mergeCustomRosterTopics([], remote, "Alice", "uid-a");
    assert.equal(hostView.length, 3);
  });

  it("F — H + A1 + B1 + A2 convergent", () => {
    const remote = [
      topic("h", "HostTheme", "Alice", "uid-a"),
      topic("a1", "A1Theme", "Ann", "uid-ann"),
      topic("b1", "B1Theme", "Ben", "uid-ben"),
      topic("a2", "A2Theme", "Ann", "uid-ann"),
    ];
    const forAlice = mergeCustomRosterTopics(
      [topic("h", "HostTheme", "Alice", "uid-a")],
      remote,
      "Alice",
      "uid-a"
    );
    assert.equal(forAlice.length, 4);
    const forAnn = mergeCustomRosterTopics(
      [topic("a1", "A1Theme", "Ann", "uid-ann"), topic("a2", "A2Theme", "Ann", "uid-ann")],
      remote,
      "Ann",
      "uid-ann"
    );
    assert.equal(forAnn.length, 4);
  });
});

describe("FEATURE-TIERNIGHT-02 — G. suppression concurrente", () => {
  it("delete distant A1 reflété ; A2/B1/B2 conservés", () => {
    const remoteAfter = [
      topic("a2", "A2", "Ann", "uid-ann"),
      topic("b1", "B1", "Ben", "uid-ben"),
      topic("b2", "B2", "Ben", "uid-ben"),
    ];
    const annLocal = [topic("a2", "A2", "Ann", "uid-ann")];
    const merged = mergeCustomRosterTopics(annLocal, remoteAfter, "Ann", "uid-ann");
    const names = merged.map((t) => t.name).sort();
    assert.deepEqual(names, ["A2", "B1", "B2"]);
    assert.equal(merged.some((t) => t.name === "A1"), false);
  });
});

describe("FEATURE-TIERNIGHT-02 — H/J. survie jeu + frontière lobby", () => {
  let snapshot;
  beforeEach(() => {
    snapshot = structuredClone(getState());
    saveStatePatch({ customRosterTopics: [] });
  });
  afterEach(() => saveStatePatch(snapshot));

  it("H — resetGameSessionsOnly conserve les thèmes (changement de jeu local)", () => {
    addCustomRosterTopic({ name: "Survit au menu" });
    resetGameSessionsOnly();
    assert.equal(getCustomRosterTopics().length, 1);
  });

  it("J — resetEveningState vide ; nouveau lobby liste vide", () => {
    addCustomRosterTopic({ name: "Lobby A" });
    resetEveningState();
    assert.deepEqual(getCustomRosterTopics(), []);
    addCustomRosterTopic({ name: "Lobby B only" });
    assert.equal(getCustomRosterTopics().length, 1);
    assert.equal(getCustomRosterTopics()[0].name, "Lobby B only");
  });
});

describe("FEATURE-TIERNIGHT-02 — I. rollback réseau (contrat source)", () => {
  it("add/delete ont try/catch + rollback ciblé par id", () => {
    const session = read("js/core/customRosterTopicSession.js");
    assert.match(session, /removeTopicById/);
    assert.match(session, /restoreTopicIfMissing/);
    assert.match(session, /catch \(e\)/);
    assert.doesNotMatch(session, /catch\s*\(\s*\)\s*\{\s*\}/);
  });
});

describe("FEATURE-TIERNIGHT-02 — SQL correctif", () => {
  it("migration lost-update : authorUid + preserving RPC + hint si base vide", () => {
    const sql = read("supabase/feature-tiernight-02-lost-update-fix.sql");
    assert.match(sql, /authorUid/);
    assert.match(sql, /upsert_game_session_preserving_roster_topics/);
    assert.match(sql, /for update/i);
    assert.match(sql, /Hôte requis/);
    assert.match(sql, /jsonb_array_length\(v_topics\) = 0/);
    assert.match(sql, /p_state -> 'customRosterTopics'/);
  });

  it("pickRichest préfère la liste non vide", () => {
    assert.deepEqual(
      pickRichestCustomRosterTopics([], [topic("a", "A1", "Ann")], []),
      [topic("a", "A1", "Ann")]
    );
  });
});

describe("FEATURE-TIERNIGHT-02 — ownership authorUid vs rename", () => {
  it("propriété suit authorUid même si display name change", () => {
    const mine = topic("x", "Thème", "OldName", "uid-1");
    const afterRename = mergeCustomRosterTopics(
      [{ ...mine, author: "NewName" }],
      [mine],
      "NewName",
      "uid-1"
    );
    assert.equal(afterRename.length, 1);
    assert.equal(afterRename[0].authorUid, "uid-1");
  });
});
