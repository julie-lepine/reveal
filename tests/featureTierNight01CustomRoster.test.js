/**
 * FEATURE-TIERNIGHT-01 - thèmes roster personnalisés (« Classe le groupe »).
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  sanitizeCustomRosterTopicsFromStorage,
  validateRosterTopicName,
  CUSTOM_ROSTER_TOPIC_ID_PREFIX,
} from "../js/core/customRosterTopics.js";
import {
  parseRosterTopicDescriptor,
  resolveRosterTopicConfig,
  mergeTierNightTopicMeta,
  ROSTER_TOPIC_PREFIX,
} from "../js/core/rosterTopic.js";
import {
  getState,
  saveStatePatch,
  addCustomRosterTopic,
  deleteCustomRosterTopic,
  getCustomRosterTopics,
  addCustomTierList,
  resetEveningState,
  resetGameSessionsOnly,
} from "../js/core/state.js";
import { TIER_NIGHT_ROSTER_TOPICS } from "../data/tierTopics.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

function read(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

/** Miroir minimal tierNightToRemote (évite import gameSync → Supabase https). */
function mirrorTierNightToRemote(payload) {
  const {
    runId,
    topicId,
    game,
    placements,
    finished,
    mode,
    modifier,
    lobbyStarted,
    items,
    playerRoster,
    listName,
    topicEmoji,
  } = payload;
  let normalizedMode = "roster";
  if (mode === "live") normalizedMode = "live";
  else if (mode === "roster") normalizedMode = "roster";
  return {
    runId: runId || null,
    topicId: topicId || null,
    mode: normalizedMode,
    modifier: modifier || "normal",
    lobbyStarted: Boolean(lobbyStarted),
    game: game ?? (lobbyStarted ? true : null),
    items: Array.isArray(items) ? items : null,
    playerRoster: Array.isArray(playerRoster) ? playerRoster : null,
    listName: typeof listName === "string" ? listName : "",
    topicEmoji: typeof topicEmoji === "string" ? topicEmoji : "",
    placements: placements || {},
    finished: finished || {},
    recap: null,
  };
}

describe("FEATURE-TIERNIGHT-01 - store local customRosterTopics", () => {
  let snapshot;

  beforeEach(() => {
    snapshot = structuredClone(getState());
    saveStatePatch({ customRosterTopics: [], customTierLists: [] });
  });

  afterEach(() => {
    saveStatePatch(snapshot);
  });

  it("ajout thème valide avec trim - sans propriété emoji", () => {
    const r = addCustomRosterTopic({ name: "  Qui survit ?  " });
    assert.equal(r.ok, true);
    assert.match(r.id, new RegExp(`^${CUSTOM_ROSTER_TOPIC_ID_PREFIX}`));
    const topic = getCustomRosterTopics()[0];
    assert.equal(topic.name, "Qui survit ?");
    assert.equal(topic.custom, true);
    assert.equal("emoji" in topic, false);
  });

  it("plusieurs thèmes coexistent", () => {
    addCustomRosterTopic({ name: "Thème A" });
    addCustomRosterTopic({ name: "Thème B" });
    assert.equal(getCustomRosterTopics().length, 2);
  });

  it("suppression ciblée", () => {
    const a = addCustomRosterTopic({ name: "Thème A" });
    assert.equal(a.ok, true);
    addCustomRosterTopic({ name: "Thème B" });
    assert.equal(deleteCustomRosterTopic(a.id), true);
    assert.equal(getCustomRosterTopics().length, 1);
    assert.equal(getCustomRosterTopics()[0].name, "Thème B");
  });

  it("sanitize ignore entrées invalides, doublons et emoji historique", () => {
    const out = sanitizeCustomRosterTopicsFromStorage([
      {
        id: `${CUSTOM_ROSTER_TOPIC_ID_PREFIX}x`,
        name: "OK",
        emoji: "🏝️",
        custom: true,
      },
      { id: `${CUSTOM_ROSTER_TOPIC_ID_PREFIX}x`, name: "Dup", custom: true },
      null,
    ]);
    assert.equal(out.length, 1);
    assert.equal(out[0].name, "OK");
    assert.equal("emoji" in out[0], false);
  });
});

