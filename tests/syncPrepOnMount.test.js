import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runSyncPrepOnMount } from "../js/core/syncPrepMount.js";

describe("M-10 syncPrepOnMount", () => {
  it("no-op si sync inactive", async () => {
    let refreshed = false;
    let reported = false;
    const out = await runSyncPrepOnMount({
      isActive: () => false,
      refresh: async () => {
        throw new Error("should not run");
      },
      refreshFromSync: () => {
        refreshed = true;
      },
      reportError: async () => {
        reported = true;
      },
    });
    assert.deepEqual(out, { skipped: true });
    assert.equal(refreshed, false);
    assert.equal(reported, false);
  });

  it("appelle refreshFromSync après refresh OK", async () => {
    let calls = 0;
    const out = await runSyncPrepOnMount({
      isActive: () => true,
      refresh: async () => ({ ok: true }),
      refreshFromSync: () => {
        calls += 1;
      },
      reportError: async () => {
        throw new Error("should not report");
      },
    });
    assert.equal(out.ok, true);
    assert.equal(calls, 1);
  });

  it("catch le rejet : pas de throw, feedback, pas de refreshFromSync", async () => {
    const err = new Error("failed to fetch");
    let refreshed = false;
    let reported = null;
    const out = await runSyncPrepOnMount({
      isActive: () => true,
      refresh: async () => {
        throw err;
      },
      refreshFromSync: () => {
        refreshed = true;
      },
      reportError: async (e) => {
        reported = e;
      },
    });
    assert.equal(out.ok, false);
    assert.equal(out.error, err);
    assert.equal(refreshed, false);
    assert.equal(reported, err);
  });
});
