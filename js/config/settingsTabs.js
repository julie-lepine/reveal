/** Onglets de l’écran Menu. La bottom nav reste « Menu ». */
export const SETTINGS_TAB = {
  SOIREE: "soiree",
  PERSONNALISATION: "personnalisation",
  FORFAITS: "forfaits",
};

/** Pages poussées depuis Profil (pas des onglets). */
export const SETTINGS_PROFILE_SUBPAGES = new Set([
  "friends",
  "carnet",
  "help-legal",
  "privacy",
]);

let pendingReturnTab = null;

export function rememberSettingsReturnTab(tab) {
  pendingReturnTab = tab || null;
}

export function consumePendingSettingsTab() {
  const tab = pendingReturnTab;
  pendingReturnTab = null;
  return tab;
}

export function resolveSettingsTab({ requested, pending, inLobby }) {
  const pick = requested || pending;
  if (pick === SETTINGS_TAB.FORFAITS) return SETTINGS_TAB.FORFAITS;
  if (pick === SETTINGS_TAB.PERSONNALISATION) return SETTINGS_TAB.PERSONNALISATION;
  if (pick === SETTINGS_TAB.SOIREE && inLobby) return SETTINGS_TAB.SOIREE;
  return inLobby ? SETTINGS_TAB.SOIREE : SETTINGS_TAB.PERSONNALISATION;
}
