/**
 * Turnstile : widget in-page sur le web ; WebView in-app sur iOS/Android.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

describe("Turnstile web + captcha natif in-app", () => {
  it("isTurnstileRequired ne court-circuite plus isNativeApp", () => {
    const src = read("js/core/turnstile.js");
    assert.match(src, /import \{ getNativePlatform \} from "\.\/platform\.js"/);
    assert.doesNotMatch(src, /if \(isNativeApp\(\)\) return false;/);
    assert.match(src, /export function usesNativeCaptchaSheet/);
    assert.match(src, /export function usesInPageTurnstile/);
  });

  it("le défi natif reste dans l’app (WebView iOS, pas Safari)", () => {
    const src = read("js/core/turnstile.js");
    assert.match(src, /openWebView/);
    assert.match(src, /loadCapacitorInAppBrowser/);
    assert.match(src, /getNativePlatform\(\) === "ios"/);
    assert.match(src, /getNativePlatform\(\) !== "ios"/);
    assert.doesNotMatch(src, /loadCapacitorBrowser/);
    assert.match(src, /Je ne suis pas un robot/);
    assert.match(src, /captcha\.html/);
    assert.match(src, /auth-captcha-overlay/);
    assert.match(src, /startOverlayTurnstile/);
    const imports = read("js/core/capacitorImports.js");
    assert.match(imports, /CapgoInAppBrowser/);
    assert.match(imports, /isPluginAvailable/);
    const pkg = JSON.parse(read("package.json"));
    assert.ok(pkg.dependencies["@capgo/capacitor-inappbrowser"]);
  });

  it("l’écran home monte un slot captcha si requis", () => {
    const src = read("js/screens/home.js");
    assert.match(src, /isTurnstileRequired\(\) \? `<div id="login-turnstile"/);
    assert.match(src, /isTurnstileRequired\(\) \? `<div id="signup-turnstile"/);
    assert.match(src, /isTurnstileRequired\(\) \? `<div id="guest-turnstile"/);
    assert.match(src, /isTurnstileRequired\(\) \? `<div id="guest-rejoin-turnstile"/);
  });

  it("captcha.html charge Turnstile sans modules ES (WebView Android)", () => {
    const page = read("captcha.html");
    assert.match(page, /challenges\.cloudflare\.com\/turnstile/);
    assert.match(page, /mobileApp\.postMessage/);
    assert.match(page, /parent\.postMessage/);
    assert.doesNotMatch(page, /type="module"/);
    assert.doesNotMatch(page, /supabase-js/);
  });
});
