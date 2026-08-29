/**
 * Turnstile : web only. Native WKWebView ne doit pas monter le widget.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

describe("Turnstile natif désactivé", () => {
  it("isTurnstileRequired court-circuite isNativeApp", () => {
    const src = read("js/core/turnstile.js");
    assert.match(src, /import \{ isNativeApp \} from "\.\/platform\.js"/);
    assert.match(src, /if \(isNativeApp\(\)\) return false;/);
    assert.doesNotMatch(src, /web et natif/);
  });

  it("isNativeApp reconnaît l’UA Capacitor (WKWebView iOS)", () => {
    const src = read("js/core/platform.js");
    assert.match(src, /\/Capacitor\/i\.test/);
    assert.match(src, /getPlatform\?\.\(\)/);
  });
});
