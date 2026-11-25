/**
 * Audit badges, classement et stats n°2 — joueurs partis gardés dans la soirée.
 *
 * Les points et stats de la soirée sont rangés par identifiant (uid) dans la
 * session, et par pseudo sur chaque téléphone. Un joueur qui a quitté le salon
 * n'est plus dans la liste des participants : sans autre source, son uid ne se
 * traduisait plus en pseudo et l'hôte l'effaçait du serveur au prochain envoi.
 *
 * Ce module garde, pour le salon en cours, la correspondance uid → pseudo de
 * tous les joueurs vus (participants actuels et liste `eveningPlayerNames` de
 * la session), et fournit les fonctions pures de résolution.
 */

export const EVENING_PLAYER_NAMES_KEY = "eveningPlayerNames";
export const DEPARTED_NAME_SUFFIX = " (parti)";
const MAX_NAME_LENGTH = 64;
const MAX_ENTRIES = 200;
const UID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let store = { lobbyId: null, names: {} };

function ensureLobby(lobbyId) {
  const id = lobbyId || null;
  if (store.lobbyId !== id) store = { lobbyId: id, names: {} };
}

/** Identifiant de compte (les anciennes clés en pseudo ne sont pas reprises). */
export function isPlayerUid(key) {
  return typeof key === "string" && UID_RE.test(key);
}

function cleanName(name) {
  if (typeof name !== "string") return null;
  const trimmed = name.trim().slice(0, MAX_NAME_LENGTH);
  return trimmed || null;
}

function setName(uid, name) {
  const clean = cleanName(name);
  if (!isPlayerUid(uid) || !clean) return;
  if (!(uid in store.names) && Object.keys(store.names).length >= MAX_ENTRIES) return;
  store.names[uid] = clean;
}

/** Fusionne la liste reçue de la session (sans écraser un participant actuel). */
export function rememberEveningPlayerNames(lobbyId, remoteNames, participants = []) {
  ensureLobby(lobbyId);
  if (!remoteNames || typeof remoteNames !== "object" || Array.isArray(remoteNames)) return;
  const active = new Set((participants || []).map((p) => p?.userId).filter(Boolean));
  for (const [uid, name] of Object.entries(remoteNames)) {
    if (active.has(uid)) continue;
    setName(uid, name);
  }
}

/** Enregistre les participants actuels (pseudo à jour, y compris après un changement). */
export function rememberEveningParticipants(lobbyId, participants = []) {
  ensureLobby(lobbyId);
  for (const p of participants || []) {
    if (p?.userId && p?.name) setName(String(p.userId), p.name);
  }
}

export function getEveningPlayerNames(lobbyId) {
  ensureLobby(lobbyId);
  return { ...store.names };
}

/**
 * Pseudo affiché d'un joueur parti, ou null (inconnu, ou encore dans le salon).
 * Si un joueur présent porte le même pseudo, on ajoute « (parti) » pour ne pas
 * mélanger leurs points.
 */
export function departedDisplayName(uid, names = {}, participants = []) {
  const key = String(uid ?? "");
  const base = names[key];
  if (!base) return null;
  const ps = participants || [];
  if (ps.some((p) => p?.userId === key)) return null;
  return ps.some((p) => p?.name === base) ? `${base}${DEPARTED_NAME_SUFFIX}` : base;
}

/** Inverse de departedDisplayName. */
export function departedUidForName(name, names = {}, participants = []) {
  if (!name) return null;
  for (const uid of Object.keys(names)) {
    if (departedDisplayName(uid, names, participants) === name) return uid;
  }
  return null;
}

/**
 * Remet dans `next` (clés uid) les entrées du serveur `prev` qui n'y sont pas :
 * un joueur que ce téléphone ne connaît pas n'est plus effacé du serveur.
 */
export function carryOverMissingUidEntries(next = {}, prev = {}, isValid = (v) => typeof v === "number" && Number.isFinite(v)) {
  const out = { ...(next || {}) };
  if (!prev || typeof prev !== "object") return out;
  for (const [uid, val] of Object.entries(prev)) {
    if (!isPlayerUid(uid) || Object.prototype.hasOwnProperty.call(out, uid)) continue;
    if (isValid(val)) out[uid] = val;
  }
  return out;
}

/** Tests uniquement. */
export function __resetEveningPlayerNamesForTests() {
  store = { lobbyId: null, names: {} };
}
