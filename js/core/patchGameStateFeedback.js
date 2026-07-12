import { patchGameState } from "./gameSync.js";
import { formatSyncErrorMessage } from "./authErrors.js";

/** Patch Supabase avec toast utilisateur en cas d'échec réseau / timeout. */
export async function patchGameStateWithFeedback(stateMerge, options = {}) {
  try {
    return await patchGameState(stateMerge, options);
  } catch (err) {
    console.warn("REVEAL patch:", err);
    const { showAppAlert } = await import("./dialog.js");
    await showAppAlert(formatSyncErrorMessage(err?.message), {
      title: "Connexion",
      icon: "📡",
    });
    throw err;
  }
}
