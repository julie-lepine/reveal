import { schedulePageScrollReset } from "./ui.js";

let appEl = null;
let currentCleanup = null;
const navStack = ["home"];
let screenParams = {};
let currentScreenId = "home";
const screenListeners = [];

const screens = {};

export function getCurrentScreen() {
  return currentScreenId;
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

export function registerScreen(id, renderFn) {
  screens[id] = renderFn;
}

export function navigate(screenId, { reset = false, params = null, navStack: forcedStack = null } = {}) {
  if (!appEl || !screens[screenId]) return false;

  screenParams = params || {};
  const screenBeforeMount = currentScreenId;

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

  const cleanup = screens[screenId](appEl);
  const redirected =
    currentScreenId !== screenBeforeMount && currentScreenId !== screenId;
  if (redirected) {
    currentCleanup = typeof cleanup === "function" ? cleanup : currentCleanup;
    requestAnimationFrame(() => schedulePageScrollReset(appEl));
    return true;
  }

  currentCleanup = cleanup || null;
  notifyScreenChange(screenId);
  requestAnimationFrame(() => schedulePageScrollReset(appEl));
  return true;
}

export function goBack(fallback = "home") {
  if (!appEl) return;

  if (currentCleanup) {
    currentCleanup();
    currentCleanup = null;
  }

  if (navStack.length > 1) navStack.pop();

  const screenId = navStack[navStack.length - 1] || fallback;
  if (!screens[screenId]) {
    navStack.length = 0;
    navStack.push(fallback);
    currentCleanup = screens[fallback](appEl) || null;
    notifyScreenChange(fallback);
    requestAnimationFrame(() => schedulePageScrollReset(appEl));
    return;
  }

  currentCleanup = screens[screenId](appEl) || null;
  notifyScreenChange(screenId);
  requestAnimationFrame(() => schedulePageScrollReset(appEl));
}

export function resetNav() {
  navStack.length = 0;
  navStack.push("home");
  currentScreenId = "home";
}
