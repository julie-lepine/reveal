/**
 * Tier lists - ajoutez vos logos dans assets/tiers/
 */
export const TIER_LISTS = [
  {
    id: "life",
    name: "Situations de vie",
    emoji: "💥",
    items: [
      "Se faire ghost",
      "Se tromper de message",
      "Arriver en retard à un RDV important",
      "Se faire griller en train de mentir",
      "Oublier un anniversaire",
      "Rater un examen",
      "Se faire refuser un date",
      "Se ridiculiser devant un crush",
      "Envoyer un message au mauvais groupe",
    ],
  },
  {
    id: "fastfood",
    name: "Fast Food",
    emoji: "🍔",
    items: [
      "McDonald's",
      "KFC",
      "Burger King",
      "Subway",
      "Domino's",
      "Five Guys",
    ],
  },
  {
    id: "animation",
    name: "Dessins animés",
    emoji: "🎬",
    items: [
      "Shrek",
      "Toy Story",
      "Les Indestructibles",
      "Kung Fu Panda",
      "L'Âge de Glace",
      "Ratatouille",
      "Madagascar",
      "Cars",
      "Monstres & Cie",
    ],
  },
  {
    id: "games",
    name: "Jeux vidéo",
    emoji: "🎮",
    items: [
      "Minecraft",
      "Fortnite",
      "GTA V",
      "Call of Duty",
      "League of Legends",
      "FIFA",
      "Among Us",
      "The Witcher 3",
      "Zelda Breath of the Wild",
    ],
  },
  {
    id: "music",
    name: "Artistes",
    emoji: "🎵",
    items: [
      "Drake",
      "Taylor Swift",
      "The Weeknd",
      "Beyoncé",
      "Kanye West",
      "Billie Eilish",
      "Travis Scott",
      "Ariana Grande",
      "Eminem",
    ],
  },
  {
    id: "movies",
    name: "Films cultes",
    emoji: "🍿",
    items: [
      "Inception",
      "Titanic",
      "Interstellar",
      "Matrix",
      "Le Parrain",
      "Fight Club",
      "Harry Potter",
      "Gladiator",
      "Forrest Gump",
    ],
  },
  {
    id: "apps_hot",
    name: "Apps du quotidien",
    emoji: "📲",
    items: [
      "TikTok",
      "Instagram",
      "Snapchat",
      "Twitter / X",
      "BeReal",
      "YouTube",
      "Discord",
      "Spotify",
      "WhatsApp",
    ],
  },
  {
    id: "food",
    name: "Nourriture",
    emoji: "🍕",
    items: [
      "Pizza",
      "Sushi",
      "Burger",
      "Tacos",
      "Kebab",
      "Pâtes",
      "Raclette",
      "Sushi burger (controversé)",
      "Frites",
    ],
  }
];

export const TIER_LEVELS = ["S", "A", "B", "C", "D"];

export const TIER_COLORS = {
  S: "#FF6B6B",
  A: "#FBBF24",
  B: "#4ADE80",
  C: "#60A5FA",
  D: "#A78BFA",
};

/**
 * Modes de jeu Tier Night (produit).
 * - roster : Rank vos amis - « Classe le groupe » (items = joueurs, plateau tiernight).
 * - live   : Rank live - item par item, vote temps réel.
 *
 * Ancien mode `consensus` (Rank it) retiré de l'UX ; normalisé vers `roster`.
 */
export const TIER_NIGHT_MODES = [
  {
    id: "roster",
    name: "Classe le groupe",
    emoji: "👥",
    tagline: "Les joueurs sont les items",
    desc: "Vous classez les membres du lobby selon un thème. Qui finit en tier S ?",
    needsList: false,
    needsTopic: true,
    minPlayers: 3,
  },
  {
    id: "live",
    name: "Rank live",
    emoji: "⚡",
    tagline: "Item par item, en temps réel",
    desc: "On révèle les items un par un, tout le monde vote en même temps. Réactions immédiates garanties.",
    needsList: true,
    minPlayers: 2,
  },
];

export const DEFAULT_TIER_NIGHT_MODE = "roster";

/** Compat : anciennes sessions / localStorage `consensus` → `roster`. */
export function normalizeTierNightMode(mode) {
  if (mode === "live") return "live";
  if (mode === "roster") return "roster";
  // consensus (Rank it) et valeurs inconnues → roster
  return "roster";
}

