import {
  EVENT_SKIN_PREVIEW,
  EVENT_SKINS,
  resolveEventSkin,
} from "../../data/eventSkin.js";

const LAYER_ID = "event-layer";
const DEFAULT_THEME_COLOR = "#0D0F1E";
const EVENT_CLASS_RE = new RegExp(`^event-(${Object.keys(EVENT_SKINS).join("|")})$`);

const LAYER_FLOATS = {
  test21: ["🧪", "🎲", "✨", "⚡", "🟣", "🟢"],
  halloween: ["🦇", "🎃", "✨", "🦇", "🍂", "✨"],
  christmas: ["🎄", "❄️", "✨", "🎄", "⭐", "❄️"],
  nye: ["✨", "🥂", "🎆", "✨", "⭐", "🥂"],
  stpatrick: ["☘️", "✨", "🍀", "☘️", "✨", "🍀"],
  aprilfools: ["🃏", "🙃", "✨", "🎩", "🃏", "✨"],
  music: ["🎵", "✨", "🎤", "🎶", "✨", "🎧"],
  bastille: ["✨", "🔵", "✨", "🔴", "✨", "⚪"],
  rentree: ["✨", "🍂", "⭐", "✨", "🍁", "✨"],
};

const PREVIEW_CHOICES = [
  { id: "test21", label: "Test 21" },
  { id: "aprilfools", label: "1er avril" },
  { id: "music", label: "Musique" },
  { id: "bastille", label: "14 juillet" },
  { id: "rentree", label: "Rentrée" },
  { id: "halloween", label: "Halloween" },
  { id: "christmas", label: "Noël" },
  { id: "nye", label: "1er de l'an" },
  { id: "stpatrick", label: "St Patrick" },
  { id: "off", label: "Off" },
];

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

function previewActiveId() {
  const match = [...document.documentElement.classList].find((name) => EVENT_CLASS_RE.test(name));
  return match ? match.replace(/^event-/, "") : "off";
}

function syncPreviewButtons() {
  const bar = document.getElementById("event-skin-preview");
  if (!bar) return;
  const active = previewActiveId();
  bar.querySelectorAll("[data-event-skin]").forEach((btn) => {
    btn.setAttribute("aria-pressed", btn.getAttribute("data-event-skin") === active ? "true" : "false");
  });
}

export function applyEventSkinById(id) {
  if (!id || id === "off") return applyEventSkin(null);
  return applyEventSkin(EVENT_SKINS[id] || null);
}

function mountEventSkinPreview() {
  if (!EVENT_SKIN_PREVIEW || typeof document === "undefined" || !document.body) return;
  if (document.getElementById("event-skin-preview")) {
    syncPreviewButtons();
    return;
  }
  const bar = document.createElement("div");
  bar.id = "event-skin-preview";
  bar.className = "event-skin-preview";
  bar.innerHTML = `
    <p class="event-skin-preview__label">Proto DA</p>
    <div class="event-skin-preview__row" role="group" aria-label="Calque saisonnier">
      ${PREVIEW_CHOICES.map(
        (choice) =>
          `<button type="button" class="event-skin-preview__btn" data-event-skin="${choice.id}">${choice.label}</button>`
      ).join("")}
    </div>
  `;
  bar.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-event-skin]");
    if (!btn) return;
    applyEventSkinById(btn.getAttribute("data-event-skin"));
    syncPreviewButtons();
  });
  document.body.appendChild(bar);
  syncPreviewButtons();
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
    syncPreviewButtons();
    return null;
  }
  root.classList.add(resolved.className);
  ensureLayer(resolved);
  setThemeColor(resolved.themeColor);
  syncPreviewButtons();
  return resolved;
}

export function initEventSkin() {
  const skin = applyEventSkin();
  mountEventSkinPreview();
  return skin;
}

export { EVENT_SKINS };
