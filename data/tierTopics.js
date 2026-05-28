/**
 * Tier lists - ajoutez vos logos dans assets/tiers/
 */
export const TIER_LISTS = [
  {
    id: "marvel",
    name: "Films Marvel",
    logo: "assets/tiers/marvel.png",
    emoji: "🦸",
    items: [
      "Iron Man",
      "Avengers",
      "Thor",
      "Black Panther",
      "Doctor Strange",
      "Guardians of the Galaxy",
    ],
  },
  {
    id: "fastfood",
    name: "Fast Food",
    logo: "assets/tiers/fastfood.png",
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
    id: "apps",
    name: "Applications",
    logo: "assets/tiers/apps.png",
    emoji: "📱",
    items: [
      "Instagram",
      "TikTok",
      "Snapchat",
      "Twitter",
      "BeReal",
      "YouTube",
    ],
  },
  {
    id: "series",
    name: "Séries TV",
    logo: "assets/tiers/series.png",
    emoji: "📺",
    items: [
      "Breaking Bad",
      "Stranger Things",
      "The Office",
      "Game of Thrones",
      "Squid Game",
      "Friends",
    ],
  },
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
