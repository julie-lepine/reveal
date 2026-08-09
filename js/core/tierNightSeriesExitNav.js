/**
 * FEATURE-TIERNIGHT-03-E / E1 - sorties autoritaires série (change mode / replay / clear).
 *
 * Contrats :
 * - customs roster + ledger consumed préservés (soirée) ;
 * - listes Rank Live et blob live non touchés ;
 * - nouveau runId série uniquement au prochain launch (prepare launch attempt) ;
 * - aucune synthèse de queue avant launch ;
 * - clear série explicite via `series: null` (merge clear) ;
 * - une seule mutation `patchGameState` (tierNight + tierNightPrep + screen).
 */

import { getState, saveStatePatch } from "./state.js";
import { snapshotStatePatch } from "./restartGameRollback.js";
import { createActionLock } from "./actionLock.js";
import { navigate, getNavStack } from "./router.js";
import { buildAuthoritativeTierNightPrepReset } from "./tierNightSeriesPrepContracts.js";
import { isTierNightSeriesUiEnabled } from "./tierNightSeriesGate.js";
import {
  isGameSyncActive,
  isLobbyHost,
  patchGameState,
  refreshGameSession,
} from "./gameSync.js";
import { showAppAlert } from "./dialog.js";
import { exitGameToGameSelect } from "./exitGame.js";
import { clearTierNightCustomRosterTopicsAtExitBoundary } from "./tierNightCustomRosterClear.js";

const exitNavLock = createActionLock();

const SERIES_SELECT_STACK = ["home", "lobby", "game-select", "tiernight-select"];
const SERIES_PREP_STACK = [
  "home",
  "lobby",
  "game-select",
  "tiernight-select",
  "tiernight-prep",
];

/**
 * Shell local après clear série (pas de runId - mint au launch série).
 * Remplace l’objet `tierNightGame` entier (pas de shallow merge nested).
 * @param {object} [prev]
 */
export function buildClearedTierNightSeriesLocalGame(prev = {}) {
  void prev;
  return {
    runId: null,
    recaps: [],
    topicId: null,
    listName: "",
    topicEmoji: "",
    controversialItem: null,
    lobbyStarted: false,
    placements: {},
    finished: {},
    // pas de clé `series` → objet local sans série active
  };
}

/**
 * Blob remote : `series: null` = clear explicite (clé absente = preserve_local).
 * items / playerRoster nullifiés pour éviter résidu legacy.
 * @param {{ mode?: string }} [opts]
 */
export function buildClearedTierNightSeriesRemote({ mode = "roster" } = {}) {
  return {
    runId: null,
    topicId: null,
    mode: mode === "live" ? "live" : "roster",
    modifier: "normal",
    lobbyStarted: false,
    listName: "",
    topicEmoji: "",
    placements: {},
    finished: {},
    game: null,
    // BUG-MP-NAV-01 : nullifier le récap distant (sinon canRouteToTierNightEnd
    // peut encore préférer l’écran end après clear série / change mode).
    recap: null,
    items: null,
    playerRoster: null,
    series: null,
  };
}

/**
 * @param {number} previousSetupEpoch
 */
export function buildSeriesExitPrepReset(previousSetupEpoch = 0) {
  return buildAuthoritativeTierNightPrepReset({
    previousSetupEpoch,
    categoryIds: ["*"],
    roundCount: 5,
  });
}

/**
 * Patch local atomique (change mode / replay) - n’inclut ni live ni customs ni consumed.
 * @param {{ previousSetupEpoch?: number }} [opts]
 */
export function buildSeriesExitLocalStatePatch({ previousSetupEpoch = 0 } = {}) {
  const prepReset = buildSeriesExitPrepReset(previousSetupEpoch);
  return {
    statePatch: {
      tierNightTopicId: null,
      tierNightMode: "roster",
      tierNightModifier: "normal",
      tierNightGame: buildClearedTierNightSeriesLocalGame(),
      tierNightSeriesPrep: prepReset,
      // Fin de partie / change mode : customs de session vidés (idempotent).
      customRosterTopics: [],
      // intentional omit: live game local, listes live, ledger consumed
    },
    prepReset,
  };
}

