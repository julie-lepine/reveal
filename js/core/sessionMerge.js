/**
 * Fusions d'état multijoueur (prêt, customs par auteur) - testables sans Supabase.
 */

export function normalizeDilemmaEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  const optionA = String(entry.optionA || "").trim();
  const optionB = String(entry.optionB || "").trim();
  if (!optionA || !optionB) return null;
  return {
    id: entry.id || `custom-${optionA}-${optionB}`,
    optionA,
    optionB,
    author: entry.author || null,
    tier: entry.tier || "custom",
  };
}

export function normalizeHotTakeEntry(entry) {
  if (typeof entry === "string") {
    const text = entry.trim();
    if (!text) return null;
    return { id: `legacy-${text.slice(0, 24)}`, text, author: null, themeId: null };
  }
  if (!entry || typeof entry !== "object") return null;
  const text = String(entry.text || "").trim();
  if (!text) return null;
  return {
    id: entry.id || `custom-${text.slice(0, 24)}-${entry.author || "anon"}`,
    text,
    author: entry.author || null,
    themeId: entry.themeId || null,
  };
}

/** En préparation : un joueur « prêt » côté local ou remote compte pour tous les actifs. */
export function mergeReadyMapsLocal(localReady = {}, remoteReady = {}, activeNames = []) {
  const merged = { ...remoteReady };
  activeNames.forEach((name) => {
    if (localReady[name] || remoteReady[name]) merged[name] = true;
  });
  return merged;
}

/**
 * Liste locale = source de vérité pour le joueur local ; remote = entrées des autres auteurs.
 * Les suppressions locales ne sont pas réinjectées depuis le serveur.
 */
export function mergeAuthorOwnedCustomList(
  localList = [],
  remoteList = [],
  { normalize, localAuthor }
) {
  const me = localAuthor;
  const byId = new Map();
  for (const raw of remoteList) {
    const item = normalize(raw);
    if (!item) continue;
    const author = item.author;
    if (author && author !== me) byId.set(item.id, item);
  }
  for (const raw of localList) {
    const item = normalize(raw);
    if (item) byId.set(item.id, item);
  }
  return [...byId.values()];
}

export function mergeDilemmaCustomDilemmas(localList, remoteList, localAuthor) {
  return mergeAuthorOwnedCustomList(localList, remoteList, {
    normalize: normalizeDilemmaEntry,
    localAuthor,
  });
}

export function mergeHotTakeCustomTakes(localList, remoteList, localAuthor) {
  return mergeAuthorOwnedCustomList(localList, remoteList, {
    normalize: normalizeHotTakeEntry,
    localAuthor,
  });
}

/** État dilemma pour patchGameState (inc = patch client, cur = serveur). */
export function mergeDilemmaPatchState(curDm, incDm, localAuthor, { mergeReadyUid, mergeVotes }) {
  if (!curDm) return incDm;
  if (!incDm) return curDm;
  return {
    ...curDm,
    ...incDm,
    ready: mergeReadyUid(curDm, incDm),
    votes: mergeVotes(curDm, incDm),
    customDilemmas: mergeDilemmaCustomDilemmas(
      incDm.customDilemmas || [],
      curDm.customDilemmas || [],
      localAuthor
    ),
  };
}

/** État hot take pour patchGameState. */
export function mergeHotTakePatchState(curHt, incHt, localAuthor, { mergeReadyUid, mergeVotes }) {
  if (!curHt) return incHt;
  if (!incHt) return curHt;
  return {
    ...curHt,
    ...incHt,
    ready: mergeReadyUid(curHt, incHt),
    votes: mergeVotes(curHt, incHt),
    customTakes: mergeHotTakeCustomTakes(
      incHt.customTakes || [],
      curHt.customTakes || [],
      localAuthor
    ),
  };
}
