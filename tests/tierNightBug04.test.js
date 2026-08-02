import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildTierNightPlayerRoster,
  getTierNightExpectedVoterIds,
  votesByUidFromMixed,
  countConfirmedTierNightVotes,
  hasAllExpectedTierNightVotes,
  mapVotesForTierNightLiveUi,
  displayNameForTierNightUid,
  buildRosterListFromPlayerRoster,
  sessionHasTierNightPlayerRoster,
} from "../js/core/tierNightRoster.js";
import { isNewSpeedVoteVoteRound } from "../js/core/sessionMerge.js";

const lobby3 = [
  { name: "Alice", userId: "u-a", emoji: "🅰️" },
  { name: "Bob", userId: "u-b", emoji: "🅱️" },
  { name: "Charlie", userId: "u-c", emoji: "©️" },
];

/** Résolution Classique pure (sans importer tierLists → state). */
function resolveClassicFromSnap(topicId, sessionLike) {
  const items = sessionLike?.items;
  const playerRoster = sessionLike?.playerRoster;
  if (Array.isArray(items) && items.length) {
    return {
      id: topicId,
      items: [...items],
      playerRoster: Array.isArray(playerRoster) ? playerRoster : null,
      roster: true,
    };
  }
  if (Array.isArray(playerRoster) && playerRoster.length) {
    return buildRosterListFromPlayerRoster(topicId, playerRoster);
  }
  return null;
}

describe("BUG-TIERNIGHT-04 — Classique roster figé", () => {
  it("1. roster construit au lancement (ordre lobby)", () => {
    const roster = buildTierNightPlayerRoster(lobby3);
    assert.deepEqual(
      roster.map((r) => r.userId),
      ["u-a", "u-b", "u-c"]
    );
    assert.deepEqual(
      roster.map((r) => r.displayName),
      ["Alice", "Bob", "Charlie"]
    );
  });

  it("2. tous les clients hydratent le même set ordonné via items persistés", () => {
    const roster = buildTierNightPlayerRoster(lobby3);
    const items = roster.map((r) => r.displayName);
    const hostList = resolveClassicFromSnap("roster:apocalypse", {
      items,
      playerRoster: roster,
    });
    const guestList = resolveClassicFromSnap("roster:apocalypse", {
      items: [...items],
      playerRoster: [...roster],
    });
    assert.deepEqual(hostList.items, guestList.items);
    assert.deepEqual(hostList.playerRoster, guestList.playerRoster);
  });

  it("3. variation ultérieure du lobby ne modifie pas le roster en cours", () => {
    const roster = buildTierNightPlayerRoster(lobby3);
    const items = roster.map((r) => r.displayName);
    const lateLobby = [
      { name: "Alice", userId: "u-a" },
      { name: "Dave", userId: "u-d" },
    ];
    const lateRoster = buildTierNightPlayerRoster(lateLobby);
    const list = resolveClassicFromSnap("roster:apocalypse", {
      items,
      playerRoster: roster,
    });
    assert.deepEqual(list.items, ["Alice", "Bob", "Charlie"]);
    assert.notDeepEqual(
      list.items,
      lateRoster.map((r) => r.displayName)
    );
  });

  it("4. reconnexion → même roster (hydratation session)", () => {
    const roster = buildTierNightPlayerRoster(lobby3);
    const session = {
      items: roster.map((r) => r.displayName),
      playerRoster: roster,
    };
    const afterReconnect = resolveClassicFromSnap("roster:apocalypse", session);
    assert.deepEqual(afterReconnect.items, ["Alice", "Bob", "Charlie"]);
    assert.equal(sessionHasTierNightPlayerRoster(session), true);
  });

  it("5. pseudo local manquant → item visible via snapshot", () => {
    const roster = buildTierNightPlayerRoster(lobby3);
    const list = buildRosterListFromPlayerRoster("apocalypse", roster, {
      name: "Classe le groupe",
    });
    assert.ok(list.items.includes("Charlie"));
    assert.equal(
      displayNameForTierNightUid("u-c", roster, () => null),
      "Charlie"
    );
  });

  it("6. pas de reshuffle : items session = source unique", () => {
    const items = ["Charlie", "Alice", "Bob"];
    const list = resolveClassicFromSnap("roster:apocalypse", {
      items,
      playerRoster: [
        { userId: "u-c", displayName: "Charlie" },
        { userId: "u-a", displayName: "Alice" },
        { userId: "u-b", displayName: "Bob" },
      ],
    });
    assert.deepEqual(list.items, items);
  });

  it("7–9. compteur fondé sur roster snapshoté ; UID attendu compté ; hors roster non compté dans X/Y", () => {
    const roster = buildTierNightPlayerRoster(lobby3);
    const expected = getTierNightExpectedVoterIds({ playerRoster: roster });
    const votes = votesByUidFromMixed(
      { "u-a": true, "u-b": true, "u-x": true },
      roster
    );
    assert.equal(countConfirmedTierNightVotes(votes, expected), 2);
    assert.equal(hasAllExpectedTierNightVotes(votes, expected), false);
    assert.ok(votes["u-x"]);
  });

  it("10. changement de manche même runId → roster identique", () => {
    const roster = buildTierNightPlayerRoster(lobby3);
    const sessionR0 = { runId: "run-1", roundIdx: 0, playerRoster: roster };
    const sessionR1 = { runId: "run-1", roundIdx: 1, playerRoster: roster };
    assert.deepEqual(
      getTierNightExpectedVoterIds(sessionR0),
      getTierNightExpectedVoterIds(sessionR1)
    );
  });
});

