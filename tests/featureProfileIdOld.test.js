/**
 * ID-OLD — UPDATE pack : old OR new (refund + grant conservent les cosmetics).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = (rel) => readFileSync(join(ROOT, rel), "utf8");

const OR_PACK =
  "v_pack := coalesce(old.profile_pack, false) or coalesce(new.profile_pack, false);";
const BAD_COALESCE = "coalesce(old.profile_pack, new.profile_pack, false)";

function cosmeticsFn(sql) {
  const start = sql.indexOf("create or replace function public.profiles_signature_cosmetics()");
  const end = sql.indexOf("$$;", start);
  return sql.slice(start, end);
}

function avatarFn(sql) {
  const start = sql.indexOf("create or replace function public.profiles_signature_avatar()");
  const end = sql.indexOf("$$;", start);
  return sql.slice(start, end);
}

function updateBranch(fn) {
  const start = fn.indexOf("if tg_op = 'UPDATE' then");
  const insert = fn.indexOf("elsif new.id is not null then");
  assert.ok(start >= 0 && insert > start, "branche UPDATE introuvable");
  return fn.slice(start, insert);
}

function insertBranch(fn) {
  const start = fn.indexOf("elsif new.id is not null then");
  const after = fn.indexOf("if not v_pack then", start);
  assert.ok(start >= 0 && after > start, "branche INSERT introuvable");
  return fn.slice(start, after);
}

describe("ID-OLD — triggers cosmetics + avatar", () => {
  const files = [
    "supabase/feature-profile-03c-emoji-fe0f.sql",
    "supabase/feature-profile-03-identity.sql",
    "supabase/feature-profile-03b-emoji-split.sql",
    "supabase/feature-profile-id-old.sql",
  ];

  it("A/B/C — UPDATE pack = old OR new (pas coalesce(old, new))", () => {
    for (const rel of files) {
      const fn = cosmeticsFn(src(rel));
      const upd = updateBranch(fn);
      assert.equal(upd.includes(OR_PACK), true, rel);
      assert.equal(upd.includes(BAD_COALESCE), false, rel);
    }
    const ava = avatarFn(src("supabase/feature-profile-05-avatar.sql"));
    const avaUpd = updateBranch(ava);
    assert.equal(avaUpd.includes(OR_PACK), true);
    assert.equal(avaUpd.includes(BAD_COALESCE), false);
    const deployAva = avatarFn(src("supabase/feature-profile-id-old.sql"));
    assert.equal(updateBranch(deployAva).includes(OR_PACK), true);
  });

  it("INSERT 03c inchangée (lit le pack déjà en base)", () => {
    const fn = cosmeticsFn(src("supabase/feature-profile-03c-emoji-fe0f.sql"));
    const ins = insertBranch(fn);
    assert.match(ins, /select p\.profile_pack into v_existing/);
    assert.match(ins, /from public\.profiles p/);
    assert.match(ins, /v_pack := coalesce\(v_existing, false\)/);
    assert.equal(ins.includes(OR_PACK), false);
  });

  it("D — sans pack, le strip cosmetics / avatar reste", () => {
    const cos = cosmeticsFn(src("supabase/feature-profile-03c-emoji-fe0f.sql"));
    assert.match(cos, /if not v_pack then\s+new\.name_color := null;/);
    const ava = avatarFn(src("supabase/feature-profile-05-avatar.sql"));
    assert.match(ava, /if not v_pack then\s+new\.avatar_path := null;/);
  });

  it("marqueurs de déploiement v4 / id-old-v1", () => {
    assert.match(src("supabase/feature-profile-03c-emoji-fe0f.sql"), /03c-persist-v4/);
    assert.match(src("supabase/feature-profile-id-old.sql"), /03c-persist-v4/);
    assert.match(src("supabase/feature-profile-id-old.sql"), /id-old-v1/);
    assert.match(src("supabase/feature-profile-05-avatar.sql"), /id-old-v1/);
    assert.equal(/03c-persist-v3/.test(src("supabase/feature-profile-03c-emoji-fe0f.sql")), false);
  });

  it("E — true→true / false→false passent par old OR new", () => {
    const upd = updateBranch(cosmeticsFn(src("supabase/feature-profile-03c-emoji-fe0f.sql")));
    assert.equal(upd.includes(OR_PACK), true);
    assert.equal(upd.includes("v_pack := coalesce(new.profile_pack, false);"), false);
  });

  it("webhook / client non touchés", () => {
    const patch = src("supabase/revenuecat-entitlement-patch.js");
    assert.match(patch, /patch\.profile_pack = grant/);
    assert.equal(/name_color/.test(patch), false);
    assert.equal(/avatar_path/.test(patch), false);
    const upsert = src("js/core/supabaseProfile.js").slice(
      src("js/core/supabaseProfile.js").indexOf("export async function upsertProfile")
    );
    assert.equal(/profile_pack\s*:/.test(upsert), false);
  });

  it("runbook vérifie les defs collées", () => {
    const rb = src("supabase/tests/feature-profile-id-old-runbook.sql");
    assert.match(rb, /IDOLD_FUNCTIONS_OK/);
    assert.match(rb, /03c-persist-v4/);
    assert.match(rb, /id-old-v1/);
  });
});
