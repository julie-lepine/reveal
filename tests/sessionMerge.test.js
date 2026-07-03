import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  mergeReadyMapsLocal,
  mergeAuthorOwnedCustomList,
  mergeDilemmaCustomDilemmas,
  mergeHotTakeCustomTakes,
  mergeDilemmaPatchState,
  mergeHotTakePatchState,
  mergeCustomGameDeck,
  mergeRemoteCustomGameDeck,
  mergeForwardGamePhase,
  mergeHotTakePhase,
  mergeDilemmaPhase,
  mergeSpeedVotePhase,
  isNewHotTakeVoteRound,
  isNewDilemmaVoteRound,
  isNewSpeedVoteVoteRound,
  isVotesOnlyGamePatch,
  isAnswersOnlyGamePatch,
  mergeConsensusPatchState,
  mergeConsensusPhase,
  isNewConsensusQuestionRound,
  mergeTriviaPatchState,
  mergeTruthMeterPatchState,
  mergeSpeedVotePatchState,
  mergeTraitrePatchState,
  mergeTraitrePhase,
  mergeTruthMeterPhase,
  isNewTraitreVoteRound,
  isNewTraitreGame,
  isStaleTraitreVotePatch,
  isTraitreVoteResetAfterTie,
  pickLatestTriviaAnswer,
  mergeTriviaAnswersUid,
  normalizeTriviaAnswersMap,
  normalizeDilemmaEntry,
  normalizeHotTakeEntry,
  normalizeKeyedVotes,
  mergeGuessLieSubmissions,
  isGuessLieLobbyReset,
  shouldApplyGuessLieLobbyReset,
  mergeGuessLieLobbyComplete,
  isGuessLieInPrep,
  isValidGuessLieSubmission,
  normalizePlayerKeyedMap,
} from "../js/core/sessionMerge.js";

describe("mergeReadyMapsLocal", () => {
  it("unionne prêt local et remote pour les joueurs actifs", () => {
    const out = mergeReadyMapsLocal({ Alice: true }, { Bob: true }, ["Alice", "Bob"]);
    assert.equal(out.Alice, true);
    assert.equal(out.Bob, true);
  });

  it("ne marque pas prêt un joueur absent des deux maps", () => {
    const out = mergeReadyMapsLocal({}, { Bob: true }, ["Alice", "Bob"]);
    assert.equal(out.Alice, false);
    assert.equal(out.Bob, true);
  });

  it("suit le remote « pas prêt » pour les autres joueurs", () => {
    const out = mergeReadyMapsLocal({ Bob: true }, { Bob: false }, ["Alice", "Bob"]);
    assert.equal(out.Bob, false);
  });

  it("conserve « pas prêt » pour le joueur local même si le serveur est encore prêt", () => {
    const out = mergeReadyMapsLocal(
      { Alice: false },
      { Alice: true, Bob: true },
      ["Alice", "Bob"],
      "Alice"
    );
    assert.equal(out.Alice, false);
    assert.equal(out.Bob, true);
  });

  it("applique le prêt local pour le joueur local", () => {
    const out = mergeReadyMapsLocal(
      { Alice: true },
      { Alice: false },
      ["Alice"],
      "Alice"
    );
    assert.equal(out.Alice, true);
  });
});

describe("mergeDilemmaCustomDilemmas", () => {
  const me = "Alice";
  const other = "Bob";

  it("conserve les dilemmes des autres depuis remote", () => {
    const local = [];
    const remote = [{ id: "d1", optionA: "A", optionB: "B", author: other }];
    const out = mergeDilemmaCustomDilemmas(local, remote, me);
    assert.equal(out.length, 1);
    assert.equal(out[0].id, "d1");
  });

  it("n réinjecte pas une suppression locale depuis remote", () => {
    const local = [];
    const remote = [{ id: "d1", optionA: "A", optionB: "B", author: me }];
    const out = mergeDilemmaCustomDilemmas(local, remote, me);
    assert.equal(out.length, 0);
  });

  it("garde les dilemmes locaux du joueur", () => {
    const local = [{ id: "d2", optionA: "X", optionB: "Y", author: me }];
    const remote = [{ id: "d2", optionA: "old", optionB: "old", author: me }];
    const out = mergeDilemmaCustomDilemmas(local, remote, me);
    assert.equal(out.length, 1);
    assert.equal(out[0].optionA, "X");
  });

  it("ajoute une entrée locale (remote vide)", () => {
    const entry = { id: "d-new", optionA: "A", optionB: "B", author: me };
    const out = mergeDilemmaCustomDilemmas([entry], [], me);
    assert.equal(out.length, 1);
    assert.equal(out[0].id, "d-new");
  });
});

