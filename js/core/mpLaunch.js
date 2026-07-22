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
  getEffectiveSessionScreen,
  isGameSyncActive,
  isLobbyHost,
  canActAsHost,
  getActingHostUserId,
  patchGameState,
  pushGameSession,
  requireLocalParticipantUid,
} from "./gameSync.js";
import { pickRemotePlayFields } from "./playPatch.js";
import { showAppAlert } from "./dialog.js";
import { getCurrentScreen, navigate } from "./router.js";
import { computePrepReadyToggle } from "./prepReadyMaps.js";
import { arch03RevealLog } from "./arch03RevealDebug.js";
import { validateActingHostPlayPatch } from "./gameSessionSecurity.js";
import { getSupabaseUserId } from "./supabaseAuth.js";
import { getState } from "./state.js";

export { computePrepReadyToggle } from "./prepReadyMaps.js";

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
  /** État local avant le patch serveur (Guess The Lie : évite la boucle wait → game → wait). */
  localFirst = false,
  /** Appelé juste après applyLocal (navigation immédiate sans attendre le patch). */
  onLocalApplied,
  timeoutMs = DEFAULT_SYNC_PATCH_TIMEOUT_MS,
  fallbackMessage = SYNC_SLOW_LAUNCH_MESSAGE,
}) {
  if (beforeCommit) await beforeCommit();

  if (!isGameSyncActive()) {
    applyLocal();
    onLocalApplied?.();
    return { ok: true };
  }

  if (!isLobbyHost()) {
    console.warn(`Launch ${gameId}: ignored on non-host client.`);
    return { ok: false, skipped: true, notHost: true };
  }

  if (localFirst) {
    applyLocal();
    onLocalApplied?.();
  }

  const remoteState = getRemoteState();
  const commit = () =>
    commitMultiplayerLaunch({ screen, gameId, state: remoteState, mode, timeoutMs });

  try {
    await commit();
    if (!localFirst) applyLocal();
    return { ok: true };
  } catch (err) {
    console.warn(`Launch ${gameId}:`, err);
    if (!localFirst) applyLocal();
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
      // On se base sur l'écran *effectif* (qui applique l'inférence lobby) et non sur
      // `row.screen` brut : lors d'une relance, la ligne de session peut encore afficher
      // "results" alors que le lobby joue déjà le nouveau jeu. Se fier au brut renverrait
      // l'invité au podium au lieu de le laisser sur la prépa.
      const effective = getEffectiveSessionScreen(getCachedGameSession());
      if (effective === "results") {
        navigate("results", { navStack: ["home", "lobby", "game-select", "results"] });
        return true;
      }
      if (effective === "leaderboard") {
        navigate("leaderboard", { navStack: ["home", "lobby", "game-select", "leaderboard"] });
        return true;
      }
    }
    const entry = getEntryScreen();
    if (entry === prepScreen) return false;
    if (entry === "guesslie") {
      return navigate("guesslie", {
        navStack: ["home", "lobby", "game-select", "guesslie-menu", "guesslie-wait", "guesslie"],
      });
    }
    return navigate(entry, buildNavStack ? { navStack: buildNavStack(entry) } : { reset: true });
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
  const prev = getSession();
  const session = { ...prev, ...patch };

  // Solo / non acting : local only
  if (!isGameSyncActive() || !canActAsHost()) {
    saveLocal(session);
    return session;
  }

  const playPatch = pickRemotePlayFields(toRemote(session), patch);
  const remotePatch = { [stateKey]: playPatch };
  const opts = { gameId, screen: screen || gameId, ...patchOpts };
  const withEveningScoresRaw = Boolean(opts.withEveningScores);
  const cached = getCachedGameSession();
  const validation = validateActingHostPlayPatch(playPatch);

  arch03RevealLog("commitHostGamePlay before RPC", {
    gameId,
    stateKey,
    localUserId: getSupabaseUserId() || null,
    hostUserId: getState().lobby?.hostId || null,
    actingHostUserId: getActingHostUserId(),
    isLobbyHost: isLobbyHost(),
    canActAsHost: canActAsHost(),
    withEveningScores: withEveningScoresRaw,
    withPatchFeedback: Boolean(opts.withPatchFeedback),
    phaseBefore: prev?.phase ?? null,
    phaseAfterLocalIntent: session?.phase ?? null,
    playPatchKeys: Object.keys(playPatch),
    playPatchValidation: validation,
    sessionUpdatedAt: cached?.updated_at || null,
    // Preuve build : call site doit envoyer isLobbyHost() pour evening
    eveningCallSiteHint:
      withEveningScoresRaw && !isLobbyHost()
        ? "UNEXPECTED: withEveningScores true sans isLobbyHost"
        : withEveningScoresRaw
          ? "evening=true (hôte réel)"
          : "evening=false (attendu acting host)",
  });

  if (!validation.ok && !isLobbyHost()) {
    arch03RevealLog("commitHostGamePlay BLOCKED local whitelist", validation);
  }

  try {
    // ARCH-03 : pas de saveLocal avant confirmation serveur (évite reveal fantôme + F5 rollback)
    if (patchOpts.withPatchFeedback) {
      const { patchGameStateWithFeedback } = await import("./patchGameStateFeedback.js");
      await patchGameStateWithFeedback(remotePatch, opts);
    } else {
      await patchGameState(remotePatch, opts);
    }
  } catch (err) {
    saveLocal(prev);
    arch03RevealLog("commitHostGamePlay RPC FAILED — local rolled back", {
      message: err?.message || String(err),
      code: err?.code || null,
      details: err?.details || null,
      hint: err?.hint || null,
      phaseRestored: prev?.phase ?? null,
    });
    throw err;
  }

  arch03RevealLog("commitHostGamePlay RPC OK — server authoritative", {
    phaseNow: getSession()?.phase ?? null,
    sessionUpdatedAt: getCachedGameSession()?.updated_at || null,
    navigationNote: "UI doit sync via applyRemoteSession / onGameSessionChange",
  });
  return getSession();
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
  const { previousReady, nextReady } = computePrepReadyToggle(
    session,
    readyField,
    readyKey,
    ready
  );
  saveLocal({ ...session, [readyField]: nextReady });
  if (!isGameSyncActive()) return nextReady;
  if (!getCachedGameSession() && !isLobbyHost()) return nextReady;

  let uid;
  try {
    uid = requireLocalParticipantUid();
  } catch (err) {
    saveLocal({ ...session, [readyField]: previousReady });
    await showAppAlert(
      err?.message || "Synchronisation du joueur en cours. Réessaie dans un instant.",
      { title: "Connexion", icon: "📡" }
    );
    return previousReady;
  }

  try {
    // I-08 : ready invité sans screen/gameId (RPC contribute via patchGameState)
    const { patchGameStateWithFeedback } = await import("./patchGameStateFeedback.js");
    const patchOpts = isLobbyHost() ? { gameId, screen } : {};
    await patchGameStateWithFeedback(
      { [stateKey]: { ready: { [uid]: ready } } },
      patchOpts
    );
    return nextReady;
  } catch {
    saveLocal({ ...session, [readyField]: previousReady });
    return previousReady;
  }
}
