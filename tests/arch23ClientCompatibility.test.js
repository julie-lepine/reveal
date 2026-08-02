/**
 * ARCH-23 Vague 1 — identité, parsing floor, service, gates, retry/cache.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  APP_COMPATIBILITY_BUILD,
  APP_VERSION,
  CLIENT_COMPAT_ERROR,
  CLIENT_COMPAT_FRESH_MS,
  CLIENT_COMPAT_FOREGROUND_MIN_HIDDEN_MS,
  CLIENT_COMPAT_TIMEOUT_MS,
  IOS_APP_STORE_URL,
  ANDROID_PLAY_STORE_URL,
} from "../js/config/appCompatibility.js";
import {
  buildInstalledClientIdentity,
  detectAppPlatform,
} from "../js/core/appBuildIdentity.js";
import {
  COMPAT_STATUS,
  compareCompatibilityBuilds,
  parseClientCompatibilityConfig,
} from "../js/core/clientCompatibilityContract.js";
import {
  assertClientCompatibility,
  checkClientCompatibility,
  getLastConfirmedIncompatible,
  getLastRecheckResult,
  __resetClientCompatibilityForTests,
} from "../js/core/clientCompatibility.js";
import {
  applyForcedRecheckResult,
  hideClientCompatibilityGate,
  isClientCompatibilityGateVisible,
  presentCompatibilityGateIfNeeded,
  __resetClientCompatibilityGateForTests,
} from "../js/core/clientCompatibilityGateUi.js";
import { LOBBY_CREATE_ERROR } from "../js/core/lobbyCreateGuard.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

function read(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

describe("ARCH-23 — identité client", () => {
  it("version commerciale + compatibility build entier ≥ 1", () => {
    assert.equal(typeof APP_VERSION, "string");
    assert.ok(APP_VERSION.length > 0);
    assert.equal(Number.isInteger(APP_COMPATIBILITY_BUILD), true);
    assert.ok(APP_COMPATIBILITY_BUILD >= 1);
  });

  it("buildId inclut platform + nativeBuild", () => {
    const id = buildInstalledClientIdentity({
      appVersion: "1.0.3",
      nativeBuild: "7",
      platform: "android",
      compatibilityBuild: 1,
    });
    assert.equal(id.buildId, "1.0.3-android-7");
    assert.equal(id.compatibilityBuild, 1);
    assert.equal(id.platform, "android");
  });

  it("detectAppPlatform web hors Cap", () => {
    assert.equal(detectAppPlatform(), "web");
  });

  it("store URLs vides en Vague 1 (pas d’invention)", () => {
    assert.equal(IOS_APP_STORE_URL, "");
    assert.equal(ANDROID_PLAY_STORE_URL, "");
  });

  it("heuristiques Vague 1 centralisées et non dupliquées", () => {
    assert.equal(CLIENT_COMPAT_FRESH_MS, 5 * 60_000);
    assert.equal(CLIENT_COMPAT_TIMEOUT_MS, 8_000);
    assert.equal(CLIENT_COMPAT_FOREGROUND_MIN_HIDDEN_MS, 10 * 60_000);
    const cfg = read("js/config/appCompatibility.js");
    assert.match(cfg, /CLIENT_COMPAT_FRESH_MS/);
    assert.match(cfg, /Heuristiques Vague 1/);
    assert.match(cfg, /writes in-game|partie déjà active/i);
    const svc = read("js/core/clientCompatibility.js");
    assert.match(svc, /CLIENT_COMPAT_FRESH_MS/);
    assert.doesNotMatch(svc, /5 \* 60_000|5 \* 60 \* 1000/);
    assert.doesNotMatch(svc, /8_000/);
  });
});

describe("ARCH-23 — parseClientCompatibilityConfig", () => {
  it("floor valide", () => {
    const r = parseClientCompatibilityConfig({ min_compatibility_build: 3 });
    assert.equal(r.ok, true);
    assert.equal(r.minCompatibilityBuild, 3);
  });

  it("floor absent / chaîne / décimal / négatif / vide", () => {
    assert.equal(parseClientCompatibilityConfig({}).ok, false);
    assert.equal(
      parseClientCompatibilityConfig({ min_compatibility_build: "" }).reason,
      "floor_absent"
    );
    assert.equal(
      parseClientCompatibilityConfig({ min_compatibility_build: "x" }).reason,
      "floor_not_number"
    );
    assert.equal(
      parseClientCompatibilityConfig({ min_compatibility_build: 1.5 }).reason,
      "floor_not_integer"
    );
    assert.equal(
      parseClientCompatibilityConfig({ min_compatibility_build: 0 }).reason,
      "floor_negative_or_zero"
    );
    assert.equal(parseClientCompatibilityConfig(null).reason, "invalid_payload");
  });
});

describe("ARCH-23 — comparaison", () => {
  it("supérieur / égal / inférieur — numérique seulement", () => {
    assert.equal(compareCompatibilityBuilds(5, 3), COMPAT_STATUS.COMPATIBLE);
    assert.equal(compareCompatibilityBuilds(3, 3), COMPAT_STATUS.COMPATIBLE);
    assert.equal(compareCompatibilityBuilds(2, 3), COMPAT_STATUS.INCOMPATIBLE);
  });
});

describe("ARCH-23 — checkClientCompatibility service", () => {
  beforeEach(() => {
    __resetClientCompatibilityForTests();
  });

  const client = buildInstalledClientIdentity({
    platform: "ios",
    nativeBuild: "2",
    compatibilityBuild: 1,
  });

  it("compatible quand floor ≤ client", async () => {
    const r = await checkClientCompatibility({
      source: "boot",
      client,
      fetchFloor: async () => ({ min_compatibility_build: 1 }),
      timeoutMs: 1000,
    });
    assert.equal(r.status, COMPAT_STATUS.COMPATIBLE);
    assert.equal(r.minCompatibilityBuild, 1);
  });

  it("incompatible quand floor > client", async () => {
    const r = await checkClientCompatibility({
      source: "boot",
      client,
      fetchFloor: async () => ({ min_compatibility_build: 99 }),
    });
    assert.equal(r.status, COMPAT_STATUS.INCOMPATIBLE);
  });

  it("unknown sur timeout / payload invalide — jamais compatible silencieux", async () => {
    const bad = await checkClientCompatibility({
      source: "boot",
      client,
      fetchFloor: async () => ({ min_compatibility_build: "nope" }),
    });
    assert.equal(bad.status, COMPAT_STATUS.UNKNOWN);

    const slow = await checkClientCompatibility({
      source: "boot",
      force: true,
      client,
      timeoutMs: 20,
      fetchFloor: () => new Promise(() => {}),
    });
    assert.equal(slow.status, COMPAT_STATUS.UNKNOWN);
    assert.equal(slow.reason, "timeout");
  });

  it("déduplication in-flight + cache frais + force", async () => {
    let calls = 0;
    const fetchFloor = async () => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 30));
      return { min_compatibility_build: 1 };
    };
    const a = checkClientCompatibility({ source: "boot", client, fetchFloor });
    const b = checkClientCompatibility({ source: "join", client, fetchFloor });
    await Promise.all([a, b]);
    assert.equal(calls, 1);

    await checkClientCompatibility({
      source: "create",
      client,
      fetchFloor,
      now: Date.now(),
    });
    assert.equal(calls, 1, "réutilise résultat frais");

    await checkClientCompatibility({
      source: "manual",
      force: true,
      client,
      fetchFloor,
    });
    assert.equal(calls, 2);
  });

  it("incompatible confirmé survit à un unknown ultérieur (cache non-force)", async () => {
    await checkClientCompatibility({
      source: "boot",
      client,
      fetchFloor: async () => ({ min_compatibility_build: 99 }),
    });
    const again = await checkClientCompatibility({
      source: "join",
      client,
      fetchFloor: async () => {
        throw new Error("network");
      },
    });
    assert.equal(again.status, COMPAT_STATUS.INCOMPATIBLE);
    assert.ok(getLastConfirmedIncompatible());
  });

  it("force retry timeout : autorité incompatible + lastRecheck unknown", async () => {
    await checkClientCompatibility({
      source: "boot",
      client,
      fetchFloor: async () => ({ min_compatibility_build: 99 }),
    });
    assert.ok(getLastConfirmedIncompatible());

    const forced = await checkClientCompatibility({
      source: "manual",
      force: true,
      client,
      timeoutMs: 20,
      fetchFloor: () => new Promise(() => {}),
    });
    assert.equal(forced.status, COMPAT_STATUS.INCOMPATIBLE);
    assert.equal(forced.lastRecheckStatus, COMPAT_STATUS.UNKNOWN);
    assert.equal(forced.reason, "authoritative_incompatible_recheck_unknown");
    assert.ok(getLastConfirmedIncompatible());
    assert.equal(getLastRecheckResult()?.status, COMPAT_STATUS.UNKNOWN);
    assert.equal(getLastRecheckResult()?.reason, "timeout");

    const asserted = await assertClientCompatibility({
      source: "create",
      checkFn: async () => forced,
    });
    assert.equal(asserted.ok, false);
    assert.equal(asserted.error, CLIENT_COMPAT_ERROR.INCOMPATIBLE);
    assert.equal(asserted.recheckUnknown, true);
  });

  it("force retry compatible : vide cache incompatible", async () => {
    await checkClientCompatibility({
      source: "boot",
      client,
      fetchFloor: async () => ({ min_compatibility_build: 99 }),
    });
    const ok = await checkClientCompatibility({
      source: "manual",
      force: true,
      client,
      fetchFloor: async () => ({ min_compatibility_build: 1 }),
    });
    assert.equal(ok.status, COMPAT_STATUS.COMPATIBLE);
    assert.equal(getLastConfirmedIncompatible(), null);
  });

  it("assert bloque create/join/resume si incompatible ou unknown", async () => {
    const blocked = await assertClientCompatibility({
      source: "create",
      checkFn: async () => ({
        status: COMPAT_STATUS.INCOMPATIBLE,
        client,
        minCompatibilityBuild: 9,
        checkedAt: new Date().toISOString(),
        source: "create",
      }),
    });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.blocked, true);
    assert.equal(blocked.error, CLIENT_COMPAT_ERROR.INCOMPATIBLE);

    const unk = await assertClientCompatibility({
      source: "join",
      checkFn: async () => ({
        status: COMPAT_STATUS.UNKNOWN,
        client,
        checkedAt: new Date().toISOString(),
        source: "join",
        reason: "timeout",
      }),
    });
    assert.equal(unk.ok, false);
    assert.equal(unk.error, CLIENT_COMPAT_ERROR.UNKNOWN);

    const ok = await assertClientCompatibility({
      source: "resume",
      checkFn: async () => ({
        status: COMPAT_STATUS.COMPATIBLE,
        client,
        minCompatibilityBuild: 1,
        checkedAt: new Date().toISOString(),
        source: "resume",
      }),
    });
    assert.equal(ok.ok, true);
  });
});

/** DOM minimal pour gate UI (Node sans jsdom). */
function installMinimalDom() {
  if (globalThis.__arch23Dom) return;

  class FakeEl {
    constructor(tag) {
      this.tagName = String(tag || "").toUpperCase();
      this.children = [];
      this.attrs = {};
      this.listeners = {};
      this.parent = null;
      this._text = "";
      this._html = "";
      this.hidden = false;
      this.className = "";
    }
    set id(v) {
      this.attrs.id = v;
    }
    get id() {
      return this.attrs.id || "";
    }
    set textContent(v) {
      this._text = String(v ?? "");
    }
    get textContent() {
      return this._text;
    }
    set innerHTML(v) {
      this._html = String(v ?? "");
      this.children = [];
      // Parse basique des éléments avec id pour querySelector.
      const re = /<([a-z0-9]+)([^>]*)>/gi;
      let m;
      while ((m = re.exec(this._html))) {
        const el = new FakeEl(m[1]);
        const idMatch = /id="([^"]+)"/.exec(m[2]);
        if (idMatch) el.id = idMatch[1];
        const dataMatch = /data-compat-(\w+)/.exec(m[2]);
        if (dataMatch) el.attrs[`data-compat-${dataMatch[1]}`] = "";
        this.children.push(el);
        el.parent = this;
      }
    }
    get innerHTML() {
      return this._html;
    }
    setAttribute(k, v) {
      this.attrs[k] = v;
    }
    appendChild(el) {
      this.children.push(el);
      el.parent = this;
      return el;
    }
    remove() {
      if (!this.parent) return;
      this.parent.children = this.parent.children.filter((c) => c !== this);
      this.parent = null;
    }
    after(el) {
      if (!this.parent) return;
      const i = this.parent.children.indexOf(this);
      this.parent.children.splice(i + 1, 0, el);
      el.parent = this.parent;
    }
    querySelector(sel) {
      return this.querySelectorAll(sel)[0] || null;
    }
    querySelectorAll(sel) {
      const out = [];
      const walk = (node) => {
        for (const c of node.children || []) {
          if (sel.startsWith("#") && c.id === sel.slice(1)) out.push(c);
          else if (sel.startsWith(".") && String(c.className).includes(sel.slice(1)))
            out.push(c);
          else if (sel.startsWith("[") && sel.endsWith("]")) {
            const key = sel.slice(1, -1);
            if (key in c.attrs || c.attrs[key] === "") out.push(c);
          }
          walk(c);
        }
      };
      walk(this);
      return out;
    }
    addEventListener(type, fn) {
      (this.listeners[type] ||= []).push(fn);
    }
  }

  const body = new FakeEl("body");
  const doc = {
    body,
    createElement: (tag) => new FakeEl(tag),
    querySelector: (sel) => body.querySelector(sel),
  };
  globalThis.document = doc;
  globalThis.__arch23Dom = true;
}