describe("mergeHotTakeCustomTakes", () => {
  it("supprime une take locale absente de la liste locale", () => {
    const me = "Alice";
    const out = mergeHotTakeCustomTakes(
      [],
      [{ id: "t1", text: "hello", author: me }],
      me
    );
    assert.equal(out.length, 0);
  });

  it("ajoute une take via la liste locale uniquement", () => {
    const me = "Alice";
    const out = mergeHotTakeCustomTakes(
      [{ id: "t1", text: "nouveau", author: me }],
      [],
      me
    );
    assert.equal(out.length, 1);
    assert.equal(out[0].text, "nouveau");
  });
});

describe("mergeDilemmaPatchState", () => {
  const mergeReadyUid = (a, b) => ({ ...a?.ready, ...b?.ready });
  const mergeVotes = (a, b) => b?.votes || a?.votes || {};

  it("patch client sans dilemme supprime celui du serveur", () => {
    const cur = {
      customDilemmas: [{ id: "d1", optionA: "A", optionB: "B", author: "Alice" }],
      ready: {},
      votes: {},
    };
    const inc = { customDilemmas: [], ready: {}, votes: {} };
    const out = mergeDilemmaPatchState(cur, inc, "Alice", { mergeReadyUid, mergeVotes });
    assert.equal(out.customDilemmas.length, 0);
  });
});

describe("mergeHotTakePatchState", () => {
  const mergeReadyUid = (a, b) => ({ ...a?.ready, ...b?.ready });
  const mergeVotes = (a, b) => ({ ...(a?.votes || {}), ...(b?.votes || {}) });

  it("patch sans take locale efface la take du joueur sur le serveur", () => {
    const cur = {
      customTakes: [{ id: "t1", text: "hot", author: "Alice" }],
      ready: {},
      votes: {},
    };
    const inc = { customTakes: [], ready: {}, votes: {} };
    const out = mergeHotTakePatchState(cur, inc, "Alice", { mergeReadyUid, mergeVotes });
    assert.equal(out.customTakes.length, 0);
  });

  it("patch votes-only ne régresse pas reveal → voting", () => {
    const cur = {
      phase: "reveal",
      takeIdx: 2,
      takeScored: true,
      votes: { u1: "Valide", u2: "Criminel" },
    };
    const inc = { votes: { u3: "Acceptable" } };
    assert.equal(isVotesOnlyGamePatch(inc), true);
    const out = mergeHotTakePatchState(cur, inc, "Bob", { mergeReadyUid, mergeVotes });
    assert.equal(out.phase, "reveal");
    assert.equal(out.takeScored, true);
    assert.equal(out.takeIdx, 2);
    assert.equal(out.votes.u3, "Acceptable");
  });

  it("patch complet ne régresse pas reveal → voting (vote tardif)", () => {
    const cur = { phase: "reveal", takeScored: true, votes: {} };
    const inc = { phase: "voting", takeScored: false, votes: { u1: "Valide" } };
    const out = mergeHotTakePatchState(cur, inc, "Alice", { mergeReadyUid, mergeVotes });
    assert.equal(out.phase, "reveal");
    assert.equal(out.votes.u1, "Valide");
  });

  it("autorise reveal → voting sur nouvelle take (votes vidés)", () => {
    const cur = {
      phase: "reveal",
      takeIdx: 0,
      takeScored: true,
      votes: { u1: "Valide", u2: "Criminel" },
    };
    const inc = {
      phase: "voting",
      takeIdx: 1,
      takeScored: false,
      votes: {},
      voteEndsAt: "2026-06-07T12:00:00.000Z",
    };
    const out = mergeHotTakePatchState(cur, inc, "Alice", {
      mergeReadyUid,
      mergeVotes: () => ({}),
    });
    assert.equal(out.phase, "voting");
    assert.equal(out.takeIdx, 1);
    assert.equal(out.takeScored, false);
  });
});

describe("mergeForwardGamePhase", () => {
  it("bloque reveal → voting (même manche)", () => {
    assert.equal(mergeForwardGamePhase("reveal", "voting"), "reveal");
  });

  it("accepte voting → reveal", () => {
    assert.equal(mergeForwardGamePhase("voting", "reveal"), "reveal");
  });
});

describe("mergeHotTakePhase", () => {
  it("autorise reveal → voting quand takeIdx avance", () => {
    const cur = { phase: "reveal", takeIdx: 2, votes: { u1: "Valide" } };
    const inc = { phase: "voting", takeIdx: 3, votes: {}, voteEndsAt: "t2" };
    assert.equal(mergeHotTakePhase(cur, inc), "voting");
    assert.equal(isNewHotTakeVoteRound(cur, inc), true);
  });
});

