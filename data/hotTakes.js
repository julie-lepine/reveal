import { EVENING_POINTS } from "./eveningScoring.js";

/** Id du thème qui fusionne toutes les banques (sauf lui-même) */
export const HOT_TAKE_CATALOG_ID = "catalog";

/** Mix : tirage aléatoire parmi les banques des autres thèmes (pas de liste locale). */
export const HOT_TAKE_MIX_ID = "mix";

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
      "Les chips dans un sandwich, c’est du génie.",
      "Commander une salade au resto pour piquer les frites des autres, c’est stratégique.",
      "Les goûters de 16h méritent plus de respect.",
      "Les gens qui aiment les raisins secs dans les cookies ne sont pas dignes de confiance.",
      "Le pain un peu brûlé a meilleur goût.",
      "Les frites sans sauce, c’est triste.",
      "Les pâtes au beurre peuvent sauver une journée.",
      "Le café sans sucre c'est pas du vrai café.",
      "Les céréales dans l'eau c'est meilleur.",
      "L'ananas sur la pizza, c'est objectivement bon.",
      "La mayonnaise est meilleure que le ketchup.",
      "Le pain rassis fait de meilleurs croûtons.",
      "Les sushis du supermarché sont underrated.",
    ],
  },
  {
    id: "habits",
    label: "🧠 Habitudes étranges",
    takes: [
      "Les chats savent exactement quand déranger.",
      "Les gens qui mâchent fort devraient être mutés.",
      "Les gens qui courent après le bus développent un lien personnel avec le chauffeur.",
      "Ouvrir le frigo sans raison précise est une activité à part entière.",
      "Les gens qui courent pour le plaisir me font peur.",
      "Refaire son lit est une perte de temps.",
      "Les gens qui aiment l’été n’ont jamais pris les transports en commun sous canicule.",
      "Les crocs sont moches… mais confortables donc validées.",
    ],
  },
  {
    id: "culture",
    label: "🎬 Culture",
    takes: [
      "Les films d’horreur sont surtout des séances de cardio.",
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
      "Les gens qui mettent des réveils sans se lever sont des artistes du chaos.",
      "Les gens qui mettent leur réveil avec une musique douce aiment souffrir lentement.",
      "Dormir avec des chaussettes c'est correct.",
      "Les réveils à 6h rendent plus productif.",
      "Les discussions après 23h deviennent automatiquement philosophiques.",
      "Les stories “happy birthdayyy” sont une obligation sociale étrange.",
      "Les “mdrrr” sans rire derrière devraient être taxés",
      "Dire “je suis à 5 minutes” en étant encore chez soi est une tradition.",
      "Les “on doit parler” enlèvent 5 ans d’espérance de vie.",
      "Les “tu fais la gueule ?” donnent instantanément envie de faire la gueule.",
      "Les vocaux de 7 minutes devraient être illégaux.",
      "Les gens qui répondent “ok” sont inquiétants.",
      "Le mode silencieux devrait être obligatoire en public.",
      "Les couvertures lourdes donnent un faux sentiment de sécurité mais ça fonctionne.",
      "Regarder la pluie par la fenêtre, c’est une activité.",
      "Le lundi ne devrait pas exister.",
      "Arriver 30 minutes en avance à l’aéroport, c’est vivre dangereusement.",
      "Les gens qui aiment l’été n’ont jamais pris les transports en commun sous canicule.",
    ],
  },
  {
    id: HOT_TAKE_MIX_ID,
    label: "🎲 Mix",
    takes: [],
  },
];

function normalizeTakeKey(text) {
  return String(text).trim().toLowerCase();
}

const AGGREGATE_THEME_IDS = new Set([HOT_TAKE_CATALOG_ID, HOT_TAKE_MIX_ID]);

/** Toutes les takes des thèmes « banque » (hors catalogue / mix), sans doublon. */
export function getCatalogTakes(themes = HOT_TAKE_THEMES) {
  const seen = new Set();
  const out = [];
  for (const theme of themes) {
    if (AGGREGATE_THEME_IDS.has(theme.id)) continue;
    for (const text of theme.takes || []) {
      const key = normalizeTakeKey(text);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(text);
    }
  }
  return out;
}

/** Banque d’un thème (catalogue / mix = fusion des autres thèmes ; le deck est mélangé à la volée). */
export function getThemeBankTexts(themeId, themes = HOT_TAKE_THEMES) {
  if (themeId === HOT_TAKE_CATALOG_ID || themeId === HOT_TAKE_MIX_ID) {
    return getCatalogTakes(themes);
  }
  const theme = themes.find((t) => t.id === themeId);
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

/** @deprecated — utiliser EVENING_POINTS depuis data/eveningScoring.js */
export const HOT_TAKE_POINTS_MAJORITY = EVENING_POINTS.WIN;
/** @deprecated */
export const HOT_TAKE_POINTS_DISSENT = EVENING_POINTS.BONUS;

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

/** @deprecated — utiliser getThemeBankTexts */
export const HOT_TAKES = getCatalogTakes();
