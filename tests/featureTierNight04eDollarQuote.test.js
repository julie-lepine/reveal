/**
 * Audit dollar-quote nesting in 04E harness SQL files (no nested $$ inside DO $$).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");

/** Find DO $$ bodies; ignore SQL line comments when looking for nested $$. */
function findNestedDollarInDoBlocks(sql) {
  const findings = [];
  const re = /do\s+\$\$([\s\S]*?)end\s+\$\$;/gi;
  let m;
  while ((m = re.exec(sql))) {
    const body = m[1];
    const line = sql.slice(0, m.index).split("\n").length;
    // Strip -- comments so documentation mentioning dollar-quotes does not false-positive.
    const codeOnly = body
      .split("\n")
      .map((ln) => ln.replace(/--.*$/, ""))
      .join("\n");
    const inner = [...codeOnly.matchAll(/\$\$/g)];
    if (inner.length) {
      findings.push({
        line,
        count: inner.length,
        sample: codeOnly.slice(Math.max(0, inner[0].index - 10), inner[0].index + 30),
      });
    }
  }
  return findings;
}

describe("FEATURE-TIERNIGHT-04E — dollar-quote nesting", () => {
  it("harness A1+A2 : aucun $$ imbriqué dans DO $$", () => {
    for (const rel of [
      "supabase/feature-tiernight-04e-start-live-series-smoke-bootstrap.sql",
      "supabase/feature-tiernight-04e-start-live-series-smoke-tests.sql",
    ]) {
      const sql = read(rel);
      assert.doesNotMatch(sql, /\$\$LIKE/);
      assert.doesNotMatch(sql, /replace\([^)]*\$\$/);
      const nested = findNestedDollarInDoBlocks(sql);
      assert.deepEqual(nested, [], `${rel}: ${JSON.stringify(nested, null, 2)}`);
    }
    const a1 = read("supabase/feature-tiernight-04e-start-live-series-smoke-bootstrap.sql");
    assert.match(a1, /replace\(v_probe,\s*'LIKE ''TN04EA%'''/);
    assert.match(a1, /TN04EXabc/);
  });

  it("harness B1+B2 : aucun $$ imbriqué dans DO $$", () => {
    for (const rel of [
      "supabase/feature-tiernight-04e-live-prep-guest-ready-smoke-bootstrap.sql",
      "supabase/feature-tiernight-04e-live-prep-guest-ready-smoke-tests.sql",
    ]) {
      const sql = read(rel);
      assert.doesNotMatch(sql, /\$\$LIKE/);
      assert.doesNotMatch(sql, /replace\([^)]*\$\$/);
      const nested = findNestedDollarInDoBlocks(sql);
      assert.deepEqual(nested, [], `${rel}: ${JSON.stringify(nested, null, 2)}`);
    }
  });
});
