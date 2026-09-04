/**
 * Suppression de compte in-app (App Store 5.1.1 / 2.1).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

function src(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

describe("FEATURE-ACCOUNT-DELETION — in-app", () => {
  it("le bouton n’ouvre plus le site ni un mailto", () => {
    const help = src("js/screens/helpLegal.js");
    assert.match(help, /deleteRegisteredAccount/);
    assert.match(help, /Supprimer définitivement/);
    assert.match(help, /id="btn-delete-account"/);
    assert.equal(help.includes("openExternalUrl"), false);
    assert.equal(help.includes("ACCOUNT_DELETION_PUBLIC_URL"), false);
    assert.equal(help.includes("ACCOUNT_DELETION_MAILTO"), false);
    assert.equal(help.includes("openDeletionPage"), false);
    assert.equal(src("js/screens/settings.js").includes("btn-delete-account"), false);
  });

  it("invité : pas de bouton supprimer, texte d’expiration", () => {
    const help = src("js/screens/helpLegal.js");
    assert.match(help, /helpLegalBodyHtml\(registeredAccount\)/);
    assert.match(help, /Le mode invité ne crée pas de compte/);
    assert.match(help, /const registeredAccount = isLoggedIn\(\)/);
  });

  it("auth : JWT courant, pas d’id client, signOut local après delete", () => {
    const auth = src("js/core/auth.js");
    const del = auth.slice(auth.indexOf("export async function deleteRegisteredAccount"));
    assert.match(del, /isLoggedIn\(\)/);
    assert.match(del, /leaveActiveLobbyForAuthChange/);
    assert.match(del, /deleteRegisteredAccountOnServer/);
    assert.match(del, /signOutSupabaseAfterAccountDeleted/);
    assert.ok(
      del.indexOf("leaveActiveLobbyForAuthChange") < del.indexOf("deleteRegisteredAccountOnServer")
    );
    assert.ok(
      del.indexOf("deleteRegisteredAccountOnServer") <
        del.indexOf("signOutSupabaseAfterAccountDeleted")
    );

    const sb = src("js/core/supabaseAuth.js");
    assert.match(sb, /functions\.invoke\("delete-account"/);
    assert.match(sb, /session\.access_token/);
    assert.equal(sb.includes("SERVICE_ROLE"), false);
    assert.equal(/admin\.deleteUser/.test(sb), false);
  });

  it("Edge Function : JWT + service_role, refuse les invités", () => {
    const fn = src("supabase/functions/delete-account/index.ts");
    const cfg = src("supabase/config.toml");
    assert.match(fn, /auth\.admin\.deleteUser/);
    assert.match(fn, /SUPABASE_SERVICE_ROLE_KEY/);
    assert.match(fn, /user\.is_anonymous/);
    assert.match(fn, /getUser\(/);
    assert.equal(fn.includes("--no-verify-jwt"), false);
    assert.match(cfg, /\[functions\.delete-account\]/);
    assert.match(cfg, /verify_jwt\s*=\s*true/);
  });

  it("politique in-app : suppression immédiate depuis Paramètres", () => {
    const legal = src("data/legalContent.js");
    const deletion = legal.slice(legal.indexOf("Suppression de compte"));
    assert.match(deletion, /Menu → Aide & légal → Supprimer mon compte/);
    assert.match(deletion, /immédiate/);
    assert.equal(deletion.includes("sous 30 jours ouvrés"), false);
    assert.equal(deletion.includes("Envoyez une demande depuis l'application"), false);
  });
});
