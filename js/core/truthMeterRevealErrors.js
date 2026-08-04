const TRUTHMETER_REVEAL_ERROR_MESSAGES = {
  TRUTHMETER_STALE_RUN:
    "Cette manche appartient à une autre partie. Recharge la session.",
  TRUTHMETER_STALE_ROUND: "Manche déjà passée ou pas encore active.",
  TRUTHMETER_INVALID_PHASE: "Impossible de révéler dans cette phase.",
  TRUTHMETER_INVALID_STATE: "État TruthMeter invalide côté serveur.",
  TRUTHMETER_RUN_REQUIRED: "Partie TruthMeter non initialisée (runId manquant).",
  TRUTHMETER_RPC_NOT_DEPLOYED:
    "Action TruthMeter indisponible : migration SQL 01B non appliquée sur Supabase. Exécute game-sessions-truthmeter-01b-reveal-round.sql puis relance une partie.",
};

/** Messages joueur - soumission de vote (jamais de vocabulaire « révéler » / ops). */
const TRUTHMETER_VOTE_ERROR_MESSAGES = {
  TRUTHMETER_STALE_RUN:
    "La partie n'est plus disponible. Reviens au lobby puis réessaie.",
  TRUTHMETER_STALE_ROUND:
    "Cette manche est déjà terminée. Ton vote n'a pas pu être enregistré.",
  TRUTHMETER_INVALID_PHASE:
    "La révélation a déjà commencé. Ton vote n'a pas pu être enregistré.",
  TRUTHMETER_INVALID_STATE:
    "Ce vote n'est pas valide. Réessaie avec une autre valeur.",
  TRUTHMETER_RUN_REQUIRED:
    "La partie n'est plus disponible. Reviens au lobby puis réessaie.",
  TRUTHMETER_RPC_NOT_DEPLOYED:
    "Impossible d'enregistrer ton vote pour le moment. Réessaie.",
  TRUTHMETER_SESSION_GONE:
    "La partie n'est plus disponible. Reviens au lobby puis réessaie.",
  TRUTHMETER_NOT_ALLOWED:
    "Tu n'es plus dans cette partie. Reviens au lobby puis réessaie.",
  TRUTHMETER_VOTE_UNAVAILABLE:
    "Impossible d'enregistrer ton vote pour le moment. Réessaie.",
  TRUTHMETER_VOTE_UNKNOWN: "Impossible d'enregistrer ton vote. Réessaie.",
};

const KNOWN_TRUTHMETER_RPC_CODES = new Set([
  ...Object.keys(TRUTHMETER_REVEAL_ERROR_MESSAGES),
  ...Object.keys(TRUTHMETER_VOTE_ERROR_MESSAGES),
]);

export function truthMeterRevealErrorCode(err) {
  if (err?.code && KNOWN_TRUTHMETER_RPC_CODES.has(err.code)) {
    return err.code;
  }
  const msg = String(err?.message || err || "");
  if (
    msg.includes("Could not find the function") &&
    (msg.includes("reveal_truth_meter_round") ||
      msg.includes("submit_truth_meter_vote"))
  ) {
    return "TRUTHMETER_RPC_NOT_DEPLOYED";
  }
  for (const code of KNOWN_TRUTHMETER_RPC_CODES) {
    if (msg.includes(code)) return code;
  }
  if (/session de jeu introuvable|lobby.*(expir|introuvable)|partie.*(plus disponible|expir)/i.test(msg)) {
    return "TRUTHMETER_SESSION_GONE";
  }
  if (
    /authentification requise|not a (lobby )?member|NOT_ALLOWED|non autoris|pas (un )?membre/i.test(
      msg
    )
  ) {
    return "TRUTHMETER_NOT_ALLOWED";
  }
  return null;
}

function mapTruthMeterCodedError(err, messages) {
  const code = truthMeterRevealErrorCode(err);
  if (!code || !messages[code]) return null;
  const mapped = new Error(messages[code]);
  mapped.code = code;
  mapped.cause = err;
  return mapped;
}

export function mapTruthMeterRevealRpcError(err) {
  return mapTruthMeterCodedError(err, TRUTHMETER_REVEAL_ERROR_MESSAGES) || err;
}

/**
 * Mapper dédié soumission de vote (BUG-TRUTHMETER-01B).
 * Post-reveal → message dédié, jamais « Réessaie » pour la même manche.
 */
export function mapTruthMeterVoteRpcError(err) {
  const coded = mapTruthMeterCodedError(err, TRUTHMETER_VOTE_ERROR_MESSAGES);
  if (coded) return coded;

  const msg = String(err?.message || err || "").toLowerCase();
  const looksNetwork =
    msg.includes("fetch") ||
    msg.includes("network") ||
    msg.includes("timeout") ||
    msg.includes("failed to fetch") ||
    msg.includes("synchronisation trop longue") ||
    err?.name === "AbortError" ||
    err?.name === "TypeError";

  const code = looksNetwork ? "TRUTHMETER_VOTE_UNAVAILABLE" : "TRUTHMETER_VOTE_UNKNOWN";
  const mapped = new Error(TRUTHMETER_VOTE_ERROR_MESSAGES[code]);
  mapped.code = code;
  mapped.cause = err;
  return mapped;
}

export function validateTruthMeterRevealRequest(session) {
  const phase = session?.phase;
  if (phase !== "voting" && phase !== "reveal-pending") {
    return { ok: false, code: "TRUTHMETER_INVALID_PHASE" };
  }
  if (!session?.runId) {
    return { ok: false, code: "TRUTHMETER_RUN_REQUIRED" };
  }
  return {
    ok: true,
    runId: session.runId,
    roundIdx: session.roundIdx ?? 0,
  };
}

export function validateTruthMeterVoteRequest(session) {
  if (!session?.runId) {
    return { ok: false, code: "TRUTHMETER_RUN_REQUIRED" };
  }
  const phase = session?.phase;
  if (phase !== "voting" && phase !== "display") {
    return { ok: false, code: "TRUTHMETER_INVALID_PHASE" };
  }
  return {
    ok: true,
    runId: session.runId,
    roundIdx: session.roundIdx ?? 0,
  };
}

export function isTruthMeterLateVoteError(err) {
  return truthMeterRevealErrorCode(err) === "TRUTHMETER_INVALID_PHASE";
}
