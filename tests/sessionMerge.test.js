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
  isVotesOnlyGamePatch,
  isAnswersOnlyGamePatch,
  mergeConsensusPatchState,
  mergeConsensusPhase,
  isNewConsensusQuestionRound,
  mergeTriviaPatchState,
  mergeTruthMeterPatchState,
  mergeSpeedVotePatchState,
  pickLatestTriviaAnswer,
  mergeTriviaAnswersUid,
  normalizeDilemmaEntry,
  normalizeHotTakeEntry,
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

  it("patch complet ne régresse pas reveal → voting", () => {
    const cur = { phase: "reveal", takeScored: true, votes: {} };
    const inc = { phase: "voting", takeScored: false, votes: { u1: "Valide" } };
    const out = mergeHotTakePatchState(cur, inc, "Alice", { mergeReadyUid, mergeVotes });
    assert.equal(out.phase, "reveal");
    assert.equal(out.votes.u1, "Valide");
  });
});

describe("mergeForwardGamePhase", () => {
  it("bloque reveal → voting", () => {
    assert.equal(mergeForwardGamePhase("reveal", "voting"), "reveal");
  });

  it("accepte voting → reveal", () => {
    assert.equal(mergeForwardGamePhase("voting", "reveal"), "reveal");
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
