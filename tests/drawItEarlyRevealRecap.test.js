/**
 * Draw it ! — clôture anticipée serveur + contrat du récap de manche.
 */
import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

const DRAWER = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const BOB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const CHLOE = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const NOW = Date.parse("2026-08-15T21:00:00.000Z");

mock.module("../js/core/supabaseClient.js", {
  namedExports: {
    isSupabaseConfigured: () => false,
    supabase: null,
  },
});

const {
  applyDrawItReveal,
  buildDrawItLaunchState,
  DRAW_IT_PHASE_DRAWING,
  DRAW_IT_PHASE_REVEAL,
} = await import("../js/core/drawItRound.js");
const {
  applyDrawItGuess,
  applyDrawItGuessesSerialized,
} = await import("../js/core/drawItGuesses.js");
const { buildDrawItRoundRecap } = await import(
  "../js/core/drawItRoundRecap.js"
);
const { drawItFromRemote, drawItToRemote } = await import(
  "../js/core/gameSync.js"
);

function session() {
  return buildDrawItLaunchState({
    session: { selectedCategoryId: "demo", roundCount: 3, ready: {} },
    participants: [
      { userId: DRAWER, name: "Alice" },
      { userId: BOB, name: "Bob" },
      { userId: CHLOE, name: "Chloé" },
    ],
    nowMs: NOW,
    runId: "run-early-reveal",
  });
}

function correct(uid, serverAt) {
  return {
    uid,
    value: "éléphant",
    nowMs: NOW + 5_000,
    serverAt,
    wordLabel: "Éléphant",
    acceptedAnswers: ["Éléphant"],
  };
}

describe("Draw it ! — clôture anticipée", () => {
  it("mauvaise réponse puis bonne partielle : phase drawing", () => {
    const wrong = applyDrawItGuess(session(), {
      ...correct(BOB, "2026-08-15T21:00:05.000Z"),
      value: "girafe",
    });
    assert.equal(wrong.ok, true);
    assert.equal(wrong.correct, false);
    assert.equal(wrong.session.phase, DRAW_IT_PHASE_DRAWING);

    const partial = applyDrawItGuess(
      wrong.session,
      correct(BOB, "2026-08-15T21:00:06.000Z")
    );
    assert.equal(partial.ok, true);
    assert.equal(partial.session.phase, DRAW_IT_PHASE_DRAWING);
    assert.equal(partial.session.guesses[1].correct, true);
    assert.equal(partial.session.guesses[1].value, "");
    assert.equal(JSON.stringify(drawItToRemote(partial.session)).includes("éléphant"), false);
    assert.equal(
      applyDrawItReveal(partial.session, {
        wordLabel: "Éléphant",
        nowMs: NOW + 6_000,
      }).ok,
      false
    );
  });

  it("deux bonnes réponses sérialisées : aucune perdue, dernier déclenche reveal", () => {
    const serialized = applyDrawItGuessesSerialized(session(), [
      correct(BOB, "2026-08-15T21:00:05.000Z"),
      correct(CHLOE, "2026-08-15T21:00:05.010Z"),
    ]);
    assert.deepEqual(
      serialized.session.foundOrder.map((entry) => entry.uid),
      [BOB, CHLOE]
    );
    const revealed = applyDrawItReveal(serialized.session, {
      wordLabel: "Éléphant",
      nowMs: NOW + 5_100,
    });
    assert.equal(revealed.ok, true);
    assert.equal(revealed.session.phase, DRAW_IT_PHASE_REVEAL);
    assert.deepEqual(
      revealed.session.lastRound.foundOrder.map((entry) => entry.uid),
      [BOB, CHLOE]
    );
    assert.equal(revealed.session.roundEndsAt, session().roundEndsAt);
  });

  it("reveal anticipé hydraté : foundOrder et mot public, secrets absents", () => {
    const both = applyDrawItGuessesSerialized(session(), [
      correct(BOB, "2026-08-15T21:00:05.000Z"),
      correct(CHLOE, "2026-08-15T21:00:06.000Z"),
    ]).session;
    const revealed = applyDrawItReveal(both, {
      wordLabel: "Éléphant",
      nowMs: NOW + 7_000,
    }).session;
    const remote = drawItToRemote(revealed);
    const guest = drawItFromRemote(remote);
    assert.equal(guest.phase, DRAW_IT_PHASE_REVEAL);
    assert.deepEqual(
      guest.foundOrder.map((entry) => entry.uid),
      [BOB, CHLOE]
    );
    assert.equal(guest.lastRound.wordLabel, "Éléphant");
    assert.equal("wordLabel" in guest, false);
    assert.equal("acceptedAnswers" in guest, false);
    assert.equal("deck" in guest, false);
  });

  it("reveal anticipé reste idempotent", () => {
    const both = applyDrawItGuessesSerialized(session(), [
      correct(BOB, "2026-08-15T21:00:05.000Z"),
      correct(CHLOE, "2026-08-15T21:00:06.000Z"),
    ]).session;
    const first = applyDrawItReveal(both, {
      wordLabel: "Éléphant",
      nowMs: NOW + 7_000,
    });
    const second = applyDrawItReveal(first.session, {
      wordLabel: "Autre",
      nowMs: NOW + 8_000,
    });
    assert.equal(second.ok, false);
    assert.equal(second.reason, "already_reveal");
    assert.equal(second.session.lastRound.wordLabel, "Éléphant");
  });
});

