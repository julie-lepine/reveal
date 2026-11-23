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

// ---------------------------------------------------------------------------
// Audit petits jeux à votes n°1 : le dernier joueur qui n'a pas voté quitte le
// salon → l'hôte relance la suite (Dilemma, Speed Vote, Hot Take, Wrong Answer,
// Truth Meter).
// ---------------------------------------------------------------------------
import {
  currentLobbyMemberUids,
  hasLobbyDeparture,
  watchLobbyDepartures,
} from "../js/core/lobbyDepartureWatch.js";

describe("Petits jeux à votes : départ d'un joueur", () => {
  const alice = { name: "Alice", userId: "uid-alice" };
  const bob = { name: "Bob", userId: "uid-bob" };
  const chloe = { name: "Chloé", userId: "uid-chloe" };

  function fakeLobby(initial) {
    let participants = initial;
    let listener = null;
    return {
      deps: {
        getParticipants: () => participants,
        subscribe: (fn) => {
          listener = fn;
          return () => {
            listener = null;
          };
        },
      },
      update(next) {
        participants = next;
        listener?.();
      },
      get subscribed() {
        return listener != null;
      },
    };
  }

  it("membres : UID seulement, sans vides", () => {
    assert.deepEqual([...currentLobbyMemberUids([alice, { name: "x" }, bob])], ["uid-alice", "uid-bob"]);
  });

  it("départ détecté seulement si un membre disparaît", () => {
    const before = new Set(["uid-alice", "uid-bob"]);
    assert.equal(hasLobbyDeparture(before, new Set(["uid-alice"])), true);
    assert.equal(hasLobbyDeparture(before, new Set(["uid-alice", "uid-bob", "uid-chloe"])), false);
    assert.equal(hasLobbyDeparture(before, new Set()), false, "salon vide = pas chargé, on ne conclut rien");
  });

  it("le rappel ne part qu'au départ, pas aux autres mises à jour du salon", () => {
    const lobby = fakeLobby([alice, bob, chloe]);
    let calls = 0;
    const unsub = watchLobbyDepartures(() => {
      calls += 1;
    }, lobby.deps);
    lobby.update([alice, bob, chloe]); // présence, message…
    assert.equal(calls, 0);
    lobby.update([alice, chloe]); // Bob part
    assert.equal(calls, 1);
    lobby.update([alice, chloe]);
    assert.equal(calls, 1);
    lobby.update([]); // salon pas encore rechargé : rien
    lobby.update([alice]); // Chloé part (comparé à la dernière liste connue)
    assert.equal(calls, 2);
    unsub();
    assert.equal(lobby.subscribed, false);
  });

  it("une erreur dans le rappel ne casse pas l'écoute", () => {
    const lobby = fakeLobby([alice, bob]);
    const unsub = watchLobbyDepartures(() => {
      throw new Error("boom");
    }, lobby.deps);
    assert.doesNotThrow(() => lobby.update([alice]));
    unsub();
  });

  const games = [
    ["dilemma", /allDilemmaVotesIn\(\)/, /void goToReveal\(\)/],
    ["speedVote", /allSpeedVoteVotesIn\(\)/, /void goToReveal\(\)\.catch/],
    ["hotTake", /allHotTakeVotesIn\(\)/, /void goToReveal\(\)/],
    ["wrongAnswer", /allWrongAnswerVotesIn\(\) && !roundScored/, /void transitionToReveal\(\)\.catch/],
    ["truthMeter", /allVotesReadyForReveal\(\)/, /await goToRevealPending\(\);\s*\}\)\(\)\.catch/],
  ];
  for (const [game, allInRe, revealRe] of games) {
    it(`${game} : l'hôte relance la suite au départ d'un joueur`, () => {
      const src = readFileSync(join(ROOT, `js/games/${game}.js`), "utf8");
      assert.match(src, /import \{ watchLobbyDepartures \} from "\.\.\/core\/lobbyDepartureWatch\.js";/);
      const start = src.indexOf("const unsubDeparture = mp");
      assert.ok(start > 0, "abonnement présent, multijoueur seulement");
      const block = src.slice(start, start + 1200);
      assert.match(block, /canActAsHost\(\)/);
      assert.match(block, allInRe);
      assert.match(block, revealRe);
      assert.match(src, /unsubDeparture\(\);/);
    });
  }

  it("wrongAnswer : la phase réponses est aussi relancée", () => {
    const src = readFileSync(join(ROOT, "js/games/wrongAnswer.js"), "utf8");
    const block = src.slice(src.indexOf("const unsubDeparture = mp"));
    assert.match(block, /phase === "answer" && allWrongAnswersIn\(\)/);
    assert.match(block, /void transitionToVoting\(\)\.catch/);
  });
});

