/**
 * « Manche suivante » côté hôte dont l'envoi échoue (même défaut que le bug n°4
 * de Clutch) : l'hôte revient à la manche en cours, comme les invités, et voit
 * « La manche suivante n'est pas partie, réessaie ! ». Sinon il lançait la
 * nouvelle manche seul au prochain événement.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startRoundWithRollback } from "../js/core/roundStartRollback.js";
import { NEXT_ROUND_FAILED_LABEL } from "../js/core/postGameFinish.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

/** Simule un sync « enregistre puis envoie » (comme syncXxxSession). */
function fakeStore(initial) {
  let saved = initial;
  return {
    get: () => saved,
    save: (s) => {
      saved = s;
    },
  };
}

describe("startRoundWithRollback", () => {
  const current = { roundIdx: 1, phase: "reveal", votes: { Bob: "A" }, matchScores: { Bob: 2 } };
  const next = { ...current, roundIdx: 2, phase: "voting", votes: {} };

  it("échec : la manche d'avant est remise et l'erreur remonte", async () => {
    const store = fakeStore(current);
    await assert.rejects(
      () =>
        startRoundWithRollback({
          previous: store.get(),
          send: async () => {
            store.save(next); // enregistré avant l'envoi
            throw new Error("réseau coupé");
          },
          restore: store.save,
        }),
      /réseau coupé/
    );
    assert.deepEqual(store.get(), current);
  });

  it("succès : la nouvelle manche reste enregistrée", async () => {
    const store = fakeStore(current);
    await startRoundWithRollback({
      previous: store.get(),
      send: async () => {
        store.save(next);
        return next;
      },
      restore: store.save,
    });
    assert.deepEqual(store.get(), next);
  });

  it("texte affiché à l'hôte", () => {
    assert.equal(NEXT_ROUND_FAILED_LABEL, "La manche suivante n’est pas partie, réessaie !");
  });
});

/** Vérifie qu'un écran affiche le message sous son bouton « manche suivante ». */
function assertMessageShown(src) {
  assert.match(
    src,
    /nextRoundFailed\s*\?\s*`<p class="hint">\$\{escapeHtml\(NEXT_ROUND_FAILED_LABEL\)\}<\/p>`/
  );
}

describe("Dilemma : manche suivante qui échoue", () => {
  const session = read("js/core/dilemmaSession.js");
  const screen = read("js/games/dilemma.js");

  it("startDilemmaRound remet la manche d'avant si l'envoi échoue", () => {
    const fn = session.slice(session.indexOf("export async function startDilemmaRound"));
    assert.match(
      fn,
      /startRoundWithRollback\(\{\s*previous,\s*send: \(\) => syncDilemmaSession\(next\),\s*restore: \(session\) => saveStatePatch\(\{ dilemmaGame: session \}\),/
    );
  });

  it("l'écran attrape l'échec et affiche le message", () => {
    assert.match(
      screen,
      /try \{\s*await startDilemmaRound\(nextIdx\);\s*\} catch \(e\) \{[\s\S]*?nextRoundFailed = true;\s*syncFromSession\(\);\s*render\(\);\s*return;/
    );
    assertMessageShown(screen);
  });
});

describe("Speed Vote : question suivante qui échoue", () => {
  const session = read("js/core/speedVoteSession.js");
  const screen = read("js/games/speedVote.js");

  it("startSpeedVoteRound remet la question d'avant si l'envoi échoue", () => {
    const fn = session.slice(session.indexOf("export async function startSpeedVoteRound"));
    assert.match(
      fn,
      /startRoundWithRollback\(\{\s*previous,\s*send: \(\) => syncSpeedVoteSession\(next\),\s*restore: \(session\) => saveStatePatch\(\{ speedVoteGame: session \}\),/
    );
  });

  it("l'écran attrape l'échec et affiche le message", () => {
    assert.match(
      screen,
      /try \{\s*await startSpeedVoteRound\(nextIdx\);\s*\} catch \(e\) \{[\s\S]*?nextRoundFailed = true;\s*syncFromSession\(\);\s*render\(\);\s*return;/
    );
    assertMessageShown(screen);
  });
});

describe("Wrong Answer Only : manche suivante qui échoue", () => {
  const session = read("js/core/wrongAnswerSession.js");
  const screen = read("js/games/wrongAnswer.js");

  it("startWrongAnswerRound remet la manche d'avant si l'envoi échoue", () => {
    const fn = session.slice(session.indexOf("export async function startWrongAnswerRound"));
    assert.match(
      fn,
      /startRoundWithRollback\(\{\s*previous: session,\s*send: \(\) => syncWrongAnswerSession\(next\),\s*restore: \(prev\) => saveStatePatch\(\{ wrongAnswerGame: prev \}\),/
    );
  });

  it("l'écran attrape l'échec et affiche le message", () => {
    assert.match(
      screen,
      /try \{\s*await startWrongAnswerRound\(roundIdx \+ 1\);\s*\} catch \(e\) \{[\s\S]*?nextRoundFailed = true;\s*syncFromSession\(\);\s*render\(\);\s*return;/
    );
    assertMessageShown(screen);
  });
});

describe("Guess The Lie : manche suivante qui échoue", () => {
  const screen = read("js/games/guessLie.js");
  const nextRound = screen.slice(
    screen.indexOf("async function nextRound"),
    screen.indexOf("async function submitVote")
  );

  it("envoi avec remise de la manche d'avant si ça échoue", () => {
    assert.match(
      nextRound,
      /startRoundWithRollback\(\{\s*previous: getGuessLieSession\(\),\s*send: \(\) =>\s*commitGuessLiePlay\(/
    );
    assert.match(nextRound, /restore: \(gl\) => saveStatePatch\(\{ guessLie: gl \}\)/);
  });

  it("l'écran ne change de manche qu'après un envoi réussi", () => {
    const mpPart = nextRound.slice(nextRound.indexOf("if (mp) {", nextRound.indexOf("const next =")));
    const sendAt = mpPart.indexOf("startRoundWithRollback");
    const switchAt = mpPart.indexOf("roundIdx = next;");
    assert.ok(sendAt > 0 && switchAt > sendAt);
  });

  it("échec : message affiché", () => {
    assert.match(nextRound, /catch \(e\) \{[\s\S]*?nextRoundFailed = true;\s*render\(\);\s*return;/);
    assertMessageShown(screen);
  });
});

describe("Hot Take : prise suivante qui échoue", () => {
  const screen = read("js/games/hotTake.js");
  const startNext = screen.slice(
    screen.indexOf("async function startNextTakeVote"),
    screen.indexOf("nextRoundFailed = false;", screen.indexOf("async function startNextTakeVote"))
  );

  it("échec : l'hôte reste sur le verdict et voit le message", () => {
    assert.match(startNext, /await commitHotTakePlay\(/);
    assert.match(startNext, /catch \(err\) \{[\s\S]*?nextRoundFailed = true;\s*syncFromSession\(\);\s*render\(\);\s*return;/);
    assertMessageShown(screen);
  });
});
