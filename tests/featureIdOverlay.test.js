/**
 * ID-OVERLAY — pending cosmetics pendant overlay Signature, replay après profile_pack SQL.
 */
import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getState, saveStatePatch, setLocalNameColor, setLocalAvatar } from "../js/core/state.js";
import {
  applyServerCosmeticsWithPending,
  coalesceLocalCosmeticsDuringHold,
  emptyPendingSignatureCosmetics,
  getPendingSignatureCosmetics,
  rememberPendingNameColor,
  shouldHoldPendingSignatureCosmetics,
} from "../js/core/signatureCosmeticsPending.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
const UID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

let profileRow = {
  ad_free: false,
  profile_pack: false,
  host_pack: false,
  name_color: null,
  avatar_path: null,
  avatar_rev: 0,
};
let upsertCalls = [];
let upsertMode = "echo";

mock.module("../js/core/supabaseProfile.js", {
  namedExports: {
    fetchProfile: async () => ({ ...profileRow }),
    upsertProfile: async (args) => {
      upsertCalls.push({ ...args });
      if (upsertMode === "fail") throw new Error("upsert fail");
      if (upsertMode === "strip") {
        return { name_color: null, avatar_path: null, avatar_rev: 0 };
      }
      return {
        name_color: args.nameColor ?? null,
        avatar_path: args.avatarPath ?? null,
        avatar_rev: args.avatarRev ?? 0,
      };
    },
  },
});

const {
  applyPremiumFromStore,
  captureSignatureCosmeticsPendingIfActivationWindow,
  getLastServerProfilePackColumn,
  refreshAdFreeFromServer,
  resetPremiumStoreOverlayForTests,
  clearStorePremiumOverlay,
} = await import("../js/core/entitlements.js");

function loggedInUser(partial = {}) {
  saveStatePatch({
    supabaseUserId: UID,
    user: {
      ...(getState().user || {}),
      loggedIn: true,
      isGuest: false,
      adFree: false,
      profilePack: false,
      hostPack: false,
      nameColor: null,
      avatarPath: null,
      avatarRev: 0,
      ...partial,
    },
  });
}

describe("ID-OVERLAY — helpers purs", () => {
  it("hold seulement overlay Signature et pack SQL false", () => {
    assert.equal(
      shouldHoldPendingSignatureCosmetics({
        overlay: { profilePack: true },
        serverProfilePackColumn: false,
      }),
      true
    );
    assert.equal(
      shouldHoldPendingSignatureCosmetics({
        overlay: { profilePack: true },
        serverProfilePackColumn: true,
      }),
      false
    );
    assert.equal(
      shouldHoldPendingSignatureCosmetics({
        overlay: null,
        serverProfilePackColumn: false,
      }),
      false
    );
    assert.equal(
      shouldHoldPendingSignatureCosmetics({
        overlay: null,
        serverProfilePackColumn: false,
        holdNameColor: "lime",
      }),
      true
    );
  });

  it("pending gagne sur un null serveur, pas sur un autre userId", () => {
    const pending = rememberPendingNameColor(emptyPendingSignatureCosmetics(), {
      userId: UID,
      nameColor: "rose",
    });
    const held = applyServerCosmeticsWithPending({
      serverNameColor: null,
      pending,
      userId: UID,
    });
    assert.equal(held.nameColor, "rose");
    const other = applyServerCosmeticsWithPending({
      serverNameColor: null,
      pending,
      userId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    });
    assert.equal(other.nameColor, null);
  });

  it("hold : null serveur n’efface pas la couleur locale", () => {
    const kept = coalesceLocalCosmeticsDuringHold({
      hold: true,
      fromServer: { nameColor: null, avatarPath: null, avatarRev: 0 },
      local: { nameColor: "lime", avatarPath: null, avatarRev: 0 },
    });
    assert.equal(kept.nameColor, "lime");
    const released = coalesceLocalCosmeticsDuringHold({
      hold: false,
      fromServer: { nameColor: null, avatarPath: null, avatarRev: 0 },
      local: { nameColor: "lime", avatarPath: null, avatarRev: 0 },
    });
    assert.equal(released.nameColor, null);
  });
});