// ---------------------------------------------------------------------------
// Audit petits jeux à votes n°2 : verdict (ou passage au vote) raté chez l'hôte
// → message sous le bouton, plus d'erreur perdue (Speed Vote, Wrong Answer).
// ---------------------------------------------------------------------------
describe("Petits jeux à votes : verdict raté, message à l'hôte", () => {
  it("les messages existent", async () => {
    const labels = await import("../js/core/postGameFinish.js");
    assert.equal(labels.REVEAL_FAILED_LABEL, "Le verdict n’est pas parti, réessaie !");
    assert.equal(labels.VOTE_START_FAILED_LABEL, "Le vote n’est pas parti, réessaie !");
  });

  it("Speed Vote : erreur attrapée, points remis, message sous « Révéler maintenant »", () => {
    const src = readFileSync(join(ROOT, "js/games/speedVote.js"), "utf8");
    const fn = src.slice(src.indexOf("async function transitionToReveal()"), src.indexOf("async function goToReveal()"));
    assert.doesNotMatch(fn, /throw err;/);
    assert.match(fn, /restoreEveningScores\(eveningBefore\);/);
    assert.match(fn, /revealFailed = true;/);
    assert.match(fn, /revealFailed = false;/);
    assert.match(src, /revealFailed \? `<p class="hint">\$\{escapeHtml\(REVEAL_FAILED_LABEL\)\}<\/p>`/);
    assert.match(src, /if \(roundIdx !== prevRound \|\| phase !== "voting"\) revealFailed = false;/);
  });

  it("Wrong Answer : passage au vote et verdict ratés → message, sans redessiner la saisie", () => {
    const src = readFileSync(join(ROOT, "js/games/wrongAnswer.js"), "utf8");
    const toVoting = src.slice(src.indexOf("async function transitionToVoting()"), src.indexOf("async function transitionToReveal()"));
    assert.match(toVoting, /catch \(err\)/);
    assert.match(toVoting, /voteStartFailed = true;/);
    assert.match(toVoting, /showHostFailedHint\(\);/);
    const toReveal = src.slice(src.indexOf("async function transitionToReveal()"), src.indexOf("// --- Rendu des phases ---"));
    assert.doesNotMatch(toReveal, /throw err;/);
    assert.match(toReveal, /restoreEveningScores\(eveningBefore\);/);
    assert.match(toReveal, /revealFailed = true;/);
    assert.match(src, /id="wrong-answer-host-failed"/);
    assert.match(src, /id="wrong-vote-host-failed"/);
    const hint = src.slice(src.indexOf("function showHostFailedHint()"), src.indexOf("function revealHtml()"));
    assert.doesNotMatch(hint, /render\(/, "pas de redessin (clavier iOS)");
  });
});

// ---------------------------------------------------------------------------
// Audit petits jeux à votes n°3 : Truth Meter, révélation ratée pendant
// « Calcul du TruthMeter… » → message + « Réessayer », plus de boucle d'alertes.
// ---------------------------------------------------------------------------
describe("Truth Meter : révélation ratée sans boucle d'alertes", () => {
  const src = readFileSync(join(ROOT, "js/games/truthMeter.js"), "utf8");

  it("plus de fenêtre d'alerte sur l'échec de la révélation", () => {
    const fn = src.slice(src.indexOf("async function transitionToReveal()"), src.indexOf("async function goToReveal()"));
    assert.doesNotMatch(fn, /showAppAlert/);
    assert.match(fn, /revealFailedMessage = mapped\?\.message \|\| REVEAL_FAILED_LABEL;/);
    assert.match(fn, /revealFailedMessage = null;/);
  });

  it("pas de nouvel essai automatique après un échec", () => {
    const fn = src.slice(src.indexOf("function scheduleRevealFromPending()"), src.indexOf("function playerMeta("));
    assert.match(fn, /if \(revealFailedMessage\) return;/);
  });

  it("message + bouton « Réessayer » pour l'hôte, remis à zéro au changement d'étape", () => {
    assert.match(src, /const showRetry = mp && canActAsHost\(\) && revealFailedMessage;/);
    assert.match(src, /id="truth-reveal-retry">Réessayer<\/button>/);
    assert.match(src, /#truth-reveal-retry"\)\?\.addEventListener\("click"/);
    assert.match(src, /if \(phase !== prevPhase \|\| roundIdx !== prevRound\) revealFailedMessage = null;/);
  });
});

// ---------------------------------------------------------------------------
// Audit petits jeux à votes n°4 (Wrong Answer : qui n'a rien à choisir n'est pas
// attendu) et n°5 (Speed Vote : compteur des seuls joueurs présents).
// ---------------------------------------------------------------------------
import { wrongAnswerExpectedVoterNames } from "../js/core/wrongAnswerSession.js";
import { wrongAnswerVoteStatusText } from "../js/core/wrongAnswerUiRefresh.js";

describe("Wrong Answer n°4 : une seule réponse", () => {
  const names = ["Alice", "Bob", "Chloé"];

  it("seule Alice a répondu → Bob et Chloé votent, Alice n'est pas attendue", () => {
    const session = { answers: { Alice: { text: "Girafe" } } };
    assert.deepEqual(wrongAnswerExpectedVoterNames(session, names), ["Bob", "Chloé"]);
  });

  it("deux réponses → tout le monde a quelqu'un pour qui voter", () => {
    const session = { answers: { Alice: { text: "Girafe" }, Bob: { text: "Bleu" } } };
    assert.deepEqual(wrongAnswerExpectedVoterNames(session, names), names);
  });

  it("réponse d'un joueur parti : toujours votable par les autres", () => {
    const session = { answers: { Damien: { text: "Lundi" } } };
    assert.deepEqual(wrongAnswerExpectedVoterNames(session, names), names);
  });

  it("aucune réponse → personne d'attendu (pas de verdict automatique)", () => {
    assert.deepEqual(wrongAnswerExpectedVoterNames({ answers: {} }, names), []);
  });

  it("message pour l'auteur de la seule réponse", () => {
    assert.equal(
      wrongAnswerVoteStatusText({ voted: false, allIn: false, votedCount: 0, total: 2, noChoice: true }),
      "Aucune autre réponse à choisir : attends le verdict."
    );
    assert.equal(
      wrongAnswerVoteStatusText({ voted: false, allIn: false, votedCount: 0, total: 2 }),
      "Vote pour la PIRE réponse (tu ne peux pas voter pour la tienne)."
    );
  });

  it("« tout le monde a voté » et les compteurs utilisent les votants attendus", () => {
    const session = readFileSync(join(ROOT, "js/core/wrongAnswerSession.js"), "utf8");
    const fn = session.slice(session.indexOf("export function allWrongAnswerVotesIn("));
    assert.match(fn, /const expected = wrongAnswerExpectedVoterNames\(session\);/);
    const game = readFileSync(join(ROOT, "js/games/wrongAnswer.js"), "utf8");
    assert.equal((game.match(/const expectedVoters = wrongAnswerExpectedVoterNames\(getWrongAnswerSession\(\)\);/g) || []).length, 2);
  });
});

describe("Speed Vote n°5 : compteur « Révéler maintenant »", () => {
  it("ne compte que les joueurs présents", () => {
    const src = readFileSync(join(ROOT, "js/games/speedVote.js"), "utf8");
    assert.doesNotMatch(src, /Object\.keys\(votes\)\.length/);
    assert.equal((src.match(/const votedCount = countSpeedVoteVotersIn\(\);/g) || []).length, 2);
    const session = readFileSync(join(ROOT, "js/core/speedVoteSession.js"), "utf8");
    assert.match(session, /export function countSpeedVoteVotersIn\(/);
  });
});

// ---------------------------------------------------------------------------
// Audit petits jeux à votes n°6 (décision 2026-11-23) : Speed Vote, un joueur
// parti garde les votes qu'il a donnés, mais n'est pas déclaré gagnant.
// ---------------------------------------------------------------------------
import { countSpeedVoteResults } from "../js/core/speedVoteSession.js";
import { awardSpeedVoteRound } from "../js/core/scoring.js";

describe("Speed Vote n°6 : joueur parti jamais gagnant", () => {
  // Damien est parti : il avait voté pour Alice, et reçu 2 votes.
  const votes = { Alice: "Damien", Bob: "Damien", Chloé: "Bob", Damien: "Alice" };
  const present = ["Alice", "Bob", "Chloé"];

  it("ses votes reçus restent affichés, mais le gagnant est un joueur présent", () => {
    const r = countSpeedVoteResults(votes, { eligibleWinners: present });
    assert.equal(r.counts.Damien, 2, "toujours visible dans les barres");
    assert.deepEqual(r.leaders.sort(), ["Alice", "Bob"], "1 vote chacun : égalité entre présents");
  });

  it("son vote donné compte pour les autres", () => {
    const r = countSpeedVoteResults({ Alice: "Bob", Damien: "Chloé", Bob: "Chloé" }, { eligibleWinners: present });
    assert.deepEqual(r.leaders, ["Chloé"]);
    assert.equal(r.counts.Chloé, 2);
  });

  it("tous les votes pour lui → personne ne gagne", () => {
    const r = countSpeedVoteResults({ Alice: "Damien", Bob: "Damien" }, { eligibleWinners: present });
    assert.deepEqual(r.leaders, []);
  });

  it("sans liste (solo, anciens appels) → comme avant", () => {
    assert.deepEqual(countSpeedVoteResults(votes).leaders, ["Damien"]);
  });

  it("points : seuls les gagnants présents reçoivent des points", () => {
    const award = awardSpeedVoteRound(votes, { multiplier: 2, eligibleWinners: present });
    assert.deepEqual(award.winners.sort(), ["Alice", "Bob"]);
    assert.equal(award.deltas.Damien, undefined);
    assert.equal(award.counts.Damien, 2);
  });

  it("l'écran passe la liste des présents aux deux calculs", () => {
    const src = readFileSync(join(ROOT, "js/games/speedVote.js"), "utf8");
    assert.match(src, /function eligibleWinnerNames\(\)/);
    assert.match(src, /awardSpeedVoteRound\(votes, \{\s*multiplier: mod\.multiplier,\s*eligibleWinners: eligibleWinnerNames\(\),/);
    assert.equal((src.match(/countSpeedVoteResults\(votes, \{\s*eligibleWinners: eligibleWinnerNames\(\)/g) || []).length, 2);
    assert.match(src, /const leaders = lastAward\?\.winners \|\| liveLeaders;/);
  });
});
