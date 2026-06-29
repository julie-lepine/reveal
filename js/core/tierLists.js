import { TIER_LISTS, TIER_NIGHT_ROSTER_TOPICS } from "../../data/tierTopics.js";
import { deleteCustomTierList as deleteCustomTierListState, getState } from "./state.js";
import { getActivePlayers } from "./players.js";

export const ROSTER_PREFIX = "roster:";

export function getAllTierLists() {
  const custom = getState().customTierLists || [];
  return [...TIER_LISTS, ...custom];
}

/** Construit une « tier list » dont les items sont les joueurs du lobby. */
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

export function deleteCustomTierList(id) {
  return deleteCustomTierListState(id);
}
