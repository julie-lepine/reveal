/**
 * UX-TIERNIGHT-NAV-01 - navigation explicite entre niveaux TierNight.
 */
import { navigate, getNavStack } from "./router.js";
import { normalizeTierNightMode } from "../../data/tierTopics.js";

const TIER_NIGHT_CREATE_SCREENS = new Set([
  "tiernight-create-roster",
  "tiernight-create",
]);

/**
 * Remonte / ouvre `tiernight-select` sur un step donné, sans laisser
 * les écrans de création dans la pile (évite retour fantôme).
 *
 * @param {{ step?: "mode"|"topic"|"list", mode?: string|null }} [opts]
 */
export function returnToTierNightSelectStep({ step = "mode", mode = null } = {}) {
  let resolvedStep = step === "topic" || step === "list" || step === "mode" ? step : "mode";
  let resolvedMode = mode != null ? normalizeTierNightMode(mode) : null;
  if (resolvedStep === "topic") resolvedMode = "roster";
  if (resolvedStep === "list") resolvedMode = "live";

  const stack = getNavStack().filter((id) => !TIER_NIGHT_CREATE_SCREENS.has(id));
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
