import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mergeReadyMapsLocal } from "../js/core/sessionMerge.js";

const NAMES = ["Host", "GuestA", "GuestB"];

/** Simule l’affichage prêt hôte vs invité à partir du même remote (contrat partagé). */
function derivePrepReadyView(localReady, remoteReady, viewerName) {
  return mergeReadyMapsLocal(localReady, remoteReady, NAMES, viewerName);
}

describe("prep ready après Recommencer (mergeReadyMapsLocal)", () => {
  it("1. Partie 1 tous prêts → Partie 2 remote {} → invités affichés non prêts", () => {
    const staleLocal = { Host: true, GuestA: true, GuestB: true };
    const remoteRestart = {};
    const guestView = derivePrepReadyView(staleLocal, remoteRestart, "GuestA");
    assert.equal(guestView.Host, false);
    assert.equal(guestView.GuestA, false);
    assert.equal(guestView.GuestB, false);
  });

  it("2. Serveur ready=false / absent gagne sur cache local true", () => {
    const local = { Host: true, GuestA: true, GuestB: true };
    const remote = { Host: false };
    const out = derivePrepReadyView(local, remote, "GuestA");
    assert.equal(out.Host, false);
    assert.equal(out.GuestB, false);
  });

  it("3. F5/remount 2e prep : ready invalidé ({}) + remote {} → aucun ancien prêt", () => {
    const persistedAfterComplete = {}; // deactivatePlayFlags écrit ready: {}
    const remote = {};
    for (const viewer of ["Host", "GuestA", "GuestB"]) {
      const view = derivePrepReadyView(persistedAfterComplete, remote, viewer);
      assert.equal(view.Host, false);
      assert.equal(view.GuestA, false);
      assert.equal(view.GuestB, false);
    }
  });

  it("4. Un invité clique prêt en 2e prep → lui seul prêt (après ack remote)", () => {
    const remoteAfterAck = { Host: true, GuestA: true };
    const guestView = derivePrepReadyView(
      { Host: true, GuestA: true },
      remoteAfterAck,
      "GuestA"
    );
    assert.equal(guestView.Host, true);
    assert.equal(guestView.GuestA, true);
    assert.equal(guestView.GuestB, false);

    const hostView = derivePrepReadyView({ Host: true }, remoteAfterAck, "Host");
    assert.equal(hostView.Host, true);
    assert.equal(hostView.GuestA, true);
    assert.equal(hostView.GuestB, false);
  });

  it("4b. Avant ack remote : clé absente ne revive pas un prêt stale (bouton = readyCommitInFlight)", () => {
    const out = derivePrepReadyView(
      { Host: true, GuestA: true },
      { Host: true },
      "GuestA"
    );
    assert.equal(out.Host, true);
    assert.equal(out.GuestA, false);
    assert.equal(out.GuestB, false);
  });

  it("5. Realtime ready=false remplace affichage local true (autre joueur)", () => {
    const out = mergeReadyMapsLocal(
      { GuestB: true },
      { GuestB: false, Host: true },
      NAMES,
      "GuestA"
    );
    assert.equal(out.GuestB, false);
    assert.equal(out.Host, true);
  });

  it("6. Pas de reset au mount si serveur indique déjà ready=true", () => {
    const remountLocal = { Host: true, GuestA: true };
    const remote = { Host: true, GuestA: true };
    const out = derivePrepReadyView(remountLocal, remote, "GuestA");
    assert.equal(out.Host, true);
    assert.equal(out.GuestA, true);
  });

  it("7. Hôte et invité dérivent le même état depuis le même remote", () => {
    const remote = { Host: true };
    const hostLocal = { Host: true };
    const guestStale = { Host: true, GuestA: true, GuestB: true };
    const hostView = derivePrepReadyView(hostLocal, remote, "Host");
    const guestView = derivePrepReadyView(guestStale, remote, "GuestA");
    assert.deepEqual(
      { Host: hostView.Host, GuestA: hostView.GuestA, GuestB: hostView.GuestB },
      { Host: guestView.Host, GuestA: guestView.GuestA, GuestB: guestView.GuestB }
    );
    assert.equal(hostView.Host, true);
    assert.equal(hostView.GuestA, false);
    assert.equal(hostView.GuestB, false);
  });

  it("8. Même contrat sur un 2e jeu prep partagée (Hot Take / SpeedVote)", () => {
    // Même choke point mergeReadyMapsLocal pour SpeedVote et Hot Take
    const stale = { Alice: true, Bob: true };
    const remote = {};
    const speedVoteView = mergeReadyMapsLocal(stale, remote, ["Alice", "Bob"], "Bob");
    const hotTakeView = mergeReadyMapsLocal(stale, remote, ["Alice", "Bob"], "Bob");
    assert.deepEqual(speedVoteView, hotTakeView);
    assert.equal(speedVoteView.Alice, false);
    assert.equal(hotTakeView.Alice, false);
  });
});
