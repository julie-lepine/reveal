/**
 * Contrat de données du récap Draw it !.
 */
import { expectedDrawItGuessers } from "./drawItRound.js";

function participantMap(session = {}) {
  const out = new Map();
  for (const participant of Array.isArray(session.participants)
    ? session.participants
    : []) {
    const uid = String(participant?.userId ?? "").trim();
    if (!uid || out.has(uid)) continue;
    out.set(uid, {
      uid,
      name: String(participant?.name || "Joueur"),
    });
  }
  return out;
}

export function buildDrawItRoundRecap(session = {}) {
  const players = participantMap(session);
  const drawerUid = String(session.drawerUid || "");
  const expected = expectedDrawItGuessers(session);
  const expectedSet = new Set(expected);
  const foundByUid = new Map();
  const foundOrder = Array.isArray(session.lastRound?.foundOrder)
    ? session.lastRound.foundOrder
    : session.foundOrder;
  const deltas =
    session.lastRound?.deltas && typeof session.lastRound.deltas === "object"
      ? session.lastRound.deltas
      : {};
  const pointsFor = (uid) => {
    const name = players.get(uid)?.name;
    const value = deltas[name] ?? deltas[uid] ?? 0;
    const points = Number(value);
    return Number.isFinite(points) ? points : 0;
  };
  for (const entry of Array.isArray(foundOrder)
    ? foundOrder
    : []) {
    const uid = String(entry?.uid ?? entry ?? "").trim();
    if (!uid || !expectedSet.has(uid) || foundByUid.has(uid)) continue;
    foundByUid.set(uid, {
      uid,
      at: entry && typeof entry === "object" ? entry.at ?? null : null,
    });
  }

  const found = [...foundByUid.values()].map((entry, index) => ({
    uid: entry.uid,
    name: players.get(entry.uid)?.name || "Joueur",
    role: "guesser",
    found: true,
    rank: index + 1,
    foundAt: entry.at,
    pointsDelta: pointsFor(entry.uid),
  }));
  const notFound = expected
    .filter((uid) => !foundByUid.has(uid))
    .map((uid) => ({
      uid,
      name: players.get(uid)?.name || "Joueur",
      role: "guesser",
      found: false,
      rank: null,
      foundAt: null,
      pointsDelta: pointsFor(uid),
    }));
  const drawer = drawerUid
    ? {
        uid: drawerUid,
        name: players.get(drawerUid)?.name || "Joueur",
        role: "drawer",
        found: false,
        rank: null,
        foundAt: null,
        pointsDelta: pointsFor(drawerUid),
      }
    : null;

  return {
    roundIdx: Number(session.roundIdx) || 0,
    wordLabel: String(session.lastRound?.wordLabel || ""),
    allGuessersFound: expected.length > 0 && notFound.length === 0,
    rows: [...found, ...notFound, ...(drawer ? [drawer] : [])],
  };
}
