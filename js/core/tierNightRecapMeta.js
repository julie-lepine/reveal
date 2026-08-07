/**
 * Enrichissement UI des recaps TierNight (série SQL sans emoji/color).
 * Préfère l’emoji / couleur choisis par le joueur (lobby).
 */

export const TIER_NIGHT_RECAP_FALLBACK_EMOJI = "🙂";
export const TIER_NIGHT_RECAP_FALLBACK_COLOR = "rgba(255,255,255,.2)";

/**
 * @param {Array<object>} [recaps]
 * @param {Array<{ userId?: string, name?: string, emoji?: string, color?: string }>} [players]
 */
export function enrichTierNightRecapsWithPlayerMeta(recaps = [], players = []) {
  const byUid = new Map();
  const byName = new Map();
  for (const p of players || []) {
    if (p?.userId) byUid.set(String(p.userId), p);
    if (p?.name) byName.set(String(p.name), p);
  }

  return (Array.isArray(recaps) ? recaps : []).map((r) => {
    if (!r || typeof r !== "object") return r;
    const meta =
      (r.uid != null && String(r.uid) && byUid.get(String(r.uid))) ||
      (r.player != null && byName.get(String(r.player))) ||
      null;
    const emoji = r.emoji || meta?.emoji || TIER_NIGHT_RECAP_FALLBACK_EMOJI;
    const color = r.color || meta?.color || TIER_NIGHT_RECAP_FALLBACK_COLOR;
    if (emoji === r.emoji && color === r.color) return r;
    return { ...r, emoji, color };
  });
}
