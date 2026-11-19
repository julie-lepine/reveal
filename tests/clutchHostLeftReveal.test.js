/**
 * Clutch : l'hôte quitte en pleine manche. Le délai de tap des invités se termine
 * AVANT que l'app désigne un remplaçant. Quand le remplaçant est désigné, il doit
 * annoncer le verdict même si l'hôte parti n'a pas tapé ; sinon tout le monde reste
 * bloqué sur « Temps écoulé - en attente du verdict… ».
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { shouldHostRevealClutchRound } from "../js/core/clutchTapCommit.js";
import { clutchAllTapsIn } from "../js/core/clutchParticipants.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("Clutch : hôte parti pendant une manche", () => {
  // Manche figée à 3 joueurs ; l'hôte Alice est partie sans taper.
  const session = {
    participants: [{ name: "Alice" }, { name: "Bob" }, { name: "Chloé" }],
  };
  const taps = { Bob: { ms: 4100, at: 1 }, Chloé: { ms: 3900, at: 2 } };

  it("l'hôte parti n'a pas tapé : « tout le monde a tapé » n'arrive jamais", () => {
    assert.equal(clutchAllTapsIn(session, taps, {}), false);
  });

  it("remplaçant désigné après la fin du délai : il annonce le verdict", () => {
    assert.equal(
      shouldHostRevealClutchRound({
        phase: "active",
        canActAsHost: true,
        allTapsIn: clutchAllTapsIn(session, taps, {}),
        localWindowClosed: true,
      }),
      true
    );
  });

  it("invité qui n'est pas hôte : il n'annonce rien, il attend", () => {
    assert.equal(
      shouldHostRevealClutchRound({
        phase: "active",
        canActAsHost: false,
        allTapsIn: false,
        localWindowClosed: true,
      }),
      false
    );
  });

  it("hôte en pleine manche, délai pas fini et taps manquants : on attend", () => {
    assert.equal(
      shouldHostRevealClutchRound({
        phase: "active",
        canActAsHost: true,
        allTapsIn: false,
        localWindowClosed: false,
      }),
      false
    );
  });

  it("hôte, tout le monde a tapé : verdict (comportement inchangé)", () => {
    assert.equal(
      shouldHostRevealClutchRound({
        phase: "active",
        canActAsHost: true,
        allTapsIn: true,
        localWindowClosed: false,
      }),
      true
    );
  });

  it("manche déjà révélée : rien à faire", () => {
    assert.equal(
      shouldHostRevealClutchRound({
        phase: "reveal",
        canActAsHost: true,
        allTapsIn: true,
        localWindowClosed: true,
      }),
      false
    );
  });

  it("l'écran Clutch utilise cette règle à chaque mise à jour de session", () => {
    const src = readFileSync(join(__dirname, "../js/games/clutch.js"), "utf8");
    const listener = src.slice(src.indexOf("onGameSessionChange((row)"));
    assert.match(listener, /shouldHostRevealClutchRound\(\{[\s\S]*?localWindowClosed,[\s\S]*?\}\)/);
    assert.doesNotMatch(listener, /canActAsHost\(\) && allClutchTapsIn\(\)\) \{/);
  });
});
