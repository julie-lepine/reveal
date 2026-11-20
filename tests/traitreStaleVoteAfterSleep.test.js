/**
 * Audit Le Traître n°2 — téléphone en veille pendant les indices.
 * Il passait du vote du tour N directement au vote du tour N+1 (sans voir la
 * phase « indices ») : l'ancien vote local revenait, affiché « Vote enregistré »,
 * alors que le serveur ne l'avait pas.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isNewTraitreVoteRound, mergeTraitrePatchState } from "../js/core/sessionMerge.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");

const mergeReadyUid = (a, b) => ({ ...a?.ready, ...b?.ready });
const mergeVotes = (a, b) => ({ ...(a?.votes || {}), ...(b?.votes || {}) });

describe("Le Traître : vote d'un tour plus récent", () => {
  const before = { phase: "vote", speakRound: 2, votes: { b: "c" } };

  it("vote → vote d'un tour plus récent : nouveau vote", () => {
    assert.equal(isNewTraitreVoteRound(before, { phase: "vote", speakRound: 3, votes: {} }), true);
  });

  it("même tour : pas un nouveau vote (le vote local reste)", () => {
    assert.equal(isNewTraitreVoteRound(before, { phase: "vote", speakRound: 2, votes: {} }), false);
  });

  it("ligne en retard d'un tour plus ancien : rien n'est vidé", () => {
    assert.equal(isNewTraitreVoteRound(before, { phase: "vote", speakRound: 1, votes: {} }), false);
  });

  it("patch sans numéro de tour : inchangé", () => {
    assert.equal(isNewTraitreVoteRound(before, { phase: "vote", votes: {} }), false);
  });

  it("fusion : l'ancien vote ne revient pas, seuls les votes du serveur restent", () => {
    const out = mergeTraitrePatchState(
      before,
      { phase: "vote", speakRound: 3, votes: { a: "c" } },
      { mergeReadyUid, mergeVotes, newVoteRound: isNewTraitreVoteRound(before, { phase: "vote", speakRound: 3 }) }
    );
    assert.deepEqual(out.votes, { a: "c" });
    assert.equal(out.speakRound, 3);
  });

  it("la fusion complète (rechargement / retour de veille) prend les votes du serveur", () => {
    const src = read("js/core/gameSync.js");
    const fn = src.slice(src.indexOf("function mergeTraitreGameLocal("));
    assert.match(fn, /const newVoteRound = isNewTraitreVoteRound\(local, remote\);/);
    assert.match(fn, /if \(newVoteRound \|\| tieVoteReset\) \{\s*votes = remoteVotes;/);
  });
});
