/**
 * Turnstile : widget web. L’app native ne monte pas le widget (aligné sur l’AAB Play).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

describe("Turnstile natif aligné Play", () => {
  it("isTurnstileRequired court-circuite isNativeApp", () => {
    const src = read("js/core/turnstile.js");
    assert.match(src, /import \{ isNativeApp \} from "\.\/platform\.js"/);
    assert.match(src, /if \(isNativeApp\(\)\) return false;/);
  });

  it("l’écran home n’émet pas de slot Turnstile si le captcha n’est pas requis", () => {
    const src = read("js/screens/home.js");
    assert.match(src, /isTurnstileRequired\(\) \? `<div id="login-turnstile"/);
    assert.match(src, /isTurnstileRequired\(\) \? `<div id="signup-turnstile"/);
    assert.match(src, /isTurnstileRequired\(\) \? `<div id="guest-turnstile"/);
    assert.match(src, /isTurnstileRequired\(\) \? `<div id="guest-rejoin-turnstile"/);
  });
});
