// RACE TO ZERO 💥 - jeu de timing : viser le 0 d'un chrono caché.
// Une manche annonce une cible aléatoire (9 → 15 s). Chaque joueur tape sa cible
// quand il pense que le chrono atteint 0. Le plus proche (écart absolu) gagne.

export const RACE_TO_ZERO_ROUND_PRESETS = [3, 5, 8];

/** Cible aléatoire de la manche : entre 9 s et 15 s. */
export const RACE_TO_ZERO_MIN_TARGET_MS = 9000;
export const RACE_TO_ZERO_MAX_TARGET_MS = 15000;

/** Fenêtre de grâce (invisible) après le 0 : on accepte encore les taps puis clôture. */
export const RACE_TO_ZERO_GRACE_MS = 3000;

/** Points attribués au podium de CHAQUE manche (top 1 / 2 / 3). */
export const RACE_TO_ZERO_PODIUM_POINTS = [25, 15, 10];

/** Tire une cible aléatoire (ms) dans la plage autorisée. */
export function pickRaceToZeroTarget() {
  const span = RACE_TO_ZERO_MAX_TARGET_MS - RACE_TO_ZERO_MIN_TARGET_MS;
  return RACE_TO_ZERO_MIN_TARGET_MS + Math.round(Math.random() * span);
}

/** Libellé court de la cible (« 12,3 s »). */
export function formatRaceToZeroSeconds(ms) {
  if (ms == null || !Number.isFinite(ms)) return "—";
  return `${(ms / 1000).toFixed(1).replace(".", ",")} s`;
}

/** Écart signé lisible (« +0,4 s » / « -0,2 s »). */
export function formatRaceToZeroGap(ms, targetMs) {
  if (ms == null || !Number.isFinite(ms) || targetMs == null) return "pas tapé";
  const delta = (ms - targetMs) / 1000;
  const sign = delta > 0 ? "+" : delta < 0 ? "-" : "±";
  return `${sign}${Math.abs(delta).toFixed(2).replace(".", ",")} s`;
}
