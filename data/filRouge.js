/** Fil Rouge — Mot Interdit (couche persistante de soirée) */

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

export {
  HOT_TAKE_FORBIDDEN_WORDS as FIL_ROUGE_FORBIDDEN_WORDS,
  HOT_TAKE_MODERATION_NOTICE as FIL_ROUGE_MODERATION_NOTICE,
} from "./hotTakes.js";
