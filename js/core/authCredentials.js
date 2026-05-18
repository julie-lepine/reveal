/** Comptes email simulés (localStorage) — démo sans backend. */

const STORAGE_KEY = "reveal-auth-credentials";

function loadStore() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveStore(store) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

export function hasEmailAccount(email) {
  return Boolean(loadStore()[email]);
}

export function registerEmailAccount(email, password, name) {
  const store = loadStore();
  store[email] = { password, name: name.trim() };
  saveStore(store);
}

export function verifyEmailAccount(email, password) {
  const entry = loadStore()[email];
  if (!entry) {
    return { ok: false, error: "Aucun compte pour cet email. Crée un compte d'abord." };
  }
  if (entry.password !== password) {
    return { ok: false, error: "Mot de passe incorrect." };
  }
  return { ok: true, name: entry.name };
}

export function updateEmailAccountName(email, name) {
  const store = loadStore();
  const entry = store[email];
  if (!entry) return;
  store[email] = { ...entry, name: name.trim() };
  saveStore(store);
}

export function changeEmailAccountPassword(email, currentPassword, newPassword) {
  const store = loadStore();
  const entry = store[email];
  if (!entry) {
    return { ok: false, error: "Compte introuvable." };
  }
  if (entry.password !== currentPassword) {
    return { ok: false, error: "Mot de passe actuel incorrect." };
  }
  if (!newPassword || newPassword.length < 4) {
    return { ok: false, error: "Le nouveau mot de passe doit faire au moins 4 caractères." };
  }
  store[email] = { ...entry, password: newPassword };
  saveStore(store);
  return { ok: true };
}
