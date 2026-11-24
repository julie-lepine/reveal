/**
 * Audit compte et profil n°5 : 4 caractères suffisaient pour un mot de passe.
 * Minimum 8 dans l'appli (inscription, mot de passe oublié, Paramètres), aligné
 * sur le réglage Supabase, et messages Supabase traduits (trop court, trop connu).
 *
 * node --experimental-test-module-mocks --test tests/passwordMinLength.test.js
 */
import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = (rel) => readFileSync(join(ROOT, rel), "utf8");

globalThis.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };

const calls = [];
let updateError = null;
mock.module("../js/core/supabaseClient.js", {
  namedExports: {
    isSupabaseConfigured: () => true,
    supabase: {
      auth: {
        async signUp(args) {
          calls.push(["signUp", args.password]);
          return { data: { user: null, session: null }, error: null };
        },
        async signInWithPassword() {
          calls.push(["signIn"]);
          return { data: { session: null }, error: null };
        },
        async updateUser(args) {
          calls.push(["updateUser", args.password]);
          return { data: {}, error: updateError };
        },
      },
    },
  },
});

const { saveStatePatch } = await import("../js/core/state.js");
const { signupWithEmail, changeEmailPassword } = await import("../js/core/auth.js");
const { formatAuthErrorMessage } = await import("../js/core/authErrors.js");
const { PASSWORD_MIN_LENGTH } = await import("../js/config/password.js");

describe("Compte n°5 — mot de passe de 8 caractères minimum", () => {
  beforeEach(() => {
    calls.length = 0;
    updateError = null;
    saveStatePatch({
      user: { email: "joueur@exemple.fr", name: "Joueur", loggedIn: true, isGuest: false, provider: "email" },
    });
  });

  it("minimum à 8", () => {
    assert.equal(PASSWORD_MIN_LENGTH, 8);
  });

  it("inscription : 7 caractères refusés sans appeler Supabase, 8 acceptés", async () => {
    const short = await signupWithEmail("a@b.fr", "1234567", "Joueur");
    assert.equal(short.ok, false);
    assert.equal(short.error, "Le mot de passe doit faire au moins 8 caractères.");
    assert.equal(calls.length, 0);
    const ok = await signupWithEmail("a@b.fr", "12345678", "Joueur");
    assert.equal(ok.ok, true);
    assert.deepEqual(calls, [["signUp", "12345678"]]);
  });

  it("Paramètres : 7 caractères refusés avant toute vérification", async () => {
    const res = await changeEmailPassword("ancien", "1234567");
    assert.equal(res.ok, false);
    assert.equal(res.error, "Le mot de passe doit faire au moins 8 caractères.");
    assert.equal(calls.length, 0);
  });

  it("refus de Supabase traduit au changement de mot de passe", async () => {
    updateError = { message: "Password is known to be weak and easy to guess, please choose a different one." };
    const res = await changeEmailPassword("ancien", "motdepasse");
    assert.equal(res.ok, false);
    assert.match(res.error, /trop connu/);
  });

  it("messages Supabase en français", () => {
    assert.equal(
      formatAuthErrorMessage("Password should be at least 8 characters."),
      "Le mot de passe est trop faible (8 caractères minimum)."
    );
    assert.match(
      formatAuthErrorMessage("Password is known to be weak and easy to guess, please choose a different one."),
      /trop connu/
    );
    assert.equal(
      formatAuthErrorMessage("New password should be different from the old password."),
      "Choisis un mot de passe différent de l'ancien."
    );
  });

  it("plus aucun « 4 caractères » dans les écrans", () => {
    for (const f of ["js/screens/home.js", "js/screens/resetPassword.js", "js/screens/settings.js", "js/core/auth.js", "js/core/authErrors.js"]) {
      assert.equal(/4 caractères/.test(src(f)), false, f);
    }
    assert.match(src("js/screens/resetPassword.js"), /next\.length < PASSWORD_MIN_LENGTH/);
    for (const f of ["js/screens/home.js", "js/screens/resetPassword.js", "js/screens/settings.js"]) {
      assert.match(src(f), /placeholder="\$\{PASSWORD_MIN_PLACEHOLDER\}"/, f);
    }
  });
});
