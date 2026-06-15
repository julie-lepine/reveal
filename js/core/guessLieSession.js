import { GUESS_LIE_ROUNDS } from "../../data/guessLies.js";
import { getActivePlayerNames, getActivePlayers } from "./players.js";
import { isValidGuessLieSubmission } from "./sessionMerge.js";
import { getLocalDisplayName, getState } from "./state.js";
import {
  navigateAfterGameLaunch,
  runLaunchButton,
} from "./mpLaunch.js";

export function getGuessLieSession() {
  return getState().guessLie;
}

export function hasLocalSubmission() {
  const session = getGuessLieSession();
  return isValidGuessLieSubmission(session.submissions[getLocalDisplayName()]);
}

export function getLobbyMembers() {
  return getActivePlayers();
}

export function getLobbyMemberNames() {
  return getActivePlayerNames();
}

export function allLobbySubmitted() {
  const { submissions } = getGuessLieSession();
  return getLobbyMemberNames().every((n) => isValidGuessLieSubmission(submissions[n]));
}

export function getGuessLieRounds() {
  const { submissions } = getGuessLieSession();
  const memberNames = getLobbyMemberNames();
  const playerNames = memberNames.length
    ? memberNames
    : Object.keys(submissions || {});
  return playerNames
    .filter((n) => isValidGuessLieSubmission(submissions[n]))
    .map((n) => ({
      player: n,
      statements: submissions[n].statements,
      lie: submissions[n].lie,
    }));
}

/** Partie en cours (aligné sur resolveActivePlayScreen dans gameSync). */
export function isGuessLieGameActive(session = getGuessLieSession()) {
  if (session.lobbyComplete) return true;
  const phase = session.phase;
  return phase === "voting" || phase === "reveal";
}

export function getGuessLieEntryScreen() {
  if (!hasLocalSubmission()) return "guesslie-menu";
  if (isGuessLieGameActive()) return "guesslie";
  return "guesslie-wait";
}

/** Lancement depuis le salon d'attente ou le menu (solo + MP avec secours local). */
export async function handleGuessLieLaunch(btn) {
  return runLaunchButton(btn, async () => {
    const { markGuessLieLobbyComplete } = await import("./state.js");
    const result = await markGuessLieLobbyComplete();
    navigateAfterGameLaunch({ gameScreen: "guesslie", result, forceNavigate: true });
    return result;
  });
}

export function fallbackForPlayer(playerName) {
  const preset = GUESS_LIE_ROUNDS.find((r) => r.player === playerName);
  if (preset) return { statements: [...preset.statements], lie: preset.lie };
  return {
    statements: [
      `${playerName} a déjà raté un devoir.`,
      `${playerName} adore les sushis.`,
      `${playerName} a un chat nommé Pixel.`,
    ],
    lie: 2,
  };
}

/** Votes NPC pour une manche (index du mensonge) */
export function simulateRoundVotes(round, excludeName) {
  const votes = {};
  const local = getLocalDisplayName();
  getLobbyMemberNames().forEach((name) => {
    if (name === excludeName) return;
    if (name === local) return;
    const pick = Math.floor(Math.random() * 3);
    votes[name] = pick;
  });
  return votes;
}