describe("ARCH-23 — gate UI retry", () => {
  beforeEach(() => {
    installMinimalDom();
    __resetClientCompatibilityForTests();
    __resetClientCompatibilityGateForTests();
    document.body.children = [];
  });

  const client = buildInstalledClientIdentity({
    platform: "android",
    nativeBuild: "7",
    compatibilityBuild: 1,
  });

  it("incompatible → force timeout → gate visible + feedback + cache", async () => {
    const first = await checkClientCompatibility({
      source: "boot",
      client,
      fetchFloor: async () => ({ min_compatibility_build: 99 }),
    });
    presentCompatibilityGateIfNeeded(first);
    assert.equal(isClientCompatibilityGateVisible(), true);

    const forced = await checkClientCompatibility({
      source: "manual",
      force: true,
      client,
      timeoutMs: 20,
      fetchFloor: () => new Promise(() => {}),
    });
    await applyForcedRecheckResult(forced);

    assert.equal(isClientCompatibilityGateVisible(), true);
    assert.ok(getLastConfirmedIncompatible());
    const feedback = document.querySelector("#client-compat-feedback");
    assert.ok(feedback);
    assert.match(feedback.textContent, /Impossible de vérifier la mise à jour/);
  });

  it("incompatible → force compatible → gate masqué + onCompatible une fois", async () => {
    let continueCalls = 0;
    const first = await checkClientCompatibility({
      source: "boot",
      client,
      fetchFloor: async () => ({ min_compatibility_build: 99 }),
    });
    presentCompatibilityGateIfNeeded(first, {
      onCompatible: () => {
        continueCalls += 1;
      },
    });

    const ok = await checkClientCompatibility({
      source: "manual",
      force: true,
      client,
      fetchFloor: async () => ({ min_compatibility_build: 1 }),
    });
    await applyForcedRecheckResult(ok);
    await applyForcedRecheckResult(ok);

    assert.equal(isClientCompatibilityGateVisible(), false);
    assert.equal(getLastConfirmedIncompatible(), null);
    assert.equal(continueCalls, 1, "pas de double continue boot");
  });

  it("foreground unknown après incompatible : gate conservé", async () => {
    await checkClientCompatibility({
      source: "boot",
      client,
      fetchFloor: async () => ({ min_compatibility_build: 99 }),
    });
    presentCompatibilityGateIfNeeded(getLastConfirmedIncompatible());

    const fg = await checkClientCompatibility({
      source: "foreground",
      force: true,
      client,
      timeoutMs: 20,
      fetchFloor: () => new Promise(() => {}),
    });
    presentCompatibilityGateIfNeeded(fg);

    assert.equal(fg.status, COMPAT_STATUS.INCOMPATIBLE);
    assert.equal(fg.lastRecheckStatus, COMPAT_STATUS.UNKNOWN);
    assert.equal(isClientCompatibilityGateVisible(), true);
    assert.ok(getLastConfirmedIncompatible());
  });

  it("foreground compatible : hide sans double init (callback boot non rejoué)", async () => {
    let bootContinues = 0;
    await checkClientCompatibility({
      source: "boot",
      client,
      fetchFloor: async () => ({ min_compatibility_build: 99 }),
    });
    presentCompatibilityGateIfNeeded(getLastConfirmedIncompatible(), {
      onCompatible: () => {
        bootContinues += 1;
      },
    });

    const ok = await checkClientCompatibility({
      source: "foreground",
      force: true,
      client,
      fetchFloor: async () => ({ min_compatibility_build: 1 }),
    });
    // Foreground path : hide seulement (pas applyForcedRecheckResult / onCompatible boot).
    hideClientCompatibilityGate();
    assert.equal(ok.status, COMPAT_STATUS.COMPATIBLE);
    assert.equal(isClientCompatibilityGateVisible(), false);
    assert.equal(bootContinues, 0);
  });
});

