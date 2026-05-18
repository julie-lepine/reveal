/** Id du thème qui fusionne toutes les banques (sauf lui-même) */
export const HOT_TAKE_CATALOG_ID = "catalog";

/** Opinions par thème — utilisées en banque Hot Take */
export const HOT_TAKE_THEMES = [
  {
    id: HOT_TAKE_CATALOG_ID,
    label: "📚 Tout le catalogue",
    takes: [],
  },
  {
    id: "food",
    label: "🍕 Food",
    takes: [
      "Les céréales dans l'eau c'est meilleur.",
      "L'ananas sur la pizza, c'est objectivement bon.",
      "La mayonnaise est meilleure que le ketchup.",
      "Le pain rassis fait de meilleurs croûtons.",
      "Les sushis du supermarché sont underrated.",
    ],
  },
  {
    id: "culture",
    label: "🎬 Culture",
    takes: [
      "Le cinéma c'est surfait, Netflix c'est mieux.",
      "Les films en noir et blanc sont ennuyeux.",
      "Les gens qui regardent les sous-titres sont plus intelligents.",
      "Les livres sont toujours meilleurs que les adaptations.",
    ],
  },
  {
    id: "life",
    label: "☕ Vie quotidienne",
    takes: [
      "Dormir avec des chaussettes c'est correct.",
      "Le café sans sucre c'est pas du vrai café.",
      "Les réveils à 6h rendent plus productif.",
      "Le mode silencieux devrait être obligatoire en public.",
    ],
  },
  {
    id: "mix",
    label: "🎲 Mix",
    takes: [
      "Les céréales dans l'eau c'est meilleur.",
      "L'ananas sur la pizza, c'est objectivement bon.",
      "Le cinéma c'est surfait, Netflix c'est mieux.",
      "Dormir avec des chaussettes c'est correct.",
    ],
  },
];

function normalizeTakeKey(text) {
  return String(text).trim().toLowerCase();
}

/** Toutes les takes de tous les thèmes (hors catalogue), sans doublon — mis à jour si tu ajoutes un thème dans HOT_TAKE_THEMES */
export function getCatalogTakes(themes = HOT_TAKE_THEMES) {
  const seen = new Set();
  const out = [];
  for (const theme of themes) {
    if (theme.id === HOT_TAKE_CATALOG_ID) continue;
    for (const text of theme.takes || []) {
      const key = normalizeTakeKey(text);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(text);
    }
  }
  return out;
}

/** Banque d’un thème (catalogue = fusion automatique) */
export function getThemeBankTexts(themeId, themes = HOT_TAKE_THEMES) {
  if (themeId === HOT_TAKE_CATALOG_ID) return getCatalogTakes(themes);
  const theme =
    themes.find((t) => t.id === themeId) || themes.find((t) => t.id === "mix");
  return [...(theme?.takes || [])];
}

export const HOT_TAKE_OPTIONS = ["BASED", "ACCEPTABLE", "CRIMINEL"];

export const HOT_TAKE_OPTION_COLORS = {
  BASED: "#4ADE80",
  ACCEPTABLE: "#FBBF24",
  CRIMINEL: "#F87171",
};

export const HOT_TAKE_TIMER_SEC = 7;

/** Nombre de manches proposées en préparation (—1 = tout le deck) */
export const HOT_TAKE_ROUND_PRESETS = [3, 5, 8];
/** @deprecated — défini dans js/games/hotTake.js */
export const HOT_TAKE_INTERMISSION_SEC = 5;

export const HOT_TAKE_POINTS_MAJORITY = 12;
export const HOT_TAKE_POINTS_DISSENT = 18;

export const HOT_TAKE_FORBIDDEN_WORDS = [
  "nègre",
  "negre",
  "nigger",
  "nigga",
  "bougnoule",
  "raton",
  "youpin",
  "pédé",
  "pede",
  "tapette",
  "gouine",
  "travelo",
  "tranny",
  "faggot",
  "fag",
];

export const HOT_TAKE_MODERATION_NOTICE =
  "Les insultes et termes racistes, homophobes, transphobes ou haineux sont interdits. Si ta hot take en contient, elle sera refusée.";

/** @deprecated — utiliser HOT_TAKE_THEMES */
export const HOT_TAKES = HOT_TAKE_THEMES.find((t) => t.id === "mix")?.takes || [];
