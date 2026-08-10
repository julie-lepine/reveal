/**
 * UX-TIERNIGHT-NAV-01 / FEATURE-TIERNIGHT-03-F - navigation explicite entre niveaux TierNight.
 * BUG-TIERNIGHT-PREP-EXIT-MODES — sortie prep → hub modes (pas game-select / teardown session).
 *
 * Les helpers leave* importent gameSync / state en lazy pour ne pas alourdir
 * `returnToTierNightSelectStep` (tests UX-NAV sans mock Supabase).
 */
import { navigate, getNavStack } from "./router.js";
import { normalizeTierNightMode } from "../../data/tierTopics.js";

const TIER_NIGHT_CREATE_SCREENS = new Set([
  "tiernight-create-roster",
  "tiernight-create",
]);

const SERIES_PREP_NAV_STACK = [
  "home",
  "lobby",
  "game-select",
  "tiernight-select",
  "tiernight-prep",
];

const LEGACY_ROSTER_STEPS = new Set(["topic", "roster-path"]);

/** Cible data-nav chevron prep → hub modes (évite `back` / sortie hub jeux). */
export const TIER_NIGHT_PREP_MODES_EXIT_NAV = "tiernight-modes-exit";

const MODES_SELECT_STACK = ["home", "lobby", "game-select", "tiernight-select"];

/**
 * Remonte / ouvre `tiernight-select` sur un step donné, sans laisser
 * les écrans de création / prep dans la pile (évite retour fantôme).
 *
 * FEATURE-TIERNIGHT-03-F - topic / roster-path / wizard → prep (jamais grille classic).
 * FEATURE-TIERNIGHT-04D - retour depuis live-prep → select mode (pas step=list).
 *
 * @param {{
 *   step?: "mode"|"topic"|"list"|"roster-path",
 *   mode?: string|null,
 *   resetLivePrepOnLeave?: boolean,
 * }} [opts]
 */
export function returnToTierNightSelectStep({
  step = "mode",
  mode = null,
  resetLivePrepOnLeave = true,
} = {}) {
  const allowed = new Set(["mode", "topic", "list", "roster-path"]);
  let resolvedStep = allowed.has(step) ? step : "mode";
  let resolvedMode = mode != null ? normalizeTierNightMode(mode) : null;
  if (LEGACY_ROSTER_STEPS.has(resolvedStep)) resolvedMode = "roster";
  // 04D : step=list n'est plus une destination - mode live → select modes.
  if (resolvedStep === "list") {
    resolvedStep = "mode";
    resolvedMode = "live";
  }

  // Create-roster / ancien step grille → prep série canonique.
  if (LEGACY_ROSTER_STEPS.has(resolvedStep)) {
    navigate("tiernight-prep", { navStack: [...SERIES_PREP_NAV_STACK] });
    void import("./tierNightSeriesPrepSession.js")
      .then(({ enterTierNightSeriesPrep }) =>
        enterTierNightSeriesPrep({ resetSettings: false })
      )
      .catch(() => {});
    return;
  }

  const leavingLivePrep = getNavStack().includes("tiernight-live-prep");
  const stack = getNavStack().filter(
    (id) =>
      !TIER_NIGHT_CREATE_SCREENS.has(id) &&
      id !== "tiernight-prep" &&
      id !== "tiernight-live-prep"
  );
  while (stack.length && stack[stack.length - 1] === "tiernight-select") {
    stack.pop();
  }
  stack.push("tiernight-select");

  // Quitter un prep live vers select : reset local settings (pas clear customs remote).
  // leaveTierNightLivePrepToModes gère déjà le reset (+ patch) → resetLivePrepOnLeave: false.
  if (leavingLivePrep && resolvedStep === "mode" && resetLivePrepOnLeave) {
    void import("./tierNightLivePrepSession.js")
      .then(({ resetTierNightLivePrepSession }) => resetTierNightLivePrepSession())
      .catch(() => {});
  }

  navigate("tiernight-select", {
    params: {
      step: resolvedStep,
      ...(resolvedMode ? { mode: resolvedMode } : {}),
    },
    navStack: stack,
  });
}

/**
 * Sortie setup légère prep → hub modes (série ou live).
 * Un seul patchGameState (reset prep + screen) ; jamais de teardown de session.
 *
 * @param {{
 *   mode: "roster"|"live",
 *   getPreviousEpoch: () => number,
 *   applyLocalReset: (prepReset: object) => void,
 *   buildRemoteMerge: (prepReset: object) => object,
 *   defaultCategoryIds: string[],
 *   defaultRoundCount: number,
 * }} spec
 */
