/** Catalogue des jeux affichés dans le menu (inactifs en tête, puis actifs). */
export const GAMES = [
  {
    id: "blindtest-prep",
    title: "Blind Test",
    desc: "Extraits musicaux — devine titre ou artiste le plus vite",
    emoji: "🎧",
    cssClass: "blindtest",
    borderGradient:
      "linear-gradient(145deg, #6366F1 0%, #818CF8 48%, #2B2D66 100%)",
    enabled: false,
    badgeLabel: "Bientôt",
  },
  {
    id: "playlistguess-prep",
    title: "De qui la playlist ?",
    desc: "Une chanson s’affiche — à qui appartient cette playlist ?",
    emoji: "🎶",
    cssClass: "playlist",
    borderGradient:
      "linear-gradient(200deg, #A78BFA 0%, #6366F1 48%, #2B2D66 100%)",
    enabled: false,
    badgeLabel: "Bientôt",
  },
  {
    id: "trivia-prep",
    title: "Trivia Quiz",
    desc: "Testez votre culture generale",
    emoji: "🧠",
    cssClass: "trivia",
    logo: "js/games/trivia.png",
    borderGradient:
      "linear-gradient(145deg, #A78BFA 0%, #22D3EE 44%, #2B2D66 100%)",
    enabled: true,
  },
  {
    id: "hottake-prep",
    title: "HotTake",
    desc: "Opinions impopulaires — vote BASED ou CRIMINEL",
    emoji: "🔥",
    cssClass: "hot",
    logo: "js/games/hottake.png",
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
    logo: "js/games/guesslie.png",
    borderGradient:
      "linear-gradient(200deg, #FF6B6B 0%, #FF3CAC 48%, #2B2D66 100%)",
    enabled: true,
  },
  {
    id: "speedvote-prep",
    title: "SpeedVote",
    desc: "Vote éclair — chaos instantané en 7 secondes",
    emoji: "⚡",
    cssClass: "speed",
    logo: "js/games/speedvote.png",
    borderGradient:
      "linear-gradient(145deg, #FBBF24 0%, #FF3CAC 48%, #2B2D66 100%)",
    enabled: true,
  },
  {
    id: "dilemma-prep",
    title: "Dilemma",
    desc: "Dilemme A vs B — vote, réactions emoji en 10 s",
    emoji: "⚖️",
    cssClass: "dilemma",
    logo: "js/games/dilemma.png",
    borderGradient:
      "linear-gradient(145deg, #60A5FA 0%, #FF3CAC 48%, #2B2D66 100%)",
    enabled: true,
  },
  {
    id: "truthmeter-prep",
    title: "TruthMeter",
    desc: "Affirmation + curseur Fake → Vrai — le groupe tranche",
    emoji: "📏",
    cssClass: "truth",
    logo: "js/games/truthmeter.png",
    borderGradient:
      "linear-gradient(145deg, #34D399 0%, #60A5FA 48%, #2B2D66 100%)",
    enabled: true,
  },
  {
    id: "consensus-prep",
    title: "Consensus",
    desc: "Curseur 0 → 100 — pense comme le groupe, pas comme toi",
    emoji: "🤝",
    cssClass: "consensus",
    logo: "js/games/consensus.png",
    borderGradient:
      "linear-gradient(145deg, #22D3EE 0%, #A78BFA 48%, #2B2D66 100%)",
    enabled: true,
  },
  {
    id: "tiernight-select",
    title: "TierNight",
    desc: "Choisis une tier list, puis classe en S / A / B / C / D",
    emoji: "🏆",
    cssClass: "tier",
    logo: "js/games/tiernight.png",
    borderGradient:
      "linear-gradient(320deg, #FF6B6B 0%, #FF3CAC 48%, #2B2D66 100%)",
    enabled: true,
  },
];

export const GAMES_COMING_SOON = GAMES.filter((g) => !g.enabled);
export const GAMES_AVAILABLE = GAMES.filter((g) => g.enabled);
