import { getLobbyParticipants } from "./lobby.js";
import { showAppAlert } from "./dialog.js";

/** Bloque l'entrée dans un jeu si le lobby n'a pas assez de joueurs. */
export async function requireMinLobbyPlayers(min, { gameTitle, icon = "👥" } = {}) {
  const count = getLobbyParticipants().length;
  if (count >= min) return { ok: true, count, min };
  await showAppAlert(
    `${gameTitle} nécessite au moins ${min} joueurs dans le lobby (${count} pour l'instant).`,
    { title: `${min} joueurs minimum`, icon }
  );
  return { ok: false, count, min };
}