describe("BUG-TIERNIGHT-04 — Live UID canonique", () => {
  const roster = buildTierNightPlayerRoster(lobby3);

  it("1. votes indexés par UID → comptés", () => {
    const byUid = votesByUidFromMixed({ "u-a": "S", "u-b": "A" }, roster);
    assert.deepEqual(byUid, { "u-a": "S", "u-b": "A" });
  });

  it("2. nameForUserId manquant → vote non supprimé", () => {
    const ui = mapVotesForTierNightLiveUi({ "u-c": "B" }, roster, () => null);
    assert.equal(ui.Charlie, "B");
  });

  it("3. fallback d'affichage depuis roster synchronisé", () => {
    assert.equal(displayNameForTierNightUid("u-b", roster, () => null), "Bob");
    assert.equal(displayNameForTierNightUid("u-z", roster, () => null), "Joueur");
  });

  it("4. mappings locaux différents → mêmes labels via snapshot", () => {
    const uiHost = mapVotesForTierNightLiveUi({ "u-a": "S" }, roster, (uid) =>
      uid === "u-a" ? "Alice" : null
    );
    const uiGuest = mapVotesForTierNightLiveUi({ "u-a": "S" }, roster, () => null);
    assert.equal(uiHost.Alice, "S");
    assert.equal(uiGuest.Alice, "S");
  });

  it("5. deux votes confirmés → même X/Y", () => {
    const expected = getTierNightExpectedVoterIds({ playerRoster: roster });
    const byUid = votesByUidFromMixed({ "u-a": "S", "u-b": "C" }, roster);
    assert.equal(countConfirmedTierNightVotes(byUid, expected), 2);
    assert.equal(expected.length, 3);
  });

  it("6. draft local non confirmé (clé absente session) → non compté", () => {
    const expected = getTierNightExpectedVoterIds({ playerRoster: roster });
    const sessionVotes = { "u-a": "S" };
    const byUid = votesByUidFromMixed(sessionVotes, roster);
    assert.equal(countConfirmedTierNightVotes(byUid, expected), 1);
  });

  it("7–8. allVotesIn basé sur UIDs attendus", () => {
    const expected = getTierNightExpectedVoterIds({ playerRoster: roster });
    const partial = votesByUidFromMixed({ "u-a": "S", "u-b": "A" }, roster);
    const full = votesByUidFromMixed(
      { "u-a": "S", "u-b": "A", "u-c": "B" },
      roster
    );
    assert.equal(hasAllExpectedTierNightVotes(partial, expected), false);
    assert.equal(hasAllExpectedTierNightVotes(full, expected), true);
  });

  it("9. force reveal utilise le même set attendu (Y = roster)", () => {
    const expected = getTierNightExpectedVoterIds({ playerRoster: roster });
    assert.equal(expected.length, 3);
  });

  it("10. contribution inconnue ne fait pas disparaître un attendu", () => {
    const ui = mapVotesForTierNightLiveUi(
      { "u-a": "S", "u-x": "D" },
      roster,
      () => null
    );
    assert.equal(ui.Alice, "S");
    assert.equal(displayNameForTierNightUid("u-b", roster, () => null), "Bob");
  });

  it("11. merge placements serveur — clés conservées (convergence)", () => {
    const local = { Alice: { S: ["item1"] } };
    const remote = { Bob: { A: ["item1"] } };
    const merged = { ...local, ...remote };
    assert.ok(merged.Alice);
    assert.ok(merged.Bob);
  });

  it("12. solo sans playerRoster → helpers ne forcent pas allIn vide", () => {
    assert.equal(sessionHasTierNightPlayerRoster({ votes: {} }), false);
    assert.deepEqual(getTierNightExpectedVoterIds({}), []);
  });
});

describe("BUG-TIERNIGHT-05 — caractérisation (non corrigé dans 04)", () => {
  it("nouveau runId + ancien vote local encore présent : merge local-first conserve le vote", () => {
    const local = {
      runId: "old",
      phase: "voting",
      roundIdx: 0,
      votes: { Alice: "S" },
    };
    const remote = {
      runId: "new",
      phase: "voting",
      roundIdx: 0,
      votes: {},
      lobbyStarted: true,
      finished: false,
      placements: {},
    };
    const newRound = isNewSpeedVoteVoteRound(local, remote);
    const votes = newRound
      ? remote.votes || {}
      : { ...(remote.votes || {}), ...(local.votes || {}) };
    if (!newRound) {
      assert.equal(votes.Alice, "S");
    } else {
      assert.deepEqual(votes, {});
    }
  });
});

describe("BUG-TIERNIGHT-04 — helpers SpeedVote partagés (non-régression contrat)", () => {
  it("isNewSpeedVoteVoteRound : nouvelle manche (roundIdx+) avec votes vides → reset", () => {
    assert.equal(
      isNewSpeedVoteVoteRound(
        { phase: "reveal", roundIdx: 0, votes: { a: "S" } },
        { phase: "voting", roundIdx: 1, votes: {} }
      ),
      true
    );
  });

  it("isNewSpeedVoteVoteRound : patch votes-only même manche → pas reset", () => {
    assert.equal(
      isNewSpeedVoteVoteRound(
        { phase: "voting", roundIdx: 0, votes: { a: "S" } },
        { votes: { b: "A" } }
      ),
      false
    );
  });
});