describe("mergeDilemmaPhase", () => {
  it("autorise reveal → voting quand roundIdx avance", () => {
    const cur = { phase: "reveal", roundIdx: 1, votes: { u1: "A" } };
    const inc = { phase: "voting", roundIdx: 2, votes: {}, voteEndsAt: "t2" };
    assert.equal(mergeDilemmaPhase(cur, inc), "voting");
    assert.equal(isNewDilemmaVoteRound(cur, inc), true);
  });
});

describe("mergeSpeedVotePhase", () => {
  it("autorise reveal → voting quand roundIdx avance", () => {
    const cur = { phase: "reveal", roundIdx: 0, votes: { u1: "Alice" } };
    const inc = { phase: "voting", roundIdx: 1, votes: {}, voteEndsAt: "t2" };
    assert.equal(mergeSpeedVotePhase(cur, inc), "voting");
    assert.equal(isNewSpeedVoteVoteRound(cur, inc), true);
  });
});

describe("mergeDilemmaPatchState reveal guard", () => {
  const mergeReadyUid = (a, b) => ({ ...a?.ready, ...b?.ready });
  const mergeVotes = (a, b) => ({ ...(a?.votes || {}), ...(b?.votes || {}) });

  it("patch votes-only conserve reveal", () => {
    const cur = { phase: "reveal", roundScored: true, votes: { u1: "A" } };
    const inc = { votes: { u2: "B" } };
    const out = mergeDilemmaPatchState(cur, inc, "Bob", { mergeReadyUid, mergeVotes });
    assert.equal(out.phase, "reveal");
    assert.equal(out.roundScored, true);
    assert.equal(out.votes.u2, "B");
  });
});

describe("mergeConsensusPatchState", () => {
  const mergeReadyUid = (a, b) => ({ ...a?.ready, ...b?.ready });
  const mergeAnswers = (a, b) => ({ ...(a?.answers || {}), ...(b?.answers || {}) });

  it("patch answers-only ne régresse pas reveal-pending", () => {
    const cur = {
      phase: "reveal-pending",
      questionIdx: 1,
      roundScored: false,
      answers: { u1: { value: 40, submittedAt: 1, timestamp: 1 } },
    };
    const inc = {
      answers: { u2: { value: 70, submittedAt: 2, timestamp: 2 } },
    };
    assert.equal(isAnswersOnlyGamePatch(inc), true);
    const out = mergeConsensusPatchState(cur, inc, {
      mergeReadyUid,
      mergeAnswers,
      newQuestionRound: false,
    });
    assert.equal(out.phase, "reveal-pending");
    assert.equal(out.questionIdx, 1);
    assert.equal(out.answers.u2.value, 70);
  });

  it("patch complet ne régresse pas reveal-pending → question", () => {
    const cur = { phase: "reveal-pending", questionIdx: 2, answers: {} };
    const inc = { phase: "question", questionIdx: 2, answers: { u1: { value: 50, submittedAt: 1 } } };
    const out = mergeConsensusPatchState(cur, inc, {
      mergeReadyUid,
      mergeAnswers,
      newQuestionRound: false,
    });
    assert.equal(out.phase, "reveal-pending");
  });
});

describe("mergeConsensusPhase", () => {
  it("accepte question → reveal-pending", () => {
    assert.equal(mergeConsensusPhase("question", "reveal-pending"), "reveal-pending");
  });

  it("bloque reveal-pending → question", () => {
    assert.equal(mergeConsensusPhase("reveal-pending", "question"), "reveal-pending");
  });

  it("repasse final → null sur retour prep", () => {
    assert.equal(mergeConsensusPhase("final", null, { newGame: true }), null);
  });
});

describe("isNewConsensusQuestionRound", () => {
  it("détecte l'avancement de questionIdx avec réponses vidées", () => {
    const cur = {
      phase: "reveal",
      questionIdx: 0,
      answers: { Alice: { value: 80, submittedAt: 1 } },
    };
    const inc = { phase: "question", questionIdx: 1, answers: {} };
    assert.equal(isNewConsensusQuestionRound(cur, inc), true);
  });

  it("détecte prep → Q0 quand le local garde des réponses obsolètes", () => {
    const cur = {
      phase: null,
      questionIdx: undefined,
      answers: { Alice: { value: 20, submittedAt: 1 } },
    };
    const inc = { phase: "question", questionIdx: 0, answers: {} };
    assert.equal(isNewConsensusQuestionRound(cur, inc), true);
  });

  it("ne confond pas une manche en cours avec une nouvelle manche", () => {
    const cur = {
      phase: "question",
      questionIdx: 1,
      answers: { Alice: { value: 55, submittedAt: 1 } },
    };
    const inc = { phase: "question", questionIdx: 1, answers: { u2: { value: 60, submittedAt: 2 } } };
    assert.equal(isNewConsensusQuestionRound(cur, inc), false);
  });
});