async function leaveTierNightPrepToModes(spec) {
  const {
    isGameSyncActive,
    isLobbyHost,
    patchGameState,
  } = await import("./gameSync.js");
  const { buildAuthoritativeTierNightPrepReset } = await import(
    "./tierNightSeriesPrepContracts.js"
  );

  const {
    mode,
    getPreviousEpoch,
    applyLocalReset,
    buildRemoteMerge,
    defaultCategoryIds,
    defaultRoundCount,
  } = spec;

  const prepReset = buildAuthoritativeTierNightPrepReset({
    previousSetupEpoch: getPreviousEpoch(),
    categoryIds: defaultCategoryIds,
    roundCount: defaultRoundCount,
  });

  const navigateToModes = ({ resetLivePrepOnLeave = true } = {}) => {
    returnToTierNightSelectStep({
      step: "mode",
      mode,
      resetLivePrepOnLeave,
    });
  };

  if (!isGameSyncActive()) {
    applyLocalReset(prepReset);
    navigateToModes({ resetLivePrepOnLeave: mode !== "live" });
    return { ok: true, localOnly: true, prepReset };
  }

  // Invité : nav locale seule (l'hôte possède le remote). Select guestFollow
  // peut le ramener au prep tant que screen remote ≠ select — volontaire.
  if (!isLobbyHost()) {
    navigateToModes({ resetLivePrepOnLeave: false });
    return { ok: true, guestLocal: true };
  }

  applyLocalReset(prepReset);
  try {
    await patchGameState(buildRemoteMerge(prepReset), {
      gameId: "tiernight",
      screen: "tiernight-select",
    });
  } catch (err) {
    return {
      ok: false,
      error: err?.message || "Impossible de quitter la préparation.",
      prepReset,
    };
  }

  navigateToModes({ resetLivePrepOnLeave: false });
  return { ok: true, prepReset };
}

/**
 * Classe le groupe — prep série → hub modes (`step=mode`, `mode=roster`).
 */
export async function leaveTierNightSeriesPrepToModes() {
  const { getState, saveStatePatch } = await import("./state.js");
  const { tierNightPrepToRemote } = await import("./gameSync.js");
  const { TIER_NIGHT_SERIES_ALL_CATEGORIES } = await import("./tierNightSeries.js");
  return leaveTierNightPrepToModes({
    mode: "roster",
    getPreviousEpoch: () =>
      Number(getState().tierNightSeriesPrep?.setupEpoch) || 0,
    applyLocalReset: (prepReset) => {
      saveStatePatch({ tierNightSeriesPrep: prepReset });
    },
    buildRemoteMerge: (prepReset) => ({
      tierNightPrep: tierNightPrepToRemote(prepReset),
    }),
    defaultCategoryIds: [TIER_NIGHT_SERIES_ALL_CATEGORIES],
    defaultRoundCount: 5,
  });
}

/**
 * Rank Live — prep → hub modes (`step=mode`, `mode=live`).
 */
export async function leaveTierNightLivePrepToModes() {
  const { getState, saveStatePatch } = await import("./state.js");
  const { tierNightPrepToRemote } = await import("./gameSync.js");
  const { TIER_NIGHT_LIVE_SERIES_ALL_CATEGORIES } = await import(
    "./tierNightLiveSeriesDomain.js"
  );
  return leaveTierNightPrepToModes({
    mode: "live",
    getPreviousEpoch: () =>
      Number(getState().tierNightLiveSeriesPrep?.setupEpoch) || 0,
    applyLocalReset: (prepReset) => {
      saveStatePatch({
        tierNightLiveSeriesPrep: {
          ...prepReset,
          categoryIds: [TIER_NIGHT_LIVE_SERIES_ALL_CATEGORIES],
        },
      });
    },
    buildRemoteMerge: (prepReset) => ({
      tierNightLivePrep: tierNightPrepToRemote({
        ...prepReset,
        categoryIds: [TIER_NIGHT_LIVE_SERIES_ALL_CATEGORIES],
      }),
    }),
    defaultCategoryIds: [TIER_NIGHT_LIVE_SERIES_ALL_CATEGORIES],
    defaultRoundCount: 5,
  });
}

/** Compat : même contrat que leaveTierNightLivePrepToModes. */
export function leaveLivePrepToSelect() {
  return leaveTierNightLivePrepToModes();
}

export { MODES_SELECT_STACK };
