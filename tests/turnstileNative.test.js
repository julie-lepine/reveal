/**
 * hCaptcha : widget in-page web + Android + iOS (Supabase Attack Protection).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

describe("hCaptcha in-page (web + native)", () => {
  it("isTurnstileRequired ne court-circuite plus isNativeApp", () => {
    const src = read("js/core/turnstile.js");
    assert.match(src, /HCAPTCHA_SITE_KEY/);
    assert.match(src, /js\.hcaptcha\.com/);
    assert.doesNotMatch(src, /if \(isNativeApp\(\)\) return false;/);
    assert.doesNotMatch(src, /challenges\.cloudflare\.com\/turnstile/);
    assert.match(src, /export function usesNativeCaptchaSheet/);
    assert.match(src, /export function usesInPageTurnstile/);
    assert.match(src, /return isTurnstileRequired\(\);/);
  });

  it("pas de Safari ni de page tierce pour le captcha", () => {
    const src = read("js/core/turnstile.js");
    assert.doesNotMatch(src, /loadCapacitorBrowser/);
    assert.doesNotMatch(src, /Browser\.open/);
    assert.doesNotMatch(src, /openWebView/);
    assert.doesNotMatch(src, /github\.io/);
    const cfg = read("js/config/turnstile.js");
    assert.match(cfg, /HCAPTCHA_SITE_KEY/);
    assert.doesNotMatch(cfg, /0x4AAAAAA/);
  });

  it("l’écran home monte un slot captcha si requis", () => {
    const src = read("js/screens/home.js");
    assert.match(src, /isTurnstileRequired\(\) \? `<div id="login-turnstile"/);
    assert.match(src, /isTurnstileRequired\(\) \? `<div id="signup-turnstile"/);
    assert.match(src, /isTurnstileRequired\(\) \? `<div id="guest-turnstile"/);
    assert.match(src, /isTurnstileRequired\(\) \? `<div id="guest-rejoin-turnstile"/);
  });
});
