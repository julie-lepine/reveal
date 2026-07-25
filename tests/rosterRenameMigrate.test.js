import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  detectParticipantRenames,
  migrateNumericNameMapMax,
  migrateNumericNameMapPreferOld,
  migratePlayerStatsForRenames,
  migrateGameScoresForRenames,
  migrateEveningMapsForRosterRenames,
} from "../js/core/rosterRenameMigrate.js";
import {
  getState,
  renameLocalPlayer,
  replaceEveningScoreMaps,
  saveStatePatch,
} from "../js/core/state.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("SYN-15 / SYN-16 — detectParticipantRenames", () => {
  it("détecte rename prouvé par même userId", () => {
    const renames = detectParticipantRenames(
      [
        { userId: "u1", name: "Alice" },
        { userId: "u2", name: "Bob" },
      ],
      [
        { userId: "u1", name: "Alicia" },
        { userId: "u2", name: "Bob" },
      ]
    );
    assert.deepEqual(renames, [
      { userId: "u1", oldName: "Alice", newName: "Alicia" },
    ]);
  });

  it("roster prev ou next vide / absent → aucun rename", () => {
    assert.deepEqual(detectParticipantRenames([], [{ userId: "u1", name: "A" }]), []);
    assert.deepEqual(detectParticipantRenames([{ userId: "u1", name: "A" }], []), []);
    assert.deepEqual(detectParticipantRenames(null, [{ userId: "u1", name: "A" }]), []);
    assert.deepEqual(detectParticipantRenames(undefined, undefined), []);
  });

  it("Alice parti + Alicia nouveau uid → pas de rename", () => {
    const renames = detectParticipantRenames(
      [
        { userId: "u1", name: "Alice" },
        { userId: "u2", name: "Bob" },
      ],
      [
        { userId: "u3", name: "Alicia" },
        { userId: "u2", name: "Bob" },
      ]
    );
    assert.deepEqual(renames, []);
  });

  it("plusieurs renames dans un snapshot", () => {
    const renames = detectParticipantRenames(
      [
        { userId: "u1", name: "Alice" },
        { userId: "u2", name: "Bob" },
      ],
      [
        { userId: "u1", name: "Alicia" },
        { userId: "u2", name: "Bobby" },
      ]
    );
    assert.deepEqual(renames, [
      { userId: "u1", oldName: "Alice", newName: "Alicia" },
      { userId: "u2", oldName: "Bob", newName: "Bobby" },
    ]);
  });
});

describe("SYN-15 — scores migrateNumericNameMapMax", () => {
  it("1 — rename distant : max conservé, ancienne clé absente", () => {
    const out = migrateNumericNameMapMax(
      { Alice: 50, Bob: 10 },
      [{ oldName: "Alice", newName: "Alicia" }]
    );
    assert.deepEqual(out, { Alicia: 50, Bob: 10 });
  });

  it("2 — nouveau nom déjà présent : Math.max", () => {
    const out = migrateNumericNameMapMax(
      { Alice: 80, Alicia: 50 },
      [{ oldName: "Alice", newName: "Alicia" }]
    );
    assert.deepEqual(out, { Alicia: 80 });
  });

  it("remote plus haut : max", () => {
    assert.deepEqual(
      migrateNumericNameMapMax(
        { Alice: 50, Alicia: 60 },
        [{ oldName: "Alice", newName: "Alicia" }]
      ),
      { Alicia: 60 }
    );
  });

  it("ancienne clé absente → no-op", () => {
    const map = { Bob: 3 };
    assert.equal(
      migrateNumericNameMapMax(map, [{ oldName: "Alice", newName: "Alicia" }]),
      map
    );
  });

  it("oldName === newName → no-op", () => {
    const map = { Alice: 1 };
    assert.equal(
      migrateNumericNameMapMax(map, [{ oldName: "Alice", newName: "Alice" }]),
      map
    );
  });
});

describe("SYN-15 — playerStats", () => {
  it("3 — fusion compteur par compteur + suppression ancienne clé", () => {
    const out = migratePlayerStatsForRenames(
      {
        Alice: { liesDetected: 3, hotTakeDissentWins: 1 },
        Alicia: { liesDetected: 1, liesFooled: 4 },
        Bob: { liesDetected: 9 },
      },
      [{ oldName: "Alice", newName: "Alicia" }]
    );
    assert.equal(out.Alice, undefined);
    assert.deepEqual(out.Alicia, {
      liesDetected: 3,
      hotTakeDissentWins: 1,
      liesFooled: 4,
    });
    assert.deepEqual(out.Bob, { liesDetected: 9 });
  });
});

