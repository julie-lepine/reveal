/** Fil Rouge - Mot Interdit (couche persistante de soirée) */

import { FIL_ROUGE_POINTS } from "./eveningScoring.js";


export const FIL_ROUGE_POINTS_MISSION = FIL_ROUGE_POINTS.MISSION;
export const FIL_ROUGE_MIN_WORD_LENGTH = 3;
export const FIL_ROUGE_MIN_PLAYERS = 3;

export const FIL_ROUGE_STATUS = {
  IDLE: "idle",
  SETUP: "setup",
  ACTIVE: "active",
  COMPLETED: "completed",
};

export const FIL_ROUGE_VALIDATION = {
  IN_PROGRESS: "in_progress",
  PENDING: "pending",
  VALIDATED: "validated",
  REJECTED: "rejected",
};

export const FIL_ROUGE_STATUS_LABELS = {
  idle: "Non configuré",
  setup: "Configuration en cours",
  active: "En cours",
  completed: "Terminé",
};

export const FIL_ROUGE_TILE = {
  emoji: "🤫",
  title: "Mot Interdit",
  desc: "Fais prononcer ton mot sans te faire griller.",
};

/**
 * Pool de mots « jouables » : assez courants pour être glissés dans une conversation.
 * Liste de départ à affiner librement (ajout / retrait).
 */
export const FIL_ROUGE_WORD_POOL = [
  "chien", "chat", "pizza", "soleil", "voiture", "café", "musique", "plage",
  "montagne", "fromage", "téléphone", "chaussure", "banane", "ordinateur",
  "fenêtre", "jardin", "vélo", "chocolat", "parapluie", "lunettes", "canapé",
  "bouteille", "cuisine", "vacances", "cinéma", "ballon", "guitare", "oreiller",
  "serviette", "télévision", "frigo", "escalier", "ascenseur", "balcon",
  "voisin", "facture", "réveil", "brosse", "savon", "miroir", "tiroir",
  "bougie", "couverture", "casquette", "écharpe", "ceinture", "portefeuille",
  "fourchette", "assiette", "couteau", "tasse", "nuage", "orage", "rivière",
  "forêt", "fusée", "dragon", "château", "trésor", "pirate", "robot",
  "fantôme", "licorne", "crayon", "ciseaux",
];

/** Nombre de mots proposés à chaque joueur dans la liste déroulante. */
export const FIL_ROUGE_WORD_CHOICE_COUNT = 10;

function hashString(str) {
  let h = 2166136261 >>> 0;
  const s = String(str);
  for (let i = 0; i < s.length; i += 1) {
    h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Sous-ensemble déterministe du pool pour un joueur donné (seed = son uid).
 * Stable au re-render et au reload ; deux joueurs distincts ont des listes différentes.
 */
export function getFilRougeWordChoices(seed, count = FIL_ROUGE_WORD_CHOICE_COUNT) {
  const rng = mulberry32(hashString(seed || "fil-rouge"));
  const a = [...FIL_ROUGE_WORD_POOL];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, Math.min(count, a.length));
}

export {
  HOT_TAKE_FORBIDDEN_WORDS as FIL_ROUGE_FORBIDDEN_WORDS,
  HOT_TAKE_MODERATION_NOTICE as FIL_ROUGE_MODERATION_NOTICE,
} from "./hotTakes.js";
