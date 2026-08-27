/**
 * Identité live amis : placeholder Joueur / 👤 n’écrase pas le pseudo d’inscription.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PLACEHOLDER_DISPLAY_NAME,
  PLACEHOLDER_EMOJI,
  isPlaceholderDisplayName,
  isPlaceholderEmoji,
  registeredProfileNeedsHeal,
  resolveLiveDisplayName,
  resolveLiveEmoji,
} from "../js/core/profileIdentity.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

describe("profileIdentity — placeholder vs pseudo d’inscription", () => {
  it("Joueur / vide / 👤 sont des placeholders", () => {
    assert.equal(isPlaceholderDisplayName("Joueur"), true);
    assert.equal(isPlaceholderDisplayName("  "), true);
    assert.equal(isPlaceholderDisplayName("Léa"), false);
    assert.equal(isPlaceholderEmoji("👤"), true);
    assert.equal(isPlaceholderEmoji("🦊"), false);
  });

  it("le profil Joueur ne gagne pas sur le display_name d’inscription", () => {
    assert.equal(
      resolveLiveDisplayName({
        profileName: PLACEHOLDER_DISPLAY_NAME,
        metadataName: "Alex",
        email: "alex@x.test",
      }),
      "Alex"
    );
  });

  it("un vrai pseudo profil gagne sur la metadata", () => {
    assert.equal(
      resolveLiveDisplayName({
        profileName: "Léa",
        metadataName: "LeaInscription",
      }),
      "Léa"
    );
  });

  it("emoji profil 👤 s’efface au profit d’un emoji choisi", () => {
    assert.equal(
      resolveLiveEmoji({
        profileEmoji: PLACEHOLDER_EMOJI,
        localEmoji: "🎭",
      }),
      "🎭"
    );
  });

  it("heal seulement si le profil est encore placeholder", () => {
    assert.equal(
      registeredProfileNeedsHeal(
        { display_name: "Joueur", emoji: "👤" },
        "Alex",
        "🦊"
      ),
      true
    );
    assert.equal(
      registeredProfileNeedsHeal(
        { display_name: "Alex", emoji: "🦊" },
        "Alex",
        "🦊"
      ),
      false
    );
    assert.equal(registeredProfileNeedsHeal(null, "Alex", "👤"), true);
    assert.equal(registeredProfileNeedsHeal(null, "Joueur", "👤"), false);
  });

  it("login soigne le profil ; inscription n’échoue plus si upsert sans session", () => {
    const auth = read("js/core/supabaseAuth.js");
    assert.match(auth, /resolveLiveDisplayName/);
    assert.match(auth, /registeredProfileNeedsHeal/);
    assert.match(auth, /Le pseudo doit faire au moins 2 caractères/);
    const signup = auth.slice(auth.indexOf("export async function signUpWithEmail"));
    assert.match(signup, /try \{/);
    assert.match(signup, /handle_new_user/);
  });

  it("changer d’emoji n’écrit plus Joueur par défaut", () => {
    const src = read("js/core/auth.js");
    assert.match(src, /isPlaceholderDisplayName/);
    assert.doesNotMatch(
      src.slice(src.indexOf("export async function updateProfileEmoji")),
      /displayName: getState\(\)\.user\?\.name \|\| "Joueur"/
    );
  });
});
