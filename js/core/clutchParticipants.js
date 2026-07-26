/**
 * UX-CLUTCH-01 — snapshot figé des participants Clutch (pur, testable).
 * Distinct du roster lobby live et des joueurs ayant tapé.
 */

/**
 * @typedef {{ userId: string|null, name: string }} ClutchParticipant
 */

/**
 * Normalise une liste brute (objets ou strings legacy) : trim, dédup UID puis nom.
 * @param {Array<ClutchParticipant|string|{userId?:string,uid?:string,name?:string}>} raw
 * @returns {ClutchParticipant[]}
 */
export function normalizeClutchParticipantEntries(raw = []) {
  const out = [];
  const seenUid = new Set();
  const seenName = new Set();

  for (const item of raw) {
    let userId = null;
    let name = "";
    if (typeof item === "string") {
      name = item.trim();
    } else if (item && typeof item === "object") {
      name = String(item.name || "").trim();
      const uid = item.userId ?? item.uid ?? null;
      userId = uid != null && String(uid).trim() ? String(uid).trim() : null;
    }
    if (!name) continue;
    if (userId && seenUid.has(userId)) continue;
    if (seenName.has(name)) continue;
    if (userId) seenUid.add(userId);
    seenName.add(name);
    out.push({ userId, name });
  }
  return out;
}

/**
 * Construit le snapshot au lancement à partir du roster (pseudos) + lobby (UIDs).
 * @param {string[]} rosterNames
 * @param {Array<{ name?: string, userId?: string }>} lobbyParticipants
 * @returns {ClutchParticipant[]}
 */
export function buildClutchParticipantsSnapshot(rosterNames = [], lobbyParticipants = []) {
  const byName = new Map();
  for (const p of lobbyParticipants || []) {
    if (p?.name) byName.set(p.name, p);
  }
  const entries = [];
  for (const raw of rosterNames || []) {
    const name = String(raw || "").trim();
    if (!name) continue;
    const p = byName.get(name);
    entries.push({
      userId: p?.userId ? String(p.userId) : null,
      name,
    });
  }
  return normalizeClutchParticipantEntries(entries);
}

export function sessionHasClutchParticipantSnapshot(session) {
  return Array.isArray(session?.participants) && session.participants.length > 0;
}

/**
 * Noms d’affichage pour les gates de manche.
 * Snapshot prioritaire ; résolution UID → nom live si dispo (rename mid-partie).
 * Legacy sans snapshot → `activeNames` (roster live), jamais un mélange.
 *
 * @param {object|null|undefined} session
 * @param {{
 *   activeNames?: string[],
 *   resolveNameByUserId?: (uid: string) => string|null|undefined,
 * }} [opts]
 * @returns {string[]}
 */
export function resolveClutchParticipantNames(session, opts = {}) {
  const { activeNames, resolveNameByUserId } = opts;

  if (sessionHasClutchParticipantSnapshot(session)) {
    const names = [];
    const seen = new Set();
    for (const p of normalizeClutchParticipantEntries(session.participants)) {
      let name = p.name;
      if (p.userId && typeof resolveNameByUserId === "function") {
        const live = resolveNameByUserId(p.userId);
        if (live && String(live).trim()) name = String(live).trim();
      }
      if (!name || seen.has(name)) continue;
      seen.add(name);
      names.push(name);
    }
    return names;
  }

  const legacy = Array.isArray(activeNames) ? activeNames : [];
  const names = [];
  const seen = new Set();
  for (const raw of legacy) {
    const name = String(raw || "").trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}

/** True si chaque participant du snapshot (ou legacy actifs) a un tap ms. */
export function clutchAllTapsIn(session, taps = {}, opts = {}) {
  const names = resolveClutchParticipantNames(session, opts);
  return names.length > 0 && names.every((n) => taps[n]?.ms != null);
}

/**
 * Classement borné à `playerNames` (snapshot). Tap hors liste ignoré.
 */
export function rankClutchEntries(taps = {}, targetMs, playerNames = []) {
  const entries = playerNames.map((name) => {
    const t = taps[name];
    const tapped = Boolean(t && typeof t.ms === "number" && Number.isFinite(t.ms));
    const ms = tapped ? t.ms : null;
    const gap = tapped ? Math.abs(ms - targetMs) : Infinity;
    const at = t && typeof t.at === "number" ? t.at : Infinity;
    return { name, ms, gap, tapped, at };
  });
  entries.sort((a, b) => {
    if (a.gap !== b.gap) return a.gap - b.gap;
    return a.at - b.at;
  });
  return entries;
}

/** Migre les noms du snapshot (I-09 rename local). */
export function migrateClutchParticipantsRename(participants, oldName, newName) {
  if (!Array.isArray(participants)) return participants;
  return participants.map((p) => {
    if (!p || typeof p !== "object") return p;
    if (p.name === oldName) return { ...p, name: newName };
    return p;
  });
}
