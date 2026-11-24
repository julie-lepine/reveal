/**
 * Audit compte et profil n°4 : dans Paramètres, le mot de passe actuel était
 * demandé mais jamais vérifié. Il est vérifié (connexion au même compte) avant
 * le changement ; le lien « mot de passe oublié » n'en a pas besoin.
 *
 * node --experimental-test-module-mocks --test tests/changePasswordCurrentCheck.test.js
 */
import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

const store = new Map();
globalThis.sessionStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const calls = [];
let signInError = null;

mock.module("../js/core/supabaseClient.js", {
  namedExports: {
    isSupabaseConfigured: () => true,
    supabase: {
      auth: {
        async signInWithPassword(args) {
          calls.push(["signIn", args]);
          return { data: { session: null }, error: signInError };
        },
        async updateUser(args) {
          calls.push(["updateUser", args]);
          return { data: {}, error: null };
        },
      },
    },
  },
});

const { saveStatePatch } = await import("../js/core/state.js");
const { changeEmailPassword } = await import("../js/core/auth.js");
const { setPasswordRecoveryPending, clearPasswordRecoveryPending } = await import(
  "../js/core/supabaseAuth.js"
);

describe("Compte n°4 — changer son mot de passe demande le bon mot de passe actuel", () => {
  beforeEach(() => {
    calls.length = 0;
    signInError = null;
    clearPasswordRecoveryPending();
    saveStatePatch({
      user: { email: "Joueur@Exemple.fr", name: "Joueur", loggedIn: true, isGuest: false, provider: "email" },
    });
  });

  it("bon mot de passe actuel : vérifié puis changé", async () => {
    const res = await changeEmailPassword("ancien", "nouveau1");
    assert.equal(res.ok, true);
    assert.deepEqual(calls, [
      ["signIn", { email: "joueur@exemple.fr", password: "ancien" }],
      ["updateUser", { password: "nouveau1" }],
    ]);
  });

  it("mauvais mot de passe actuel : rien n'est changé", async () => {
    signInError = { message: "Invalid login credentials" };
    const res = await changeEmailPassword("faux", "nouveau1");
    assert.equal(res.ok, false);
    assert.equal(res.error, "Mot de passe actuel incorrect.");
    assert.equal(calls.some(([n]) => n === "updateUser"), false);
  });

  it("mot de passe actuel vide : refusé sans rien appeler", async () => {
    const res = await changeEmailPassword("", "nouveau1");
    assert.equal(res.ok, false);
    assert.equal(res.error, "Indique ton mot de passe actuel.");
    assert.equal(calls.length, 0);
  });

  it("anti-robot exigé par Supabase : on renvoie vers « Mot de passe oublié », rien n'est changé", async () => {
    signInError = { message: "captcha verification process failed" };
    const res = await changeEmailPassword("ancien", "nouveau1");
    assert.equal(res.ok, false);
    assert.match(res.error, /Mot de passe oublié/);
    assert.equal(calls.some(([n]) => n === "updateUser"), false);
  });

  it("lien « mot de passe oublié » : pas d'ancien mot de passe demandé", async () => {
    setPasswordRecoveryPending();
    const res = await changeEmailPassword("", "nouveau1");
    assert.equal(res.ok, true);
    assert.deepEqual(calls, [["updateUser", { password: "nouveau1" }]]);
  });
});
