import { schedulePageScrollReset } from "./ui.js";
import {
  advanceMountGeneration,
  resetMountGenerationForTests,
} from "./mountLifecycle.js";

let appEl = null;
let currentCleanup = null;
const navStack = ["home"];
let screenParams = {};
let currentScreenId = "home";
const screenListeners = [];

/** Depth of synchronous navigate/goBack mount; >0 means nested navigate from mount*. */
let syncMountDepth = 0;
/** Set when a nested navigate finished while an outer mount was in progress. */
let nestedNavigateCompleted = false;

const screens = {};

export function getCurrentScreen() {
  return currentScreenId;
}

/** Snapshot of the navigation stack (tests + rare callers). */
export function getNavStack() {
  return navStack.slice();
}

export function onScreenChange(fn) {
  screenListeners.push(fn);
}

function notifyScreenChange(screenId) {
  currentScreenId = screenId;
  screenListeners.forEach((fn) => fn(screenId));
}

export function getScreenParams() {
  return screenParams;
}

export function initRouter(app) {
  appEl = app;
}

export function isScreenRegistered(id) {
  return Boolean(id && screens[id]);
}

export function registerScreen(id, renderFn) {
  screens[id] = renderFn;
}

/**
 * After mount* called navigate(dest) then returned: drop the intermediate
 * screenId that this navigate/goBack had placed under the destination.
 */
function removeNestedRedirectGhost(requestedScreenId) {
  const destinationId = currentScreenId;
  if (!requestedScreenId || requestedScreenId === destinationId) return;
  for (let i = navStack.length - 1; i >= 1; i--) {
    if (navStack[i] === destinationId && navStack[i - 1] === requestedScreenId) {
      navStack.splice(i - 1, 1);
      break;
    }
  }
  // navigate(dest) while already on dest can leave […, dest, ghost, dest] → […, dest, dest]
  while (
    navStack.length >= 2 &&
    navStack[navStack.length - 1] === destinationId &&
    navStack[navStack.length - 2] === destinationId
  ) {
    navStack.pop();
  }
}

function settleAfterNestedRedirect(requestedScreenId) {
  removeNestedRedirectGhost(requestedScreenId);
  nestedNavigateCompleted = false;
  requestAnimationFrame(() => schedulePageScrollReset(appEl));
}

/** ARCH-06 C : avance la génération puis monte l'écran. */
function mountScreen(screenId) {
  advanceMountGeneration();
  return screens[screenId](appEl);
}

export function navigate(screenId, { reset = false, params = null, navStack: forcedStack = null } = {}) {
  if (!appEl || !screens[screenId]) return false;

  screenParams = params || {};
  const isNested = syncMountDepth > 0;
  if (!isNested) nestedNavigateCompleted = false;

  if (currentCleanup) {
    currentCleanup();
    currentCleanup = null;
  }

  if (forcedStack) {
    navStack.length = 0;
    navStack.push(...forcedStack);
  } else if (reset) {
    navStack.length = 0;
    navStack.push(screenId);
  } else if (navStack[navStack.length - 1] !== screenId) {
    navStack.push(screenId);
  }

  syncMountDepth += 1;
  let cleanup;
  try {
    cleanup = mountScreen(screenId);
  } finally {
    syncMountDepth -= 1;
  }

  if (isNested) {
    // Intermediate mount that itself redirected further (A→B→C): keep C.
    if (nestedNavigateCompleted) {
      removeNestedRedirectGhost(screenId);
      requestAnimationFrame(() => schedulePageScrollReset(appEl));
      return true;
    }
    // Destination navigate from inside another mount - settle normally.
    currentCleanup = cleanup || null;
    notifyScreenChange(screenId);
    nestedNavigateCompleted = true;
    requestAnimationFrame(() => schedulePageScrollReset(appEl));
    return true;
  }

  if (nestedNavigateCompleted) {
    // Outer navigate(A): mount redirected via navigate(B). Keep B's cleanup/notify.
    settleAfterNestedRedirect(screenId);
    return true;
  }

  currentCleanup = cleanup || null;
  notifyScreenChange(screenId);
  requestAnimationFrame(() => schedulePageScrollReset(appEl));
  return true;
}

export function goBack(fallback = "home", { params } = {}) {
  if (!appEl) return;

  if (currentCleanup) {
    currentCleanup();
    currentCleanup = null;
  }

  if (navStack.length > 1) navStack.pop();

  const screenId = navStack[navStack.length - 1] || fallback;
  nestedNavigateCompleted = false;

  if (params !== undefined) {
    screenParams = params || {};
  }

  if (!screens[screenId]) {
    navStack.length = 0;
    navStack.push(fallback);
    currentCleanup = mountScreen(fallback) || null;
    notifyScreenChange(fallback);
    requestAnimationFrame(() => schedulePageScrollReset(appEl));
    return;
  }

  syncMountDepth += 1;
  let cleanup;
  try {
    cleanup = mountScreen(screenId);
  } finally {
    syncMountDepth -= 1;
  }

  if (nestedNavigateCompleted) {
    settleAfterNestedRedirect(screenId);
    return;
  }

  currentCleanup = cleanup || null;
  notifyScreenChange(screenId);
  requestAnimationFrame(() => schedulePageScrollReset(appEl));
}

export function resetNav() {
  navStack.length = 0;
  navStack.push("home");
  currentScreenId = "home";
  syncMountDepth = 0;
  nestedNavigateCompleted = false;
  resetMountGenerationForTests();
}