describe("Draw it ! — contrat récapitulatif", () => {
  it("classe trouvés, absents et drawer sans inventer de points", () => {
    const revealed = applyDrawItReveal(
      {
        ...session(),
        foundOrder: [{ uid: BOB, at: "2026-08-15T21:00:05.000Z" }],
        roundEndsAt: "2026-08-15T21:00:10.000Z",
      },
      { wordLabel: "Éléphant", nowMs: NOW + 10_000 }
    ).session;
    const recap = buildDrawItRoundRecap(revealed);
    assert.equal(recap.wordLabel, "Éléphant");
    assert.equal(recap.allGuessersFound, false);
    assert.deepEqual(
      recap.rows.map((row) => [row.name, row.role, row.found, row.rank, row.pointsDelta]),
      [
        ["Bob", "guesser", true, 1, null],
        ["Chloé", "guesser", false, null, null],
        ["Alice", "drawer", false, null, null],
      ]
    );
  });

  it("phase reveal rend récap, dessin local/placeholder et CTA synchronisé", () => {
    const src = read("js/games/drawIt.js");
    const drawingStart = src.indexOf("phase === DRAW_IT_PHASE_DRAWING");
    const revealStart = src.indexOf("phase === DRAW_IT_PHASE_REVEAL", drawingStart);
    const drawingBranch = src.slice(drawingStart, revealStart);
    const revealBranch = src.slice(revealStart);
    assert.match(drawingBranch, /draw-it-clock/);
    assert.doesNotMatch(drawingBranch, /draw-it-advance/);
    assert.match(revealBranch, /Récapitulatif de la manche/);
    assert.doesNotMatch(revealBranch, /id="draw-it-clock"/);
    assert.match(revealBranch, /Dessin de la manche/);
    assert.match(revealBranch, /Résultat de la manche/);
    assert.match(src, /Points : —/);
    assert.match(src, /Dessin indisponible sur cet appareil/);
    assert.match(revealBranch, /Manche suivante →/);
    assert.match(revealBranch, /Voir les résultats →/);
    assert.match(src, /canActAsHost/);
    assert.match(revealBranch, /commitDrawItNextRound/);
    assert.match(revealBranch, /commitDrawItComplete/);
    assert.doesNotMatch(src, /drawit-recap/);
  });
});

describe("Draw it ! — contrat SQL atomique", () => {
  it("helper dérive les attendus du snapshot, jamais du roster live", () => {
    const sql = read("supabase/feature-drawit-02-private-word.sql");
    const helper = sql.slice(
      sql.indexOf("create or replace function public.drawit_all_guessers_found"),
      sql.indexOf("create or replace function public.reveal_drawit_round")
    );
    assert.match(helper, /participants/);
    assert.match(helper, /drawerOrder/);
    assert.match(helper, /drawerUid/);
    assert.match(helper, /foundOrder/);
    assert.doesNotMatch(helper, /lobby_members/);
    assert.match(sql, /clock_timestamp\(\) < v_ends[\s\S]*drawit_all_guessers_found/);
  });

  it("dernier guess publie reveal + lastRound dans le même UPDATE verrouillé", () => {
    const sql = read("supabase/feature-drawit-03-guesses.sql");
    const fn = sql.slice(
      sql.indexOf("create or replace function public.submit_drawit_guess")
    );
    assert.match(fn, /for update/i);
    assert.match(fn, /v_at >= v_ends/);
    assert.match(fn, /v_found := v_found \|\|/);
    assert.match(fn, /case when v_correct then '' else v_trimmed end/);
    assert.match(fn, /drawit_all_guessers_found\(v_di\)/);
    assert.match(fn, /drawit_revealed_state\(v_di, v_priv\.word_label\)/);
    assert.match(fn, /set state = jsonb_set\([\s\S]*'\{drawIt\}'[\s\S]*v_di/);
    assert.doesNotMatch(fn, /update public\.lobby_members/);
    const revealSql = read("supabase/feature-drawit-02-private-word.sql");
    const sharedReveal = revealSql.slice(
      revealSql.indexOf("create or replace function public.drawit_revealed_state"),
      revealSql.indexOf("create or replace function public.reveal_drawit_round")
    );
    assert.match(sharedReveal, /'phase', 'reveal'/);
    assert.match(sharedReveal, /'lastRound'/);
    assert.match(sharedReveal, /'wordLabel', coalesce\(p_word_label/);
    assert.match(revealSql, /drawit_revealed_state\(v_di, v_word\)/);
  });

  it("le submit client n'enchaîne aucun deuxième reveal RPC", () => {
    const src = read("js/core/drawItSession.js");
    const submit = src.slice(
      src.indexOf("export async function submitDrawItGuess"),
      src.indexOf("export async function loadLocalDrawItPrivateWord")
    );
    assert.match(submit, /rpcSubmitDrawItGuess/);
    assert.doesNotMatch(submit, /rpcRevealDrawItRound|commitDrawItReveal/);
  });
});
