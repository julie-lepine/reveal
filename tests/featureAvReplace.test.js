/**
 * AV-REPLACE — remplacement d’avatar : upload upsert, jamais de remove préalable.
 */
import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getState, saveStatePatch } from "../js/core/state.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = (rel) => readFileSync(join(ROOT, rel), "utf8");
const UID = "0e36808e-52e3-461d-a424-906129b24aed";
const PATH = `${UID}/avatar.jpg`;

const storageCalls = { from: [], remove: [], upload: [] };
const upsertCalls = [];
const callLog = [];
let uploadError = null;
let upsertError = null;

function resetCalls() {
  storageCalls.from.length = 0;
  storageCalls.remove.length = 0;
  storageCalls.upload.length = 0;
  upsertCalls.length = 0;
  callLog.length = 0;
  uploadError = null;
  upsertError = null;
}

mock.module("../js/core/supabaseClient.js", {
  namedExports: {
    isSupabaseConfigured: () => true,
    supabase: {
      storage: {
        from(bucket) {
          storageCalls.from.push(bucket);
          return {
            async remove(paths) {
              callLog.push("remove");
              storageCalls.remove.push({ bucket, paths: [...paths] });
              return { data: [], error: null };
            },
            async upload(path, blob, opts) {
              callLog.push("upload");
              storageCalls.upload.push({
                bucket,
                path,
                blob,
                opts: { ...opts },
              });
              if (uploadError) return { data: null, error: uploadError };
              return { data: { path }, error: null };
            },
          };
        },
      },
    },
  },
});

mock.module("../js/core/supabaseProfile.js", {
  namedExports: {
    fetchProfile: async () => ({}),
    upsertProfile: async (args) => {
      callLog.push("upsert");
      upsertCalls.push({ ...args });
      if (upsertError) throw upsertError;
      return {
        avatar_path: args.avatarPath ?? null,
        avatar_rev: args.avatarRev ?? 0,
      };
    },
  },
});

const { uploadProfileAvatarBlob, removeProfileAvatar } = await import("../js/core/auth.js");

function fnSlice(text, name) {
  const start = text.indexOf(`export async function ${name}`);
  assert.ok(start >= 0, `${name} introuvable`);
  const next = text.indexOf("\nexport async function", start + 1);
  return text.slice(start, next === -1 ? undefined : next);
}

function signatureUser(partial = {}) {
  saveStatePatch({
    supabaseUserId: UID,
    user: {
      ...(getState().user || {}),
      loggedIn: true,
      isGuest: false,
      profilePack: true,
      avatarPath: null,
      avatarRev: 0,
      ...partial,
    },
  });
}

