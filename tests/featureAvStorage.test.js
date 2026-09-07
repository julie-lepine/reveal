/**
 * AV-STORAGE — Storage RLS avatars : owner + profile_pack OR host_pack.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = (rel) => readFileSync(join(ROOT, rel), "utf8");

describe("AV-STORAGE — policies Storage avatars", () => {
  const sql = src("supabase/feature-profile-av-storage.sql");
  const runbook = src("supabase/tests/feature-profile-av-storage-runbook.sql");
  const sql05 = src("supabase/feature-profile-05-avatar.sql");
  const idOld = src("supabase/feature-profile-id-old.sql");
  const auth = src("js/core/auth.js");
  const overlay = src("js/core/signatureCosmeticsPending.js");

  it("A/B/C — INSERT/UPDATE/DELETE : owner + can_write_own_avatar", () => {
    assert.match(sql, /av-storage-v1/);
    assert.match(sql, /create or replace function public\.can_write_own_avatar\(\)/);
    assert.match(sql, /security definer/);
    assert.match(sql, /p\.id = auth\.uid\(\)/);
    assert.match(
      sql,
      /coalesce\(p\.profile_pack, false\)\s+or coalesce\(p\.host_pack, false\)/
    );
    assert.match(sql, /grant execute on function public\.can_write_own_avatar\(\) to authenticated/);
    assert.match(sql, /revoke all on function public\.can_write_own_avatar\(\) from anon/);

    const ins = sql.slice(sql.indexOf('drop policy if exists "avatars owner insert"'));
    const insEnd = ins.indexOf('drop policy if exists "avatars owner update"');
    const insertPol = ins.slice(0, insEnd);
    assert.match(insertPol, /for insert/);
    assert.match(insertPol, /name = auth\.uid\(\)::text \|\| '\/avatar\.jpg'/);
    assert.match(insertPol, /public\.can_write_own_avatar\(\)/);

    const upd = sql.slice(sql.indexOf('drop policy if exists "avatars owner update"'));
    const updEnd = upd.indexOf('drop policy if exists "avatars owner delete"');
    const updatePol = upd.slice(0, updEnd);
    assert.match(updatePol, /for update/);
    assert.equal((updatePol.match(/can_write_own_avatar/g) || []).length, 2);

    const del = sql.slice(sql.indexOf('drop policy if exists "avatars owner delete"'));
    assert.match(del, /for delete/);
    assert.match(del, /public\.can_write_own_avatar\(\)/);
  });

  it("E — SELECT public inchangé (ce fichier ne recrée pas la policy)", () => {
    assert.doesNotMatch(sql, /create policy "avatars public read"/);
    assert.doesNotMatch(sql, /drop policy if exists "avatars public read"/);
    assert.match(sql05, /create policy "avatars public read"/);
    const sel = sql05.slice(sql05.indexOf('create policy "avatars public read"'));
    const selEnd = sel.indexOf("drop policy if exists");
    assert.doesNotMatch(sel.slice(0, selEnd), /can_write_own_avatar/);
  });

  it("ne recrée pas le bucket ; pas d’écriture profile_pack client", () => {
    assert.doesNotMatch(sql, /insert into storage\.buckets/);
    assert.doesNotMatch(sql, /public\s*=\s*false/);
    assert.doesNotMatch(sql, /profile_pack\s*:/);
    assert.doesNotMatch(sql, /host_pack\s*:/);
  });

  it("runbook vérifie les 4 policies et refuse une write permissive", () => {
    assert.match(runbook, /AVSTORAGE_POLICIES_OK/);
    assert.match(runbook, /v_n <> 4/);
    assert.match(runbook, /AVSTORAGE_PERMISSIVE_WRITE/);
    assert.match(runbook, /AVSTORAGE_SELECT_GATED/);
  });

  it("non-régression ID-OLD / ID-OVERLAY / AV-REPLACE", () => {
    assert.match(
      idOld,
      /v_pack := coalesce\(old\.profile_pack, false\) or coalesce\(new\.profile_pack, false\)/
    );
    assert.match(overlay, /replayPendingSignatureCosmetics/);
    const uploadStart = auth.indexOf("export async function uploadProfileAvatarBlob");
    const uploadEnd = auth.indexOf("\nexport async function", uploadStart + 1);
    const upload = auth.slice(uploadStart, uploadEnd);
    assert.doesNotMatch(upload, /\.remove\s*\(/);
    assert.match(upload, /\.upload\(path, blob/);
    assert.match(upload, /upsert:\s*true/);
    assert.match(upload, /user\.profilePack !== true/);
    const removeFn = auth.slice(auth.indexOf("export async function removeProfileAvatar"));
    assert.match(removeFn, /\.remove\(\[path\]\)/);
    assert.doesNotMatch(sql, /create (or replace )?function public\.profiles_signature_avatar/);
    assert.doesNotMatch(sql, /create trigger profiles_signature_avatar/);
  });
});