describe("SYN-16 — gameScores + baseline", () => {
  it("4 — migration multi-jeux ; autres joueurs/jeux intacts", () => {
    const out = migrateGameScoresForRenames(
      {
        clutch: { Alice: 20, Bob: 5 },
        trivia: { Alice: 7, Carol: 1 },
        hottake: { Bob: 3 },
      },
      [{ oldName: "Alice", newName: "Alicia" }]
    );
    assert.deepEqual(out, {
      clutch: { Alicia: 20, Bob: 5 },
      trivia: { Alicia: 7, Carol: 1 },
      hottake: { Bob: 3 },
    });
  });

  it("4b — collision dans un jeu : Math.max", () => {
    const out = migrateGameScoresForRenames(
      { clutch: { Alice: 80, Alicia: 50 } },
      [{ oldName: "Alice", newName: "Alicia" }]
    );
    assert.deepEqual(out, { clutch: { Alicia: 80 } });
  });

  it("5 — baseline preferOld (contrat I-09)", () => {
    // preferOld : valeur sous Alice (identité qui rename) gagne
    assert.deepEqual(
      migrateNumericNameMapPreferOld(
        { Alice: 40, Alicia: 90 },
        [{ oldName: "Alice", newName: "Alicia" }]
      ),
      { Alicia: 40 }
    );
  });
});

describe("SYN-15/16 — scénarios composés", () => {
  it("6 — renames successifs Alice → Alicia → Alix", () => {
    let scores = { Alice: 50, Bob: 1 };
    scores = migrateNumericNameMapMax(scores, [
      { oldName: "Alice", newName: "Alicia" },
    ]);
    scores = migrateNumericNameMapMax(scores, [
      { oldName: "Alicia", newName: "Alix" },
    ]);
    assert.deepEqual(scores, { Alix: 50, Bob: 1 });
  });

  it("7 — joueur sorti : clé conservée (pas de rename uid)", () => {
    const renames = detectParticipantRenames(
      [
        { userId: "u1", name: "Alice" },
        { userId: "u2", name: "Bob" },
      ],
      [{ userId: "u2", name: "Bob" }]
    );
    assert.deepEqual(renames, []);
    const scores = { Alice: 50, Bob: 10 };
    assert.deepEqual(migrateNumericNameMapMax(scores, renames), scores);
  });

  it("8 — Alice et Alicia uids différents : aucune fusion", () => {
    const renames = detectParticipantRenames(
      [
        { userId: "u1", name: "Alice" },
        { userId: "u2", name: "Bob" },
      ],
      [
        { userId: "u1", name: "Alice" },
        { userId: "u3", name: "Alicia" },
        { userId: "u2", name: "Bob" },
      ]
    );
    assert.deepEqual(renames, []);
    assert.deepEqual(
      migrateNumericNameMapMax({ Alice: 50, Alicia: 50 }, renames),
      { Alice: 50, Alicia: 50 }
    );
  });

  it("9 — roster absent : aucune purge via migrateEvening", () => {
    const maps = {
      scores: { Alice: 50, Ghost: 99 },
      playerStats: { Alice: { liesDetected: 1 } },
      gameScores: { clutch: { Alice: 2 } },
      gameScoreSessionBaseline: { Alice: 1 },
    };
    const out = migrateEveningMapsForRosterRenames(maps, []);
    assert.equal(out.changed, false);
    assert.deepEqual(out.scores, maps.scores);
  });

  it("10 — idempotence : 2× même rename", () => {
    const renames = [{ oldName: "Alice", newName: "Alicia" }];
    const once = migrateEveningMapsForRosterRenames(
      {
        scores: { Alice: 80, Alicia: 50 },
        playerStats: {
          Alice: { liesDetected: 2 },
          Alicia: { liesDetected: 5 },
        },
        gameScores: { clutch: { Alice: 3, Alicia: 1 } },
        gameScoreSessionBaseline: { Alice: 10, Alicia: 99 },
      },
      renames
    );
    assert.equal(once.changed, true);
    const twice = migrateEveningMapsForRosterRenames(once, renames);
    assert.equal(twice.changed, false);
    assert.deepEqual(twice.scores, once.scores);
    assert.deepEqual(twice.playerStats, once.playerStats);
    assert.deepEqual(twice.gameScores, once.gameScores);
    assert.deepEqual(twice.gameScoreSessionBaseline, once.gameScoreSessionBaseline);
  });

  it("11 — multi-renames parallèles sans contamination", () => {
    const out = migrateNumericNameMapMax(
      { Alice: 10, Bob: 20, Carol: 3 },
      [
        { oldName: "Alice", newName: "Alicia" },
        { oldName: "Bob", newName: "Bobby" },
      ]
    );
    assert.deepEqual(out, { Alicia: 10, Bobby: 20, Carol: 3 });
  });

  it("11b — échange théorique Alice↔Bob : snapshot two-phase préserve les valeurs", () => {
    // Impossible sous contrainte SQL unique en un seul UPDATE, mais défendu.
    const out = migrateNumericNameMapMax(
      { Alice: 10, Bob: 20 },
      [
        { oldName: "Alice", newName: "Bob" },
        { oldName: "Bob", newName: "Alice" },
      ]
    );
    assert.deepEqual(out, { Bob: 10, Alice: 20 });
  });
});