describe("AV-REPLACE — contrat source", () => {
  const auth = src("js/core/auth.js");
  const upload = fnSlice(auth, "uploadProfileAvatarBlob");
  const remove = fnSlice(auth, "removeProfileAvatar");
  const settings = src("js/screens/settings.js");

  it("uploadProfileAvatarBlob n’appelle jamais storage.remove", () => {
    assert.doesNotMatch(upload, /\.remove\s*\(/);
    assert.doesNotMatch(upload, /removeProfileAvatar/);
    assert.match(upload, /\.upload\(path, blob/);
    assert.match(upload, /upsert:\s*true/);
    assert.ok(upload.indexOf(".upload(") < upload.indexOf("updateProfileAvatar"));
    assert.ok(upload.indexOf("if (error)") < upload.indexOf("updateProfileAvatar"));
  });

  it("removeProfileAvatar reste SQL puis Storage remove", () => {
    assert.match(remove, /updateProfileAvatar\(\{\s*path:\s*null,\s*rev:\s*0\s*\}\)/);
    assert.match(remove, /\.remove\(\[path\]\)/);
    assert.ok(remove.indexOf("updateProfileAvatar") < remove.indexOf(".remove([path])"));
  });

  it("UI : preview seulement après upload OK ; pas d’optimistic avant", () => {
    const handler = settings.slice(settings.indexOf("uploadProfileAvatarBlob(blob)"));
    const previewIdx = handler.indexOf("setLocalAvatarPreview(blob)");
    const failIdx = handler.indexOf("if (!res.ok)");
    assert.ok(failIdx >= 0 && previewIdx > failIdx);
    assert.match(handler, /if \(!res\.ok\) \{\s*showAvatarStatus\("", res\.error/);
  });
});

describe("AV-REPLACE — appels Storage / SQL", () => {
  let snap;

  beforeEach(() => {
    snap = structuredClone(getState());
    resetCalls();
    signatureUser();
  });

  afterEach(() => {
    saveStatePatch(snap);
  });

  it("TEST 1 — première photo : upload SUCCESS → updateProfileAvatar, rev + 1", async () => {
    signatureUser({ avatarPath: null, avatarRev: 0 });
    const blob = { kind: "jpeg-a" };
    const res = await uploadProfileAvatarBlob(blob);
    assert.equal(res.ok, true);
    assert.equal(storageCalls.remove.length, 0);
    assert.equal(storageCalls.upload.length, 1);
    assert.equal(storageCalls.upload[0].bucket, "avatars");
    assert.equal(storageCalls.upload[0].path, PATH);
    assert.equal(storageCalls.upload[0].opts.upsert, true);
    assert.equal(storageCalls.upload[0].blob, blob);
    assert.equal(upsertCalls.length, 1);
    assert.equal(upsertCalls[0].avatarPath, PATH);
    assert.equal(upsertCalls[0].avatarRev, 1);
    assert.equal(getState().user.avatarPath, PATH);
    assert.equal(getState().user.avatarRev, 1);
    assert.deepEqual(callLog, ["upload", "upsert"]);
  });

  it("TEST 2 — remplacement SUCCESS : remove jamais appelé, upsert true, rev + 1", async () => {
    signatureUser({ avatarPath: PATH, avatarRev: 7 });
    const blob = { kind: "jpeg-b" };
    const res = await uploadProfileAvatarBlob(blob);
    assert.equal(res.ok, true);
    assert.equal(storageCalls.remove.length, 0);
    assert.equal(storageCalls.upload.length, 1);
    assert.equal(storageCalls.upload[0].path, PATH);
    assert.equal(storageCalls.upload[0].opts.upsert, true);
    assert.equal(storageCalls.upload[0].opts.contentType, "image/jpeg");
    assert.equal(upsertCalls.length, 1);
    assert.equal(upsertCalls[0].avatarPath, PATH);
    assert.equal(upsertCalls[0].avatarRev, 8);
    assert.equal(getState().user.avatarPath, PATH);
    assert.equal(getState().user.avatarRev, 8);
    assert.equal(callLog.includes("remove"), false);
    assert.deepEqual(callLog, ["upload", "upsert"]);
  });

  it("TEST 3 — remplacement FAIL : pas de remove, pas d’update SQL, rev inchangé", async () => {
    signatureUser({ avatarPath: PATH, avatarRev: 7 });
    uploadError = { message: "Network request failed" };
    const res = await uploadProfileAvatarBlob({ kind: "jpeg-b" });
    assert.equal(res.ok, false);
    assert.match(res.error, /Network request failed/);
    assert.equal(storageCalls.remove.length, 0);
    assert.equal(storageCalls.upload.length, 1);
    assert.equal(storageCalls.upload[0].opts.upsert, true);
    assert.equal(upsertCalls.length, 0);
    assert.equal(getState().user.avatarPath, PATH);
    assert.equal(getState().user.avatarRev, 7);
    assert.deepEqual(callLog, ["upload"]);
  });

  it("TEST 4 — retrait volontaire : SQL null puis storage.remove", async () => {
    signatureUser({ avatarPath: PATH, avatarRev: 8 });
    const res = await removeProfileAvatar();
    assert.equal(res.ok, true);
    assert.equal(getState().user.avatarPath, null);
    assert.equal(getState().user.avatarRev, 0);
    assert.equal(upsertCalls.length, 1);
    assert.equal(upsertCalls[0].avatarPath, null);
    assert.equal(upsertCalls[0].avatarRev, 0);
    assert.equal(storageCalls.upload.length, 0);
    assert.equal(storageCalls.remove.length, 1);
    assert.deepEqual(storageCalls.remove[0].paths, [PATH]);
    assert.equal(storageCalls.remove[0].bucket, "avatars");
    assert.deepEqual(callLog, ["upsert", "remove"]);
  });

  it("upload OK puis upsert SQL FAIL : Storage déjà B, SQL non mis à jour — pas de rollback", async () => {
    signatureUser({ avatarPath: PATH, avatarRev: 7 });
    upsertError = new Error("upsert fail");
    const res = await uploadProfileAvatarBlob({ kind: "jpeg-b" });
    assert.equal(res.ok, false);
    assert.equal(storageCalls.remove.length, 0);
    assert.equal(storageCalls.upload.length, 1);
    assert.equal(upsertCalls.length, 1);
    assert.equal(getState().user.avatarPath, PATH);
    assert.equal(getState().user.avatarRev, 8);
    assert.deepEqual(callLog, ["upload", "upsert"]);
  });
});
