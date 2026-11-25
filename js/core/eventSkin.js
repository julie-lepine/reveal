import { EVENT_SKINS, resolveEventSkin } from "../../data/eventSkin.js";
import { isNativeApp } from "./platform.js";

const LAYER_ID = "event-layer";
const DEFAULT_THEME_COLOR = "#0D0F1E";
const EVENT_CLASS_RE = new RegExp(`^event-(${Object.keys(EVENT_SKINS).join("|")})$`);

const LAYER_FLOATS = {
  halloween: ["🦇", "🎃", "✨", "🦇", "🍂", "✨"],
  christmas: ["🎄", "❄️", "✨", "🎄", "⭐", "❄️"],
  nye: ["✨", "🥂", "🎆", "✨", "⭐", "🥂"],
  stpatrick: ["☘️", "✨", "🍀", "☘️", "✨", "🍀"],
  aprilfools: ["🃏", "🙃", "✨", "🎩", "🃏", "✨"],
  music: ["🎵", "✨", "🎤", "🎶", "✨", "🎧"],
  bastille: ["✨", "🔵", "✨", "🔴", "✨", "⚪"],
  rentree: ["✨", "🍂", "⭐", "✨", "🍁", "✨"],
};

function floatsHtml(skinId) {
  const glyphs = LAYER_FLOATS[skinId];
  if (!glyphs) return `<div class="event-layer__vignette"></div>`;
  const spans = glyphs
    .map(
      (glyph, i) =>
        `<span class="event-float event-float--${i + 1}" aria-hidden="true">${glyph}</span>`
    )
    .join("");
  return `<div class="event-layer__vignette"></div>${spans}`;
}

function currentSearch() {
  try {
    return typeof location !== "undefined" ? location.search : "";
  } catch {
    return "";
  }
}

function setThemeColor(color) {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", color || DEFAULT_THEME_COLOR);
}

function clearEventClasses(el) {
  [...el.classList].forEach((name) => {
    if (EVENT_CLASS_RE.test(name)) el.classList.remove(name);
  });
}

function ensureLayer(skin) {
  let el = document.getElementById(LAYER_ID);
  if (!skin) {
    el?.remove();
    return;
  }
  if (!el) {
    if (!document.body) return;
    el = document.createElement("div");
    el.id = LAYER_ID;
    el.setAttribute("aria-hidden", "true");
    document.body.appendChild(el);
  }
  el.className = `event-layer event-layer--${skin.id}`;
  el.innerHTML = floatsHtml(skin.id);
}

/**
 * Applique (ou retire) le calque saisonnier. Idempotent.
 * @param {import("../../data/eventSkin.js").EventSkin | null} [skin]
 */
export function applyEventSkin(skin) {
  if (typeof document === "undefined" || !document.documentElement) return skin ?? null;
  const resolved = skin === undefined ? resolveEventSkin({ search: currentSearch() }) : skin;
  const root = document.documentElement;
  clearEventClasses(root);
  if (document.body) clearEventClasses(document.body);
  if (!resolved) {
    ensureLayer(null);
    setThemeColor(DEFAULT_THEME_COLOR);
    return null;
  }
  root.classList.add(resolved.className);
  ensureLayer(resolved);
  setThemeColor(resolved.themeColor);
  return resolved;
}

let appliedSkinId = null;
let refreshInit = false;
let midnightTimer = null;

/**
 * Recalcule le skin (date du jour) et ne touche au DOM que s'il a changé :
 * pas de calque recréé ni d'animation relancée à chaque retour dans l'appli.
 */
export function refreshEventSkin() {
  const next = resolveEventSkin({ search: currentSearch() });
  const nextId = next?.id ?? null;
  if (nextId === appliedSkinId) return next;
  appliedSkinId = nextId;
  return applyEventSkin(next);
}

/** Millisecondes jusqu'au prochain minuit local (+1 s de marge). */
export function msUntilNextLocalMidnight(now = new Date()) {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1);
  return Math.max(1000, next.getTime() - now.getTime());
}

function scheduleMidnightRefresh() {
  if (midnightTimer) clearTimeout(midnightTimer);
  midnightTimer = setTimeout(() => {
    midnightTimer = null;
    refreshEventSkin();
    scheduleMidnightRefresh();
  }, msUntilNextLocalMidnight());
}

/**
 * L'appli revient souvent du second plan sans redémarrer : on recalcule
 * le skin au retour au premier plan et à minuit si elle reste ouverte.
 */
function initEventSkinRefresh() {
  if (refreshInit || typeof document === "undefined") return;
  refreshInit = true;

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    refreshEventSkin();
    scheduleMidnightRefresh();
  });
  scheduleMidnightRefresh();

  if (!isNativeApp()) return;
  void (async () => {
    try {
      const { loadCapacitorApp } = await import("./capacitorImports.js");
      const App = (await loadCapacitorApp())?.App;
      App?.addListener?.("appStateChange", ({ isActive }) => {
        if (!isActive) return;
        refreshEventSkin();
        scheduleMidnightRefresh();
      });
    } catch (e) {
      console.warn("[eventSkin] foreground listener:", e?.message || e);
    }
  })();
}

export function initEventSkin() {
  const skin = applyEventSkin();
  appliedSkinId = skin?.id ?? null;
  initEventSkinRefresh();
  return skin;
}

export { EVENT_SKINS };
