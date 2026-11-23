/**
 * Audit petits jeux à votes n°1 — joueur qui quitte le salon en pleine manche.
 *
 * Les jeux vérifient « tout le monde a voté » (joueurs encore présents) seulement
 * quand la partie change. Le départ d'un joueur ne change pas la partie : si le
 * dernier joueur qui n'avait pas voté s'en va, rien ne relance la suite.
 *
 * `watchLobbyDepartures` appelle `onDeparture` quand au moins un membre disparaît
 * du salon (et seulement dans ce cas : pas à chaque mise à jour du salon, qui
 * arrive aussi pour les présences, messages, etc.).
 */
import { getLobbyParticipants } from "./lobby.js";
import { onLobbyBundleUpdated } from "./supabaseLobby.js";

/** UID des membres actuels du salon. */
export function currentLobbyMemberUids(participants = getLobbyParticipants()) {
  return new Set(
    (participants || [])
      .map((p) => (p?.userId ? String(p.userId) : ""))
      .filter(Boolean)
  );
}

/**
 * true si un UID de `before` n'est plus dans `after`.
 * Liste `after` vide : on ne conclut rien (salon pas encore chargé, prudence).
 */
export function hasLobbyDeparture(before, after) {
  if (!before || !after || after.size === 0) return false;
  for (const uid of before) {
    if (!after.has(uid)) return true;
  }
  return false;
}

/**
 * @param {() => void} onDeparture
 * @param {{ subscribe?: typeof onLobbyBundleUpdated, getParticipants?: () => any[] }} [deps] (tests)
 * @returns {() => void} désabonnement
 */
export function watchLobbyDepartures(onDeparture, deps = {}) {
  const subscribe = deps.subscribe || onLobbyBundleUpdated;
  const getParticipants = deps.getParticipants || getLobbyParticipants;
  let known = currentLobbyMemberUids(getParticipants());
  return subscribe(() => {
    const now = currentLobbyMemberUids(getParticipants());
    const departed = hasLobbyDeparture(known, now);
    if (now.size > 0) known = now;
    if (!departed) return;
    try {
      onDeparture();
    } catch (e) {
      console.warn("REVEAL départ d'un joueur :", e);
    }
  });
}
