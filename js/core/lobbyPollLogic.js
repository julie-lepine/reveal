/**
 * Vague 2 - logique pure sondages (testable, sans DOM / Supabase).
 */

export const POLL_CREATE_LOCAL_SCREENS = new Set([
  "results",
  "leaderboard",
  "game-select",
]);

/** @param {unknown} row */
export function normalizeLobbyPollRow(row) {
  if (!row || typeof row !== "object") return null;
  const id = row.id ?? null;
  if (!id) return null;
  const options = Array.isArray(row.options) ? row.options : [];
  return {
    id: String(id),
    lobbyId: row.lobby_id ?? row.lobbyId ?? null,
    createdBy: row.created_by ?? row.createdBy ?? null,
    status: row.status === "closed" ? "closed" : "open",
    options: options.map(normalizePollOption).filter(Boolean),
    closedReason: row.closed_reason ?? row.closedReason ?? null,
    createdAt: row.created_at ?? row.createdAt ?? null,
    closedAt: row.closed_at ?? row.closedAt ?? null,
  };
}

function normalizePollOption(opt) {
  if (!opt || typeof opt !== "object") return null;
  const gameId = String(opt.gameId ?? opt.game_id ?? "").trim();
  const title = String(opt.title ?? "").trim();
  const emoji = String(opt.emoji ?? "").trim();
  if (!gameId || !title || !emoji) return null;
  return { gameId, title, emoji };
}

/** @param {unknown[]} voteRows */
export function normalizeVotesAllByUserId(voteRows = []) {
  const map = {};
  for (const row of voteRows || []) {
    if (!row || typeof row !== "object") continue;
    const uid = row.user_id ?? row.userId;
    const gameId = row.game_id ?? row.gameId;
    if (!uid || gameId == null || gameId === "") continue;
    map[String(uid)] = String(gameId);
  }
  return map;
}

/**
 * Applique un upsert vote (changement = remplacement, pas de doublon).
 * @param {Record<string, string>} votesAllByUserId
 * @param {string} userId
 * @param {string} gameId
 */
export function applyVoteUpsert(votesAllByUserId, userId, gameId) {
  if (!userId || gameId == null || gameId === "") return { ...(votesAllByUserId || {}) };
  return { ...(votesAllByUserId || {}), [String(userId)]: String(gameId) };
}

/** @param {string[]} activeMemberIds @param {Record<string, string>} votesAllByUserId */
export function filterActiveVotes(votesAllByUserId, activeMemberIds) {
  const active = new Set((activeMemberIds || []).map(String));
  const out = {};
  for (const [uid, gameId] of Object.entries(votesAllByUserId || {})) {
    if (active.has(String(uid))) out[uid] = gameId;
  }
  return out;
}

/**
 * @param {{ gameId: string }[]} options
 * @param {Record<string, string>} votesActiveByUserId
 */
export function tallyActiveResults(options, votesActiveByUserId) {
  const counts = {};
  for (const opt of options || []) {
    if (opt?.gameId) counts[opt.gameId] = 0;
  }
  for (const gameId of Object.values(votesActiveByUserId || {})) {
    if (gameId in counts) counts[gameId] += 1;
    else counts[gameId] = (counts[gameId] || 0) + 1;
  }
  return counts;
}

/** @param {Record<string, number>} countsByGameId */
export function resolvePollLeader(countsByGameId) {
  const entries = Object.entries(countsByGameId || {});
  if (!entries.length) {
    return { kind: "none", gameIds: [], maxVotes: 0 };
  }
  let max = -1;
  for (const [, n] of entries) {
    if (n > max) max = n;
  }
  if (max <= 0) {
    return { kind: "none", gameIds: [], maxVotes: 0 };
  }
  const leaders = entries.filter(([, n]) => n === max).map(([id]) => id);
  if (leaders.length > 1) {
    return { kind: "tie", gameIds: leaders, maxVotes: max };
  }
  return { kind: "majority", gameIds: leaders, maxVotes: max };
}

export function localScreenAllowsPollCreate(screenId) {
  return POLL_CREATE_LOCAL_SCREENS.has(screenId);
}

/**
 * Miroir du prédicat SQL can_create_lobby_poll_phase (sans verrou).
 * @param {{ game_id?: string, gameId?: string, screen?: string }|null} sessionRow
 * @param {string|null|undefined} lobbyGameId
 */
export function remotePhaseAllowsPollCreate(sessionRow, lobbyGameId) {
  if (!sessionRow) {
    return lobbyGameId == null || lobbyGameId === "menu";
  }
  const gameId = sessionRow.game_id ?? sessionRow.gameId ?? null;
  const screen = sessionRow.screen ?? null;
  return gameId === "menu" && POLL_CREATE_LOCAL_SCREENS.has(screen);
}

/**
 * @param {{
 *   localScreen: string|null,
 *   sessionRow: object|null,
 *   lobbyGameId: string|null|undefined,
 *   activePoll: object|null,
 * }} args
 */
export function canOfferPollCreate({
  localScreen,
  sessionRow,
  lobbyGameId,
  activePoll,
}) {
  if (activePoll) return false;
  if (!localScreenAllowsPollCreate(localScreen)) return false;
  return remotePhaseAllowsPollCreate(sessionRow, lobbyGameId);
}

/**
 * Fermeture explicite : hôte, acting host ou créateur du sondage.
 * @param {{
 *   uid: string|null|undefined,
 *   poll: { createdBy?: string|null }|null,
 *   isHost: boolean,
 *   isActingHost: boolean,
 *   committingClose?: boolean,
 * }} args
 */
export function canCloseLobbyPoll({
  uid,
  poll,
  isHost,
  isActingHost,
  committingClose = false,
}) {
  if (!poll || committingClose) return false;
  if (isHost || isActingHost) return true;
  if (!uid || !poll.createdBy) return false;
  return String(poll.createdBy) === String(uid);
}

