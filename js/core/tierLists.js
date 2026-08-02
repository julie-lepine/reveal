import { TIER_LISTS, TIER_NIGHT_ROSTER_TOPICS } from "../../data/tierTopics.js";
import { deleteCustomTierList as deleteCustomTierListState, getState } from "./state.js";
import { getActivePlayers } from "./players.js";
import { buildRosterListFromPlayerRoster } from "./tierNightRoster.js";

export const ROSTER_PREFIX = "roster:";

export function getAllTierLists() {
  const custom = getState().customTierLists || [];
  return [...TIER_LISTS, ...custom];
}

/**
 * Construit une « tier list » dont les items sont les joueurs du lobby.
 * Solo / sélection : lobby live. En MP Classique lancé, préférer
 * `resolveTierNightClassicList` (snapshot session).
 */
export function buildRosterList(topicRef) {
  const topicId = topicRef.startsWith(ROSTER_PREFIX)
    ? topicRef.slice(ROSTER_PREFIX.length)
    : topicRef;
  const topic = TIER_NIGHT_ROSTER_TOPICS.find((t) => t.id === topicId);
  const players = getActivePlayers();
  if (!players.length) return null;
  return {
    id: `${ROSTER_PREFIX}${topicId}`,
    name: topic?.name || "Classe le groupe",
    emoji: topic?.emoji || "👥",
    logo: "",
    items: players.map((p) => p.name),
    roster: true,
  };
}

export function getTierListById(id) {
  if (typeof id === "string" && id.startsWith(ROSTER_PREFIX)) {
    return buildRosterList(id);
  }
  return getAllTierLists().find((t) => t.id === id) || null;
}

/**
 * BUG-TIERNIGHT-04 — liste Classique depuis le snapshot session (items + playerRoster).
 * Ne reconstruit pas depuis getActivePlayers() une fois la partie lancée.
 */
export function resolveTierNightClassicList(topicId, sessionLike = null) {
  const items = sessionLike?.items;
  const playerRoster = sessionLike?.playerRoster;
  const isRosterTopic =
    typeof topicId === "string" && topicId.startsWith(ROSTER_PREFIX);

  if (Array.isArray(items) && items.length) {
    if (isRosterTopic || (Array.isArray(playerRoster) && playerRoster.length)) {
      const topicKey = isRosterTopic ? topicId.slice(ROSTER_PREFIX.length) : topicId;
      const topic = TIER_NIGHT_ROSTER_TOPICS.find((t) => t.id === topicKey);
      const fromSnap = buildRosterListFromPlayerRoster(
        topicId,
        Array.isArray(playerRoster) && playerRoster.length
          ? playerRoster
          : items.map((name) => ({ userId: "", displayName: name })),
        topic
      );
      if (fromSnap) {
        return { ...fromSnap, items: [...items], id: topicId || fromSnap.id };
      }
    }
    const base = isRosterTopic ? null : getAllTierLists().find((t) => t.id === topicId);
    return {
      id: topicId,
      name: sessionLike?.listName || base?.name || "Tier list",
      emoji: base?.emoji || "📋",
      logo: base?.logo || "",
      items: [...items],
      roster: Boolean(base?.roster) || isRosterTopic,
      playerRoster: Array.isArray(playerRoster) ? playerRoster : null,
    };
  }

  if (Array.isArray(playerRoster) && playerRoster.length && isRosterTopic) {
    const topicKey = topicId.slice(ROSTER_PREFIX.length);
    const topic = TIER_NIGHT_ROSTER_TOPICS.find((t) => t.id === topicKey);
    return buildRosterListFromPlayerRoster(topicId, playerRoster, topic);
  }

  return getTierListById(topicId);
}

export function deleteCustomTierList(id) {
  return deleteCustomTierListState(id);
}
