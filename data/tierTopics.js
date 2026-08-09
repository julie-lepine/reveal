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
 * Identifiants techniques - ne pas renommer sans migration de sessions.
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
 *
 * `name` = axe oral « Du plus … au plus/moins … » (classement S→D de tout le lobby).
 */
export const TIER_NIGHT_ROSTER_TOPICS = [
  {
    id: "apocalypse",
    emoji: "🧟",
    name: "Du meilleur survivant au plus nul en apocalypse zombie",
    categoryId: "survival",
    enabled: true,
    order: 10,
  },
  {
    id: "soiree",
    emoji: "🎉",
    name: "Du meilleur organisateur de soirées au pire",
    categoryId: "social",
    enabled: true,
    order: 10,
  },
  {
    id: "secret",
    emoji: "🤐",
    name: "Du plus fiable au plus nul pour garder un secret",
    categoryId: "social",
    enabled: true,
    order: 20,
  },
  {
    id: "boss",
    emoji: "💼",
    name: "Du meilleur boss au pire cauchemar de manager",
    categoryId: "social",
    enabled: true,
    order: 30,
  },
  {
    id: "crime",
    emoji: "🕵️",
    name: "Du plus malin au plus vite grillé par la police après un crime",
    categoryId: "survival",
    enabled: true,
    order: 20,
  },
  {
    id: "loto",
    emoji: "🤑",
    name: "Du plus économe au plus speed pour claquer un jackpot",
    categoryId: "chaos",
    enabled: true,
    order: 10,
  },
  {
    id: "roadtrip",
    emoji: "🚗",
    name: "Du meilleur compagnon de road-trip au plus lourd",
    categoryId: "chaos",
    enabled: true,
    order: 20,
  },
  {
    id: "celebrity",
    emoji: "⭐",
    name: "Du plus potentiellement célèbre un jour au plus anonyme à vie",
    categoryId: "social",
    enabled: true,
    order: 40,
  },
  {
    id: "panic",
    emoji: "🔥",
    name: "Du plus calme au plus paniqué en situations d'urgence",
    categoryId: "survival",
    enabled: true,
    order: 30,
  },
  {
    id: "ghost",
    emoji: "👻",
    name: "Du plus ghosteur au plus collant",
    categoryId: "chaos",
    enabled: true,
    order: 30,
  },
  {
    id: "island",
    emoji: "🏝️",
    name: "Du meilleur survivant au plus perdu sur une île déserte",
    categoryId: "survival",
    enabled: true,
    order: 40,
  },
  {
    id: "roommate",
    emoji: "🏠",
    name: "Du rêve de coloc au cauchemar absolu",
    categoryId: "social",
    enabled: true,
    order: 50,
  },
  {
    id: "wedding",
    emoji: "💍",
    name: "Du meilleur discours de mariage au plus gênant",
    categoryId: "social",
    enabled: true,
    order: 60,
  },
  {
    id: "influencer",
    emoji: "📱",
    name: "Du meilleur influenceur au flop total",
    categoryId: "social",
    enabled: true,
    order: 70,
  },
  {
    id: "late",
    emoji: "⏰",
    name: "Du plus ponctuel au plus toujours en retard",
    categoryId: "chaos",
    enabled: true,
    order: 40,
  },
  {
    id: "scam",
    emoji: "🎣",
    name: "Du plus méfiant au plus naïf face aux arnaques",
    categoryId: "chaos",
    enabled: true,
    order: 50,
  },
  {
    id: "karaoke",
    emoji: "🎤",
    name: "Du boss karaoké au pire cringe",
    categoryId: "chaos",
    enabled: true,
    order: 60,
  },
  {
    id: "retraite",
    emoji: "🏖️",
    name: "Du plus tôt à la retraite au plus à travailler à vie",
    categoryId: "future",
    enabled: true,
    order: 10,
  },
  {
    id: "tout-quitter",
    emoji: "✈️",
    name: "Du plus prêt à tout plaquer pour l'étranger au plus casanier",
    categoryId: "future",
    enabled: true,
    order: 10,
  },
  {
    id: "maison-reve",
    emoji: "🏡",
    name: "De celui qui aura la maison de rêve à celui qui aura un studio douteux dans 10 ans",
    categoryId: "future",
    enabled: true,
    order: 10,
  },
  {
    id: "business",
    emoji: "🚀",
    name: "Du plus impulsif au plus prudent pour lancer un business",
    categoryId: "future",
    enabled: true,
    order: 10,
  },
  {
    id: "drama",
    emoji: "🎭",
    name: "Du plus zen au plus drama queen",
    categoryId: "personality",
    enabled: true,
    order: 10,
  },
  {
    id: "fou-rire",
    emoji: "😂",
    name: "Du plus contagieux au plus impassible pour un fou rire",
    categoryId: "social",
    enabled: true,
    order: 10,
  },
  {
    id: "inconnus",
    emoji: "🤝",
    name: "Du plus sociable au plus gênant avec des inconnus",
    categoryId: "social",
    enabled: true,
    order: 10,
  },
  {
    id: "centre-attention",
    emoji: "🎤",
    name: "Du centre d'attention au plus discret en soirée",
    categoryId: "social",
    enabled: true,
    order: 10,
  },
  {
    id: "after",
    emoji: "🌅",
    name: "Du dernier debout à la fin de l'after au premier KO",
    categoryId: "party",
    enabled: true,
    order: 10,
  },
  {
    id: "danse",
    emoji: "🕺",
    name: "Du premier sur la piste au plus collé au mur",
    categoryId: "party",
    enabled: true,
    order: 10,
  },
  {
    id: "lendemain-soiree",
    emoji: "🥴",
    name: "Du plus frais au plus malade en lendemains de soirées",
    categoryId: "party",
    enabled: true,
    order: 10,
  },
  {
    id: "tele-realite",
    emoji: "📺",
    name: "Du gagnant de la télé-réalité au premier éliminé",
    categoryId: "chaos",
    enabled: true,
    order: 10,
  },
  {
    id: "tatouage",
    emoji: "🖋️",
    name: "Du plus impulsif au plus réfléchi pour un tatouage",
    categoryId: "chaos",
    enabled: true,
    order: 10,
  },
  {
    id: "police",
    emoji: "🚓",
    name: "Du premier appelé pour le commissariat au plus inutile",
    categoryId: "chaos",
    enabled: true,
    order: 10,
  },
  {
    id: "film-horreur",
    emoji: "🔪",
    name: "Du dernier survivant au mort le plus tôt dans un film d'horreur",
    categoryId: "survival",
    enabled: true,
    order: 10,
  },
  {
    id: "premier-mourir-film",
    emoji: "💀",
    name: "Du premier mort au dernier survivant dans un film d'horreur",
    categoryId: "survival",
    enabled: true,
    order: 10,
  },
  {
    id: "president",
    emoji: "🏛️",
    name: "Du président le plus crédible au plus catastrophique",
    categoryId: "future",
    enabled: true,
    order: 10,
  },
];

export function getTierNightRosterCategoryById(id) {
  return TIER_NIGHT_ROSTER_CATEGORIES.find((c) => c.id === id) || null;
}

