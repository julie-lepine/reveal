import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  mergeReadyMapsLocal,
  mergeAuthorOwnedCustomList,
  mergeDilemmaCustomDilemmas,
  mergeHotTakeCustomTakes,
  mergeDilemmaPatchState,
  mergeHotTakePatchState,
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
  const mergeVotes = (a, b) => b?.votes || a?.votes || {};

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
