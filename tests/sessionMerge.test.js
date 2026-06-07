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
  pickLatestTriviaAnswer,
  mergeTriviaAnswersUid,
  normalizeDilemmaEntry,
  normalizeHotTakeEntry,
  normalizeKeyedVotes,
  mergeGuessLieSubmissions,
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
    assert.equal(out.Alice, undefined);
    assert.equal(out.Bob, true);
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
  it("bloque vote → speak", () => {
    assert.equal(mergeTraitrePhase("vote", "speak"), "vote");
  });

  it("accepte speak → vote", () => {
    assert.equal(mergeTraitrePhase("speak", "vote"), "vote");
  });

  it("autorise reset de vote sur revote", () => {
    assert.equal(mergeTraitrePhase("vote", "vote", { newVoteRound: true }), "vote");
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

  it("nouvelle manche de vote efface les votes distants", () => {
    const cur = { phase: "vote", votes: { a: "b", c: "d" } };
    const inc = { phase: "vote", votes: {} };
    const out = mergeTraitrePatchState(cur, inc, {
      mergeReadyUid,
      mergeVotes,
      newVoteRound: isNewTraitreVoteRound(cur, inc),
    });
    assert.deepEqual(out.votes, {});
    assert.equal(out.phase, "vote");
  });
});

describe("mergeTruthMeterPhase", () => {
  it("bloque reveal → voting", () => {
    assert.equal(mergeTruthMeterPhase("reveal", "voting"), "reveal");
  });

  it("accepte voting → reveal-pending", () => {
    assert.equal(mergeTruthMeterPhase("voting", "reveal-pending"), "reveal-pending");
  });
});

describe("mergeGuessLieSubmissions", () => {
  it("unionne local et remote sans perdre d'entrée", () => {
    const local = {
      Admin: { statements: ["a", "b", "c"], lie: 1 },
      mozilla: { statements: ["d", "e", "f"], lie: 0 },
    };
    const remote = {
      mozilla: { statements: ["d2", "e2", "f2"], lie: 2 },
      Joulaille: { statements: ["g", "h", "i"], lie: 1 },
    };
    const out = mergeGuessLieSubmissions(local, remote);
    assert.equal(out.Admin.lie, 1);
    assert.equal(out.mozilla.lie, 2);
    assert.equal(out.Joulaille.statements[0], "g");
  });

  it("conserve le local si le remote est vide", () => {
    const local = { Admin: { statements: ["a", "b", "c"], lie: 0 } };
    assert.deepEqual(mergeGuessLieSubmissions(local, {}), local);
  });
});