/**
 * Payload distant d’une seule mutation patchGameState (E1).
 * @param {{ previousSetupEpoch?: number, screen: string }} opts
 */
export function buildSeriesExitRemoteMutation({ previousSetupEpoch = 0, screen }) {
  const prepReset = buildSeriesExitPrepReset(previousSetupEpoch);
  return {
    stateMerge: {
      tierNight: buildClearedTierNightSeriesRemote({ mode: "roster" }),
      tierNightPrep: {
        categoryIds: prepReset.categoryIds,
        roundCount: prepReset.roundCount,
        ready: {},
        setupEpoch: prepReset.setupEpoch,
      },
      // intentional omit: live remote, ledger consumed, customs roster
    },
    patchOpts: { gameId: "tiernight", screen },
    prepReset,
  };
}

/**
 * Destination « Changer de mode » : hub modes TierNight (pas game-select).
 */
export function resolveChangeModeDestination() {
  return {
    screen: "tiernight-select",
    params: { step: "mode" },
    navStack: [...SERIES_SELECT_STACK],
  };
}

/**
 * Replay : gate ON → prep série ; gate OFF → select (rollback grille).
 * @param {{ seriesUiEnabled?: boolean }} [opts]
 */
export function resolveReplayDestination({ seriesUiEnabled = false } = {}) {
  if (seriesUiEnabled) {
    return {
      screen: "tiernight-prep",
      params: null,
      navStack: [...SERIES_PREP_STACK],
    };
  }
  return {
    screen: "tiernight-select",
    params: { step: "mode" },
    navStack: [...SERIES_SELECT_STACK],
  };
}

/**
 * Sous gate ON, recommencer depuis fin série / legacy roster → prep (pas classic).
 * Rank Live (mode live) → false → hub select via launchTierNightSelect.
 *
 * @param {{
 *   seriesUiEnabled?: boolean,
 *   tierNight?: object|null,
 *   tierNightLive?: object|null,
 *   tierNightMode?: string|null,
 * }} [opts]
 */
export function shouldReplayTierNightSeriesToPrep({
  seriesUiEnabled = isTierNightSeriesUiEnabled(),
  tierNight = getState().tierNightGame,
  tierNightLive = getState().tierNightLiveGame,
  tierNightMode = getState().tierNightMode,
} = {}) {
  if (!seriesUiEnabled) return false;
  if (tierNightLive?.lobbyStarted && !tierNightLive?.finished) return false;

  const mode = tierNight?.mode || tierNightMode || "roster";
  const phase = tierNight?.series?.phase;

  if (phase === "series_end") return true;
  if (mode === "live") return false;

  if (
    Array.isArray(tierNight?.recaps) &&
    tierNight.recaps.length > 0 &&
    !(phase && phase !== "series_end")
  ) {
    return true;
  }

  if (phase == null && mode === "roster" && tierNight?.lobbyStarted === false) {
    return false;
  }

  return false;
}

/**
 * Change mode / replay série : hôte réel uniquement (BUG-MP-NAV-01B CAS A).
 *
 * Pourquoi pas acting host :
 * - clear customs distant = RPC hôte réel ;
 * - mutation = `tierNight` + `tierNightPrep` (update hôte ; AH = 1 jeu / screens play) ;
 * - même famille que quit / `eveningRecapRestartButtonHtml` (frontière soirée).
 * AH conserve « Thème suivant » (`canHostSeriesCommit`).
 */
export function canAuthorSeriesExit() {
  if (!isGameSyncActive()) return true;
  return isLobbyHost();
}

/**
 * Quit : hôte réel uniquement (aligné `returnToGameSelect` / `endGameSession`).
 * Acting host → pas d’CTA quit (évite faux « arrêter pour tous »).
 */
export function canAuthorSeriesQuit() {
  if (!isGameSyncActive()) return true;
  return isLobbyHost();
}