describe("mergeTriviaPatchState answers-only", () => {
  const mergeReadyUid = (a, b) => ({ ...a?.ready, ...b?.ready });
  const mergeAnswers = (a, b) => mergeTriviaAnswersUid(a?.answers || {}, b?.answers || {});

  it("conserve phase reveal lors d'un patch réponse invité", () => {
    const cur = { phase: "reveal", questionIdx: 0, answers: {} };
    const inc = { answers: { u1: { answerIndex: 2, answeredAt: 1 } } };
    const out = mergeTriviaPatchState(cur, inc, {
      mergeReadyUid,
      mergeAnswers,
      newQuestionRound: false,
    });
    assert.equal(out.phase, "reveal");
    assert.equal(out.answers.u1.answerIndex, 2);
  });
});

describe("normalizeTriviaAnswersMap", () => {
  const players = ["Admin", "Alex", "sarah"];
  const uidToName = {
    "uid-admin": "Admin",
    "uid-alex": "Alex",
    "uid-sarah": "sarah",
  };

  it("résout les uid vers les pseudos actifs", () => {
    const answers = {
      "uid-admin": { answerIndex: 1, answeredAt: 100 },
      "uid-alex": { answerIndex: 2, answeredAt: 200 },
    };
    const out = normalizeTriviaAnswersMap(answers, players, (key) => uidToName[key] || null);
    assert.equal(out.Admin.answerIndex, 1);
    assert.equal(out.Alex.answerIndex, 2);
    assert.equal(out.sarah, undefined);
  });

  it("fusionne pseudo et uid pour le même joueur en gardant la plus récente", () => {
    const answers = {
      Admin: { answerIndex: 0, answeredAt: 50 },
      "uid-admin": { answerIndex: 3, answeredAt: 150 },
    };
    const out = normalizeTriviaAnswersMap(answers, players, (key) => uidToName[key] || key);
    assert.equal(out.Admin.answerIndex, 3);
    assert.equal(out.Admin.answeredAt, 150);
  });

  it("ignore les clés non résolues ou joueurs inactifs", () => {
    const answers = {
      "uid-unknown": { answerIndex: 1, answeredAt: 10 },
      Ghost: { answerIndex: 2, answeredAt: 20 },
    };
    const out = normalizeTriviaAnswersMap(answers, players, (key) => uidToName[key] || key);
    assert.deepEqual(out, {});
  });
});

describe("pickLatestTriviaAnswer", () => {
  it("garde la réponse avec le answeredAt le plus récent", () => {
    const older = { answerIndex: 0, answeredAt: 100 };
    const newer = { answerIndex: 2, answeredAt: 200 };
    assert.deepEqual(pickLatestTriviaAnswer(older, newer), newer);
    assert.deepEqual(pickLatestTriviaAnswer(newer, older), newer);
  });

  it("mergeTriviaAnswersUid applique pickLatest par joueur", () => {
    const cur = { u1: { answerIndex: 0, answeredAt: 100 } };
    const inc = { u1: { answerIndex: 3, answeredAt: 300 }, u2: { answerIndex: 1, answeredAt: 50 } };
    const out = mergeTriviaAnswersUid(cur, inc);
    assert.equal(out.u1.answerIndex, 3);
    assert.equal(out.u2.answerIndex, 1);
  });
});

describe("mergeTruthMeterPatchState votes-only", () => {
  const mergeReadyUid = (a, b) => ({ ...a?.ready, ...b?.ready });
  const mergeVotes = (a, b) => ({ ...(a?.votes || {}), ...(b?.votes || {}) });

  it("conserve reveal-pending", () => {
    const cur = { phase: "reveal-pending", roundIdx: 1, votes: {} };
    const inc = { votes: { u1: 42 } };
    const out = mergeTruthMeterPatchState(cur, inc, { mergeReadyUid, mergeVotes });
    assert.equal(out.phase, "reveal-pending");
    assert.equal(out.votes.u1, 42);
  });
});

describe("mergeCustomGameDeck", () => {
  it("retourne null en prep même si remote a un ancien deck", () => {
    const stale = [{ text: "deleted take", themeId: "custom" }];
    assert.equal(
      mergeCustomGameDeck({ deck: null, lobbyStarted: false }, { deck: stale, lobbyStarted: false }),
      null
    );
  });

  it("conserve le deck figé une fois la partie lancée", () => {
    const deck = [{ text: "round 1", themeId: "catalog" }];
    assert.deepEqual(
      mergeCustomGameDeck({ deck, lobbyStarted: true }, { deck: null, lobbyStarted: true }),
      deck
    );
  });
});

