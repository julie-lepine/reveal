/**
 * Vague C — garde canonique de création de lobby (pure + décision injectable).
 *
 * SoT avant INSERT : `queryActiveLobbyMembership()` (Fetch runtime).
 * `found` / `unknown` → refus ; `none` → autorise la tentative d’INSERT.
 * Un snapshot `none` (même frais) ne suffit jamais seul : createLobby re-query toujours.
 *
 * Limite multi-onglets : deux clients peuvent obtenir `none` puis INSERT en parallèle ;
 * aucune contrainte SQL « un lobby vivant par user » n’est ajoutée ici (ticket serveur séparé).
 *
 * Politique snapshot found/unknown : même règle que Home (Vague B) — consommateur,
 * pas `setMembershipSnapshot` bas niveau.
 */

/** Fraîcheur chrome / canCreateLobby synchrone (pas une autorisation d’INSERT). */
export const MEMBERSHIP_SNAPSHOT_FRESH_MS = 30_000;

export const LOBBY_CREATE_ERROR = Object.freeze({
  CACHE_ACTIVE: "LOBBY_CACHE_ACTIVE",
  ALREADY_EXISTS: "LOBBY_MEMBERSHIP_ALREADY_EXISTS",
  CHECK_FAILED: "LOBBY_MEMBERSHIP_CHECK_FAILED",
});

/**
 * @param {string} code
 * @param {string} message
 * @param {object} [extras]
 */
export function makeLobbyCreateError(code, message, extras = {}) {
  const err = new Error(message);
  err.name = "LobbyCreateError";
  err.code = code;
  Object.assign(err, extras);
  return err;
}

/**
 * Décision d’écriture snapshot après query (Home / create).
 * `unknown` + ancien `found` → ne pas écraser.
 *
 * @param {{ status?: string, membership?: { code?: string } }|null|undefined} previous
 * @param {{ status?: string, membership?: object, extraCount?: number }|null|undefined} result
 * @param {string} [source]
 */
export function decideMembershipSnapshotWrite(previous, result, source = "membership-query") {
  if (!result || typeof result !== "object" || !result.status) {
    return { action: "skip" };
  }
  if (
    result.status === "unknown" &&
    previous?.status === "found" &&
    previous.membership?.code
  ) {
    return { action: "retain_found" };
  }
  return { action: "write", result, source };
}

/**
 * @param {{ status?: string, checkedAt?: number }|null|undefined} snapshot
 * @param {number} [now]
 * @param {number} [freshMs]
 */
export function isMembershipSnapshotFresh(
  snapshot,
  now = Date.now(),
  freshMs = MEMBERSHIP_SNAPSHOT_FRESH_MS
) {
  if (!snapshot || typeof snapshot.checkedAt !== "number") return false;
  return now - snapshot.checkedAt >= 0 && now - snapshot.checkedAt <= freshMs;
}

/**
 * Dérivé synchrone — chrome / fast-fail. Pas une autorisation d’INSERT.
 *
 * @param {{
 *   loggedIn?: boolean,
 *   hasActiveLobby?: boolean,
 *   authReady?: boolean,
 *   supabaseConfigured?: boolean,
 *   snapshot?: { status?: string, checkedAt?: number }|null,
 *   now?: number,
 *   freshMs?: number,
 * }} input
 */
export function canCreateLobbyFromInputs(input = {}) {
  const loggedIn = Boolean(input.loggedIn);
  const hasActiveLobby = Boolean(input.hasActiveLobby);
  const authReady = input.authReady !== false;
  const supabaseConfigured = Boolean(input.supabaseConfigured);
  const snapshot = input.snapshot ?? null;
  const now = input.now ?? Date.now();
  const freshMs = input.freshMs ?? MEMBERSHIP_SNAPSHOT_FRESH_MS;

  if (!loggedIn || hasActiveLobby) return false;

  // Offline : pas de snapshot membership — comportement historique.
  if (!supabaseConfigured) return true;

  if (!authReady) return false;
  if (!snapshot || snapshot.status !== "none") return false;
  if (!isMembershipSnapshotFresh(snapshot, now, freshMs)) return false;
  return true;
}

/**
 * Applique le résultat de query au snapshot (politique retain found).
 * @returns {"wrote"|"retained"|"skipped"}
 */
export function applyMembershipQueryToSnapshot(
  result,
  {
    getMembershipSnapshot,
    setMembershipSnapshot,
    source = "create-lobby-guard",
  }
) {
  const decision = decideMembershipSnapshotWrite(
    getMembershipSnapshot(),
    result,
    source
  );
  if (decision.action === "retain_found") return "retained";
  if (decision.action === "write") {
    setMembershipSnapshot(decision.result, decision.source);
    return "wrote";
  }
  return "skipped";
}

/**
 * Garde avant INSERT — injectable / testable sans client Supabase CDN.
 *
 * @param {{
 *   hasActiveLobby?: boolean,
 *   activeLobbyCode?: string|null,
 *   queryActiveLobbyMembership: () => Promise<{ status: string, membership?: { code?: string } }>,
 *   getMembershipSnapshot: () => object|null,
 *   setMembershipSnapshot: (result: object, source?: string) => unknown,
 * }} deps
 * @returns {Promise<{ status: "none" }>}
 */
export async function assertCanInsertLobby(deps) {
  if (deps.hasActiveLobby) {
    const code = deps.activeLobbyCode || "?";
    throw makeLobbyCreateError(
      LOBBY_CREATE_ERROR.CACHE_ACTIVE,
      `Quitte le lobby ${code} avant d'en créer un nouveau.`,
      { lobbyCode: code }
    );
  }

  if (typeof deps.queryActiveLobbyMembership !== "function") {
    throw makeLobbyCreateError(
      LOBBY_CREATE_ERROR.CHECK_FAILED,
      "Impossible de vérifier votre situation. Réessayez."
    );
  }

  let result;
  try {
    result = await deps.queryActiveLobbyMembership();
  } catch {
    result = { status: "unknown" };
  }

  if (!result || typeof result !== "object" || !result.status) {
    result = { status: "unknown" };
  }

  applyMembershipQueryToSnapshot(result, {
    getMembershipSnapshot: deps.getMembershipSnapshot,
    setMembershipSnapshot: deps.setMembershipSnapshot,
    source: "create-lobby-guard",
  });

  if (result.status === "found") {
    const code = result.membership?.code || "?";
    throw makeLobbyCreateError(
      LOBBY_CREATE_ERROR.ALREADY_EXISTS,
      `Tu es déjà dans le lobby ${code}. Quitte-le avant d'en créer un nouveau.`,
      { lobbyCode: code, membership: result.membership || null }
    );
  }

  if (result.status !== "none") {
    // unknown (ou statut inattendu) — jamais « déjà dans un lobby ».
    throw makeLobbyCreateError(
      LOBBY_CREATE_ERROR.CHECK_FAILED,
      "Impossible de vérifier votre situation. Réessayez."
    );
  }

  return { status: "none" };
}
