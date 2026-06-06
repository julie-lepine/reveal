import { isGameSyncActive } from "./gameSync.js";

/**
 * État partagé pour les écrans prep « Je suis prêt » (optimistic UI + simulate solo).
 */
export function createPrepLobbyController({ localKey, getReadyMap }) {
  let readyCommitInFlight = null;
  let cleanupSim = null;

  function localReadyState() {
    if (readyCommitInFlight !== null) return readyCommitInFlight;
    return Boolean(getReadyMap()[localKey]);
  }

  async function toggleReady({ setReady, simulateReady, render }) {
    const nextReady = !localReadyState();
    readyCommitInFlight = nextReady;
    render();
    try {
      await setReady(localKey, nextReady);
      if (!isGameSyncActive() && nextReady && simulateReady) {
        if (cleanupSim) cleanupSim();
        cleanupSim = simulateReady(render);
      }
      if (!isGameSyncActive() && !nextReady && cleanupSim) {
        cleanupSim();
        cleanupSim = null;
      }
    } finally {
      readyCommitInFlight = null;
      render();
    }
  }

  function dispose() {
    if (cleanupSim) cleanupSim();
    cleanupSim = null;
    readyCommitInFlight = null;
  }

  return { localReadyState, toggleReady, dispose };
}
