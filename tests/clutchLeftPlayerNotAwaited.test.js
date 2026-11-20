/**
 * Point mineur de l'audit : un joueur qui quitte le salon en cours de partie reste
 * dans la liste figée de Clutch. « Tout le monde a tapé » n'arrivait jamais : chaque
 * manche attendait jusqu'au bout (cible + grâce + attente de l'hôte).
 * Désormais il n'est plus attendu, mais reste classé « pas tapé ».
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildClutchParticipantsSnapshot,
  clutchAllTapsIn,
  rankClutchEntries,
  resolveClutchAwaitedNames,
  resolveClutchParticipantNames,
} from "../js/core/clutchParticipants.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const lobby = [
  { name: "Alice", userId: "uid-alice" },
  { name: "Bob", userId: "uid-bob" },
  { name: "Chloé", userId: "uid-chloe" },
];
const session = { participants: buildClutchParticipantsSnapshot(["Alice", "Bob", "Chloé"], lobby) };
const taps = { Alice: { ms: 4100, at: 1 }, Chloé: { ms: 3900, at: 2 } };

describe("Clutch : joueur parti du salon en cours de partie", () => {
  it("Bob a quitté le salon : il n'est plus attendu, la manche peut se conclure", () => {
    const members = new Set(["uid-alice", "uid-chloe"]);
    assert.deepEqual(resolveClutchAwaitedNames(session, { memberUserIds: members }), ["Alice", "Chloé"]);
    assert.equal(clutchAllTapsIn(session, taps, { memberUserIds: members }), true);
  });

  it("il reste dans le classement, « pas tapé »", () => {
    const names = resolveClutchParticipantNames(session, {});
    assert.deepEqual(names, ["Alice", "Bob", "Chloé"]);
    const bob = rankClutchEntries(taps, 4000, names).find((r) => r.name === "Bob");
    assert.equal(bob.tapped, false);
  });

  it("Bob toujours membre (réseau perdu, pas parti) : toujours attendu", () => {
    const members = new Set(["uid-alice", "uid-bob", "uid-chloe"]);
    assert.equal(clutchAllTapsIn(session, taps, { memberUserIds: members }), false);
  });

  it("liste des membres vide ou absente : comportement d'avant (tout le monde attendu)", () => {
    assert.equal(clutchAllTapsIn(session, taps, { memberUserIds: new Set() }), false);
    assert.equal(clutchAllTapsIn(session, taps, {}), false);
  });

  it("joueur sans identifiant connu : toujours attendu par prudence", () => {
    const s = { participants: [{ name: "Alice", userId: "uid-alice" }, { name: "Invité", userId: null }] };
    const members = new Set(["uid-alice"]);
    assert.deepEqual(resolveClutchAwaitedNames(s, { memberUserIds: members }), ["Alice", "Invité"]);
  });

  it("tout le monde est parti sauf personne : pas de conclusion anticipée", () => {
    assert.equal(clutchAllTapsIn(session, {}, { memberUserIds: new Set(["uid-autre"]) }), false);
  });

  it("l'écran utilise la liste des membres actuels du salon", () => {
    const src = readFileSync(join(ROOT, "js/core/clutchSession.js"), "utf8");
    const fn = src.slice(src.indexOf("export function allClutchTapsIn"));
    assert.match(fn, /getLobbyParticipants\(\)[\s\S]{0,120}p\.userId/);
    assert.match(fn, /clutchAllTapsIn\(session, session\.taps \|\| \{\}, \{\s*memberUserIds,/);
  });
});
