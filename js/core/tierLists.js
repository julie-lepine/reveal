import { TIER_LISTS } from "../../data/tierTopics.js";
import { deleteCustomTierList as deleteCustomTierListState, getState } from "./state.js";
import { getActivePlayers } from "./players.js";
import { buildRosterListFromPlayerRoster } from "./tierNightRoster.js";
import { CUSTOM_ROSTER_TOPIC_ID_PREFIX } from "./customRosterTopics.js";
import {
  ROSTER_TOPIC_PREFIX,
  parseRosterTopicDescriptor,
  resolveRosterTopicConfig,
} from "./rosterTopic.js";

export { ROSTER_TOPIC_PREFIX as ROSTER_PREFIX };

export function getAllTierLists() {
  const custom = getState().customTierLists || [];
  return [...TIER_LISTS, ...custom];
}

/**
 * Construit une « tier list » dont les items sont les joueurs du lobby.
 * Solo / sélection : lobby live. En MP Classique lancé, préférer
 * `resolveTierNightClassicList` (snapshot session).
 */
export function buildRosterList(topicRef, sessionSnapshot = null) {
  const config = resolveRosterTopicConfig(topicRef, sessionSnapshot);
  if (!config.found) return null;
  const players = getActivePlayers();
  if (!players.length) return null;
  return {
    id: config.topicId,
    name: config.listName,
    emoji: config.topicEmoji,
    logo: "",
    items: players.map((p) => p.name),
    roster: true,
    custom: config.custom,
  };
}

export function getTierListById(id) {
  if (typeof id === "string" && id.startsWith(ROSTER_TOPIC_PREFIX)) {
    return buildRosterList(id);
  }
  return getAllTierLists().find((t) => t.id === id) || null;
}

/**
 * BUG-TIERNIGHT-04 - liste Classique depuis le snapshot session (items + playerRoster).
 * Ne reconstruit pas depuis getActivePlayers() une fois la partie lancée.
 */
export function resolveTierNightClassicList(topicId, sessionLike = null) {
  const items = sessionLike?.items;
  const playerRoster = sessionLike?.playerRoster;
  const parsed = parseRosterTopicDescriptor(topicId);
  const isRosterTopic = parsed.isRoster;

  if (Array.isArray(items) && items.length) {
    if (isRosterTopic || (Array.isArray(playerRoster) && playerRoster.length)) {
      const config = resolveRosterTopicConfig(topicId, sessionLike);
      const isCustomRoster =
        config.custom || parsed.rawId.startsWith(CUSTOM_ROSTER_TOPIC_ID_PREFIX);
      const topicMeta = config.found
        ? { name: config.listName, emoji: isCustomRoster ? "" : config.topicEmoji }
        : {
            name: sessionLike?.listName || "Classe le groupe",
            emoji: isCustomRoster ? "" : sessionLike?.topicEmoji || "👥",
          };
      const fromSnap = buildRosterListFromPlayerRoster(
        topicId,
        Array.isArray(playerRoster) && playerRoster.length
          ? playerRoster
          : items.map((name) => ({ userId: "", displayName: name })),
        topicMeta
      );
      if (fromSnap) {
        return {
          ...fromSnap,
          items: [...items],
          id: topicId || fromSnap.id,
          name: sessionLike?.listName || fromSnap.name,
          emoji: isCustomRoster ? "" : sessionLike?.topicEmoji || fromSnap.emoji,
          custom: config.custom,
        };
      }
    }
    const base = isRosterTopic ? null : getAllTierLists().find((t) => t.id === topicId);
    return {
      id: topicId,
      name: sessionLike?.listName || base?.name || "Tier list",
      emoji: base?.emoji || sessionLike?.topicEmoji || "📋",
      logo: base?.logo || "",
      items: [...items],
      roster: Boolean(base?.roster) || isRosterTopic,
      playerRoster: Array.isArray(playerRoster) ? playerRoster : null,
    };
  }

  if (Array.isArray(playerRoster) && playerRoster.length && isRosterTopic) {
    const config = resolveRosterTopicConfig(topicId, sessionLike);
    const isCustomRoster =
      config.custom || parsed.rawId.startsWith(CUSTOM_ROSTER_TOPIC_ID_PREFIX);
    const topicMeta = config.found
      ? { name: config.listName, emoji: isCustomRoster ? "" : config.topicEmoji }
      : {
          name: sessionLike?.listName || "Classe le groupe",
          emoji: isCustomRoster ? "" : sessionLike?.topicEmoji || "👥",
        };
    return buildRosterListFromPlayerRoster(topicId, playerRoster, topicMeta);
  }

  if (isRosterTopic) {
    return buildRosterList(topicId, sessionLike);
  }

  return getTierListById(topicId);
}

export function deleteCustomTierList(id) {
  return deleteCustomTierListState(id);
}