/**
 * Snapshot options depuis le catalogue (pas de saisie libre gameId).
 * @param {Array<{ id: string, title: string, emoji: string }>} games
 * @param {string[]} selectedIds
 */
export function buildPollOptionsSnapshot(games, selectedIds) {
  const byId = new Map((games || []).map((g) => [g.id, g]));
  const seen = new Set();
  const options = [];
  for (const id of selectedIds || []) {
    if (seen.has(id)) continue;
    const g = byId.get(id);
    if (!g) continue;
    seen.add(id);
    options.push({ gameId: g.id, title: g.title, emoji: g.emoji });
  }
  return options;
}

export function validatePollOptionsClient(options) {
  if (!Array.isArray(options) || options.length < 2) {
    return { ok: false, error: "Choisis au moins 2 jeux." };
  }
  if (options.length > 20) {
    return { ok: false, error: "Trop de jeux sélectionnés." };
  }
  const ids = new Set();
  for (const o of options) {
    if (!o?.gameId || !o?.title || !o?.emoji) {
      return { ok: false, error: "Options invalides." };
    }
    if (ids.has(o.gameId)) {
      return { ok: false, error: "Jeux en double." };
    }
    ids.add(o.gameId);
  }
  return { ok: true };
}

/** Garde fetch async : ignore résultats obsolètes (close / autre lobby / gen plus récente). */
export function shouldApplyPollFetchResult({
  gen,
  currentGen,
  requestedLobbyId,
  storeLobbyId,
}) {
  if (gen !== currentGen) return false;
  if (!requestedLobbyId) return false;
  if (storeLobbyId != null && storeLobbyId !== requestedLobbyId) return false;
  return true;
}

/**
 * Un événement Realtime votes ne doit refetch que s'il concerne le poll actif.
 * Sans poll actif : ignorer (lobby_polls gère création/fermeture).
 */
export function shouldRefetchOnVoteRealtime({ activePollId, eventPollId }) {
  if (!activePollId || !eventPollId) return false;
  return String(activePollId) === String(eventPollId);
}

/** Rollback vote optimistic uniquement si on est encore sur le même poll/lobby. */
export function shouldRestoreOptimisticVote({
  votePollId,
  voteLobbyId,
  storePollId,
  storeLobbyId,
}) {
  return (
    Boolean(votePollId) &&
    votePollId === storePollId &&
    voteLobbyId === storeLobbyId
  );
}

/**
 * UPDATE/DELETE Realtime lobby_polls = fermeture du poll actif local.
 * Ne dépend PAS exclusivement de payload.old.status (REPLICA IDENTITY partielle).
 * @param {{ eventType?: string, event?: string, new?: object, old?: object }} payload
 * @param {string|null} activePollId
 */
export function isRealtimeActivePollClose(payload, activePollId) {
  if (!activePollId) return false;
  const eventType = payload?.eventType || payload?.event || "";
  const rowNew = payload?.new || null;
  const rowOld = payload?.old || null;
  const id = rowNew?.id || rowOld?.id;
  if (!id || String(id) !== String(activePollId)) return false;

  if (eventType === "DELETE") return true;

  // Contrat robuste : UPDATE du poll actif + new non-open OU closed_at
  if (eventType === "UPDATE" || !eventType) {
    if (rowNew?.closed_at) return true;
    if (rowNew && rowNew.status != null && rowNew.status !== "open") return true;
    // Complément si old.status dispo
    if (rowOld?.status === "open" && rowNew && rowNew.status !== "open") {
      return true;
    }
  }
  return false;
}

/**
 * INSERT d'un poll open pour le lobby courant.
 * @param {{ eventType?: string, event?: string, new?: object }} payload
 * @param {string} lobbyId
 */
export function isRealtimeOpenPollInsert(payload, lobbyId) {
  if (!lobbyId) return false;
  const eventType = payload?.eventType || payload?.event || "";
  if (eventType !== "INSERT") return false;
  const row = payload?.new;
  if (!row?.id) return false;
  if (String(row.lobby_id) !== String(lobbyId)) return false;
  if (row.status != null && row.status !== "open") return false;
  return true;
}

/**
 * Pastille : nouveau poll id distinct du dernier vu, sheet fermé.
 */
export function computeUnseenPollOnNewId({
  pollId,
  lastSeenPollId,
  sheetOpen,
  localCreate,
  isInitialHydrate,
}) {
  if (!pollId || localCreate || isInitialHydrate) {
    return { unseenPoll: false, lastSeenPollId: pollId || lastSeenPollId };
  }
  if (sheetOpen) {
    return { unseenPoll: false, lastSeenPollId: pollId };
  }
  if (String(pollId) === String(lastSeenPollId || "")) {
    return { unseenPoll: false, lastSeenPollId };
  }
  return { unseenPoll: true, lastSeenPollId };
}

/**
 * clearChannel ne doit pas annuler un debounce de refetch (close / sync).
 * Seul invalidatePollFetches annule volontairement.
 */
export function channelRebuildCancelsDebounce() {
  return false;
}

/**
 * Garde catch-up post join-reply replace (génération / lobby / module).
 */
export function shouldApplyReplacementCatchup({
  expectedChannelGen,
  currentChannelGen,
  catchupLobbyId,
  storeLobbyId,
  started,
}) {
  if (!started) return false;
  if (!catchupLobbyId || !storeLobbyId) return false;
  if (String(catchupLobbyId) !== String(storeLobbyId)) return false;
  if (
    expectedChannelGen != null &&
    currentChannelGen != null &&
    expectedChannelGen !== currentChannelGen
  ) {
    return false;
  }
  return true;
}
