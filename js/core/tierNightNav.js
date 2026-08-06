/**
 * UX-TIERNIGHT-NAV-01 / FEATURE-TIERNIGHT-03-F — navigation explicite entre niveaux TierNight.
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

/**
 * Remonte / ouvre `tiernight-select` sur un step donné, sans laisser
 * les écrans de création / prep dans la pile (évite retour fantôme).
 *
 * FEATURE-TIERNIGHT-03-F — topic / roster-path / wizard → prep (jamais grille classic).
 *
 * @param {{ step?: "mode"|"topic"|"list"|"roster-path", mode?: string|null }} [opts]
 */
export function returnToTierNightSelectStep({ step = "mode", mode = null } = {}) {
  const allowed = new Set(["mode", "topic", "list", "roster-path"]);
  let resolvedStep = allowed.has(step) ? step : "mode";
  let resolvedMode = mode != null ? normalizeTierNightMode(mode) : null;
  if (LEGACY_ROSTER_STEPS.has(resolvedStep)) resolvedMode = "roster";
  if (resolvedStep === "list") resolvedMode = "live";

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

  const stack = getNavStack().filter(
    (id) => !TIER_NIGHT_CREATE_SCREENS.has(id) && id !== "tiernight-prep"
  );
  while (stack.length && stack[stack.length - 1] === "tiernight-select") {
    stack.pop();
  }
  stack.push("tiernight-select");

  navigate("tiernight-select", {
    params: {
      step: resolvedStep,
      ...(resolvedMode ? { mode: resolvedMode } : {}),
    },
    navStack: stack,
  });
}
