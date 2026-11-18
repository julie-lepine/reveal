/**
 * « Ajouter ma hot take » : addCustomTake levait
 * « ReferenceError: checkHotTakeModeration is not defined » (réexport sans import local).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { HOT_TAKE_FORBIDDEN_WORDS } from "../data/hotTakes.js";
import { addCustomTake, checkHotTakeModeration } from "../js/core/hotTakeSession.js";

describe("addCustomTake - modération branchée", () => {
  it("une hot take correcte est ajoutée", async () => {
    const res = await addCustomTake("Les chats sont meilleurs que les chiens");
    assert.equal(res.ok, true);
  });

  it("une hot take avec un terme interdit est refusée, avec le message de modération", async () => {
    const word = HOT_TAKE_FORBIDDEN_WORDS[0];
    const res = await addCustomTake(`Franchement ${word} pour tout le monde`);
    assert.equal(res.ok, false);
    assert.match(res.error, /terme interdit/);
  });

  it("le réexport public reste disponible", () => {
    assert.equal(typeof checkHotTakeModeration, "function");
  });
});
