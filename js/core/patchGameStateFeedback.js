import { patchGameState } from "./gameSync.js";

/** Patch Supabase avec toast utilisateur en cas d'échec réseau / timeout. */
export async function patchGameStateWithFeedback(stateMerge, options = {}) {
  try {
    return await patchGameState(stateMerge, options);
  } catch (err) {
    console.warn("REVEAL patch:", err);
    const { showAppAlert } = await import("./dialog.js");
    await showAppAlert(err?.message || "Impossible de synchroniser.", {
      title: "Connexion",
      icon: "📡",
    });
    throw err;
  }
}
