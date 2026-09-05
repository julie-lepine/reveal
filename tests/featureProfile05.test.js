import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  avatarPathForUser,
  publicAvatarUrl,
  sanitizeAvatarPath,
  sanitizeAvatarRev,
} from "../js/core/signatureAvatar.js";
import { playerAvatarHtml } from "../js/core/signatureUi.js";
import { setLocalAvatar, getState, saveStatePatch } from "../js/core/state.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const UID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

function src(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

describe("FEATURE-PROFILE-05 — avatar photo Signature", () => {
  it("chemin allowlist {uuid}/avatar.jpg + cache-bust", () => {
    assert.equal(avatarPathForUser(UID), `${UID}/avatar.jpg`);
    assert.equal(avatarPathForUser("not-a-uuid"), null);
    assert.equal(sanitizeAvatarPath(`${UID}/avatar.jpg`), `${UID}/avatar.jpg`);
    assert.equal(sanitizeAvatarPath(`${UID}/../secret.jpg`), null);
    assert.equal(sanitizeAvatarPath("other/avatar.jpg"), null);
    assert.equal(sanitizeAvatarRev(4), 4);
    assert.equal(sanitizeAvatarRev(-1), 0);
    const url = publicAvatarUrl(`${UID}/avatar.jpg`, 7, "https://example.supabase.co");
    assert.equal(
      url,
      `https://example.supabase.co/storage/v1/object/public/avatars/${UID}/avatar.jpg?v=7`
    );
    assert.equal(publicAvatarUrl(`${UID}/avatar.jpg`, 0, "https://example.supabase.co")?.includes("?v="), false);
  });

  it("playerAvatarHtml : photo + emoji secours ; sans Signature = pas d’img", () => {
    const withPhoto = playerAvatarHtml({
      emoji: "🦊",
      color: "#60A5FA",
      signature: true,
      avatarPath: `${UID}/avatar.jpg`,
      avatarRev: 3,
    });
    assert.match(withPhoto, /avatar__photo/);
    assert.match(withPhoto, /\?v=3/);
    assert.match(withPhoto, /onerror="this\.remove\(\)"/);
    assert.match(withPhoto, /🦊/);
    const fallback = playerAvatarHtml({
      emoji: "🦊",
      signature: false,
      avatarPath: `${UID}/avatar.jpg`,
      avatarRev: 3,
    });
    assert.doesNotMatch(fallback, /avatar__photo/);
    assert.match(fallback, /🦊/);
  });

  it("setLocalAvatar refuse sans pack", () => {
    const snap = structuredClone(getState());
    try {
      saveStatePatch({
        user: { ...(getState().user || {}), loggedIn: true, isGuest: false, profilePack: false },
      });
      assert.equal(setLocalAvatar({ path: `${UID}/avatar.jpg`, rev: 1 }).ok, false);
      saveStatePatch({
        user: { ...getState().user, profilePack: true },
      });
      const ok = setLocalAvatar({ path: `${UID}/avatar.jpg`, rev: 2 });
      assert.equal(ok.ok, true);
      assert.equal(getState().user.avatarPath, `${UID}/avatar.jpg`);
      assert.equal(getState().user.avatarRev, 2);
    } finally {
      saveStatePatch(snap);
    }
  });

  it("SQL : colonnes, gate path, snapshot salon, bucket, helpers internes", () => {
    const sql = src("supabase/feature-profile-05-avatar.sql");
    assert.match(sql, /add column if not exists avatar_path/);
    assert.match(sql, /lobby_members[\s\S]*avatar_rev integer/);
    assert.match(sql, /profiles_signature_avatar/);
    assert.match(sql, /id::text \|\| '\/avatar\.jpg'/);
    assert.match(sql, /lobby_members_stamp_signature/);
    assert.match(sql, /new\.avatar_path := case when new\.signature then v_path/);
    assert.match(sql, /after update of profile_pack, name_color, avatar_path, avatar_rev/);
    assert.match(sql, /friends_live_avatar_path/);
    assert.match(sql, /revoke all on function public\.friends_live_avatar_path\(uuid\) from authenticated/);
    assert.doesNotMatch(sql, /grant execute on function public\.friends_live_avatar_path/);
    assert.match(sql, /values \(\s*'avatars'/);
    assert.match(sql, /name = auth\.uid\(\)::text \|\| '\/avatar\.jpg'/);
    assert.match(sql, /list_my_friends\(\)[\s\S]*avatar_path text/);
  });

  it("Profil a le picker ; la carte share n’en a pas", () => {
    const settings = src("js/screens/settings.js");
    assert.match(settings, /btn-pick-avatar/);
    assert.match(settings, /openCarnetPhotoCrop/);
    assert.match(settings, /uploadProfileAvatarBlob/);
    assert.doesNotMatch(settings, /capture=/);
    const card = src("js/core/signatureCarnetCard.js");
    assert.doesNotMatch(card, /openCarnetPhotoCrop/);
    assert.doesNotMatch(card, /data-carnet-share-photo/);
    assert.doesNotMatch(card, /accept="image\/\*"/);
    assert.match(card, /crossOrigin = "anonymous"/);
    assert.match(src("js/config/signatureAvatar.js"), /Choisir une photo/);
    const cropUi = src("js/core/signatureCarnetCrop.js");
    assert.doesNotMatch(cropUi, /rotate|90°|Pivoter/);
  });

  it("upsert profil écrit avatar_path, pas profile_pack", () => {
    const profile = src("js/core/supabaseProfile.js");
    const upsert = profile.slice(profile.indexOf("export async function upsertProfile"));
    assert.equal(/profile_pack\s*:/.test(upsert), false);
    assert.match(upsert, /avatar_path/);
    assert.match(upsert, /avatar_rev/);
    assert.match(src("js/core/auth.js"), /cacheControl:\s*"0"/);
    assert.match(src("js/core/auth.js"), /\.remove\(\[path\]\)/);
    assert.match(src("js/screens/lobby.js"), /avatarPhotoHtml/);
  });
});
