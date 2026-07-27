/**
 * Normalisation PostgREST lobby_members → LivingRow.
 * Pure, sans import Supabase — testable en Node.
 *
 * Forme brute many-to-one attendue :
 *   { lobby_id, joined_at, lobbies: { id, code, status, game_id, host_id } }
 */

/**
 * @typedef {{
 *   lobbyId: string,
 *   joinedAt: string|null,
 *   code: string,
 *   lobbyStatus: string|null,
 *   gameId: string|null,
 *   hostId: string|null,
 * }} LivingMembershipRow
 */

/**
 * @param {unknown} raw
 * @returns {LivingMembershipRow|null}
 */
export function normalizePostgrestMembershipRow(raw) {
  if (!raw || typeof raw !== "object") return null;
  const lobbies = /** @type {{ lobbies?: unknown }} */ (raw).lobbies;
  if (lobbies == null) return null;
  if (Array.isArray(lobbies)) return null;
  if (typeof lobbies !== "object") return null;

  const lobby = /** @type {{ id?: unknown, code?: unknown, status?: unknown, game_id?: unknown, host_id?: unknown }} */ (
    lobbies
  );
  if (!lobby.id || !lobby.code) return null;

  const row = /** @type {{ lobby_id?: unknown, joined_at?: unknown }} */ (raw);
  return {
    lobbyId: String(lobby.id),
    joinedAt: row.joined_at != null ? String(row.joined_at) : null,
    code: String(lobby.code),
    lobbyStatus: lobby.status != null ? String(lobby.status) : null,
    gameId: lobby.game_id != null ? String(lobby.game_id) : null,
    hostId: lobby.host_id != null ? String(lobby.host_id) : null,
  };
}

/**
 * @param {unknown} data
 * @returns {LivingMembershipRow[]}
 */
export function normalizePostgrestMembershipData(data) {
  if (data == null) return [];
  const list = Array.isArray(data) ? data : [data];
  return list.map(normalizePostgrestMembershipRow).filter(Boolean);
}
