/**
 * Lancement multijoueur unifié - à réutiliser pour tout nouveau jeu.
 *
 * Patterns :
 * - `launchGameWithSync` : sync remote d'abord, local ensuite, fallback + retry si échec
 * - `runLaunchButton` : bouton « Lancer » (disable + label)
 * - `navigateAfterGameLaunch` : navigation hôte après lancement
 * - `prepGuestFollowOnSession` : invités sur écran prep qui suivent l'hôte
 *
 * Modes sync :
 * - `patch` : patch léger via patchGameState (ex. Guess The Lie - contenu déjà sur le serveur)
 * - `push` : blob complet via pushGameSession (ex. deck construit au lancement)
 *
 * En partie (hôte) : `commitHostGamePlay` + `pickRemotePlayFields` (playPatch.js)
 */
import {
  DEFAULT_SYNC_PATCH_TIMEOUT_MS,
  getCachedGameSession,
  isGameSyncActive,
  isLobbyHost,
  patchGameState,
  pushGameSession,
  userIdForName,
} from "./gameSync.js";
import { pickRemotePlayFields } from "./playPatch.js";
import { showAppAlert } from "./dialog.js";
import { getCurrentScreen, navigate } from "./router.js";

export { DEFAULT_SYNC_PATCH_TIMEOUT_MS as SYNC_PATCH_TIMEOUT_MS };

export const SYNC_SLOW_LAUNCH_MESSAGE =
  "La sync est lente - la partie démarre chez toi. Les autres peuvent avoir un léger retard.";

/**
 * Envoie l'état de lancement au serveur (patch léger ou push complet).
 * @param {'patch'|'push'} mode
 */
export async function commitMultiplayerLaunch({
  screen,
  gameId,
  state,
  mode = "push",
  timeoutMs = DEFAULT_SYNC_PATCH_TIMEOUT_MS,
}) {
  if (!isGameSyncActive() || !isLobbyHost()) {
    return { ok: true, skipped: true };
  }

  if (mode === "patch") {
    await patchGameState(state, { screen, gameId, timeoutMs });
    return { ok: true };
  }

  const row = await pushGameSession({
    screen,
    gameId,
    state,
    timeoutMs,
    alertOnFailure: false,
  });
  if (!row) {
    throw new Error("Synchronisation impossible.");
  }
  return { ok: true };
}

/**
 * Lance une partie MP : remote d'abord, applyLocal ensuite ; fallback local + retry si timeout.
 *
 * @example patch léger (Guess The Lie)
 * launchGameWithSync({
 *   screen: "guesslie", gameId: "guesslie", mode: "patch",
 *   applyLocal: () => saveStatePatch({ guessLie: next }),
 *   getRemoteState: () => ({ guessLie: guessLieLobbyStartToRemote() }),
 * });
 *
 * @example push complet (deck au lancement)
 * launchGameWithSync({
 *   screen: "dilemma", gameId: "dilemma", mode: "push",
 *   beforeCommit: () => setLobbyPlaying("dilemma"),
 *   applyLocal: () => saveStatePatch({ dilemmaGame: next }),
 *   getRemoteState: () => ({ dilemma: dilemmaToRemote(next) }),
 * });
 */
export async function launchGameWithSync({
  screen,
  gameId,
  applyLocal,
  getRemoteState,
  mode = "push",
  beforeCommit,
  timeoutMs = DEFAULT_SYNC_PATCH_TIMEOUT_MS,
  fallbackMessage = SYNC_SLOW_LAUNCH_MESSAGE,
}) {
  if (beforeCommit) await beforeCommit();

  if (!isGameSyncActive()) {
    applyLocal();
    return { ok: true };
  }

  if (!isLobbyHost()) {
    applyLocal();
    return { ok: true };
  }

  const remoteState = getRemoteState();
  const commit = () =>
    commitMultiplayerLaunch({ screen, gameId, state: remoteState, mode, timeoutMs });

  try {
    await commit();
    applyLocal();
    return { ok: true };
  } catch (err) {
    console.warn(`Launch ${gameId}:`, err);
    applyLocal();
    void commit().catch(() => {});
    await showAppAlert(fallbackMessage, { title: "Connexion", icon: "📡" });
    return { ok: false, usedFallback: true, error: err };
  }
}

