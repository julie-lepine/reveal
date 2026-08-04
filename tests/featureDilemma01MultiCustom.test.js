/**
 * FEATURE-DILEMMA-01 — plusieurs dilemmes custom par joueur (alignement Hot Take).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  mergeDilemmaCustomDilemmas,
  mergeDilemmaPatchState,
  mergeAuthorOwnedCustomList,
  normalizeDilemmaEntry,
} from "../js/core/sessionMerge.js";
import { prepOthersCustomEntriesHintHtml } from "../js/core/prepOthersCustomHint.js";
import { resolveEffectiveRoundCount } from "../js/core/dilemmaDuration.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

function read(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

function makeCustom(id, optionA, optionB, author = "Alice") {
  return { id, optionA, optionB, author, tier: "custom" };
}

/** Miroir consumePlayedCustomDilemma (filtre par id, sans sync). */
function consumeCustomById(list, playedId) {
  return list.filter((d) => d.id !== playedId);
}

/** Miroir buildDilemmaDeck customs slice (shuffle ignoré — vérifie inclusion). */
function customsIncludedInPool(customs, effective) {
  return customs.length >= effective;
}

describe("FEATURE-DILEMMA-01 — verrous supprimés (statique)", () => {
  it("dilemmaSession : pas de guard length >= 1", () => {
    const src = read("js/core/dilemmaSession.js");
    assert.doesNotMatch(src, /getMyCustomDilemmas\(\)\.length\s*>=\s*1/);
    assert.doesNotMatch(src, /déjà soumis un dilemme pour cette partie/);
  });

  it("hotTakeSession : pas de plafond (référence alignement)", () => {
    const src = read("js/core/hotTakeSession.js");
    assert.doesNotMatch(src, /getMyCustomTakes\(\)\.length\s*>=\s*1/);
    assert.match(src, /mergeHotTakeCustomTakes/);
  });

  it("addCustomDilemma aligné sur addCustomTake (append + merge, pas de cap)", () => {
    const dm = read("js/core/dilemmaSession.js");
    const ht = read("js/core/hotTakeSession.js");
    assert.match(dm, /mergeDilemmaCustomDilemmas/);
    assert.match(ht, /mergeHotTakeCustomTakes/);
    assert.match(dm, /rpcUpsertPlayerCustomEntry/);
    assert.match(ht, /rpcUpsertPlayerCustomEntry/);
  });

  it("dilemmaPrep : formulaire + liste toujours visibles", () => {
    const src = read("js/screens/dilemmaPrep.js");
    assert.match(src, /Tes dilemmes/);
    assert.match(src, /Ajoute-en autant que tu veux/);
    assert.match(src, /id="add-dilemma"/);
    assert.match(src, /id="dilemma-option-a"/);
    assert.match(src, /customDilemmasListHtml\(\)/);
    assert.doesNotMatch(src, /prochaine partie/);
    assert.doesNotMatch(src, /if \(myCustoms\.length > 0\)/);
  });

  it("hotTakePrep : formulaire + liste (référence UI)", () => {
    const src = read("js/screens/hotTakePrep.js");
    assert.match(src, /id="add-take"/);
    assert.match(src, /customTakesListHtml\(\)/);
  });

  it("SQL migration : pas de raise « déjà soumis » dans le corps RPC", () => {
    const sql = read("supabase/feature-dilemma-01-multi-custom.sql");
    assert.doesNotMatch(sql, /raise exception 'Tu as déjà soumis un dilemme custom.'/);
    assert.match(sql, /if not v_found then[\s\S]*v_arr := v_arr \|\| jsonb_build_array\(v_entry\)/);
    assert.match(sql, /FEATURE-DILEMMA-01/);
  });

  it("reveal / vote / scoring : pipeline jeu non modifié", () => {
    const game = read("js/games/dilemma.js");
    assert.match(game, /consumePlayedCustomDilemma/);
    assert.match(game, /awardDilemmaRound/);
    assert.match(game, /commitDilemmaVote/);
    assert.doesNotMatch(game, /getMyCustomDilemmas\(\)\.length/);
  });
});

