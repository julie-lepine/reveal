/**
 * Lancement prep MP avec roster optionnel (joueurs prêts + hôte toujours inclus).
 */
import { getLobbyParticipants } from "./lobby.js";
import { isLobbyHost } from "./gameSync.js";
import { showAppAlert, showAppConfirm } from "./dialog.js";
import { runPrepGameLaunch } from "./mpLaunch.js";
import { buildLaunchRoster } from "./prepRoster.js";

export { buildLaunchRoster } from "./prepRoster.js";

export const DEFAULT_PREP_MIN_PLAYERS = 2;

export function prepLaunchSlotParams({
  readyMap,
  allReady,
  isHost,
  minPlayers,
  poolEmpty = false,
  poolEmptyLabel,
  launchLabel,
  startButtonId = "btn-start-game",
  forceButtonId = "btn-force-start-game",
  readyKey = (p) => p.name,
  participants = getLobbyParticipants(),
}) {
  const { roster, excluded } = buildLaunchRoster(participants, readyMap, { readyKey });
  const canForceLaunch =
    isHost &&
    !poolEmpty &&
    !allReady &&
    roster.length >= minPlayers &&
    excluded.length > 0;
  return {
    poolEmpty,
    poolEmptyLabel,
    allReady,
    isHost,
    launchLabel,
    startButtonId,
    forceButtonId,
    canForceLaunch,
    readyCount: roster.length,
    totalCount: participants.length,
  };
}

export async function confirmForcePrepLaunch({ gameTitle, roster, excluded }) {
  const excludedBlock =
    excluded.length > 0
      ? `\n\nPas prêts - exclus de cette partie :\n${excluded.map((n) => `• ${n}`).join("\n")}`
      : "";
  const includedBlock = roster.map((n) => `• ${n}`).join("\n");
  return showAppConfirm(
    `${roster.length} joueur(s) participeront.${excludedBlock}\n\nParticipants :\n${includedBlock}`,
    {
      title: `Lancer ${gameTitle} quand même ?`,
      confirmLabel: `Lancer (${roster.length} joueur${roster.length > 1 ? "s" : ""})`,
      cancelLabel: "Annuler",
      icon: "▶️",
    }
  );
}

export async function executePrepLaunch({
  force = false,
  btn,
  getReadyMap,
  minPlayers = DEFAULT_PREP_MIN_PLAYERS,
  gameTitle = "la partie",
  gameScreen,
  navStack,
  markStarted,
  allReadyFn,
  validateBeforeLaunch,
  poolEmpty = false,
  readyKey = (p) => p.name,
  participants = getLobbyParticipants(),
}) {
  if (!isLobbyHost()) {
    await showAppAlert("Seul l'hôte peut lancer la partie.", { title: gameTitle, icon: "👑" });
    return null;
  }
  if (poolEmpty) return null;

  const readyMap = getReadyMap();
  const { roster, excluded } = buildLaunchRoster(participants, readyMap, { readyKey });

  if (!force) {
    if (!allReadyFn()) return null;
  } else {
    if (roster.length < minPlayers) {
      await showAppAlert(
        `Il faut au moins ${minPlayers} joueur(s) prêt(s) pour lancer quand même (hôte inclus).`,
        { title: gameTitle, icon: "⚠️" }
      );
      return null;
    }
    const ok = await confirmForcePrepLaunch({ gameTitle, roster, excluded });
    if (!ok) return null;
  }

  if (validateBeforeLaunch) {
    const v = await validateBeforeLaunch(roster, { force });
    if (v && v.ok === false) {
      if (v.message) {
        await showAppAlert(v.message, { title: gameTitle, icon: v.icon || "⚠️" });
      }
      return v;
    }
  }

  const rosterNames = force ? roster : undefined;

  return runPrepGameLaunch({
    btn,
    launch: () => markStarted({ rosterNames }),
    gameScreen,
    navStack,
  });
}
