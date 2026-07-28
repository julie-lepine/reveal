/**
 * Vague E4 — détection du conflit UNIQUE lobby_members(user_id).
 * Ne mappe PAS tout 23505 vers ALREADY_EXISTS.
 *
 * Forme PostgREST typique (souvent SANS champ `constraint`) :
 * {
 *   code: "23505",
 *   message: 'duplicate key value violates unique constraint "lobby_members_one_living_per_user"',
 *   details: "Key (user_id)=(…) already exists.",
 *   hint: null
 * }
 * Matcher en priorité le nom d’index dans message/details ; fallback étroit Key (user_id).
 */

/** Nom d’index / contrainte stable (SQL e4-02). */
export const LOBBY_MEMBERS_ONE_LIVING_PER_USER =
  "lobby_members_one_living_per_user";

/**
 * @param {unknown} error — erreur PostgREST / Postgres / Error
 * @returns {boolean}
 */
export function isLobbyMembersOneLivingPerUserConflict(error) {
  if (!error || typeof error !== "object") return false;
  const err = /** @type {Record<string, unknown>} */ (error);

  const code = String(err.code || err.code_ || "");
  const constraint = String(
    err.constraint || err.constraint_name || ""
  ).toLowerCase();
  const message = String(err.message || "");
  const details = String(err.details || "");
  const hint = String(err.hint || "");
  const blob = `${constraint}\n${message}\n${details}\n${hint}`.toLowerCase();

  const nameHit = blob.includes(LOBBY_MEMBERS_ONE_LIVING_PER_USER.toLowerCase());
  if (nameHit) return true;

  // Fallback étroit si le nom d’index est absent mais Key (user_id) seul apparaît.
  const is23505 =
    code === "23505" ||
    /unique constraint|duplicate key/i.test(message);
  if (!is23505) return false;

  if (/lobby_members/i.test(blob) && /\(user_id\)/i.test(blob)) {
    if (
      /lobby_id,\s*user_id|unique_name_per_lobby|lobbies_code/i.test(blob)
    ) {
      return false;
    }
    return true;
  }

  return false;
}
