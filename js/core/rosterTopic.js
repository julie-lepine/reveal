/**
 * Résolution centralisée des thèmes roster (catalogue + custom + snapshot session).
 */
import { TIER_NIGHT_ROSTER_TOPICS } from "../../data/tierTopics.js";
import { getCustomRosterTopics } from "./state.js";
import { CUSTOM_ROSTER_TOPIC_ID_PREFIX } from "./customRosterTopics.js";

export const ROSTER_TOPIC_PREFIX = "roster:";

/**
 * @param {string|null|undefined} descriptor — `roster:<id>` ou `<id>` brut
 */
export function parseRosterTopicDescriptor(descriptor) {
  const raw = String(descriptor ?? "").trim();
  if (!raw) return { isRoster: false, rawId: "", topicId: "" };
  if (raw.startsWith(ROSTER_TOPIC_PREFIX)) {
    const rawId = raw.slice(ROSTER_TOPIC_PREFIX.length);
    return { isRoster: Boolean(rawId), rawId, topicId: `${ROSTER_TOPIC_PREFIX}${rawId}` };
  }
  return { isRoster: true, rawId: raw, topicId: `${ROSTER_TOPIC_PREFIX}${raw}` };
}

/**
 * @param {string|null|undefined} topicRef
 * @param {object|null|undefined} sessionSnapshot
 * @returns {{ found: boolean, topicId: string, listName: string, topicEmoji: string, custom: boolean }}
 */
export function resolveRosterTopicConfig(topicRef, sessionSnapshot = null) {
  const parsed = parseRosterTopicDescriptor(topicRef);
  if (!parsed.isRoster || !parsed.rawId) {
    return { found: false, topicId: "", listName: "", topicEmoji: "👥", custom: false };
  }

  const { rawId, topicId } = parsed;

  const catalog = TIER_NIGHT_ROSTER_TOPICS.find((t) => t.id === rawId);
  if (catalog) {
    return {
      found: true,
      topicId,
      listName: catalog.name,
      topicEmoji: catalog.emoji || "👥",
      custom: false,
    };
  }

  const custom = getCustomRosterTopics().find((t) => t.id === rawId);
  if (custom) {
    return {
      found: true,
      topicId,
      listName: custom.name,
      topicEmoji: "",
      custom: true,
    };
  }

  const snapTopicId = sessionSnapshot?.topicId != null ? String(sessionSnapshot.topicId) : "";
  const snapName = sessionSnapshot?.listName != null ? String(sessionSnapshot.listName).trim() : "";
  const isCustomSnap = rawId.startsWith(CUSTOM_ROSTER_TOPIC_ID_PREFIX);
  if (snapName && snapTopicId === topicId) {
    return {
      found: true,
      topicId,
      listName: snapName,
      topicEmoji: isCustomSnap ? "" : sessionSnapshot?.topicEmoji || "👥",
      custom: isCustomSnap,
    };
  }

  return { found: false, topicId, listName: "", topicEmoji: "👥", custom: false };
}

/**
 * Merge listName / topicEmoji pour hydratation MP (autorité remote sur run actif).
 * @param {object} opts
 */
export function mergeTierNightTopicMeta({
  local = {},
  remote = {},
  remoteRunId = null,
  localRunId = null,
}) {
  const listNameLocal = typeof local.listName === "string" ? local.listName : "";
  const emojiLocal = typeof local.topicEmoji === "string" ? local.topicEmoji : "";
  const remoteActive = Boolean(remote.lobbyStarted || remote.game);

  if (remoteActive && remoteRunId) {
    const listName =
      typeof remote.listName === "string" ? remote.listName : listNameLocal;
    const topicEmoji =
      typeof remote.topicEmoji === "string" ? remote.topicEmoji : emojiLocal;
    return { listName, topicEmoji };
  }

  const prepReset =
    !remote.lobbyStarted &&
    remote.game == null &&
    (remote.recap == null || remote.recap === undefined) &&
    remoteRunId &&
    localRunId &&
    remoteRunId !== localRunId;

  if (prepReset && Object.prototype.hasOwnProperty.call(remote, "listName") && remote.listName === "") {
    return { listName: "", topicEmoji: "" };
  }

  if (
    remoteRunId &&
    localRunId &&
    remoteRunId === localRunId &&
    typeof remote.listName === "string" &&
    remote.listName
  ) {
    return {
      listName: remote.listName,
      topicEmoji: typeof remote.topicEmoji === "string" ? remote.topicEmoji : emojiLocal,
    };
  }

  return { listName: listNameLocal, topicEmoji: emojiLocal };
}