describe("mergeRemoteCustomGameDeck", () => {
  it("efface le deck serveur en prep quand customs changent", () => {
    const stale = [{ text: "old" }];
    assert.equal(
      mergeRemoteCustomGameDeck({ deck: stale, lobbyStarted: false }, { deck: null, lobbyStarted: false }),
      null
    );
  });
});

describe("normalize entries", () => {
  it("normalizeDilemmaEntry rejette entrées vides", () => {
    assert.equal(normalizeDilemmaEntry({ optionA: "", optionB: "b" }), null);
  });

  it("normalizeHotTakeEntry accepte string legacy", () => {
    const t = normalizeHotTakeEntry("  hello  ");
    assert.equal(t.text, "hello");
  });
});

describe("normalizePlayerKeyedMap", () => {
  const players = ["Admin", "mozilla", "Joulaille", "ios"];

  it("conserve les clés déjà en pseudo", () => {
    const map = { Admin: "VALIDE", mozilla: "CRIMINEL" };
    assert.deepEqual(normalizePlayerKeyedMap(map, players), map);
  });

  it("résout les UUID vers pseudo", () => {
    const map = { u1: "VALIDE", u2: "ACCEPTABLE", u3: "CRIMINEL", u4: "VALIDE" };
    const resolve = (k) => ({ u1: "Admin", u2: "mozilla", u3: "Joulaille", u4: "ios" }[k] || null);
    assert.deepEqual(normalizePlayerKeyedMap(map, players, resolve), {
      Admin: "VALIDE",
      mozilla: "ACCEPTABLE",
      Joulaille: "CRIMINEL",
      ios: "VALIDE",
    });
  });
});

describe("normalizeKeyedVotes", () => {
  const alive = ["Admin", "mozilla", "Joulaille", "ios"];
  const uid = { Admin: "u1", mozilla: "u2", Joulaille: "u3", ios: "u4" };

  it("conserve les votes indexés par pseudo", () => {
    const votes = { Admin: "ios", mozilla: "ios", Joulaille: "Admin", ios: "Joulaille" };
    assert.deepEqual(normalizeKeyedVotes(votes, alive), votes);
  });

  it("résout les UUID vers pseudo via resolveKey", () => {
    const votes = { u1: "u4", u2: "u4", u3: "u1", u4: "u3" };
    const resolve = (k) => ({ u1: "Admin", u2: "mozilla", u3: "Joulaille", u4: "ios" }[k] || null);
    assert.deepEqual(normalizeKeyedVotes(votes, alive, resolve), {
      Admin: "ios",
      mozilla: "ios",
      Joulaille: "Admin",
      ios: "Joulaille",
    });
  });
});

describe("mergeTraitrePhase", () => {
  it("accepte speak → vote", () => {
    assert.equal(mergeTraitrePhase("speak", "vote"), "vote");
  });

  it("accepte decision → speak (continuer après manche 1)", () => {
    assert.equal(mergeTraitrePhase("decision", "speak"), "speak");
  });

  it("accepte vote → speak (nouvelle manche après élimination)", () => {
    assert.equal(mergeTraitrePhase("vote", "speak"), "speak");
  });

  it("bloque final → speak", () => {
    assert.equal(mergeTraitrePhase("final", "speak"), "final");
  });

  it("bloque speak → vote si patch vote obsolète (votes encore remplis)", () => {
    assert.equal(
      mergeTraitrePhase("speak", "vote", { staleVotePatch: true }),
      "speak"
    );
  });

  it("accepte speak → vote pour un nouveau vote (votes vidés)", () => {
    assert.equal(mergeTraitrePhase("speak", "vote", { staleVotePatch: false }), "vote");
  });

  it("autorise reset de vote sur revote", () => {
    assert.equal(mergeTraitrePhase("vote", "vote", { newVoteRound: true }), "vote");
  });

  it("accepte final → deal sur nouvelle partie", () => {
    assert.equal(mergeTraitrePhase("final", "deal", { newGame: true }), "deal");
  });

  it("accepte final → null sur retour prep", () => {
    assert.equal(mergeTraitrePhase("final", null, { newGame: true }), null);
  });
});