describe("FEATURE-TIERNIGHT-01 - validation et modération", () => {
  it("formulaire création - texte seul, modération avant persistance", () => {
    const src = read("js/screens/tierNightCreateRoster.js");
    assert.doesNotMatch(src, /roster-topic-emoji/);
    const handler = src.match(/createBtn\.addEventListener\("click"[\s\S]*?\}\)\(\);/)?.[0] || "";
    assert.ok(handler.indexOf("checkHotTakeModeration") < handler.indexOf("addCustomRosterTopicAndSync"));
    assert.match(handler, /addCustomRosterTopicAndSync\(\{ name \}\)/);
    assert.doesNotMatch(handler, /isLobbyHost/);
  });
});

describe("FEATURE-TIERNIGHT-01 - résolution roster", () => {
  let snapshot;

  beforeEach(() => {
    snapshot = structuredClone(getState());
    saveStatePatch({ customRosterTopics: [] });
  });

  afterEach(() => {
    saveStatePatch(snapshot);
  });

  it("custom local résolu sans topicEmoji", () => {
    const { id, topic } = addCustomRosterTopic({ name: "Île ?" });
    assert.equal("emoji" in topic, false);
    const cfg = resolveRosterTopicConfig(`${ROSTER_TOPIC_PREFIX}${id}`);
    assert.equal(cfg.listName, "Île ?");
    assert.equal(cfg.topicEmoji, "");
  });

  it("snapshot session custom ignore topicEmoji historique", () => {
    const cfg = resolveRosterTopicConfig(`${ROSTER_TOPIC_PREFIX}custom-roster-gone`, {
      topicId: `${ROSTER_TOPIC_PREFIX}custom-roster-gone`,
      listName: "Thème distant",
      topicEmoji: "🌊",
    });
    assert.equal(cfg.listName, "Thème distant");
    assert.equal(cfg.topicEmoji, "");
  });
});

describe("FEATURE-TIERNIGHT-01 - sérialisation distante", () => {
  it("custom roster : listName synchronisé, topicEmoji vide", () => {
    const remote = mirrorTierNightToRemote({
      runId: "run-1",
      topicId: `${ROSTER_TOPIC_PREFIX}custom-roster-1`,
      mode: "roster",
      lobbyStarted: true,
      listName: "Qui survit ?",
      topicEmoji: "",
    });
    assert.equal(remote.listName, "Qui survit ?");
    assert.equal(remote.topicEmoji, "");
  });
});

describe("FEATURE-TIERNIGHT-01 - Relancer une partie", () => {
  it("retourne toujours à la sélection TierNight", () => {
    const src = read("js/core/restartGame.js");
    assert.match(src, /tiernight: launchTierNightSelect/);
    assert.doesNotMatch(src, /launchTierNightRestart/);
    assert.doesNotMatch(src, /relaunchTierNightClassicSameTopic/);
  });

  it("launchTierNightSelect remet topicId et listName à zéro", () => {
    const src = read("js/core/restartGame.js");
    const fn = src.match(/export async function launchTierNightSelect\([\s\S]*?^}/m)?.[0] || "";
    assert.match(fn, /topicId: null/);
    assert.match(fn, /listName: ""/);
    assert.match(fn, /navigate\("tiernight-select"\)/);
  });
});

describe("FEATURE-TIERNIGHT-01 - UI wiring (statique)", () => {
  it("cartes custom : icône UI ✏️", () => {
    const src = read("js/screens/tierNightSelect.js");
    assert.match(src, /const cardEmoji = custom \? "✏️"/);
  });
});

