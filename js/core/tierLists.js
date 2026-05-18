import { TIER_LISTS } from "../../data/tierTopics.js";
import { getState } from "./state.js";

export function getAllTierLists() {
  const custom = getState().customTierLists || [];
  return [...TIER_LISTS, ...custom];
}

export function getTierListById(id) {
  return getAllTierLists().find((t) => t.id === id) || null;
}
