/**
 * ARCH-22 Vague C — runLaunchButton soft delay « Lancement… ».
 * Pas d’import de mpLaunch.js (dépendances ESM browser) : contrats source +
 * réplique minimale du chrome soft-delay (même branchement que la prod).
 */
import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createSyncPending } from "../js/core/syncPending.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, "../js/core/mpLaunch.js"), "utf8");

function extractRunLaunchButton(body) {
  const start = body.indexOf("export async function runLaunchButton");
  assert.notEqual(start, -1, "runLaunchButton introuvable");
  const paramsEnd = body.indexOf(") {", start);
  assert.notEqual(paramsEnd, -1, "signature runLaunchButton introuvable");
  const brace = paramsEnd + 2; // '{'
  let depth = 0;
  for (let i = brace; i < body.length; i++) {
    if (body[i] === "{") depth += 1;
    else if (body[i] === "}") {
      depth -= 1;
      if (depth === 0) return body.slice(brace, i + 1);
    }
  }
  throw new Error("runLaunchButton non fermée");
}

describe("ARCH-22 runLaunchButton — contrats source", () => {
  it("importe createSyncPending ; soft delay sur le chrome seulement", () => {
    assert.match(src, /import \{ createSyncPending \} from "\.\/syncPending\.js"/);
    const fn = extractRunLaunchButton(src);
    assert.match(fn, /btn\.disabled = true/);
    // Ancien pattern : label immédiat après disable — interdit
    assert.doesNotMatch(
      fn,
      /btn\.disabled = true;\r?\n\s*btn\.textContent = loadingLabel/
    );
    assert.match(fn, /createSyncPending\(\{/);
    assert.match(
      fn,
      /if \(state\.visible\)\s*\{\s*\r?\n\s*btn\.textContent = loadingLabel/
    );
    assert.match(fn, /syncPending\.start\(\)/);
    const finallyIdx = fn.indexOf("} finally {");
    assert.ok(finallyIdx > 0);
    const finallyBlock = fn.slice(finallyIdx);
    assert.match(finallyBlock, /syncPending\.end\(token\)/);
    assert.match(finallyBlock, /syncPending\.dispose\(\)/);
    assert.match(finallyBlock, /btn\.disabled = false/);
    assert.match(finallyBlock, /btn\.textContent = prevLabel/);
  });

  it("ne branche pas createSyncPending dans launchGameWithSync", () => {
    const launchFnStart = src.indexOf("export async function launchGameWithSync");
    const runBtnStart = src.indexOf("export async function runLaunchButton");
    assert.ok(launchFnStart >= 0 && runBtnStart > launchFnStart);
    const launchBody = src.slice(launchFnStart, runBtnStart);
    assert.doesNotMatch(launchBody, /createSyncPending/);
    assert.doesNotMatch(src, /withPatchTimeout/);
  });
});

/** Miroir du chrome soft-delay de runLaunchButton (sans deps mpLaunch). */
async function softLaunchChrome(btn, launchFn, { loadingLabel = "Lancement…", softDelayMs = 500 } = {}) {
  const prevLabel = btn?.textContent;
  if (btn) btn.disabled = true;
  const syncPending = createSyncPending({
    softDelayMs,
    onChange: (state) => {
      if (!btn?.isConnected) return;
      if (state.visible) btn.textContent = loadingLabel;
    },
  });
  const token = syncPending.start();
  try {
    return await launchFn();
  } finally {
    syncPending.end(token);
    syncPending.dispose();
    if (btn?.isConnected) {
      btn.disabled = false;
      if (prevLabel) btn.textContent = prevLabel;
    }
  }
}

describe("ARCH-22 launch chrome — comportement soft delay", () => {
  beforeEach(() => {
    mock.timers.enable({ apis: ["setTimeout"], now: 0 });
  });

  afterEach(() => {
    mock.timers.reset();
  });

  function makeBtn(label = "Lancer") {
    return { disabled: false, textContent: label, isConnected: true };
  }

  it("disable immédiat ; pas de Lancement… avant soft delay", async () => {
    const btn = makeBtn();
    let resolveLaunch;
    const launchPromise = new Promise((r) => {
      resolveLaunch = r;
    });
    const done = softLaunchChrome(btn, () => launchPromise, { softDelayMs: 500 });
    assert.equal(btn.disabled, true);
    assert.equal(btn.textContent, "Lancer");
    mock.timers.tick(499);
    assert.equal(btn.textContent, "Lancer");
    resolveLaunch("ok");
    await done;
    assert.equal(btn.disabled, false);
    assert.equal(btn.textContent, "Lancer");
  });

  it("Lancement… après soft delay ; restauration en succès", async () => {
    const btn = makeBtn();
    let resolveLaunch;
    const launchPromise = new Promise((r) => {
      resolveLaunch = r;
    });
    const done = softLaunchChrome(btn, () => launchPromise, { softDelayMs: 500 });
    mock.timers.tick(500);
    assert.equal(btn.textContent, "Lancement…");
    assert.equal(btn.disabled, true);
    resolveLaunch("ok");
    await done;
    assert.equal(btn.disabled, false);
    assert.equal(btn.textContent, "Lancer");
  });

  it("restauration en erreur", async () => {
    const btn = makeBtn();
    let rejectLaunch;
    const launchPromise = new Promise((_, rej) => {
      rejectLaunch = rej;
    });
    const done = softLaunchChrome(btn, () => launchPromise, { softDelayMs: 500 });
    mock.timers.tick(500);
    assert.equal(btn.textContent, "Lancement…");
    rejectLaunch(new Error("boom"));
    await assert.rejects(() => done);
    assert.equal(btn.disabled, false);
    assert.equal(btn.textContent, "Lancer");
  });

  it("pas de label après isConnected false", async () => {
    const btn = makeBtn();
    let resolveLaunch;
    const launchPromise = new Promise((r) => {
      resolveLaunch = r;
    });
    const done = softLaunchChrome(btn, () => launchPromise, { softDelayMs: 500 });
    btn.isConnected = false;
    mock.timers.tick(500);
    assert.equal(btn.textContent, "Lancer");
    resolveLaunch("ok");
    await done;
  });
});
