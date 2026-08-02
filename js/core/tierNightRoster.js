/**
 * BUG-TIERNIGHT-04 — roster / votants figés pour TierNight (Classique + Live).
 * Identité canonique = userId. displayName = label snapshoté au lancement.
 *
 * Ordre : ordre du lobby au moment du lancement (getLobbyParticipants),
 * figé une fois pour le runId — aucun reshuffle ni rebuild depuis getActivePlayers().
 */

/**
 * @typedef {{ userId: string, displayName: string }} TierNightRosterEntry
 */

/**
 * Snapshot ordonné des participants au lancement.
 * @param {Array<{ userId?: string, name?: string }>} participants
 * @returns {TierNightRosterEntry[]}
 */
export function buildTierNightPlayerRoster(participants = []) {
  const out = [];
  const seen = new Set();
  for (const p of participants || []) {
    const userId = p?.userId != null && String(p.userId).trim() ? String(p.userId).trim() : "";
    if (!userId || seen.has(userId)) continue;
    seen.add(userId);
    const displayName = String(p?.name || "").trim() || "Joueur";
    out.push({ userId, displayName });
  }
  return out;
}

export function sessionHasTierNightPlayerRoster(session) {
  return Array.isArray(session?.playerRoster) && session.playerRoster.length > 0;
}

/** UIDs attendus (votants / finishers) depuis le snapshot de partie. */
export function getTierNightExpectedVoterIds(session) {
  if (!sessionHasTierNightPlayerRoster(session)) return [];
  return session.playerRoster.map((r) => r.userId).filter(Boolean);
}

/**
 * Votes mixtes (uid ou pseudo) → map UID, sans supprimer de clé.
 * @param {Record<string, unknown>} votes
 * @param {TierNightRosterEntry[]} playerRoster
 * @param {(name: string) => string|null|undefined} [nameToUid]
 */
export function votesByUidFromMixed(votes = {}, playerRoster = [], nameToUid = () => null) {
  const out = {};
  const byUid = new Set((playerRoster || []).map((r) => r.userId).filter(Boolean));
  const nameToRosterUid = new Map(
    (playerRoster || []).map((r) => [r.displayName, r.userId])
  );
  Object.entries(votes || {}).forEach(([key, val]) => {
    if (val == null || val === "") return;
    const k = String(key);
    if (byUid.has(k)) {
      out[k] = val;
      return;
    }
    const fromRoster = nameToRosterUid.get(k);
    if (fromRoster) {
      out[fromRoster] = val;
      return;
    }
    const mapped = nameToUid(k);
    if (mapped) {
      out[String(mapped)] = val;
      return;
    }
    out[k] = val;
  });
  return out;
}

export function countConfirmedTierNightVotes(votesByUid = {}, expectedIds = []) {
  return expectedIds.filter((id) => votesByUid[id] != null && votesByUid[id] !== "").length;
}

export function hasAllExpectedTierNightVotes(votesByUid = {}, expectedIds = []) {
  return (
    expectedIds.length > 0 &&
    expectedIds.every((id) => votesByUid[id] != null && votesByUid[id] !== "")
  );
}

/**
 * Affichage : snapshot → resolve live → "Joueur".
 * Ne retourne jamais null (un mapping manquant ne fait pas disparaître l'item).
 */
export function displayNameForTierNightUid(
  uid,
  playerRoster = [],
  resolveLiveName = () => null
) {
  const key = uid != null ? String(uid) : "";
  if (!key) return "Joueur";
  const snap = (playerRoster || []).find((r) => r.userId === key);
  if (snap?.displayName) return snap.displayName;
  const live = resolveLiveName(key);
  if (live) return String(live);
  return "Joueur";
}

/**
 * Map votes pour l'UI (clés = displayName snapshoté quand possible).
 * Ne drop jamais une contribution faute de mapping.
 */
export function mapVotesForTierNightLiveUi(
  votes = {},
  playerRoster = [],
  resolveLiveName = () => null
) {
  const out = {};
  const byUid = new Map((playerRoster || []).map((r) => [r.userId, r]));
  const byName = new Set((playerRoster || []).map((r) => r.displayName));
  Object.entries(votes || {}).forEach(([key, val]) => {
    if (val == null || val === "") return;
    const k = String(key);
    if (byUid.has(k)) {
      out[byUid.get(k).displayName] = val;
      return;
    }
    if (byName.has(k)) {
      out[k] = val;
      return;
    }
    const mapped = resolveLiveName(k);
    if (mapped) {
      out[String(mapped)] = val;
      return;
    }
    out[k] = val;
  });
  return out;
}

/** Signale (non bloquant) les clés de vote hors roster attendu. */
export function warnUnexpectedTierNightVoteKeys(votesByUid = {}, expectedIds = []) {
  const expected = new Set(expectedIds || []);
  if (!expected.size) return;
  Object.keys(votesByUid || {}).forEach((k) => {
    if (!expected.has(k)) {
      console.debug("[TierNight] vote key outside expected roster", k);
    }
  });
}

/**
 * Liste Classique « Classe le groupe » depuis un roster figé (pas getActivePlayers).
 */
export function buildRosterListFromPlayerRoster(topicRef, playerRoster, topicMeta = null) {
  const topicId =
    typeof topicRef === "string" && topicRef.startsWith("roster:")
      ? topicRef.slice("roster:".length)
      : topicRef;
  const roster = Array.isArray(playerRoster) ? playerRoster : [];
  if (!roster.length) return null;
  return {
    id: `roster:${topicId}`,
    name: topicMeta?.name || "Classe le groupe",
    emoji: topicMeta?.emoji || "👥",
    logo: "",
    items: roster.map((r) => r.displayName),
    roster: true,
    playerRoster: roster,
  };
}
