import { EVENING_POINTS } from "./eveningScoring.js";

/**
 * Fallback NPC - affirmations par joueur
 */
export const GUESS_LIE_ROUNDS = [
  {
    player: "Lucas",
    statements: [
      "J'ai déjà mangé 4 pizzas entières d'un coup.",
      "Je parle couramment 3 langues.",
      "J'ai rencontré un président.",
    ],
    lie: 2,
  },
  {
    player: "Emma",
    statements: [
      "J'ai grimpé le Mont Blanc.",
      "J'ai un tatouage caché.",
      "J'ai joué dans un film d'horreur.",
    ],
    lie: 0,
  },
  {
    player: "Noah",
    statements: [
      "Je déteste le chocolat.",
      "J'ai un frère jumeau.",
      "J'ai appris le piano à 4 ans.",
    ],
    lie: 0,
  },
  {
    player: "Chloé",
    statements: [
      "J'ai été adoptée par des loups.",
      "Je collectionne les timbres.",
      "J'ai cassé un os en skiant.",
    ],
    lie: 0,
  },
];

export const GUESS_LIE_DETECTIVE_POINTS = EVENING_POINTS.WIN;
export const GUESS_LIE_LIAR_POINTS = EVENING_POINTS.BONUS;
export const GUESS_LIE_VOTE_TIMER_SEC = 30;
/** Moins de ce ratio de détectives → bonus menteur */
export const GUESS_LIE_LIAR_BONUS_THRESHOLD = 0.5;

/** @deprecated */
export const GUESS_LIE_POINTS = GUESS_LIE_DETECTIVE_POINTS;
