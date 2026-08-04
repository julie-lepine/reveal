/**
 * API production - résolution membership lobby (Vague A).
 *
 * Convention d’import runtime (Vague B+) :
 *   import { queryActiveLobbyMembership } from "../core/lobbyMembershipFetch.js";
 *   import { getMembershipSnapshot, setMembershipSnapshot, invalidateMembershipSnapshot }
 *     from "../core/lobbyMembershipSnapshot.js";
 *
 * Tests / deps injectées :
 *   import { queryActiveLobbyMembership } from "../core/lobbyMembershipQuery.js"; // (deps)
 *
 * Cette fonction homonyme câble Supabase ; la variante injectable vit dans
 * lobbyMembershipQuery.js. Ne pas importer les deux signatures dans un même
 * contexte ambigu.
 *
 * Aucun effet de bord hors fetch réseau : pas d’hydrate, snapshot, leave, UI.
 */

import { supabase, isSupabaseConfigured } from "./supabaseClient.js";
import { getSupabaseUserId } from "./supabaseAuth.js";
import {
  ACTIVE_MEMBERSHIP_QUERY_LIMIT,
  queryActiveLobbyMembership as queryActiveLobbyMembershipWithDeps,
} from "./lobbyMembershipQuery.js";
import {
  normalizePostgrestMembershipData,
  normalizePostgrestMembershipRow,
} from "./lobbyMembershipNormalize.js";

export {
  ACTIVE_MEMBERSHIP_QUERY_LIMIT,
  normalizePostgrestMembershipData,
  normalizePostgrestMembershipRow,
};

/**
 * Fetch PostgREST : memberships jointes à un lobby vivant (`!inner`).
 * Pas de filtre `isLobbyJoinTooOld`. Pas de remember/guest hints.
 *
 * @param {string} userId
 * @returns {Promise<{ ok: true, rows: import("./lobbyMembershipNormalize.js").LivingMembershipRow[] }|{ ok: false, error: unknown }>}
 */
export async function fetchLivingMembershipRowsForUser(userId) {
  try {
    if (!supabase || !userId) {
      return { ok: false, error: new Error("fetch_unavailable") };
    }
    const { data, error } = await supabase
      .from("lobby_members")
      .select("lobby_id, joined_at, lobbies!inner(id, code, status, game_id, host_id)")
      .eq("user_id", userId)
      .order("joined_at", { ascending: false })
      .limit(ACTIVE_MEMBERSHIP_QUERY_LIMIT);

    if (error) return { ok: false, error };
    return { ok: true, rows: normalizePostgrestMembershipData(data) };
  } catch (error) {
    return { ok: false, error };
  }
}

/**
 * Résolution ternaire production : `none` | `found` | `unknown`.
 * @param {string|null|undefined} [userId]
 */
export async function queryActiveLobbyMembership(userId = getSupabaseUserId()) {
  return queryActiveLobbyMembershipWithDeps({
    userId,
    getUserId: getSupabaseUserId,
    isSupabaseConfigured,
    fetchLivingMembershipRows: fetchLivingMembershipRowsForUser,
  });
}
