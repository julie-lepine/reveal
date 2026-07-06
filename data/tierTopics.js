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
 * Modes de jeu Tier Night.
 * - consensus : flux classique Rank it (chacun classe, médiane du groupe).
 * - roster    : les items sont les joueurs du lobby (« classe le groupe »).
 * - live      : révélation item par item, vote en temps réel.
 */
export const TIER_NIGHT_MODES = [
  {
    id: "consensus",
    name: "Rank it",
    emoji: "📊",
    tagline: "Classe, puis compare au groupe",
    desc: "Chacun fait sa tier list. On calcule le classement médian du groupe et tu marques selon ta proximité.",
    needsList: true,
    minPlayers: 1,
  },
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
    name: "En direct",
    emoji: "⚡",
    tagline: "Item par item, en temps réel",
    desc: "On révèle les items un par un, tout le monde vote en même temps. Réactions immédiates garanties.",
    needsList: true,
    minPlayers: 2,
  },
];

export const DEFAULT_TIER_NIGHT_MODE = "consensus";

export function getTierNightModeById(id) {
  return TIER_NIGHT_MODES.find((m) => m.id === id) || TIER_NIGHT_MODES[0];
}

/**
 * Modifiers de manche (mode consensus). Le modifier change la contrainte ou
 * le scoring d'une partie.
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

/** Thèmes pour le mode « Classe le groupe » (items = joueurs). */
export const TIER_NIGHT_ROSTER_TOPICS = [
  { id: "apocalypse", emoji: "🧟", name: "Qui survit à l'apocalypse ?" },
  { id: "soiree", emoji: "🎉", name: "Qui organise la meilleure soirée ?" },
  { id: "secret", emoji: "🤐", name: "À qui tu confies ton plus gros secret ?" },
  { id: "boss", emoji: "💼", name: "Qui ferait le meilleur boss ?" },
  { id: "crime", emoji: "🕵️", name: "Qui s'en sortirait après un crime ?" },
  { id: "loto", emoji: "🤑", name: "Qui claque tout son loto en une semaine ?" },
  { id: "roadtrip", emoji: "🚗", name: "Qui tu veux en road-trip ?" },
  { id: "celebrity", emoji: "⭐", name: "Qui devient célèbre en premier ?" },
  { id: "panic", emoji: "🔥", name: "Qui garde son calme en cas de panique ?" },
  { id: "ghost", emoji: "👻", name: "Qui ghoste le plus vite ?" },
];

