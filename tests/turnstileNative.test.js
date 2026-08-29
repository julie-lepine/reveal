/**
 * Turnstile reste requis sur le web et dans l’app native.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

describe("Turnstile requis web et natif", () => {
  it("isTurnstileRequired ne désactive pas le captcha en app native", () => {
    const src = read("js/core/turnstile.js");
    assert.doesNotMatch(src, /import \{ isNativeApp \} from "\.\/platform\.js"/);
    assert.doesNotMatch(src, /if \(isNativeApp\(\)\) return false;/);
  });
});