/**
 * Patch local + une mutation remote (hôte/AH) pour clear série + reset prep.
 * Ne touche pas live / customs / consumed.
 * @param {{ screen: string, shouldContinue?: () => boolean }} opts
 */
async function applySeriesClearAndPrepReset({ screen, shouldContinue }) {
  const canContinue = () =>
    typeof shouldContinue !== "function" || shouldContinue();

  const state = getState();
  const prevEpoch = Number(state.tierNightSeriesPrep?.setupEpoch) || 0;
  const { statePatch, prepReset } = buildSeriesExitLocalStatePatch({
    previousSetupEpoch: prevEpoch,
  });
  const remote = buildSeriesExitRemoteMutation({
    previousSetupEpoch: prevEpoch,
    screen,
  });

  const patchKeys = Object.keys(statePatch);
  const previousPatch = snapshotStatePatch(state, patchKeys);
  saveStatePatch(statePatch);

  if (!isGameSyncActive()) {
    await clearTierNightCustomRosterTopicsAtExitBoundary({
      reopen: true,
      shouldContinue,
    });
    return { ok: true, previousPatch, prepReset, localOnly: true, networkCalls: 0 };
  }

  if (!canAuthorSeriesExit()) {
    saveStatePatch(previousPatch);
    return {
      ok: false,
      code: "NOT_HOST",
      error: "Seul l'hôte peut changer de mode ou rejouer la série.",
      previousPatch,
      networkCalls: 0,
    };
  }

  // Clear distant autoritatif avant patch série (reopen pour nouveaux customs prep).
  const cleared = await clearTierNightCustomRosterTopicsAtExitBoundary({
    reopen: true,
    shouldContinue,
  });
  if (!cleared?.ok && !cleared?.stale) {
    saveStatePatch(previousPatch);
    return {
      ok: false,
      code: cleared?.code || "CUSTOM_CLEAR_FAILED",
      error: cleared?.error || "Impossible de vider les thèmes personnalisés.",
      previousPatch,
      rolledBack: true,
      networkCalls: 1,
    };
  }
  if (cleared?.stale || !canContinue()) {
    return {
      ok: false,
      code: "STALE",
      stale: true,
      previousPatch,
      networkCalls: 1,
    };
  }

  try {
    const row = await patchGameState(remote.stateMerge, remote.patchOpts);
    if (!canContinue()) {
      // Succès serveur déjà appliqué localement - pas de rollback d’un état plus récent.
      return {
        ok: false,
        code: "STALE",
        stale: true,
        previousPatch,
        networkCalls: 1,
      };
    }
    // BUG-MP-NAV-01 / 01B : confirmation screen serveur (update sélectionne `screen`).
    // Pas de nav locale si row absente, screen manquant, ou screen ≠ cible.
    const remoteScreen = row?.screen ?? null;
    if (!row || remoteScreen !== screen) {
      saveStatePatch(previousPatch);
      return {
        ok: false,
        code: "SCREEN_MISMATCH",
        error:
          "La session distante n’a pas basculé. Réessaie ou demande à l’hôte de relancer.",
        previousPatch,
        rolledBack: true,
        networkCalls: 1,
        remoteScreen,
      };
    }
    return { ok: true, previousPatch, prepReset, networkCalls: 1, row };
  } catch (err) {
    // Timeout / réseau : le serveur a pu réussir - reconcile avant rollback.
    try {
      const row = await refreshGameSession();
      const remoteTn = row?.state?.tierNight;
      const seriesCleared =
        Boolean(remoteTn) &&
        (!Object.prototype.hasOwnProperty.call(remoteTn, "series") ||
          remoteTn.series == null);
      const prepEpoch = Number(row?.state?.tierNightPrep?.setupEpoch) || 0;
      const screenOk = !row?.screen || row.screen === screen;
      if (
        row &&
        seriesCleared &&
        prepEpoch >= prepReset.setupEpoch &&
        screenOk
      ) {
        if (!canContinue()) {
          return {
            ok: false,
            code: "STALE",
            stale: true,
            reconciled: true,
            networkCalls: 2,
          };
        }
        return {
          ok: true,
          previousPatch,
          prepReset,
          reconciled: true,
          networkCalls: 2,
        };
      }
    } catch {
      /* fall through to rollback */
    }

    saveStatePatch(previousPatch);
    return {
      ok: false,
      code: "NETWORK",
      error: err?.message || "Impossible de synchroniser la sortie.",
      previousPatch,
      rolledBack: true,
      networkCalls: 2,
    };
  }
}

