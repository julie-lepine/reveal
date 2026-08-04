/**
 * FEATURE-TIERNIGHT-01 — thèmes roster personnalisés (« Classe le groupe »).
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

describe("FEATURE-TIERNIGHT-01 — store local customRosterTopics", () => {
  let snapshot;

  beforeEach(() => {
    snapshot = structuredClone(getState());
    saveStatePatch({ customRosterTopics: [], customTierLists: [] });
  });

  afterEach(() => {
    saveStatePatch(snapshot);
  });

  it("ajout thème valide avec trim — sans propriété emoji", () => {
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

describe("FEATURE-TIERNIGHT-01 — validation et modération", () => {
  it("formulaire création — texte seul, modération avant persistance", () => {
    const src = read("js/screens/tierNightCreateRoster.js");
    assert.doesNotMatch(src, /roster-topic-emoji/);
    const handler = src.match(/createBtn\.addEventListener\("click"[\s\S]*?\}\)\(\);/)?.[0] || "";
    assert.ok(handler.indexOf("checkHotTakeModeration") < handler.indexOf("addCustomRosterTopic"));
    assert.match(handler, /addCustomRosterTopic\(\{ name \}\)/);
  });
});

describe("FEATURE-TIERNIGHT-01 — résolution roster", () => {
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

describe("FEATURE-TIERNIGHT-01 — sérialisation distante", () => {
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

describe("FEATURE-TIERNIGHT-01 — Relancer une partie", () => {
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

describe("FEATURE-TIERNIGHT-01 — UI wiring (statique)", () => {
  it("cartes custom : icône UI ✏️", () => {
    const src = read("js/screens/tierNightSelect.js");
    assert.match(src, /const cardEmoji = custom \? "✏️"/);
  });
});

describe("FEATURE-TIERNIGHT-01 — snapshot partie", () => {
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
