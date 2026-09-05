import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getState, saveStatePatch, setLocalEmoji, setLocalNameColor } from "../js/core/state.js";
import {
  canUseProfileEmoji,
  isAllowedNameColorId,
  resolvedNameColorHex,
  SIGNATURE_EMOJI_CHOICES,
  SIGNATURE_NAME_COLOR_IDS,
} from "../data/signatureIdentity.js";
import { PROFILE_EMOJI_CHOICES } from "../data/profileEmojis.js";
import { playerNameHtml, signatureRingClass, signatureSelfPreviewHtml } from "../js/core/signatureUi.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function src(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

function patchUser(partial) {
  saveStatePatch({
    user: {
      ...(getState().user || {}),
      ...partial,
    },
  });
}

describe("FEATURE-PROFILE-03 — identité Signature", () => {
  let snapshot;

  beforeEach(() => {
    snapshot = structuredClone(getState());
  });

  afterEach(() => {
    saveStatePatch(snapshot);
  });

  it("palette fermée ; hors liste = pas de couleur", () => {
    assert.equal(isAllowedNameColorId("gold"), true);
    assert.equal(isAllowedNameColorId("#F5D76E"), false);
    assert.equal(SIGNATURE_NAME_COLOR_IDS.length, 8);
    assert.equal(resolvedNameColorHex({ signature: true, nameColor: "gold" }), "#F5D76E");
    assert.equal(resolvedNameColorHex({ signature: false, nameColor: "gold" }), null);
    assert.equal(resolvedNameColorHex({ signature: true, nameColor: "nope" }), null);
  });

  it("18 emojis gratuits ; extra dans Signature", () => {
    assert.equal(canUseProfileEmoji("🦊", { profilePack: false }), true);
    assert.equal(canUseProfileEmoji("👑", { profilePack: false }), false);
    assert.equal(canUseProfileEmoji("👑", { profilePack: true }), true);
    assert.equal(canUseProfileEmoji("🦄\uFE0F", { profilePack: true }), true);
    assert.equal(canUseProfileEmoji("👑", { profilePack: true, isGuest: true }), false);
    assert.equal(PROFILE_EMOJI_CHOICES.length, 18);
    assert.equal(SIGNATURE_EMOJI_CHOICES.length, 24);
    for (const emoji of ["😈", "👻", "🔥", "🐸", "💎", "🌈", "😎", "💜", "🌟", "🎯", "🚀", "🎈"]) {
      assert.equal(PROFILE_EMOJI_CHOICES.includes(emoji), false, emoji);
      assert.equal(SIGNATURE_EMOJI_CHOICES.includes(emoji), true, emoji);
      assert.equal(canUseProfileEmoji(emoji, { profilePack: false }), false, emoji);
      assert.equal(canUseProfileEmoji(emoji, { profilePack: true }), true, emoji);
      assert.equal(canUseProfileEmoji(emoji, { profilePack: true, isGuest: true }), false, emoji);
    }
  });

  it("setLocalEmoji / setLocalNameColor refusent sans pack", () => {
    patchUser({ loggedIn: true, isGuest: false, profilePack: false, nameColor: null });
    assert.equal(setLocalEmoji("👑").ok, false);
    assert.equal(setLocalNameColor("gold").ok, false);
    assert.equal(setLocalEmoji("🦊").ok, true);
  });

  it("setLocalNameColor OK si Signature", () => {
    patchUser({ loggedIn: true, isGuest: false, profilePack: true });
    const res = setLocalNameColor("violet");
    assert.equal(res.ok, true);
    assert.equal(getState().user.nameColor, "violet");
  });

  it("playerNameHtml : badge + couleur seulement si signature", () => {
    const plain = playerNameHtml({ name: "Ada", signature: false, nameColor: "gold" });
    assert.match(plain, /Ada/);
    assert.doesNotMatch(plain, /signature-badge/);
    assert.doesNotMatch(plain, /#F5D76E/);
    const sig = playerNameHtml({ name: "Ada", signature: true, nameColor: "gold" });
    assert.match(sig, /signature-badge/);
    assert.match(sig, /#F5D76E/);
    assert.equal(signatureRingClass({ signature: true }, "avatar"), "avatar signature-ring");
    assert.equal(signatureRingClass({ signature: false }, "avatar"), "avatar");
    const self = signatureSelfPreviewHtml({
      name: "Ada",
      emoji: "🦊",
      signature: true,
      nameColor: "gold",
    });
    assert.match(self, /Les autres te voient comme ça/);
    assert.match(self, /signature-badge/);
    assert.match(self, /signature-ring/);
  });

  it("liens Profil ↔ Forfaits", () => {
    const settings = src("js/screens/settings.js");
    assert.match(settings, /goToSettingsTab\(TAB_FORFAITS\)/);
    assert.match(settings, /data-settings-goto="\$\{TAB_FORFAITS\}"/);
    assert.match(settings, /data-settings-goto="\$\{TAB_PERSONNALISATION\}"/);
    assert.match(src("js/screens/lobby.js"), /Voir les forfaits/);
    assert.match(src("js/screens/lobby.js"), /SETTINGS_TAB\.FORFAITS/);
    assert.match(src("js/screens/gameSelect.js"), /SETTINGS_TAB\.FORFAITS/);
    assert.match(src("style.css"), /flex-wrap:\s*nowrap/);
  });

  it("SQL : colonnes + trigger gate + snapshot salon", () => {
    const sql = src("supabase/feature-profile-03-identity.sql");
    assert.match(sql, /add column if not exists name_color/);
    assert.match(sql, /lobby_members[\s\S]*signature boolean/);
    assert.match(sql, /profiles_signature_cosmetics/);
    assert.match(sql, /lobby_members_stamp_signature/);
    assert.match(sql, /friends_live_name_color/);
    assert.match(sql, /friends_live_signature/);
    const split = src("supabase/feature-profile-03b-emoji-split.sql");
    assert.match(split, /😈👻🔥🐸💎🌈/);
    assert.match(split, /😎💜🌟🎯🚀🎈/);
    const persist = src("supabase/feature-profile-03c-emoji-fe0f.sql");
    assert.match(persist, /03c-persist-v3/);
    assert.match(persist, /from public\.profiles p/);
    assert.match(persist, /profiles_signature_cosmetics/);
    assert.match(sql, /03c-persist-v3/);
    const auth = src("js/core/auth.js");
    const emojiFn = auth.slice(auth.indexOf("export async function updateProfileEmoji"));
    assert.match(emojiFn, /upsertProfile\(\{\s*userId,\s*emoji:/);
    const profile = src("js/core/supabaseProfile.js");
    assert.match(profile, /name_color/);
    const upsert = profile.slice(profile.indexOf("export async function upsertProfile"));
    assert.equal(/profile_pack\s*:/.test(upsert), false);
    assert.match(upsert, /name_color/);
    assert.match(upsert, /emoji !== undefined/);
  });
});