describe("FEATURE-TIERNIGHT-01 - cycle de vie lobby (customRosterTopics)", () => {
  let snapshot;

  beforeEach(() => {
    snapshot = structuredClone(getState());
    saveStatePatch({ customRosterTopics: [], customTierLists: [] });
  });

  afterEach(() => {
    saveStatePatch(snapshot);
  });

  it("1 - création d'un thème", () => {
    const r = addCustomRosterTopic({ name: "Qui survit sur l'île ?" });
    assert.equal(r.ok, true);
    assert.equal(getCustomRosterTopics().length, 1);
    assert.equal(getCustomRosterTopics()[0].name, "Qui survit sur l'île ?");
  });

  it("2 - plusieurs parties / changement de jeu dans le même lobby → thème conservé", () => {
    addCustomRosterTopic({ name: "Thème lobby" });
    // Même chemin que returnToGameSelect / leaveGameSetup / exitGame.
    resetGameSessionsOnly();
    resetGameSessionsOnly();
    assert.equal(getCustomRosterTopics().length, 1);
    assert.equal(getCustomRosterTopics()[0].name, "Thème lobby");
  });

  it("3 - fermeture / destruction du lobby → thèmes vidés (resetEveningState)", () => {
    addCustomRosterTopic({ name: "Thème à purger" });
    assert.equal(getCustomRosterTopics().length, 1);
    // Helper central aussi utilisé par Hot Take / Dilemma (via reset des sessions jeu).
    resetEveningState();
    assert.deepEqual(getCustomRosterTopics(), []);
  });

  it("4–5 - nouveau lobby après teardown → liste vide (pas de bibliothèque)", () => {
    addCustomRosterTopic({ name: "Ancien lobby" });
    // createLobby / joinLobby (hors transition) / leave → performLobbyBoundaryTeardown
    // → resetEveningState.
    resetEveningState();
    assert.deepEqual(getCustomRosterTopics(), []);
    // Simulation : on « crée » un thème dans le nouveau lobby uniquement après.
    assert.equal(getCustomRosterTopics().length, 0);
    const next = addCustomRosterTopic({ name: "Nouveau lobby only" });
    assert.equal(next.ok, true);
    assert.equal(getCustomRosterTopics().length, 1);
    assert.equal(getCustomRosterTopics()[0].name, "Nouveau lobby only");
  });

  it("câblage : performLobbyBoundaryTeardown → resetEveningState (helper partagé)", () => {
    const lobby = read("js/core/lobby.js");
    const teardown = lobby.match(
      /export function performLobbyBoundaryTeardown\(\) \{[\s\S]*?\n\}/
    )?.[0];
    assert.ok(teardown, "performLobbyBoundaryTeardown introuvable");
    assert.match(teardown, /resetEveningState\(\)/);

    const state = read("js/core/state.js");
    const evening = state.match(
      /export function resetEveningState\(\) \{[\s\S]*?\n\}/
    )?.[0];
    assert.ok(evening, "resetEveningState introuvable");
    assert.match(evening, /customRosterTopics:\s*\[\]/);

    const sessionsOnly = state.match(
      /export function resetGameSessionsOnly\(\) \{[\s\S]*?\n\}/
    )?.[0];
    assert.ok(sessionsOnly, "resetGameSessionsOnly introuvable");
    assert.doesNotMatch(sessionsOnly, /customRosterTopics/);
  });

  it("customTierLists (Rank Live) non touchés par resetEveningState", () => {
    addCustomTierList({ name: "Ma tier list", items: ["A", "B"] });
    addCustomRosterTopic({ name: "Roster temporaire" });
    const tierCountBefore = (getState().customTierLists || []).length;
    assert.ok(tierCountBefore >= 1);
    resetEveningState();
    assert.deepEqual(getCustomRosterTopics(), []);
    assert.equal((getState().customTierLists || []).length, tierCountBefore);
  });
});

describe("FEATURE-TIERNIGHT-01 - snapshot partie", () => {
  let snapshot;

  beforeEach(() => {
    snapshot = structuredClone(getState());
  });

  afterEach(() => {
    saveStatePatch(snapshot);
  });

  it("listName snapshoté même si thème custom supprimé du store", () => {
    const added = addCustomRosterTopic({ name: "Thème restart" });
    saveStatePatch({
      tierNightGame: {
        topicId: `${ROSTER_TOPIC_PREFIX}${added.id}`,
        listName: "Thème restart",
      },
    });
    deleteCustomRosterTopic(added.id);
    const cfg = resolveRosterTopicConfig(getState().tierNightGame.topicId, getState().tierNightGame);
    assert.equal(cfg.listName, "Thème restart");
  });
});