describe("SYN-15/16 — replaceEveningScoreMaps + I-09", () => {
  let snapshot;

  beforeEach(() => {
    snapshot = structuredClone(getState());
  });

  afterEach(() => {
    saveStatePatch(snapshot);
  });

  it("replaceEveningScoreMaps supprime bien les anciennes clés (pas de shallow merge)", () => {
    saveStatePatch({
      scores: { Alice: 1, Bob: 2 },
      playerStats: { Alice: { liesDetected: 1 }, Bob: { liesDetected: 2 } },
      gameScores: { clutch: { Alice: 5, Bob: 6 } },
      gameScoreSessionBaseline: { Alice: 0, Bob: 0 },
    });
    replaceEveningScoreMaps({
      scores: { Alicia: 1, Bob: 2 },
      playerStats: { Alicia: { liesDetected: 1 }, Bob: { liesDetected: 2 } },
      gameScores: { clutch: { Alicia: 5, Bob: 6 } },
      gameScoreSessionBaseline: { Alicia: 0, Bob: 0 },
    });
    const s = getState();
    assert.equal(s.scores.Alice, undefined);
    assert.equal(s.playerStats.Alice, undefined);
    assert.equal(s.gameScores.clutch.Alice, undefined);
    assert.equal(s.scores.Alicia, 1);
  });

  it("12 — non-régression I-09 : rename local conserve scores/stats", () => {
    saveStatePatch({
      user: { ...(getState().user || {}), name: "Alice", loggedIn: true, isGuest: true },
      lobby: {
        ...(getState().lobby || {}),
        participants: [
          { name: "Alice", isLocal: true, emoji: "🎭", color: "#A78BFA" },
          { name: "Bob", isLocal: false, emoji: "🎲", color: "#34D399" },
        ],
      },
      scores: { Alice: 42, Bob: 7 },
      playerStats: {
        Alice: { liesDetected: 4, hotTakeDissentWins: 2 },
        Bob: { liesDetected: 1 },
      },
      gameScores: { clutch: { Alice: 15, Bob: 0 } },
      gameScoreSessionBaseline: { Alice: 5, Bob: 0 },
    });
    const res = renameLocalPlayer("Alicia");
    assert.equal(res.ok, true);
    const s = getState();
    assert.equal(s.scores.Alice, undefined);
    assert.equal(s.scores.Alicia, 42);
    assert.equal(s.playerStats.Alice, undefined);
    assert.equal(s.playerStats.Alicia.liesDetected, 4);
    assert.equal(s.gameScores.clutch.Alicia, 15);
  });
});

describe("SYN-15/16 — branchement applyLobbyToState", () => {
  it("supabaseLobby importe detect + migrate et replaceEveningScoreMaps", () => {
    const src = readFileSync(
      join(__dirname, "../js/core/supabaseLobby.js"),
      "utf8"
    );
    assert.match(src, /detectParticipantRenames/);
    assert.match(src, /migrateEveningMapsForRosterRenames/);
    assert.match(src, /replaceEveningScoreMaps/);
    assert.match(
      src,
      /detectParticipantRenames\(\s*prevLobby\?\.participants/
    );
  });
});
