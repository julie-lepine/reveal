/**
 * Calques saisonniers. Une seule peau à la fois ; hors fenêtre = DA d’origine.
 * Priorité : ?event= (QA) → EVENT_SKIN_OVERRIDE → calendrier (date locale du téléphone).
 * Prod : OVERRIDE = null, EVENT_SKIN_PREVIEW = false.
 */

/** @typedef {"test21" | "halloween" | "christmas" | "nye" | "stpatrick" | "aprilfools" | "music" | "bastille" | "rentree"} EventSkinId */

/**
 * @typedef {object} EventSkin
 * @property {EventSkinId} id
 * @property {string} className
 * @property {string} themeColor
 * @property {string} start inclusive YYYY-MM-DD (local)
 * @property {string} end exclusive YYYY-MM-DD (local)
 */

/** @type {Record<EventSkinId, EventSkin>} */
export const EVENT_SKINS = {
  test21: {
    id: "test21",
    className: "event-test21",
    themeColor: "#1c0628",
    start: "2026-09-21",
    end: "2026-09-22",
  },
  halloween: {
    id: "halloween",
    className: "event-halloween",
    themeColor: "#14080c",
    start: "2026-10-01",
    end: "2026-11-01",
  },
  christmas: {
    id: "christmas",
    className: "event-christmas",
    themeColor: "#07140c",
    start: "2026-12-01",
    end: "2026-12-26",
  },
  nye: {
    id: "nye",
    className: "event-nye",
    themeColor: "#12100a",
    start: "2026-12-26",
    end: "2027-01-03",
  },
  stpatrick: {
    id: "stpatrick",
    className: "event-stpatrick",
    themeColor: "#07140c",
    start: "2027-03-10",
    end: "2027-03-18",
  },
  aprilfools: {
    id: "aprilfools",
    className: "event-aprilfools",
    themeColor: "#0f0d1e",
    start: "2027-03-31",
    end: "2027-04-03",
  },
  music: {
    id: "music",
    className: "event-music",
    themeColor: "#0c0618",
    start: "2027-06-18",
    end: "2027-06-23",
  },
  bastille: {
    id: "bastille",
    className: "event-bastille",
    themeColor: "#070b16",
    start: "2027-07-12",
    end: "2027-07-16",
  },
  rentree: {
    id: "rentree",
    className: "event-rentree",
    themeColor: "#12100c",
    start: "2027-09-01",
    end: "2027-09-16",
  },
};

/** @type {EventSkinId | "off" | null} */
export const EVENT_SKIN_OVERRIDE = null;

/** Barre Proto DA. Passer à false avant un build store. */
export const EVENT_SKIN_PREVIEW = true;

export function toLocalDateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function isDateInSkinWindow(date, skin) {
  if (!skin?.start || !skin?.end) return false;
  const key = toLocalDateKey(date);
  return key >= skin.start && key < skin.end;
}

export function skinForDate(date = new Date()) {
  return Object.values(EVENT_SKINS).find((skin) => isDateInSkinWindow(date, skin)) || null;
}

function normalizeSkinId(raw) {
  if (raw == null) return null;
  const id = String(raw).trim().toLowerCase();
  if (!id) return null;
  if (id === "off" || id === "none" || id === "0") return "off";
  if (EVENT_SKINS[id]) return id;
  return null;
}

function skinFromId(id) {
  if (!id || id === "off") return null;
  return EVENT_SKINS[id] || null;
}

/**
 * @param {{ now?: Date, search?: string, override?: EventSkinId | "off" | null }} [opts]
 */
export function resolveEventSkin(opts = {}) {
  const now = opts.now instanceof Date ? opts.now : new Date();
  const search = opts.search ?? "";
  const override = opts.override === undefined ? EVENT_SKIN_OVERRIDE : opts.override;

  const query = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const fromQuery = normalizeSkinId(query.get("event"));
  if (fromQuery) return skinFromId(fromQuery);

  const fromOverride = normalizeSkinId(override);
  if (fromOverride) return skinFromId(fromOverride);

  return skinForDate(now);
}