describe("isNewTraitreGame", () => {
  it("détecte un changement de paire de mots", () => {
    assert.equal(
      isNewTraitreGame({ pairId: "a", phase: "final" }, { pairId: "b", phase: "deal" }),
      true
    );
  });

  it("détecte relance final → deal", () => {
    assert.equal(
      isNewTraitreGame({ phase: "final", pairId: "a" }, { phase: "deal", pairId: "a" }),
      true
    );
  });

  it("détecte retour prep après fin de partie", () => {
    assert.equal(
      isNewTraitreGame(
        { phase: "final", lobbyStarted: true },
        { phase: null, lobbyStarted: false }
      ),
      true
    );
  });

  it("ignore une avancée normale dans la même partie", () => {
    assert.equal(isNewTraitreGame({ phase: "deal", pairId: "a" }, { phase: "speak", pairId: "a" }), false);
  });

  it("détecte retour prep depuis deal en cours", () => {
    assert.equal(
      isNewTraitreGame(
        { phase: "deal", pairId: "social_1", lobbyStarted: true, alive: ["a", "b"] },
        { phase: null, pairId: null, lobbyStarted: false, alive: [] }
      ),
      true
    );
  });
});

describe("mergeTraitrePatchState", () => {
  const mergeReadyUid = (cur, inc) => ({ ...(cur?.ready || {}), ...(inc?.ready || {}) });
  const mergeVotes = (cur, inc) => ({ ...(cur?.votes || {}), ...(inc?.votes || {}) });

  it("patch ready-only ne régresse pas la phase", () => {
    const cur = { phase: "vote", ready: { a: true }, votes: { x: "y" } };
    const inc = { ready: { b: true } };
    const out = mergeTraitrePatchState(cur, inc, { mergeReadyUid, mergeVotes });
    assert.equal(out.phase, "vote");
    assert.equal(out.ready.b, true);
  });

  it("patch votes-only conserve la phase reveal", () => {
    const cur = { phase: "vote", votes: {} };
    const inc = { votes: { a: "b" } };
    const out = mergeTraitrePatchState(cur, inc, { mergeReadyUid, mergeVotes });
    assert.equal(out.phase, "vote");
    assert.equal(out.votes.a, "b");
  });

  it("égalité au vote → speak efface les votes distants", () => {
    const cur = { phase: "vote", votes: { a: "b", c: "d" } };
    const inc = {
      phase: "speak",
      speakRound: 3,
      votes: {},
      tieAfterVote: true,
    };
    assert.equal(isTraitreVoteResetAfterTie(cur, inc), true);
    const out = mergeTraitrePatchState(cur, inc, {
      mergeReadyUid,
      mergeVotes,
      newVoteRound: false,
    });
    assert.deepEqual(out.votes, {});
    assert.equal(out.phase, "speak");
    assert.equal(out.tieAfterVote, true);
  });

  it("détecte l'égalité sans flag tieAfterVote (sync invités)", () => {
    const cur = {
      phase: "vote",
      speakRound: 2,
      lastEliminated: null,
      votes: { a: "b", c: "b" },
    };
    const inc = { phase: "speak", speakRound: 3, votes: {}, lastEliminated: null };
    assert.equal(isTraitreVoteResetAfterTie(cur, inc), true);
    const out = mergeTraitrePatchState(cur, inc, {
      mergeReadyUid,
      mergeVotes,
      newVoteRound: false,
    });
    assert.equal(out.tieAfterVote, true);
  });

  it("n'interprète pas une élimination comme une égalité", () => {
    const cur = { phase: "vote", speakRound: 2, lastEliminated: null, votes: { a: "b" } };
    const inc = {
      phase: "speak",
      speakRound: 3,
      votes: {},
      lastEliminated: "b",
    };
    assert.equal(isTraitreVoteResetAfterTie(cur, inc), false);
  });

  it("votes vides sans revotePending ne réinitialise pas", () => {
    const cur = { phase: "vote", votes: { a: "b", c: "d" } };
    const inc = { phase: "vote", votes: {} };
    assert.equal(isNewTraitreVoteRound(cur, inc), false);
    const out = mergeTraitrePatchState(cur, inc, {
      mergeReadyUid,
      mergeVotes,
      newVoteRound: false,
    });
    assert.deepEqual(out.votes, { a: "b", c: "d" });
  });

  it("patch partiel sans pairId conserve la paire en cours", () => {
    const cur = { phase: "deal", pairId: "social_1", lobbyStarted: true };
    const inc = { phase: "deal", dealAcks: { uid_a: true } };
    const out = mergeTraitrePatchState(cur, inc, { mergeReadyUid, mergeVotes });
    assert.equal(out.pairId, "social_1");
  });

  it("pairId null distant ne remplace pas une paire locale", () => {
    const cur = { phase: "deal", pairId: "social_1", lobbyStarted: true };
    const inc = { phase: "deal", pairId: null, dealAcks: { uid_a: true } };
    const out = mergeTraitrePatchState(cur, inc, { mergeReadyUid, mergeVotes });
    assert.equal(out.pairId, "social_1");
  });

  it("retour prep depuis deal efface pairId et phase", () => {
    const cur = {
      phase: "deal",
      pairId: "social_1",
      lobbyStarted: true,
      alive: ["a", "b", "c"],
      votes: { a: "b" },
    };
    const inc = {
      phase: null,
      pairId: null,
      lobbyStarted: false,
      alive: [],
      ready: {},
      votes: {},
    };
    const out = mergeTraitrePatchState(cur, inc, { mergeReadyUid, mergeVotes });
    assert.equal(out.pairId, null);
    assert.equal(out.phase, null);
    assert.equal(out.lobbyStarted, false);
    assert.deepEqual(out.votes, {});
    assert.deepEqual(out.alive, []);
  });

  it("patch vote stale ne régresse pas speak → vote", () => {
    const cur = { phase: "speak", speakRound: 3, alive: ["a", "b", "c"], votes: {} };
    const inc = {
      phase: "vote",
      speakRound: 2,
      votes: { a: "b", b: "b", c: "a" },
    };
    assert.equal(isStaleTraitreVotePatch(cur, inc), true);
    const out = mergeTraitrePatchState(cur, inc, { mergeReadyUid, mergeVotes });
    assert.equal(out.phase, "speak");
  });

  it("remplace l'état local sur nouvelle partie", () => {
    const cur = {
      phase: "final",
      pairId: "old_pair",
      lobbyStarted: true,
      winner: "civilians",
      impostorRevealed: true,
      votes: { a: "b" },
    };
    const inc = {
      phase: "deal",
      pairId: "new_pair",
      lobbyStarted: true,
      winner: null,
      impostorRevealed: false,
      votes: {},
      dealAcks: {},
    };
    const out = mergeTraitrePatchState(cur, inc, { mergeReadyUid, mergeVotes });
    assert.equal(out.phase, "deal");
    assert.equal(out.pairId, "new_pair");
    assert.deepEqual(out.votes, {});
    assert.equal(out.winner, null);
  });
});