describe("FEATURE-DILEMMA-01 — merge sync (plusieurs par auteur)", () => {
  const me = "Alice";

  it("plusieurs créations même auteur — merge local", () => {
    const local = [
      makeCustom("d1", "A1", "B1", me),
      makeCustom("d2", "A2", "B2", me),
      makeCustom("d3", "A3", "B3", me),
    ];
    const out = mergeDilemmaCustomDilemmas(local, [], me);
    assert.equal(out.length, 3);
  });

  it("suppression d'un seul — mergeAuthorOwnedCustomList", () => {
    const all = [
      makeCustom("d1", "A1", "B1", me),
      makeCustom("d2", "A2", "B2", me),
    ];
    const afterRemove = all.filter((d) => d.id !== "d1");
    const out = mergeDilemmaCustomDilemmas(afterRemove, all, me);
    assert.equal(out.length, 1);
    assert.equal(out[0].id, "d2");
  });

  it("ajout puis suppression puis nouvel ajout — ids distincts", () => {
    let local = [makeCustom("d1", "X", "Y", me)];
    local = local.filter((d) => d.id !== "d1");
    local = [...local, makeCustom("d2", "A", "B", me)];
    assert.equal(local.length, 1);
    assert.equal(local[0].id, "d2");
  });

  it("merge plusieurs IDs du même auteur + remote autre joueur", () => {
    const local = [
      makeCustom("d1", "A1", "B1", me),
      makeCustom("d2", "A2", "B2", me),
    ];
    const remote = [makeCustom("b1", "X", "Y", "Bob")];
    const out = mergeDilemmaCustomDilemmas(local, remote, me);
    assert.equal(out.length, 3);
    assert.equal(out.filter((d) => d.author === me).length, 2);
  });

  it("reconnexion prep — mergeDilemmaPatchState conserve plusieurs customs", () => {
    const cur = {
      lobbyStarted: false,
      customDilemmas: [makeCustom("d1", "A", "B", me)],
      deck: null,
      ready: {},
      votes: {},
    };
    const inc = {
      lobbyStarted: false,
      customDilemmas: [
        makeCustom("d1", "A", "B", me),
        makeCustom("d2", "C", "D", me),
      ],
      deck: null,
    };
    const merged = mergeDilemmaPatchState(cur, inc, me, {
      mergeReadyUid: (c, i) => ({ ...(c?.ready || {}), ...(i?.ready || {}) }),
      mergeVotes: (c, i) => ({ ...(c?.votes || {}), ...(i?.votes || {}) }),
    });
    assert.equal(merged.customDilemmas.length, 2);
  });

  it("QA : Alice 6 dilemmes, Bob 0 — merge pool size", () => {
    const aliceEntries = Array.from({ length: 6 }, (_, i) =>
      makeCustom(`a-${i}`, `OptA${i}`, `OptB${i}`, "Alice")
    );
    const merged = mergeDilemmaCustomDilemmas(aliceEntries, [], "Alice");
    assert.equal(merged.length, 6);
    const effective = resolveEffectiveRoundCount(8, merged.length + 100);
    assert.ok(customsIncludedInPool(merged, Math.min(6, effective)));
  });
});

describe("FEATURE-DILEMMA-01 — deck et consume (contrat)", () => {
  it("consume retire un seul id", () => {
    const customs = [
      makeCustom("keep-1", "A1", "B1"),
      makeCustom("play-1", "A2", "B2"),
      makeCustom("keep-2", "A3", "B3"),
    ];
    const left = consumeCustomById(customs, "play-1");
    assert.equal(left.length, 2);
    assert.ok(left.every((d) => d.id !== "play-1"));
  });

  it("buildDilemmaDeck source : shuffle customs sans quota auteur", () => {
    const src = read("js/core/dilemmaSession.js");
    assert.match(src, /shuffleArray\(customs\)/);
    assert.doesNotMatch(src, /author.*slice|maxCustom|quota/i);
  });
});

describe("FEATURE-DILEMMA-01 — vote et scoring inchangés", () => {
  it("countDilemmaResults stable", () => {
    const fn = read("js/core/dilemmaSession.js");
    assert.match(fn, /export function countDilemmaResults/);
    assert.match(fn, /majority/);
  });

  it("awardDilemmaRound stable", () => {
    const fn = read("js/core/scoring.js");
    assert.match(fn, /export function awardDilemmaRound/);
    assert.match(fn, /DILEMMA_POINTS_MAJORITY_WIN/);
  });
});

describe("FEATURE-DILEMMA-01 — prepOthersCustomHint (partagé Hot Take)", () => {
  it("hint dilemme et hot take", () => {
    assert.match(
      prepOthersCustomEntriesHintHtml({
        count: 2,
        hintId: "x",
        itemLabel: "dilemme",
        revealedPast: "révélé",
      }),
      /2 dilemmes d'autres joueurs - révélés en manche/
    );
    assert.equal(
      prepOthersCustomEntriesHintHtml({
        count: 0,
        hintId: "x",
        itemLabel: "hot take",
        revealedPast: "révélée",
      }),
      ""
    );
  });
});

describe("FEATURE-DILEMMA-01 — compatibilité client/SQL", () => {
  it("nouveau client : pas de plafond client", () => {
    assert.doesNotMatch(read("js/core/dilemmaSession.js"), /length\s*>=\s*1/);
  });

  it("ancienne SQL : erreur RPC explicite", () => {
    assert.match(
      read("supabase/game-sessions-i08-arch03.sql"),
      /raise exception 'Tu as déjà soumis un dilemme custom.'/
    );
  });

  it("nouvelle SQL : append sans limite par auteur", () => {
    const sql = read("supabase/feature-dilemma-01-multi-custom.sql");
    assert.match(sql, /v_arr := v_arr \|\| jsonb_build_array\(v_entry\)/);
    assert.doesNotMatch(sql, /max 1 custom dilemma/i);
  });
});

describe("FEATURE-DILEMMA-01 — mergeAuthorOwnedCustomList multi-entry", () => {
  it("deux entrées même auteur local conservées", () => {
    const me = "Alice";
    const out = mergeAuthorOwnedCustomList(
      [makeCustom("a", "1", "2", me), makeCustom("b", "3", "4", me)],
      [],
      { normalize: normalizeDilemmaEntry, localAuthor: me }
    );
    assert.equal(out.length, 2);
  });
});