describe("ARCH-23 — codes d’erreur frontières", () => {
  it("create distingue INCOMPATIBLE vs UNKNOWN (≠ CHECK_FAILED membership)", () => {
    assert.equal(LOBBY_CREATE_ERROR.CLIENT_INCOMPATIBLE, "CLIENT_INCOMPATIBLE");
    assert.equal(LOBBY_CREATE_ERROR.CLIENT_COMPAT_UNKNOWN, "CLIENT_COMPAT_UNKNOWN");
    assert.notEqual(
      LOBBY_CREATE_ERROR.CLIENT_INCOMPATIBLE,
      LOBBY_CREATE_ERROR.CHECK_FAILED
    );
    const lobby = read("js/core/lobby.js");
    assert.match(lobby, /LOBBY_CREATE_ERROR\.CLIENT_INCOMPATIBLE/);
    assert.match(lobby, /LOBBY_CREATE_ERROR\.CLIENT_COMPAT_UNKNOWN/);
    assert.match(
      lobby,
      /guardClientCompatibility\("create"\)[\s\S]*?CLIENT_INCOMPATIBLE[\s\S]*?CLIENT_COMPAT_UNKNOWN/
    );
    assert.match(lobby, /errorCode:/);
    assert.match(lobby, /guardClientCompatibility\("join"\)/);
    assert.match(lobby, /guardClientCompatibility\("resume"\)/);
    assert.match(lobby, /if \(!compat\.ok\) return false/);
  });

  it("CLIENT_COMPAT_ERROR centralisés", () => {
    assert.equal(CLIENT_COMPAT_ERROR.INCOMPATIBLE, "CLIENT_INCOMPATIBLE");
    assert.equal(CLIENT_COMPAT_ERROR.UNKNOWN, "CLIENT_COMPAT_UNKNOWN");
    assert.equal(CLIENT_COMPAT_ERROR.CHECK_FAILED, "CLIENT_COMPAT_CHECK_FAILED");
  });
});

