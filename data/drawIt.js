/** Id de catégorie qui fusionne toutes les banques (convention SpeedVote). */
export const DRAW_IT_CATALOG_ID = "catalog";

/** Durée fixe d'une manche — pas un paramètre de prépa. */
export const DRAW_IT_ROUND_DURATION_MS = 60_000;

export const DRAW_IT_ROUND_PRESETS = [3, 5, 8];
export const DRAW_IT_ROUND_ALL = -1;

/**
 * Catégories T1 — structure extensible (id + label).
 * Les libellés « Démo » sont temporaires ; le catalogue réel arrive plus tard.
 */
export const DRAW_IT_CATEGORIES = [
  {
    id: DRAW_IT_CATALOG_ID,
    label: "🎲 Tout le catalogue",
  },
  {
    id: "demo",
    label: "✏️ Démo",
  },
];

/**
 * Mots T1 — placeholders clairement temporaires (structure future : id, label,
 * categoryId, enabled, acceptedAnswers).
 */
export const DRAW_IT_WORDS = [
  {
    id: "demo_elephant",
    label: "Éléphant",
    categoryId: "demo",
    enabled: true,
  },
  {
    id: "demo_pizza",
    label: "Pizza",
    categoryId: "demo",
    enabled: true,
  },
  {
    id: "demo_umbrella",
    label: "Parapluie",
    categoryId: "demo",
    enabled: true,
  },
];

/**
 * Mots enabled d'une catégorie. `catalog` = toutes les banques.
 * `words` injecté pour tests / futur catalogue — ne mute jamais la source.
 * @param {string} categoryId
 * @param {typeof DRAW_IT_WORDS} [words]
 */
export function getDrawItCategoryWords(categoryId, words = DRAW_IT_WORDS) {
  const source = Array.isArray(words) ? words : DRAW_IT_WORDS;
  const enabled = source.filter((w) => w && w.enabled !== false);
  if (!categoryId || categoryId === DRAW_IT_CATALOG_ID) return enabled;
  return enabled.filter((w) => w.categoryId === categoryId);
}

export function isDrawItCategoryId(categoryId) {
  return DRAW_IT_CATEGORIES.some((c) => c.id === categoryId);
}

export function isDrawItRoundCount(roundCount) {
  return DRAW_IT_ROUND_PRESETS.includes(Number(roundCount));
}
