/** Champs prep / blob lourd — exclus des patches en cours de partie. */
export const PLAY_PATCH_EXCLUDE = new Set([
  "deck",
  "ready",
  "customTakes",
  "customDilemmas",
  "submissions",
  "selectedThemeId",
  "selectedDeckId",
  "selectedModeId",
  "roundCount",
  "questionCount",
  "lobbyStarted",
  "lobbyComplete",
  "sessionId",
  "impostorName",
  "impostorUid",
  "rolesByUid",
  "isLocalImpostor",
]);

/**
 * Extrait du remote complet uniquement les clés du patch local (sans deck ni prep).
 * Tolère `{ ...session, phase }` côté appelant.
 */
export function pickRemotePlayFields(fullRemote, patch) {
  const out = {};
  if (!fullRemote || !patch) return out;
  for (const key of Object.keys(patch)) {
    if (PLAY_PATCH_EXCLUDE.has(key)) continue;
    if (Object.prototype.hasOwnProperty.call(fullRemote, key)) {
      out[key] = fullRemote[key];
    }
  }
  return out;
}