describe("ARCH-23 — wiring / SQL (statique)", () => {
  it("SQL floor initial = 1, RLS select anon, pas de bump prod", () => {
    const sql = read("supabase/app-client-compatibility.sql");
    assert.match(sql, /min_client_compatibility_build/);
    assert.match(sql, /get_client_compatibility_config/);
    assert.match(sql, /values \(1, 1,/i);
    assert.match(sql, /to anon, authenticated/);
    assert.match(sql, /Ne PAS relever|Ne pas bumper/i);
  });

  it("boot attend check avant resume ; continueBoot once ; create/join/resume gardés", () => {
    const main = read("js/main.js");
    assert.match(main, /checkClientCompatibility\(\{\s*source:\s*"boot"/);
    assert.match(main, /initClientCompatibilityForeground/);
    assert.match(main, /continueBootAfterCompatibilityOk/);
    assert.match(main, /postCompatBootStarted/);
    assert.match(main, /onCompatible:\s*\(\)\s*=>\s*continueBootAfterCompatibilityOk/);
    const bootStart = main.indexOf("async function boot");
    const bootSlice = main.slice(bootStart, bootStart + 2500);
    assert.match(bootSlice, /void initLobbyPollSync\(\)/);
    assert.match(bootSlice, /await reconcileLobbyMembership\(\)/);
    const lobby = read("js/core/lobby.js");
    assert.match(lobby, /guardClientCompatibility\("create"\)/);
    assert.match(lobby, /guardClientCompatibility\("join"\)/);
    assert.match(lobby, /guardClientCompatibility\("resume"\)/);
    assert.match(lobby, /assertClientCompatibility/);
  });

  it("UX gate : store seulement si URL ; feedback recheck unknown ; pas d’URL inventée", () => {
    const ui = read("js/core/clientCompatibilityGateUi.js");
    assert.match(ui, /Mettre à jour nécessaire|Mise à jour nécessaire/);
    assert.match(ui, /isWeb/);
    assert.match(ui, /storeUrl/);
    assert.match(ui, /Impossible de vérifier la mise à jour/);
    assert.match(ui, /applyForcedRecheckResult/);
    assert.doesNotMatch(ui, /play\.google\.com\/store\/apps\/details/);
  });

  it("compatibility build commun — pas versionCode comme floor", () => {
    const id = read("js/core/appBuildIdentity.js");
    assert.match(id, /APP_COMPATIBILITY_BUILD/);
    assert.doesNotMatch(id, /versionCode/);
    const cfg = read("js/config/appCompatibility.js");
    assert.equal(APP_COMPATIBILITY_BUILD, 1);
    assert.match(cfg, /Vague 1 : rester à 1/);
  });

  it("docs périmètre writes in-game", () => {
    const dep = read("docs/DEPLOYMENTS_SQL.md");
    assert.match(dep, /writes in-game|partie déjà active/i);
    assert.match(dep, /rétrocompatibilité|rétrocompat/i);
    const audit = read("docs/AUDIT_REGROUPEMENT_CAUSES_RACINES.md");
    assert.match(audit, /pas.*write in-game|pas.*chaque write/i);
  });
});
