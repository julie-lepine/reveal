/**
 * Audit Trivia n°1 : un joueur qui quitte le salon en pleine question bloquait la
 * révélation automatique (liste des joueurs attendus figée au début de la question).
 * Désormais seuls les joueurs encore membres du salon sont attendus, côté serveur
 * (trivia_all_expected_players_answered) et côté hôte (révélation lancée au départ).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  triviaAllPresentPlayersAnswered,
  triviaFastestPlayerLabel,
  triviaHasDepartedExpectedPlayer,
} from "../js/core/triviaPresentPlayers.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const remoteTrivia = {
  phase: "question",
  questionPlayerUids: ["uid-alice", "uid-bob", "uid-chloe"],
  answers: {
    "uid-alice": { answerIndex: 1, answeredAt: 10 },
    "uid-chloe": { answerIndex: 2, answeredAt: 12 },
  },
};

describe("Trivia : joueur parti du salon en pleine question", () => {
  it("Bob a quitté le salon, Alice et Chloé ont répondu → révélation possible", () => {
    const members = ["uid-alice", "uid-chloe"];
    assert.equal(triviaHasDepartedExpectedPlayer({ remoteTrivia, memberUserIds: members }), true);
    assert.equal(triviaAllPresentPlayersAnswered({ remoteTrivia, memberUserIds: members }), true);
  });

  it("Bob est toujours membre (simple coupure réseau) → toujours attendu", () => {
    const members = ["uid-alice", "uid-bob", "uid-chloe"];
    assert.equal(triviaHasDepartedExpectedPlayer({ remoteTrivia, memberUserIds: members }), false);
    assert.equal(triviaAllPresentPlayersAnswered({ remoteTrivia, memberUserIds: members }), false);
  });

  it("un joueur présent n'a pas encore répondu → on attend", () => {
    const members = ["uid-alice", "uid-chloe"];
    const partial = { ...remoteTrivia, answers: { "uid-alice": { answerIndex: 1 } } };
    assert.equal(triviaAllPresentPlayersAnswered({ remoteTrivia: partial, memberUserIds: members }), false);
  });

  it("liste des membres inconnue ou vide → rien n'est conclu", () => {
    assert.equal(triviaAllPresentPlayersAnswered({ remoteTrivia, memberUserIds: [] }), false);
    assert.equal(triviaHasDepartedExpectedPlayer({ remoteTrivia, memberUserIds: [] }), false);
  });

  it("plus aucun joueur attendu présent → pas de révélation automatique", () => {
    assert.equal(
      triviaAllPresentPlayersAnswered({ remoteTrivia, memberUserIds: ["uid-nouveau"] }),
      false
    );
  });

  it("hors phase question → rien", () => {
    assert.equal(
      triviaAllPresentPlayersAnswered({
        remoteTrivia: { ...remoteTrivia, phase: "reveal" },
        memberUserIds: ["uid-alice", "uid-chloe"],
      }),
      false
    );
  });

  it("SQL : seuls les joueurs attendus encore membres du salon comptent", () => {
    const sql = readFileSync(join(ROOT, "supabase/fix-trivia-departed-players.sql"), "utf8");
    assert.match(sql, /create or replace function public\.trivia_all_expected_players_answered/);
    assert.match(sql, /from public\.lobby_members lm/);
    assert.match(sql, /return v_present > 0;/);
  });

  it("écran : l'hôte lance la révélation au départ d'un joueur, sans alerte", () => {
    const src = readFileSync(join(ROOT, "js/games/trivia.js"), "utf8");
    assert.match(src, /onLobbyBundleUpdated\(/);
    assert.match(src, /function maybeRevealAfterDeparture\(\)/);
    assert.match(src, /if \(!mp \|\| !canActAsHost\(\)\) return;/);
    assert.match(src, /goToReveal\(\{ silent: true \}\)/);
    assert.match(src, /unsubLobby\(\);/);
  });
});

describe("Trivia n°2 : heure de réponse notée par le serveur", () => {
  it("la migration remplace l'heure du téléphone par clock_timestamp(), une seule fois", () => {
    const sql = readFileSync(join(ROOT, "supabase/fix-trivia-server-answer-time.sql"), "utf8");
    assert.match(sql, /submit_trivia_answer\(uuid,uuid,integer,integer,bigint\)/);
    assert.match(sql, /v_old text := '''answeredAt'', p_answered_at';/);
    assert.match(sql, /floor\(extract\(epoch from clock_timestamp\(\)\) \* 1000\)::bigint/);
    assert.match(sql, /if v_count <> 1 then/);
    assert.match(sql, /déjà à jour, rien à faire/);
  });
});

describe("Trivia n°3 : bonus vitesse d'un joueur parti", () => {
  it("joueur connu → son pseudo", () => {
    assert.equal(triviaFastestPlayerLabel("Alice", ["Alice", "Bob"]), "Alice");
  });
  it("joueur parti (identifiant technique) → « un joueur parti »", () => {
    assert.equal(
      triviaFastestPlayerLabel("3f2a9c1e-0000-4000-8000-000000000000", ["Alice", "Bob"]),
      "un joueur parti"
    );
  });
  it("personne → null (message « Personne n'a trouvé… »)", () => {
    assert.equal(triviaFastestPlayerLabel(null, ["Alice"]), null);
    assert.equal(triviaFastestPlayerLabel("", ["Alice"]), null);
  });
  it("l'écran n'affiche plus l'identifiant brut", () => {
    const src = readFileSync(join(ROOT, "js/games/trivia.js"), "utf8");
    assert.match(src, /Bonus vitesse : \$\{escapeHtml\(fastestLabel\)\}/);
    assert.doesNotMatch(src, /Bonus vitesse : \$\{escapeHtml\(lastRound\.fastestPlayer\)\}/);
  });
});
