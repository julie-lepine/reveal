/**
 * Audit RAISE format strings in 04E harnesses: placeholder count === args.
 * Namespace wildcards in RAISE must use %% ; LIKE predicates stay single %.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");

function extractRaises(sql) {
  const lines = sql.split("\n");
  const raises = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*raise\s+(exception|notice|warning|info|log|debug)\s+/i.test(lines[i])) continue;
    let buf = lines[i];
    let j = i;
    while (!/;/.test(buf) && j + 1 < lines.length) {
      j++;
      buf += "\n" + lines[j];
    }
    const sm = buf.match(
      /raise\s+(exception|notice|warning|info|log|debug)\s+('(?:[^']|'')*')/is
    );
    if (!sm) {
      raises.push({ line: i + 1, bad: true, reason: "no_format_string" });
      i = j;
      continue;
    }
    const fmtQuoted = sm[2];
    const inner = fmtQuoted.slice(1, -1).replace(/''/g, "'");
    let placeholders = 0;
    for (let k = 0; k < inner.length; k++) {
      if (inner[k] !== "%") continue;
      if (inner[k + 1] === "%") {
        k++;
        continue;
      }
      placeholders++;
    }
    const after = buf.slice(buf.indexOf(fmtQuoted) + fmtQuoted.length);
    let args = 0;
    const mArgs = after.match(/^\s*,([\s\S]*?)(?:\s+using\b|;)/i);
    if (mArgs && mArgs[1].trim()) {
      args = 1;
      let depth = 0;
      let inq = false;
      const list = mArgs[1];
      for (let k = 0; k < list.length; k++) {
        const c = list[k];
        if (c === "'") {
          if (!inq) inq = true;
          else if (list[k + 1] === "'") k++;
          else inq = false;
          continue;
        }
        if (inq) continue;
        if (c === "(") depth++;
        else if (c === ")") depth--;
        else if (c === "," && depth === 0) args++;
      }
    }
    // Unescaped TN04E* wildcard in RAISE format (single % after namespace token)
    const unescapedNs = /TN04E[ABXG]?%(?!%)/i.test(inner);
    raises.push({
      line: i + 1,
      inner,
      placeholders,
      args,
      bad: placeholders !== args || unescapedNs,
      unescapedNs,
    });
    i = j;
  }
  return raises;
}

describe("FEATURE-TIERNIGHT-04E — RAISE % escaping", () => {
  it("harness A1+A2 : placeholders === args ; namespaces en %%", () => {
    for (const rel of [
      "supabase/feature-tiernight-04e-start-live-series-smoke-bootstrap.sql",
      "supabase/feature-tiernight-04e-start-live-series-smoke-tests.sql",
    ]) {
      const sql = read(rel);
      const raises = extractRaises(sql);
      assert.ok(raises.length >= 10, `${rel}: expected RAISE, got ${raises.length}`);
      const bad = raises.filter((r) => r.bad);
      assert.deepEqual(bad, [], `${rel}: ${JSON.stringify(bad, null, 2)}`);
    }
    const a2 = read("supabase/feature-tiernight-04e-start-live-series-smoke-tests.sql");
    assert.match(
      a2,
      /raise notice 'R18 OK[^']*TN04EA%%[^']*\(%\)',\s*v_clean;/
    );
    const a1 = read("supabase/feature-tiernight-04e-start-live-series-smoke-bootstrap.sql");
    assert.match(a1, /code LIKE 'TN04EA%'/);
    assert.doesNotMatch(a1, /LIKE 'TN04EA%%'/);
    assert.match(a1, /code LIKE 'TN04EG%'/);
    assert.doesNotMatch(a1, /LIKE 'TN04EG%%'/);
  });

  it("harness B1+B2 : placeholders === args ; namespaces en %%", () => {
    for (const rel of [
      "supabase/feature-tiernight-04e-live-prep-guest-ready-smoke-bootstrap.sql",
      "supabase/feature-tiernight-04e-live-prep-guest-ready-smoke-tests.sql",
    ]) {
      const sql = read(rel);
      const raises = extractRaises(sql);
      assert.ok(raises.length >= 10, `${rel}: expected RAISE, got ${raises.length}`);
      const bad = raises.filter((r) => r.bad);
      assert.deepEqual(bad, [], `${rel}: ${JSON.stringify(bad, null, 2)}`);
    }
    const b1 = read("supabase/feature-tiernight-04e-live-prep-guest-ready-smoke-bootstrap.sql");
    assert.match(b1, /code like 'TN04EB%'/i);
    assert.doesNotMatch(b1, /LIKE 'TN04EB%%'/i);
    assert.match(b1, /code like 'TN04EG%'/i);
    assert.doesNotMatch(b1, /LIKE 'TN04EG%%'/i);
  });
});