describe("mergeTruthMeterPhase", () => {
  it("bloque reveal → voting", () => {
    assert.equal(mergeTruthMeterPhase("reveal", "voting"), "reveal");
  });

  it("accepte voting → reveal-pending", () => {
    assert.equal(mergeTruthMeterPhase("voting", "reveal-pending"), "reveal-pending");
  });

  it("accepte reveal → writing (nouvelle manche)", () => {
    assert.equal(mergeTruthMeterPhase("reveal", "writing"), "writing");
    assert.equal(mergeTruthMeterPhase("reveal-pending", "writing"), "writing");
  });

  it("accepte reveal → writing avec newRound", () => {
    assert.equal(mergeTruthMeterPhase("reveal", "writing", { newRound: true }), "writing");
  });
});

describe("mergeTruthMeterPatchState", () => {
  const mergeReadyUid = (cur, inc) => ({ ...cur?.ready, ...inc?.ready });
  const mergeVotes = (cur, inc) => ({ ...cur?.votes, ...inc?.votes });

  it("passe reveal → writing quand roundIdx avance", () => {
    const cur = {
      roundIdx: 0,
      phase: "reveal",
      affirmation: { text: "M1", author: "Alice" },
      roundScored: true,
    };
    const inc = {
      roundIdx: 1,
      phase: "writing",
      affirmation: null,
      authorEstimate: null,
      votes: {},
      voteEndsAt: null,
      roundScored: false,
    };
    const out = mergeTruthMeterPatchState(cur, inc, { mergeReadyUid, mergeVotes, newRound: true });
    assert.equal(out.phase, "writing");
    assert.equal(out.roundIdx, 1);
    assert.equal(out.affirmation, null);
  });

  it("passe reveal → writing même sans flag newRound (roundIdx avancé)", () => {
    const cur = { phase: "reveal", roundScored: true };
    const inc = {
      roundIdx: 1,
      phase: "writing",
      affirmation: null,
      votes: {},
      roundScored: false,
    };
    const out = mergeTruthMeterPatchState(cur, inc, { mergeReadyUid, mergeVotes });
    assert.equal(out.phase, "writing");
    assert.equal(out.roundIdx, 1);
  });
});

