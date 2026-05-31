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
      "Arriver en retard important",
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

/** Temps pour classer toute la tier list (1 min 30) */
export const TIER_NIGHT_TIMER_SEC = 90;
