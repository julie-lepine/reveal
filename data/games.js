/** Catalogue des jeux affichés dans le menu. `enabled: false` → section « Bientôt » (gameSelect). */
export const GAMES = [
  {
    id: "traitre-prep",
    title: "Le Traître",
    desc: "4 joueurs min. — mot secret, indices oraux, démasque l'intrus",
    emoji: "🎭",
    cssClass: "traitre",
    borderGradient:
      "linear-gradient(145deg, #F97316 0%, #EF4444 48%, #2B2D66 100%)",
    enabled: true,
  },
  {
    id: "playlistguess-prep",
    title: "VibeCheck",
    desc: "3 joueurs min. - une chanson, votez à qui elle correspond le mieux",
    emoji: "🎵",
    cssClass: "playlist",
    logo: "assets/games/vibecheck.png",
    borderGradient:
      "linear-gradient(200deg, #A78BFA 0%, #6366F1 48%, #2B2D66 100%)",
    enabled: true,
  },
  {
    id: "consensus-prep",
    title: "Consensus",
    desc: "Curseur 0 → 100 - pense comme le groupe, pas comme toi",
    emoji: "🤝",
    cssClass: "consensus",
    logo: "assets/games/consensus.png",
    borderGradient:
      "linear-gradient(145deg, #22D3EE 0%, #A78BFA 48%, #2B2D66 100%)",
    enabled: true,
  },
  {
    id: "hottake-prep",
    title: "HotTake",
    desc: "Opinions impopulaires",
    emoji: "🔥",
    cssClass: "hot",
    logo: "assets/games/hottake.png",
    borderGradient:
      "linear-gradient(145deg, #FF6B6B 0%, #FF3CAC 48%, #2B2D66 100%)",
    enabled: true,
  },
  {
    id: "guesslie",
    title: "Guess The Lie",
    desc: "2 vérités, 1 mensonge",
    emoji: "🕵️",
    cssClass: "guess",
    logo: "assets/games/guesslie.png",
    borderGradient:
      "linear-gradient(200deg, #FF6B6B 0%, #FF3CAC 48%, #2B2D66 100%)",
    enabled: true,
  },
  {
    id: "speedvote-prep",
    title: "SpeedVote",
    desc: "Vote éclair - chaos instantané en 7 secondes",
    emoji: "⚡",
    cssClass: "speed",
    logo: "assets/games/speedvote.png",
    borderGradient:
      "linear-gradient(145deg, #FBBF24 0%, #FF3CAC 48%, #2B2D66 100%)",
    enabled: true,
  },
  {
    id: "dilemma-prep",
    title: "Dilemma",
    desc: "Dilemme A vs B - Choisis ton camp, défends-le… vote",
    emoji: "⚖️",
    cssClass: "dilemma",
    logo: "assets/games/dilemma.png",
    borderGradient:
      "linear-gradient(145deg, #60A5FA 0%, #FF3CAC 48%, #2B2D66 100%)",
    enabled: true,
  },
  {
    id: "truthmeter-prep",
    title: "TruthMeter",
    desc: "2 joueurs min. - affirmation + curseur Faux → Vrai, le groupe tranche",
    emoji: "📏",
    cssClass: "truth",
    logo: "assets/games/truthmeter.png",
    borderGradient:
      "linear-gradient(145deg, #34D399 0%, #60A5FA 48%, #2B2D66 100%)",
    enabled: true,
  },
  {
    id: "tiernight-select",
    title: "TierNight",
    desc: "Choisis une tier list, puis classe en S / A / B / C / D",
    emoji: "🏆",
    cssClass: "tier",
    logo: "assets/games/tiernight.png",
    borderGradient:
      "linear-gradient(320deg, #FF6B6B 0%, #FF3CAC 48%, #2B2D66 100%)",
    enabled: true,
  },
  {
    id: "trivia-prep",
    title: "Trivia Quiz",
    desc: "Testez votre culture générale",
    emoji: "🧠",
    cssClass: "trivia",
    logo: "assets/games/trivia.png",
    borderGradient:
      "linear-gradient(145deg, #A78BFA 0%, #22D3EE 44%, #2B2D66 100%)",
    enabled: true,
  },
];

export const GAMES_COMING_SOON = GAMES.filter((g) => !g.enabled);
export const GAMES_AVAILABLE = GAMES.filter((g) => g.enabled);
