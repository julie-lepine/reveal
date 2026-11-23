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

// ---------------------------------------------------------------------------
// Audit amis et invitations n°1 (décision 2026-11-23) : délai qui s'allonge
// après chaque refus d'une demande d'ami (1 jour, 7 jours, puis jamais).
// ---------------------------------------------------------------------------
describe("Amis n°1 : délai qui s'allonge après un refus", () => {
  const sql = readFileSync(join(ROOT, "supabase/fix-friends-decline-escalation.sql"), "utf8");
  const decline = sql.slice(sql.indexOf("create or replace function public.decline_friend_request"), sql.indexOf("create or replace function public.send_friend_request"));
  const send = sql.slice(sql.indexOf("create or replace function public.send_friend_request"));

  it("compteur de refus ajouté à la table des délais", () => {
    assert.match(sql, /add column if not exists decline_count integer not null default 1;/);
  });

  it("1 jour, puis 7 jours, puis plus jamais", () => {
    assert.match(decline, /when v_count <= 1 then now\(\) \+ interval '1 day'/);
    assert.match(decline, /when v_count = 2 then now\(\) \+ interval '7 days'/);
    assert.match(decline, /else 'infinity'::timestamptz/);
    assert.match(decline, /decline_count = excluded\.decline_count/);
    assert.doesNotMatch(decline, /60 seconds/);
  });

  it("une demande ne purge plus les délais expirés (le compteur reste)", () => {
    assert.doesNotMatch(send, /delete from public\.friend_request_cooldowns where until < now\(\)/);
    assert.match(send, /raise exception 'friends_cooldown';/);
  });

  it("devenir amis remet le compteur à zéro (lignes supprimées dans les deux sens)", () => {
    assert.match(send, /delete from public\.friend_request_cooldowns\s+where \(from_user_id = v_from and to_user_id = p_to\)\s+or \(from_user_id = p_to and to_user_id = v_from\);/);
  });

  it("le délai reste silencieux côté appli (bouton « + Ami », pas de message de refus)", () => {
    const logic = readFileSync(join(ROOT, "js/core/friendsLogic.js"), "utf8");
    assert.match(logic, /return code === FRIEND_RPC_ERROR\.cooldown;/);
  });
});

// ---------------------------------------------------------------------------
// Audit amis et invitations n°2 : « Quitter et rejoindre » vérifie l'invitation
// AVANT de quitter son salon.
// ---------------------------------------------------------------------------
import { lobbyInviteFailMessageAfterCheck } from "../js/core/lobbyInvitesLogic.js";