/** Désactive un bouton pendant une action async (lancement, sync). */
export async function runLaunchButton(btn, launchFn, { loadingLabel = "Lancement…" } = {}) {
  const prevLabel = btn?.textContent;
  if (btn) {
    btn.disabled = true;
    btn.textContent = loadingLabel;
  }
  try {
    return await launchFn();
  } finally {
    if (btn?.isConnected) {
      btn.disabled = false;
      if (prevLabel) btn.textContent = prevLabel;
    }
  }
}

/**
 * Navigation hôte après lancement : secours si le routage session n'a pas basculé l'écran.
 */
export function navigateAfterGameLaunch({
  gameScreen,
  navStack,
  result,
  forceNavigate = false,
}) {
  const mp = isGameSyncActive();
  if (forceNavigate || !mp || result?.usedFallback || getCurrentScreen() !== gameScreen) {
    navigate(gameScreen, navStack ? { navStack } : { reset: true });
  }
}

/**
 * Handler `onGameSessionChange` pour écrans prep : invités suivent l'hôte quand la partie démarre.
 */
export function prepGuestFollowOnSession({ prepScreen, getEntryScreen, buildNavStack }) {
  return () => {
    if (isGameSyncActive() && !isLobbyHost()) {
      const row = getCachedGameSession();
      if (row?.screen === "results") {
        navigate("results", { navStack: ["home", "lobby", "game-select", "results"] });
        return true;
      }
      if (row?.screen === "leaderboard") {
        navigate("leaderboard", { navStack: ["home", "lobby", "game-select", "leaderboard"] });
        return true;
      }
    }
    const entry = getEntryScreen();
    if (entry === prepScreen) return false;
    navigate(entry, buildNavStack ? { navStack: buildNavStack(entry) } : { reset: true });
    return true;
  };
}

/**
 * Flux prep standard : bouton lancer → mark*LobbyStarted → navigation.
 */
export async function runPrepGameLaunch({
  btn,
  launch,
  gameScreen,
  navStack,
  hostOnly = true,
}) {
  if (hostOnly && !isLobbyHost()) return null;
  return runLaunchButton(btn, async () => {
    const result = await launch();
    if (result?.ok === false && !result?.usedFallback) return result;
    navigateAfterGameLaunch({ gameScreen, navStack, result });
    return result;
  });
}

/** Options patch standard pour un jeu (timeout 20 s). */
export function gamePatchOpts(gameId, screen) {
  return {
    gameId,
    screen: screen || gameId,
    timeoutMs: DEFAULT_SYNC_PATCH_TIMEOUT_MS,
  };
}

/**
 * Commit hôte en partie : local d'abord, patch remote partiel (sans deck / prep).
 */
export async function commitHostGamePlay({
  patch,
  gameId,
  screen,
  stateKey,
  getSession,
  saveLocal,
  toRemote,
  patchOpts = {},
}) {
  const session = { ...getSession(), ...patch };
  saveLocal(session);
  if (!isGameSyncActive() || !isLobbyHost()) return session;
  await patchGameState(
    { [stateKey]: pickRemotePlayFields(toRemote(session), patch) },
    { gameId, screen: screen || gameId, ...patchOpts }
  );
  return session;
}

/**
 * Toggle prêt en prep : patch local + patch remote narrow (ready uniquement).
 */
export async function commitPrepReadyToggle({
  readyKey,
  ready,
  getSession,
  saveLocal,
  stateKey,
  gameId,
  screen,
  readyField = "ready",
}) {
  const session = getSession();
  const nextReady = { ...(session[readyField] || {}), [readyKey]: ready };
  saveLocal({ ...session, [readyField]: nextReady });
  if (!isGameSyncActive()) return nextReady;
  const uid = userIdForName(readyKey) || readyKey;
  await patchGameState({ [stateKey]: { ready: { [uid]: ready } } }, { gameId, screen });
  return nextReady;
}
