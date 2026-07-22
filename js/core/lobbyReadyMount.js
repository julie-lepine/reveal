/**
 * Contrats prêts lobby (I-06 / P-01 + ARCH-09 léger).
 * Module pur — importable en tests Node sans Supabase.
 */

/** Mount / remount : jamais de wipe ready. */
export function shouldResetReadyOnLobbyMount() {
  return false;
}

/**
 * ARCH-09 léger : réhydrater depuis le serveur si lobby MP connu.
 * Lecture seule — aucun write ready=false.
 */
export function shouldReconcileLobbyReadyFromServer({ supabaseConfigured, lobbyId }) {
  return Boolean(supabaseConfigured && lobbyId);
}

/** Contrat local setLobbyWaiting / reset ready : tous à false. */
export function mapParticipantsReadyFalse(participants) {
  return (participants || []).map((p) => ({ ...p, ready: false }));
}

/** Préserve les flags ready (remount non destructif). */
export function preserveParticipantsReady(participants) {
  return (participants || []).map((p) => ({ ...p, ready: Boolean(p.ready) }));
}