describe("mergeGuessLieSubmissions", () => {
  const valid = (statements, lie = 0) => ({ statements, lie });

  it("unionne local et remote sans perdre d'entrée", () => {
    const local = {
      Admin: valid(["a", "b", "c"], 1),
      mozilla: valid(["d", "e", "f"], 0),
    };
    const remote = {
      mozilla: valid(["d2", "e2", "f2"], 2),
      Joulaille: valid(["g", "h", "i"], 1),
    };
    const out = mergeGuessLieSubmissions(local, remote);
    assert.equal(out.Admin.lie, 1);
    assert.equal(out.mozilla.lie, 2);
    assert.equal(out.Joulaille.statements[0], "g");
  });

  it("purge le local quand reset (nouvelle partie)", () => {
    const local = { sarah: valid(["a", "b", "c"]) };
    assert.deepEqual(mergeGuessLieSubmissions(local, {}, { reset: true }), {});
  });

  it("en prep : le remote fait foi, pas de soumission fantôme locale", () => {
    const local = { sarah: valid(["stale", "stale", "stale"]) };
    const remote = { Admin: valid(["x", "y", "z"]) };
    const out = mergeGuessLieSubmissions(local, remote, { prepPhase: true });
    assert.equal(out.Admin.statements[0], "x");
    assert.equal(out.sarah, undefined);
  });

  it("en prep : garde la soumission locale optimiste du joueur courant", () => {
    const local = { sarah: valid(["mine", "mine", "mine"], 2) };
    const remote = { Admin: valid(["x", "y", "z"]) };
    const out = mergeGuessLieSubmissions(local, remote, {
      prepPhase: true,
      localName: "sarah",
    });
    assert.equal(out.sarah.lie, 2);
    assert.equal(out.Admin.statements[0], "x");
  });
});

describe("mergeGuessLieLobbyComplete", () => {
  it("conserve le lancement local si le serveur est encore en prep", () => {
    const local = { lobbyComplete: true, phase: "voting" };
    const remote = { lobbyComplete: false, phase: null };
    assert.equal(mergeGuessLieLobbyComplete(local, remote), true);
  });

  it("suit le lancement distant pour les invités", () => {
    const local = { lobbyComplete: false, phase: null };
    const remote = { lobbyComplete: true, phase: "voting" };
    assert.equal(mergeGuessLieLobbyComplete(local, remote), true);
  });

  it("conserve le lancement local malgré un reset prep distant obsolète", () => {
    const local = { lobbyComplete: true, phase: "voting" };
    const remote = { lobbyComplete: false, phase: null, submissions: {} };
    assert.equal(
      mergeGuessLieLobbyComplete(local, remote, {
        lobbyReset: shouldApplyGuessLieLobbyReset(local, remote),
      }),
      true
    );
    assert.equal(shouldApplyGuessLieLobbyReset(local, remote), false);
  });

  it("revient à false sur reset lobby quand le local est encore en prep", () => {
    const local = { lobbyComplete: false, phase: null };
    const remote = { lobbyComplete: false, phase: null, submissions: {} };
    assert.equal(
      mergeGuessLieLobbyComplete(local, remote, {
        lobbyReset: shouldApplyGuessLieLobbyReset(local, remote),
      }),
      false
    );
  });
});

describe("shouldApplyGuessLieLobbyReset", () => {
  it("ignore un snapshot prep vide si le local a déjà lancé", () => {
    const local = { lobbyComplete: true, phase: "voting" };
    const remote = { lobbyComplete: false, phase: null, submissions: {} };
    assert.equal(shouldApplyGuessLieLobbyReset(local, remote), false);
  });

  it("applique le reset prep quand le local n'a pas encore lancé", () => {
    const local = { lobbyComplete: false, phase: null };
    const remote = { lobbyComplete: false, phase: null, submissions: {} };
    assert.equal(shouldApplyGuessLieLobbyReset(local, remote), true);
  });
});

describe("isGuessLieInPrep", () => {
  it("n'est plus en prep après lancement local", () => {
    const local = { lobbyComplete: true, phase: "voting" };
    const remote = { lobbyComplete: false, phase: null };
    assert.equal(isGuessLieInPrep(local, remote), false);
  });
});

describe("isGuessLieLobbyReset", () => {
  it("détecte une relance avec soumissions vides", () => {
    assert.equal(
      isGuessLieLobbyReset({ lobbyComplete: false, phase: null, submissions: {} }),
      true
    );
  });

  it("ignore une partie en cours", () => {
    assert.equal(
      isGuessLieLobbyReset({ lobbyComplete: true, phase: "voting", submissions: {} }),
      false
    );
  });
});

describe("isValidGuessLieSubmission", () => {
  it("rejette les entrées vides ou incomplètes", () => {
    assert.equal(isValidGuessLieSubmission({}), false);
    assert.equal(isValidGuessLieSubmission({ statements: ["a", "b"], lie: 0 }), false);
    assert.equal(isValidGuessLieSubmission({ statements: ["a", "b", ""], lie: 0 }), false);
    assert.equal(
      isValidGuessLieSubmission({ statements: ["a", "b", "c"], lie: 0 }),
      true
    );
  });
});
