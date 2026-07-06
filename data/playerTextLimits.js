/** Limite partagée : hot takes, dilemmes custom, affirmations Guess Lie. */
export const PLAYER_TEXT_MAX_LEN = 160;

export function trimPlayerText(text) {
  return String(text ?? "").trim().slice(0, PLAYER_TEXT_MAX_LEN);
}

export function playerTextRemaining(text, max = PLAYER_TEXT_MAX_LEN) {
  return Math.max(0, max - String(text ?? "").length);
}

export function playerTextMaxError(max = PLAYER_TEXT_MAX_LEN) {
  return `Maximum ${max} caractères.`;
}

export function isPlayerTextTooLong(text, max = PLAYER_TEXT_MAX_LEN) {
  return String(text ?? "").trim().length > max;
}