describe("Invitations n°2 : vérifier avant de quitter son salon", () => {
  it("SQL : lecture seule, mêmes contrôles que l'acceptation, réservée aux comptes connectés", () => {
    const sql = readFileSync(join(ROOT, "supabase/fix-lobby-invite-check-before-leave.sql"), "utf8");
    const body = sql.slice(sql.indexOf("create or replace function public.check_lobby_invite"));
    assert.match(body, /^create or replace function public\.check_lobby_invite\(p_id uuid\)\s+returns jsonb\s+language plpgsql\s+stable/m);
    assert.match(body, /v_uid := public\.friends_require_caller\(\);/);
    assert.match(body, /raise exception 'lobby_invite_gone';/);
    assert.match(body, /raise exception 'lobby_invite_closed';/);
    assert.match(body, /raise exception 'lobby_invite_full';/);
    assert.match(body, /'result', 'already_in'/);
    const fn = body.slice(0, body.indexOf("revoke all"));
    assert.doesNotMatch(fn, /\b(insert|delete|update)\b/i, "ne modifie rien");
    assert.match(sql, /revoke all on function public\.check_lobby_invite\(uuid\) from anon;/);
    assert.match(sql, /grant execute on function public\.check_lobby_invite\(uuid\) to authenticated;/);
  });

  it("appli : la vérification passe avant leaveLobby, et on reste si elle échoue", () => {
    const src = readFileSync(join(ROOT, "js/core/lobbyInviteJoin.js"), "utf8");
    const fn = src.slice(src.indexOf("export async function leaveAndJoinFromLobbyInvite"));
    const check = fn.indexOf("await checkLobbyInvite(inviteId)");
    const leave = fn.indexOf("await leaveLobby(");
    assert.ok(check > 0 && leave > check, "checkLobbyInvite avant leaveLobby");
    assert.match(fn, /stayed: true,/);
  });

  it("fonction serveur absente (avant la migration) → comportement d'avant", () => {
    const src = readFileSync(join(ROOT, "js/core/supabaseLobbyInvites.js"), "utf8");
    assert.match(src, /PGRST202\|42883\|Could not find the function/);
    assert.match(src, /if \(isMissingRpcError\(error\)\) return \{ ok: true, unchecked: true \};/);
  });

  it("message : « Tu restes dans ta soirée. » quand on n'a pas quitté", () => {
    assert.equal(
      lobbyInviteFailMessageAfterCheck("lobby_invite_full", { stayed: true }),
      "Cette soirée est complète. Tu restes dans ta soirée."
    );
    assert.equal(lobbyInviteFailMessageAfterCheck("lobby_invite_full"), "Cette soirée est complète.");
    for (const file of ["js/core/lobbyInviteNotice.js", "js/screens/friends.js"]) {
      const src = readFileSync(join(ROOT, file), "utf8");
      assert.match(src, /lobbyInviteFailMessageAfterCheck\([^)]*stayed: Boolean\(/);
    }
  });
});

// ---------------------------------------------------------------------------
// Audit amis et invitations n°3 à 6 : invitations périmées et droits en trop.
// ---------------------------------------------------------------------------
describe("Amis et invitations n°3 à 6", () => {
  const sql = readFileSync(join(ROOT, "supabase/fix-friends-invites-cleanup.sql"), "utf8");
  const section = (start, end) => sql.slice(sql.indexOf(start), end ? sql.indexOf(end) : undefined);

  it("n°3a : unfriend supprime les invitations entre les deux, dans les deux sens", () => {
    const fn = section("create or replace function public.unfriend", "-- n°3b.");
    assert.match(fn, /delete from public\.friendships/);
    assert.match(fn, /delete from public\.lobby_invites\s+where \(from_user_id = v_uid and to_user_id = p_other\)\s+or \(from_user_id = p_other and to_user_id = v_uid\);/);
  });

  it("n°3b : accept refuse si l'invitant n'est plus dans le salon (modif en place, rejouable)", () => {
    const block = section("-- n°3b.", "-- n°4.");
    assert.match(block, /accept_lobby_invite\(uuid\)'::regprocedure/);
    assert.match(block, /if v_count <> 1 then/);
    assert.match(block, /déjà à jour, rien à faire/);
    assert.match(block, /and m\.user_id = i\.from_user_id/);
    assert.match(block, /raise exception ''lobby_invite_gone'';/);
    assert.match(block, /execute replace\(v_def, v_anchor, v_block \|\| v_anchor\);/);
  });

  it("n°4 : retirer un joueur supprime ses invitations vers ce salon", () => {
    const fn = section("create or replace function public.kick_lobby_member", "-- n°5.");
    const kick = fn.indexOf("delete from public.lobby_members");
    const inv = fn.indexOf("delete from public.lobby_invites");
    assert.ok(kick > 0 && inv > kick);
    assert.match(fn, /where lobby_id = p_lobby_id\s+and to_user_id = p_target_user_id;/);
    assert.match(fn, /Seul l''hôte peut retirer un joueur\./, "garde de l'hôte conservée");
  });

  it("n°5 : la liste ne montre que les invitations encore utilisables (lecture seule)", () => {
    const fn = section("create or replace function public.list_incoming_lobby_invites", "-- n°6.");
    assert.match(fn, /\bstable\b/);
    assert.match(fn, /join public\.lobbies l\s+on l\.id = i\.lobby_id/);
    assert.match(fn, /> now\(\) - interval '24 hours'/);
    assert.match(fn, /and m\.user_id = i\.from_user_id/);
    assert.doesNotMatch(fn, /\bdelete\b/);
  });

  it("n°6 : l'appli garde seulement la lecture sur les 3 tables", () => {
    for (const table of ["friend_requests", "friendships", "lobby_invites"]) {
      assert.match(
        sql,
        new RegExp(String.raw`revoke insert, update, delete, truncate, references, trigger\s+on table public\.${table} from authenticated;`)
      );
    }
    assert.doesNotMatch(sql, /revoke[^;]*select[^;]*from authenticated/i, "la lecture reste (temps réel)");
  });

  it("la vérification d'avant départ suit la même règle que l'acceptation", () => {
    const check = readFileSync(join(ROOT, "supabase/fix-lobby-invite-check-before-leave.sql"), "utf8");
    assert.match(check, /and m\.user_id = i\.from_user_id/);
  });
});
