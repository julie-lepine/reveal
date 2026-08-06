/**
 * Projection libellé « item le plus clivant » (série + legacy).
 * Jamais undefined / null / ID technique / chaîne vide à l’écran.
 */

/**
 * @param {unknown} raw
 * @returns {string|null}
 */
export function normalizeControversialItemLabel(raw) {
  if (raw == null) return null;
  if (typeof raw === "string") {
    const t = raw.trim();
    if (!t || t === "undefined" || t === "null") return null;
    return t;
  }
  if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
  if (typeof raw === "object") {
    const candidate =
      raw.name ?? raw.label ?? raw.item ?? raw.topicName ?? raw.displayName ?? null;
    return normalizeControversialItemLabel(candidate);
  }
  return null;
}

/**
 * Priorité : bridge legacy session → roundRecap → dernière entrée history.
 * @param {{
 *   session?: object|null,
 *   series?: object|null,
 * }} [opts]
 * @returns {{ item: string|null, spread: number, source: string|null }}
 */
export function resolveControversialItemForDisplay({ session = null, series = null } = {}) {
  const candidates = [
    { item: session?.controversialItem, spread: session?.controversialSpread, source: "session" },
    {
      item: series?.roundRecap?.controversialItem,
      spread: series?.roundRecap?.controversialSpread,
      source: "roundRecap",
    },
  ];
  const history = Array.isArray(series?.roundHistory) ? series.roundHistory : [];
  if (history.length) {
    const last = history[history.length - 1];
    candidates.push({
      item: last?.controversialItem,
      spread: last?.controversialSpread,
      source: "roundHistory",
    });
  }

  for (const c of candidates) {
    const item = normalizeControversialItemLabel(c.item);
    const spread = Number(c.spread);
    if (item && Number.isFinite(spread) && spread > 0) {
      return { item, spread, source: c.source };
    }
  }
  return { item: null, spread: 0, source: null };
}
