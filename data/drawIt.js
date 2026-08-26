/** Id de catégorie qui fusionne toutes les banques (convention SpeedVote). */
export const DRAW_IT_CATALOG_ID = "catalog";

/** Durée fixe d'une manche — pas un paramètre de prépa. */
export const DRAW_IT_ROUND_DURATION_MS = 60_000;
export const DRAW_IT_FINDER_POINTS = Object.freeze([20, 15, 10]);
export const DRAW_IT_LATER_FINDER_POINTS = 5;
export const DRAW_IT_DRAWER_POINTS_PER_FIND = 5;

export const DRAW_IT_ROUND_PRESETS = [3, 5, 8];
export const DRAW_IT_ROUND_ALL = -1;

/** Catégories T1 — structure extensible (id + label). */
export const DRAW_IT_CATEGORIES = [
  {
    id: DRAW_IT_CATALOG_ID,
    label: "🎲 Tout le catalogue",
  },
  {
    id: "Facile",
    label: "👼 Facile",
  },
  {
    id: "Moyen",
    label: "👾 Moyen",
  },
  {
    id: "Hardcore",
    label: "👹 Hardcore",
  },
];

/**
 * Mots T1 — par banque (id, label, categoryId, enabled, acceptedAnswers).
 */
export const DRAW_IT_WORDS = [
  { id: "Facile_elephant", label: "Éléphant", categoryId: "Facile", enabled: true },
  { id: "Facile_pizza", label: "Pizza", categoryId: "Facile", enabled: true },
  { id: "Facile_umbrella", label: "Parapluie", categoryId: "Facile", enabled: true },
  { id: "Facile_cat", label: "Chat", categoryId: "Facile", enabled: true },
  { id: "Facile_house", label: "Maison", categoryId: "Facile", enabled: true },
  { id: "Facile_sun", label: "Soleil", categoryId: "Facile", enabled: true },
  { id: "Facile_car", label: "Voiture", categoryId: "Facile", enabled: true },
  { id: "Facile_banana", label: "Banane", categoryId: "Facile", enabled: true },
  { id: "Facile_tree", label: "Arbre", categoryId: "Facile", enabled: true },
  { id: "Facile_glasses", label: "Lunettes", categoryId: "Facile", enabled: true },
  { id: "Facile_fish", label: "Poisson", categoryId: "Facile", enabled: true },
  { id: "Facile_plane", label: "Avion", categoryId: "Facile", enabled: true },
  { id: "Facile_heart", label: "Coeur", categoryId: "Facile", enabled: true },
  { id: "Facile_crayon", label: "Crayon", categoryId: "Facile", enabled: true },
  { id: "Facile_crown", label: "Couronne", categoryId: "Facile", enabled: true },
  { id: "Facile_dog", label: "Chien", categoryId: "Facile", enabled: true },
  { id: "Facile_star", label: "Étoile", categoryId: "Facile", enabled: true },
  { id: "Facile_apple", label: "Pomme", categoryId: "Facile", enabled: true },
  { id: "Facile_bike", label: "Vélo", categoryId: "Facile", enabled: true },
  { id: "Facile_moon", label: "Lune", categoryId: "Facile", enabled: true },
  { id: "Facile_flower", label: "Fleur", categoryId: "Facile", enabled: true },
  { id: "Facile_boat", label: "Bateau", categoryId: "Facile", enabled: true },
  { id: "Facile_key", label: "Clé", categoryId: "Facile", enabled: true },
  { id: "Facile_chair", label: "Chaise", categoryId: "Facile", enabled: true },
  { id: "Facile_pencil", label: "Crayon", categoryId: "Facile", enabled: true },
  { id: "Facile_cake", label: "Gâteau", categoryId: "Facile", enabled: true },
  { id: "Facile_mushroom", label: "Champignon", categoryId: "Facile", enabled: true },

  { id: "Moyen_firefighter", label: "Pompier", categoryId: "Moyen", enabled: true },
  { id: "Moyen_astronaut", label: "Astronaute", categoryId: "Moyen", enabled: true },
  {
    id: "Moyen_castle",
    label: "Château fort",
    categoryId: "Moyen",
    enabled: true,
    acceptedAnswers: ["chateau"],
  },
  {
    id: "Moyen_rollercoaster",
    label: "Montagnes russes",
    categoryId: "Moyen",
    enabled: true,
    acceptedAnswers: ["montagne russe"],
  },
  { id: "Moyen_mermaid", label: "Sirène", categoryId: "Moyen", enabled: true },
  { id: "Moyen_pirate", label: "Pirate", categoryId: "Moyen", enabled: true },
  { id: "Moyen_volcano", label: "Volcan", categoryId: "Moyen", enabled: true },
  { id: "Moyen_kangaroo", label: "Kangourou", categoryId: "Moyen", enabled: true },
  {
    id: "Moyen_eiffel",
    label: "Tour Eiffel",
    categoryId: "Moyen",
    enabled: true,
    acceptedAnswers: ["eiffel", "la tour eiffel"],
  },
  {
    id: "Moyen_superhero",
    label: "Super-héros",
    categoryId: "Moyen",
    enabled: true,
    acceptedAnswers: ["superheros", "super hero"],
  },
  { id: "Moyen_robot", label: "Robot", categoryId: "Moyen", enabled: true },
  { id: "Moyen_dinosaur", label: "Dinosaure", categoryId: "Moyen", enabled: true },
  { id: "Moyen_rocket", label: "Fusée", categoryId: "Moyen", enabled: true },
  { id: "Moyen_igloo", label: "Igloo", categoryId: "Moyen", enabled: true },
  { id: "Moyen_guitar", label: "Guitare", categoryId: "Moyen", enabled: true },
  { id: "Moyen_hotairballoon", label: "Montgolfière", categoryId: "Moyen", enabled: true },
  { id: "Moyen_lighthouse", label: "Phare", categoryId: "Moyen", enabled: true },
  { id: "Moyen_crocodile", label: "Crocodile", categoryId: "Moyen", enabled: true },
  { id: "Moyen_rainbow", label: "Arc-en-ciel", categoryId: "Moyen", enabled: true },
  { id: "Moyen_giraffe", label: "Girafe", categoryId: "Moyen", enabled: true },
  { id: "Moyen_dragon", label: "Dragon", categoryId: "Moyen", enabled: true },
  { id: "Moyen_ninja", label: "Ninja", categoryId: "Moyen", enabled: true },
  { id: "Moyen_penguin", label: "Pingouin", categoryId: "Moyen", enabled: true },
  { id: "Moyen_tractor", label: "Tracteur", categoryId: "Moyen", enabled: true },
  { id: "Moyen_palm", label: "Palmier", categoryId: "Moyen", enabled: true },
  { id: "Moyen_vampire", label: "Vampire", categoryId: "Moyen", enabled: true },

  {
    id: "Hardcore_platypus",
    label: "Ornithorynque",
    categoryId: "Hardcore",
    enabled: true,
  },
  {
    id: "Hardcore_helicopter",
    label: "Hélicoptère",
    categoryId: "Hardcore",
    enabled: true,
    acceptedAnswers: ["helico"],
  },
  { id: "Hardcore_accordion", label: "Accordéon", categoryId: "Hardcore", enabled: true },
  {
    id: "Hardcore_octopus",
    label: "Pieuvre",
    categoryId: "Hardcore",
    enabled: true,
    acceptedAnswers: ["poulpe"],
  },
  { id: "Hardcore_chameleon", label: "Caméléon", categoryId: "Hardcore", enabled: true },
  {
    id: "Hardcore_sewing_machine",
    label: "Machine à coudre",
    categoryId: "Hardcore",
    enabled: true,
  },
  { id: "Hardcore_sphinx", label: "Sphinx", categoryId: "Hardcore", enabled: true },
  { id: "Hardcore_peacock", label: "Paon", categoryId: "Hardcore", enabled: true },
  { id: "Hardcore_dragonfly", label: "Libellule", categoryId: "Hardcore", enabled: true },
  {
    id: "Hardcore_armor",
    label: "Armure",
    categoryId: "Hardcore",
    enabled: true,
    acceptedAnswers: ["armure de chevalier"],
  },
  { id: "Hardcore_jellyfish", label: "Méduse", categoryId: "Hardcore", enabled: true },

  {
    id: "Hardcore_praying_mantis",
    label: "Mante religieuse",
    categoryId: "Hardcore",
    enabled: true,
    acceptedAnswers: ["mante"],
  },
  {
    id: "Hardcore_seahorse",
    label: "Hippocampe",
    categoryId: "Hardcore",
    enabled: true,
    acceptedAnswers: ["cheval de mer"],
  },
  {
    id: "Hardcore_typewriter",
    label: "Machine à écrire",
    categoryId: "Hardcore",
    enabled: true,
  },
  { id: "Hardcore_gargoyle", label: "Gargouille", categoryId: "Hardcore", enabled: true },
  {
    id: "Hardcore_saxophone",
    label: "Saxophone",
    categoryId: "Hardcore",
    enabled: true,
    acceptedAnswers: ["saxo"],
  },
  { id: "Hardcore_scorpion", label: "Scorpion", categoryId: "Hardcore", enabled: true },
  {
    id: "Hardcore_carousel",
    label: "Carrousel",
    categoryId: "Hardcore",
    enabled: true,
    acceptedAnswers: ["manege"],
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