describe("ID-OVERLAY — overlay / refresh / replay", () => {
  let snapshot;

  beforeEach(() => {
    snapshot = structuredClone(getState());
    resetPremiumStoreOverlayForTests();
    upsertCalls = [];
    upsertMode = "echo";
    profileRow = {
      ad_free: false,
      profile_pack: false,
      host_pack: false,
      name_color: null,
      avatar_path: null,
      avatar_rev: 0,
    };
    loggedInUser();
  });

  afterEach(() => {
    resetPremiumStoreOverlayForTests();
    saveStatePatch(snapshot);
  });

  it("A — overlay : couleur locale + pending survivent au refresh", async () => {
    applyPremiumFromStore({ profilePack: true });
    const local = setLocalNameColor("rose");
    assert.equal(local.ok, true);
    captureSignatureCosmeticsPendingIfActivationWindow({ nameColor: "rose" });
    assert.equal(getPendingSignatureCosmetics().hasNameColor, true);
    await refreshAdFreeFromServer();
    assert.equal(getLastServerProfilePackColumn(), false);
    assert.equal(getState().user.nameColor, "rose");
    assert.equal(getPendingSignatureCosmetics().hasNameColor, true);
    assert.equal(upsertCalls.length, 0);
  });

  it("A2 — overlay : couleur locale survit même sans capture préalable", async () => {
    applyPremiumFromStore({ profilePack: true });
    assert.equal(setLocalNameColor("lime").ok, true);
    assert.equal(getPendingSignatureCosmetics().hasNameColor, false);
    await refreshAdFreeFromServer();
    assert.equal(getLastServerProfilePackColumn(), false);
    assert.equal(getState().user.nameColor, "lime");
    assert.equal(getState().user.signatureHoldNameColor, "lime");
    assert.equal(getPendingSignatureCosmetics().hasNameColor, true);
    assert.equal(getPendingSignatureCosmetics().nameColor, "lime");
    assert.equal(upsertCalls.length, 0);
  });

  it("B — grant SQL : replay upsert puis pending retiré", async () => {
    applyPremiumFromStore({ profilePack: true });
    setLocalNameColor("rose");
    captureSignatureCosmeticsPendingIfActivationWindow({ nameColor: "rose" });
    profileRow = { ...profileRow, profile_pack: true };
    await refreshAdFreeFromServer();
    assert.equal(getLastServerProfilePackColumn(), true);
    assert.equal(upsertCalls.length, 1);
    assert.equal(upsertCalls[0].nameColor, "rose");
    assert.equal(getPendingSignatureCosmetics().hasNameColor, false);
    assert.equal(getState().user.nameColor, "rose");
  });

  it("C — replay échoue : pending conservé, retry possible", async () => {
    applyPremiumFromStore({ profilePack: true });
    setLocalNameColor("rose");
    captureSignatureCosmeticsPendingIfActivationWindow({ nameColor: "rose" });
    profileRow = { ...profileRow, profile_pack: true };
    upsertMode = "strip";
    await refreshAdFreeFromServer();
    assert.equal(getPendingSignatureCosmetics().hasNameColor, true);
    assert.equal(getPendingSignatureCosmetics().nameColor, "rose");
    upsertMode = "echo";
    await refreshAdFreeFromServer();
    assert.equal(getPendingSignatureCosmetics().hasNameColor, false);
    assert.equal(upsertCalls.length, 2);
  });

  it("D — avatar pending survit au refresh puis replay au grant", async () => {
    applyPremiumFromStore({ profilePack: true });
    const path = `${UID}/avatar.jpg`;
    const av = setLocalAvatar({ path, rev: 2 });
    assert.equal(av.ok, true);
    captureSignatureCosmeticsPendingIfActivationWindow({
      avatarPath: path,
      avatarRev: 2,
    });
    await refreshAdFreeFromServer();
    assert.equal(getState().user.avatarPath, path);
    assert.equal(getPendingSignatureCosmetics().hasAvatar, true);
    profileRow = { ...profileRow, profile_pack: true };
    await refreshAdFreeFromServer();
    assert.equal(upsertCalls[upsertCalls.length - 1].avatarPath, path);
    assert.equal(upsertCalls[upsertCalls.length - 1].avatarRev, 2);
    assert.equal(getPendingSignatureCosmetics().hasAvatar, false);
  });

  it("E — webhook déjà là : pas de pending inutile", async () => {
    applyPremiumFromStore({ profilePack: true });
    profileRow = { ...profileRow, profile_pack: true };
    await refreshAdFreeFromServer();
    setLocalNameColor("gold");
    captureSignatureCosmeticsPendingIfActivationWindow({ nameColor: "gold" });
    assert.equal(getPendingSignatureCosmetics().hasNameColor, false);
  });

  it("F — pas d’overlay : personnalisation Signature refusée", () => {
    const res = setLocalNameColor("rose");
    assert.equal(res.ok, false);
    captureSignatureCosmeticsPendingIfActivationWindow({ nameColor: "rose" });
    assert.equal(getPendingSignatureCosmetics().hasNameColor, false);
  });

  it("G — logout / autre compte : pas de fuite pending", () => {
    applyPremiumFromStore({ profilePack: true });
    setLocalNameColor("rose");
    captureSignatureCosmeticsPendingIfActivationWindow({ nameColor: "rose" });
    assert.equal(getPendingSignatureCosmetics().hasNameColor, true);
    clearStorePremiumOverlay();
    loggedInUser({
      profilePack: false,
      nameColor: null,
      signatureHoldNameColor: null,
      signatureHoldAvatarPath: null,
      signatureHoldAvatarRev: 0,
    });
    saveStatePatch({ supabaseUserId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" });
    assert.equal(getPendingSignatureCosmetics().hasNameColor, false);
    captureSignatureCosmeticsPendingIfActivationWindow({ nameColor: "cyan" });
    assert.equal(getPendingSignatureCosmetics().hasNameColor, false);
  });

  it("H — idempotence : plusieurs refresh après grant, un seul upsert", async () => {
    applyPremiumFromStore({ profilePack: true });
    setLocalNameColor("rose");
    captureSignatureCosmeticsPendingIfActivationWindow({ nameColor: "rose" });
    profileRow = { ...profileRow, profile_pack: true };
    await refreshAdFreeFromServer();
    await refreshAdFreeFromServer();
    await refreshAdFreeFromServer();
    assert.equal(upsertCalls.length, 1);
  });

  it("n’écrit pas profile_pack ; trigger ID-OLD intact", () => {
    const ent = read("js/core/entitlements.js");
    assert.doesNotMatch(ent, /profile_pack\s*:/);
    const pending = read("js/core/signatureCosmeticsPending.js");
    assert.doesNotMatch(pending, /profile_pack\s*:/);
    const idOld = read("supabase/feature-profile-id-old.sql");
    assert.match(
      idOld,
      /v_pack := coalesce\(old\.profile_pack, false\) or coalesce\(new\.profile_pack, false\)/
    );
  });
});