function navigateToDestination(dest) {
  const stack = Array.isArray(dest.navStack)
    ? dest.navStack
    : getNavStack().filter((id) => id !== "tiernight-between" && id !== "tiernight-end");
  navigate(dest.screen, {
    ...(dest.params ? { params: dest.params } : {}),
    navStack: stack,
  });
}

/**
 * Between / end → hub modes. Clear série + reset prep (anti fantôme roster).
 * @param {{ shouldContinue?: () => boolean }} [opts]
 */
export async function changeTierNightModeFromSeriesPlay({ shouldContinue } = {}) {
  const outcome = await exitNavLock.run(async () => {
    const dest = resolveChangeModeDestination();
    const res = await applySeriesClearAndPrepReset({
      screen: dest.screen,
      shouldContinue,
    });
    if (!res.ok) {
      if (res.code === "STALE") return res;
      if (res.error) {
        await showAppAlert(res.error, { title: "Changer de mode", icon: "⚠️" });
      }
      return res;
    }
    navigateToDestination(dest);
    return { ok: true, destination: dest, networkCalls: res.networkCalls };
  });
  return outcome.ok ? outcome.value : { ok: false, skipped: true };
}

/**
 * series_end / legacy roster sous gate → prep ; gate OFF → select.
 * Pas de mint runId, pas de queue.
 * @param {{ shouldContinue?: () => boolean, seriesUiEnabled?: boolean }} [opts]
 */
export async function replayTierNightAfterSeriesEnd({
  shouldContinue,
  seriesUiEnabled = isTierNightSeriesUiEnabled(),
} = {}) {
  const outcome = await exitNavLock.run(async () => {
    const dest = resolveReplayDestination({ seriesUiEnabled });
    const res = await applySeriesClearAndPrepReset({
      screen: dest.screen,
      shouldContinue,
    });
    if (!res.ok) {
      if (res.code === "STALE") return res;
      if (res.error) {
        await showAppAlert(res.error, { title: "Rejouer", icon: "⚠️" });
      }
      return res;
    }
    navigateToDestination(dest);
    return {
      ok: true,
      destination: dest,
      prepReset: res.prepReset,
      networkCalls: res.networkCalls,
    };
  });
  return outcome.ok ? outcome.value : { ok: false, skipped: true };
}

/**
 * Quitter TierNight → menu jeux (contrat exitGame existant).
 * Ne dissolve pas le lobby. Hôte : delete session (+ timeout reconcile) ; invité : leave local.
 * Anti-double : withClickLock écran (confirm modal hors exitNavLock).
 * @param {{ shouldContinue?: () => boolean }} [opts]
 */
export async function quitTierNightSeriesToGameSelect({ shouldContinue } = {}) {
  if (isGameSyncActive() && !canAuthorSeriesQuit()) {
    return false;
  }
  // Hôte : clear distant avant delete session ; invité : clear local.
  const cleared = await clearTierNightCustomRosterTopicsAtExitBoundary({
    reopen: false,
    shouldContinue,
  });
  if (isGameSyncActive() && isLobbyHost() && cleared && cleared.ok === false && !cleared.stale) {
    await showAppAlert(cleared.error || "Impossible de vider les thèmes personnalisés.", {
      title: "Sortie impossible",
      icon: "⚠️",
    });
    return false;
  }
  return exitGameToGameSelect({ shouldContinue });
}

/** Tests / anti-double. */
export function __testGetSeriesExitNavLock() {
  return exitNavLock;
}
