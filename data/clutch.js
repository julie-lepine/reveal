// CLUTCH 💥 - jeu de timing : un chrono visible monte de 0 vers une cible (9 → 15 s).
// 2 s avant la cible, le chrono disparaît : les joueurs doivent taper pile à la cible.
// Le plus proche (écart absolu) gagne.

export const CLUTCH_ROUND_PRESETS = [3, 5, 8];

/** Cible aléatoire de la manche : entre 9 s et 15 s. */
export const CLUTCH_MIN_TARGET_MS = 9000;
export const CLUTCH_MAX_TARGET_MS = 15000;

/** Fenêtre de grâce (invisible) après la cible : on accepte encore les taps puis clôture. */
export const CLUTCH_GRACE_MS = 3000;

/** Le chrono visible se masque ce délai avant la cible (dernières secondes à l'aveugle). */
export const CLUTCH_HIDE_BEFORE_MS = 2000;

/** Points attribués au podium de CHAQUE manche (top 1 / 2 / 3). */
export const CLUTCH_PODIUM_POINTS = [25, 15, 10];

/** Tire une cible aléatoire (ms) dans la plage autorisée. */
export function pickClutchTarget() {
  const span = CLUTCH_MAX_TARGET_MS - CLUTCH_MIN_TARGET_MS;
  return CLUTCH_MIN_TARGET_MS + Math.round(Math.random() * span);
}

/** Libellé court d'un temps (« 12,3 s »). */
export function formatClutchSeconds(ms) {
  if (ms == null || !Number.isFinite(ms)) return "—";
  return `${(ms / 1000).toFixed(1).replace(".", ",")} s`;
}

/** Écart signé lisible (« +0,4 s » / « -0,2 s »). */
export function formatClutchGap(ms, targetMs) {
  if (ms == null || !Number.isFinite(ms) || targetMs == null) return "pas tapé";
  const delta = (ms - targetMs) / 1000;
  const sign = delta > 0 ? "+" : delta < 0 ? "-" : "±";
  return `${sign}${Math.abs(delta).toFixed(2).replace(".", ",")} s`;
}
