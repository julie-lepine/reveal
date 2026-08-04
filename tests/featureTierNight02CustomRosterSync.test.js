/**
 * FEATURE-TIERNIGHT-02 — tous les joueurs peuvent créer des thèmes roster synchronisés.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mergeCustomRosterTopics } from "../js/core/sessionMerge.js";
import {
  getState,
  saveStatePatch,
  addCustomRosterTopic,
  getCustomRosterTopics,
  getLocalDisplayName,
} from "../js/core/state.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

function read(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

function topic(id, name, author) {
  return { id: `custom-roster-${id}`, name, custom: true, author };
}

describe("FEATURE-TIERNIGHT-02 — permissions création vs lancement", () => {
  it("1 — création : plus de garde isLobbyHost dans le handler", () => {
    const src = read("js/screens/tierNightCreateRoster.js");
    assert.doesNotMatch(src, /isLobbyHost/);
    assert.doesNotMatch(src, /Seul l'hôte peut créer un thème/);
    assert.match(src, /addCustomRosterTopicAndSync/);
  });

  it("4–5 — lancement reste hôte-only (ensureHost / markTierNightClassicStarted)", () => {
    const select = read("js/screens/tierNightSelect.js");
    assert.match(select, /async function ensureHost/);
    assert.match(select, /Seul l'hôte choisit le mode et le thème/);
    const start = select.match(/async function startGame[\s\S]*?^  \}/m)?.[0] || "";
    assert.match(start, /ensureHost/);
    assert.match(start, /markTierNightClassicStarted/);
  });

  it("7 — hôte : bouton créer + sync host path présents", () => {
    const select = read("js/screens/tierNightSelect.js");
    assert.match(select, /data-nav="tiernight-create-roster"/);
    const session = read("js/core/customRosterTopicSession.js");
    assert.match(session, /isLobbyHost\(\)/);
    assert.match(session, /patchGameState\(\{ customRosterTopics/);
    assert.match(session, /rpcUpsertPlayerCustomEntry/);
    assert.match(session, /game:\s*"tiernight"/);
  });
});

describe("FEATURE-TIERNIGHT-02 — synchronisation multi-joueurs", () => {
  let snapshot;

  beforeEach(() => {
    snapshot = structuredClone(getState());
    saveStatePatch({ customRosterTopics: [] });
  });

  afterEach(() => {
    saveStatePatch(snapshot);
  });

  it("1 — un invité (auteur) crée un thème localement", () => {
    const r = addCustomRosterTopic({ name: "Qui survit ?" });
    assert.equal(r.ok, true);
    assert.equal(r.topic.author, getLocalDisplayName());
    assert.equal(getCustomRosterTopics().length, 1);
  });

  it("2–3 — hôte et second invité voient le thème via merge (remote)", () => {
    const guestTopic = topic("g1", "Idée de Bob", "Bob");
    const hostLocal = [];
    const hostView = mergeCustomRosterTopics(hostLocal, [guestTopic], "Alice");
    assert.equal(hostView.length, 1);
    assert.equal(hostView[0].name, "Idée de Bob");
    assert.equal(hostView[0].author, "Bob");

    const otherGuest = mergeCustomRosterTopics([], [guestTopic], "Charlie");
    assert.equal(otherGuest.length, 1);
    assert.equal(otherGuest[0].id, guestTopic.id);
  });

  it("6 — plusieurs invités peuvent créer des thèmes successivement", () => {
    const remote = [
      topic("b1", "Thème Bob", "Bob"),
      topic("c1", "Thème Charlie", "Charlie"),
    ];
    const aliceAdds = topic("a1", "Thème Alice", "Alice");
    const merged = mergeCustomRosterTopics([aliceAdds], remote, "Alice");
    assert.equal(merged.length, 3);
    const names = merged.map((t) => t.name).sort();
    assert.deepEqual(names, ["Thème Alice", "Thème Bob", "Thème Charlie"]);
  });

  it("merge : ne réinjecte pas un thème local supprimé depuis le remote d'autrui", () => {
    const mine = topic("a1", "Le mien", "Alice");
    const other = topic("b1", "Le sien", "Bob");
    // Alice a déjà publié ; remote n'a plus le sien d'Alice (supprimé) + Bob.
    const afterDelete = mergeCustomRosterTopics([], [other], "Alice");
    assert.equal(afterDelete.length, 1);
    assert.equal(afterDelete[0].author, "Bob");
    // Optimistic local Alice conservé si encore présent localement.
    const withLocal = mergeCustomRosterTopics([mine], [other], "Alice");
    assert.equal(withLocal.length, 2);
  });
});

describe("FEATURE-TIERNIGHT-02 — architecture evening / SQL", () => {
  it("eveningStateToRemote publie customRosterTopics (survit aux jeux)", () => {
    const sync = read("js/core/gameSync.js");
    const evening = sync.match(
      /function eveningStateToRemote\(\) \{[\s\S]*?\n\}/
    )?.[0];
    assert.ok(evening);
    assert.match(evening, /customRosterTopics/);
    assert.match(evening, /mergeCustomRosterTopics/);

    const apply = sync.match(
      /export function applyRemoteEveningState\([\s\S]*?\n\}/
    )?.[0];
    assert.ok(apply);
    assert.match(apply, /st\.customRosterTopics/);
    assert.match(apply, /mergeCustomRosterTopics/);
  });

  it("SQL : tiernight → state.customRosterTopics top-level", () => {
    const sql = read("supabase/feature-tiernight-02-custom-roster-sync.sql");
    assert.match(sql, /v_game = 'tiernight'/);
    assert.match(sql, /customRosterTopics/);
    assert.match(sql, /v_top_level/);
    assert.match(sql, /Hot Take \/ Dilemma \/ TierNight/);
  });

  it("select : refresh liste sur onGameSessionChange + ensureHost inchangé", () => {
    const select = read("js/screens/tierNightSelect.js");
    assert.match(select, /onGameSessionChange/);
    assert.match(select, /step === "topic"/);
    assert.match(select, /Thèmes personnalisés/);
    assert.match(select, /ensureHost/);
  });

  it("session : réutilise rpcUpsertPlayerCustomEntry / patchGameState (pas de nouvelle RPC)", () => {
    const session = read("js/core/customRosterTopicSession.js");
    assert.match(session, /rpcUpsertPlayerCustomEntry/);
    assert.match(session, /rpcDeletePlayerCustomEntry/);
    assert.match(session, /patchGameState/);
    assert.match(session, /applyRemoteSession/);
    assert.doesNotMatch(session, /canActAsHost/);
  });
});