export function getTierNightModeById(id) {
  const normalized = normalizeTierNightMode(id);
  return TIER_NIGHT_MODES.find((m) => m.id === normalized) || TIER_NIGHT_MODES[0];
}

/**
 * Modifiers de manche (héritage Rank it). Plus exposés en UI ; le scoring /
 * le plateau lisent encore `normal` (et éventuellement un vieux modifier local).
 */
export const TIER_NIGHT_MODIFIERS = [
  {
    id: "normal",
    name: "Classique",
    emoji: "🎯",
    desc: "Classement libre sur les 5 tiers, score à la proximité du consensus.",
  },
  {
    id: "sd_only",
    name: "S & D seulement",
    emoji: "⚖️",
    desc: "Pas de juste milieu : chaque item va en S (on adore) ou en D (on déteste).",
    tiers: ["S", "D"],
  },
  {
    id: "reverse",
    name: "À contre-courant",
    emoji: "🔄",
    desc: "Les points récompensent ceux qui s'éloignent le plus du consensus.",
    reverseScore: true,
  },
  {
    id: "blind",
    name: "À l'aveugle",
    emoji: "🙈",
    desc: "On classe vite : un seul passage, pas de réajustement après validation.",
    blind: true,
  },
];

export const DEFAULT_TIER_NIGHT_MODIFIER = "normal";

export function getTierNightModifierById(id) {
  return TIER_NIGHT_MODIFIERS.find((m) => m.id === id) || TIER_NIGHT_MODIFIERS[0];
}

/**
 * Catégories stables (FEATURE-TIERNIGHT-SERIES-01).
 * Identifiants techniques — ne pas renommer sans migration de sessions.
 */
export const TIER_NIGHT_ROSTER_CATEGORIES = [
  { id: "survival", label: "Survie", order: 10 },
  { id: "social", label: "Social", order: 20 },
  { id: "chaos", label: "Chaos", order: 30 },
];

/**
 * Thèmes pour le mode « Classe le groupe » (items = joueurs).
 * FEATURE-TIERNIGHT-SERIES-01 : `categoryId` / `enabled` / `order` additifs.
 * Les `id` existants et le wire `roster:<id>` sont immuables.
 */
export const TIER_NIGHT_ROSTER_TOPICS = [
  {
    id: "apocalypse",
    emoji: "🧟",
    name: "Qui survit à l'apocalypse ?",
    categoryId: "survival",
    enabled: true,
    order: 10,
  },
  {
    id: "soiree",
    emoji: "🎉",
    name: "Qui organise la meilleure soirée ?",
    categoryId: "social",
    enabled: true,
    order: 10,
  },
  {
    id: "secret",
    emoji: "🤐",
    name: "À qui tu confies ton plus gros secret ?",
    categoryId: "social",
    enabled: true,
    order: 20,
  },
  {
    id: "boss",
    emoji: "💼",
    name: "Qui ferait le meilleur boss ?",
    categoryId: "social",
    enabled: true,
    order: 30,
  },
  {
    id: "crime",
    emoji: "🕵️",
    name: "Qui s'en sortirait après un crime ?",
    categoryId: "survival",
    enabled: true,
    order: 20,
  },
  {
    id: "loto",
    emoji: "🤑",
    name: "Qui claque tout son loto en une semaine ?",
    categoryId: "chaos",
    enabled: true,
    order: 10,
  },
  {
    id: "roadtrip",
    emoji: "🚗",
    name: "Qui tu veux en road-trip ?",
    categoryId: "chaos",
    enabled: true,
    order: 20,
  },
  {
    id: "celebrity",
    emoji: "⭐",
    name: "Qui devient célèbre en premier ?",
    categoryId: "social",
    enabled: true,
    order: 40,
  },
  {
    id: "panic",
    emoji: "🔥",
    name: "Qui garde son calme en cas de panique ?",
    categoryId: "survival",
    enabled: true,
    order: 30,
  },
  {
    id: "ghost",
    emoji: "👻",
    name: "Qui ghoste le plus vite ?",
    categoryId: "chaos",
    enabled: true,
    order: 30,
  },
];

export function getTierNightRosterCategoryById(id) {
  return TIER_NIGHT_ROSTER_CATEGORIES.find((c) => c.id === id) || null;
}

