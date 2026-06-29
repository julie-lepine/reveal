import { getActivePlayerNames, getActivePlayers } from "./players.js";
import { isValidGuessLieSubmission } from "./sessionMerge.js";
import {
  applyGuessLieLobbyCompleteLocal,
  getLocalDisplayName,
  getState,
  saveStatePatch,
  syncGuessLieLobbyCompleteRemote,
} from "./state.js";
import { isGameSyncActive, userIdForName } from "./gameSync.js";
import { runLaunchButton } from "./mpLaunch.js";
import { getCurrentScreen, navigate } from "./router.js";

export function getGuessLieSession() {
  return getState().guessLie;
}

export function hasLocalSubmission() {
  const session = getGuessLieSession();
  const subs = session.submissions || {};
  const name = getLocalDisplayName();
  if (isValidGuessLieSubmission(subs[name])) return true;
  const lobbyName = getState().lobby?.participants?.find((p) => p.isLocal)?.name;
  if (lobbyName && isValidGuessLieSubmission(subs[lobbyName])) return true;
  return false;
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
  const subKeys = Object.keys(submissions || {});
  const playerNames = memberNames.length
    ? [...new Set([...memberNames, ...subKeys])]
    : subKeys;
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
  if (isGuessLieGameActive()) return "guesslie";
  if (!hasLocalSubmission()) return "guesslie-menu";
  return "guesslie-wait";
}

export const GUESS_LIE_PLAY_NAV_STACK = [
  "home",
  "lobby",
  "game-select",
  "guesslie-menu",
  "guesslie-wait",
  "guesslie",
];

const GUESS_LIE_NAV_STACK = {
  guesslie: GUESS_LIE_PLAY_NAV_STACK,
  "guesslie-wait": ["home", "lobby", "game-select", "guesslie-menu", "guesslie-wait"],
  "guesslie-menu": ["home", "lobby", "game-select", "guesslie-menu"],
  "guesslie-setup": ["home", "lobby", "game-select", "guesslie-menu", "guesslie-setup"],
};

function warnNavigateFailure(reason, extra = {}) {
  console.warn(`Guess The Lie: ${reason}`, {
    currentScreen: getCurrentScreen(),
    entry: getGuessLieEntryScreen(),
    rounds: getGuessLieRounds().length,
    lobbyComplete: getGuessLieSession().lobbyComplete,
    phase: getGuessLieSession().phase,
    ...extra,
  });
}

/** Navigation directe vers l'écran de vote (sans garde entry). */
export function forceNavigateToGuessLiePlay() {
  const ok = navigate("guesslie", { navStack: GUESS_LIE_PLAY_NAV_STACK });
  if (!ok) warnNavigateFailure("navigate(guesslie) returned false");
  return ok;
}

/** Navigation vers l'écran de vote (après lancement ou reprise session). */
export function navigateToGuessLiePlay() {
  if (!isGuessLieGameActive()) return false;
  if (!getGuessLieRounds().length) {
    warnNavigateFailure("no rounds available");
    return false;
  }
  return forceNavigateToGuessLiePlay();
}

/** Quitter le salon d'attente si la partie a démarré (retry si navigate a échoué). */
export function tryEnterGuessLiePlayFromWait() {
  if (!isGuessLieGameActive()) return false;
  if (navigateToGuessLiePlay()) return true;
  if (getCurrentScreen() !== "guesslie-wait") return true;
  return forceNavigateToGuessLiePlay();
}

/** Boot / reprise : menu, wait ou partie selon l'état local. */
export function navigateToGuessLieEntry() {
  const entry = getGuessLieEntryScreen();
  if (entry === "guesslie-wait") return false;
  if (entry === "guesslie") return navigateToGuessLiePlay();
  const ok = navigate(entry, {
    navStack: GUESS_LIE_NAV_STACK[entry] || ["home", "lobby", "game-select", entry],
  });
  return ok;
}

/** MP : envoie uniquement le vote du joueur courant (comme Dilemma / Hot Take). */
export async function commitGuessLieVote(pick) {
  const localName = getLocalDisplayName();
  const session = getGuessLieSession();
  const votes = { ...(session.votes || {}), [localName]: pick };
  saveStatePatch({ guessLie: { ...session, votes } });
  if (!isGameSyncActive()) return { ...session, votes };
  const uid = userIdForName(localName) || localName;
  const { patchGameStateWithFeedback } = await import("./patchGameStateFeedback.js");
  await patchGameStateWithFeedback(
    { guessLie: { votes: { [uid]: pick } } },
    { gameId: "guesslie", screen: "guesslie" }
  );
  return { ...session, votes };
}

/** Lancement depuis le salon d'attente ou le menu (solo + MP). */
export async function handleGuessLieLaunch(btn) {
  return runLaunchButton(btn, async () => {
    applyGuessLieLobbyCompleteLocal();
    tryEnterGuessLiePlayFromWait();
    syncGuessLieLobbyCompleteRemote();
  });
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
