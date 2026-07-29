/**
 * ARCH-08 — launchGameWithSync : retry observable + isolation commit / applyLocal.
 */
import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const mpLaunchSrc = readFileSync(join(__dirname, "../js/core/mpLaunch.js"), "utf8");

const pushGameSessionMock = mock.fn();
const patchGameStateMock = mock.fn();
const showAppAlertMock = mock.fn(async () => {});
const isGameSyncActiveMock = mock.fn(() => true);
const isLobbyHostMock = mock.fn(() => true);

mock.module("../js/core/gameSync.js", {
  exports: {
    DEFAULT_SYNC_PATCH_TIMEOUT_MS: 20000,
    isGameSyncActive: isGameSyncActiveMock,
    isLobbyHost: isLobbyHostMock,
    pushGameSession: pushGameSessionMock,
    patchGameState: patchGameStateMock,
    getCachedGameSession: () => null,
    getEffectiveSessionScreen: () => null,
    canActAsHost: () => false,
    getActingHostUserId: () => null,
    requireLocalParticipantUid: () => "uid-test",
  },
});

mock.module("../js/core/dialog.js", {
  exports: {
    showAppAlert: showAppAlertMock,
    showAppConfirm: mock.fn(async () => false),
  },
});

mock.module("../js/core/supabaseAuth.js", {
  exports: {
    getSupabaseUserId: () => "user-test",
  },
});

const { launchGameWithSync } = await import("../js/core/mpLaunch.js");

const SESSION_ROW = { id: "session-1", lobby_id: "lobby-1" };
const REMOTE_STATE = { dilemma: { lobbyStarted: true, roundIdx: 0 } };

function baseLaunchOpts(overrides = {}) {
  return {
    screen: "dilemma",
    gameId: "dilemma",
    mode: "push",
    applyLocal: mock.fn(),
    getRemoteState: mock.fn(() => REMOTE_STATE),
    ...overrides,
  };
}

function findStructuredWarn(warnings, phase) {
  return warnings.find(
    (entry) =>
      entry[0] === "[MP-LAUNCH] commit failed" &&
      entry[1]?.event === "mp_launch_commit_failed" &&
      entry[1]?.phase === phase
  );
}

function pushSequence(...behaviors) {
  let call = 0;
  pushGameSessionMock.mock.mockImplementation(async () => {
    const behavior = behaviors[call] ?? behaviors[behaviors.length - 1];
    call += 1;
    if (behavior instanceof Error) throw behavior;
    if (typeof behavior === "function") return behavior();
    return behavior;
  });
}

function patchSequence(...behaviors) {
  let call = 0;
  patchGameStateMock.mock.mockImplementation(async () => {
    const behavior = behaviors[call] ?? behaviors[behaviors.length - 1];
    call += 1;
    if (behavior instanceof Error) throw behavior;
    if (typeof behavior === "function") return behavior();
    return behavior;
  });
}

async function flushBackgroundWork() {
  await new Promise((resolve) => setImmediate(resolve));
}

describe("ARCH-08 launchGameWithSync", () => {
  /** @type {typeof console.warn} */
  let origWarn;
  /** @type {unknown[][]} */
  let warnings;

  beforeEach(() => {
    pushGameSessionMock.mock.resetCalls();
    patchGameStateMock.mock.resetCalls();
    showAppAlertMock.mock.resetCalls();
    isGameSyncActiveMock.mock.resetCalls();
    isLobbyHostMock.mock.resetCalls();
    isGameSyncActiveMock.mock.mockImplementation(() => true);
    isLobbyHostMock.mock.mockImplementation(() => true);
    pushGameSessionMock.mock.mockImplementation(async () => SESSION_ROW);
    patchGameStateMock.mock.mockImplementation(async () => SESSION_ROW);
    showAppAlertMock.mock.mockImplementation(async () => {});

    warnings = [];
    origWarn = console.warn;
    console.warn = (...args) => {
      warnings.push(args);
      origWarn(...args);
    };
  });

  afterEach(() => {
    console.warn = origWarn;
  });

  it("1. commit initial réussi, localFirst false", async () => {
    const opts = baseLaunchOpts();
    const result = await launchGameWithSync(opts);

    assert.equal(pushGameSessionMock.mock.callCount(), 1);
    assert.equal(opts.applyLocal.mock.callCount(), 1);
    assert.equal(showAppAlertMock.mock.callCount(), 0);
    assert.deepEqual(result, { ok: true });
    assert.equal(findStructuredWarn(warnings, "initial_commit"), undefined);
    assert.equal(findStructuredWarn(warnings, "background_retry"), undefined);
  });

  it("2. commit initial échoué, retry réussi", async () => {
    const networkErr = new Error("network down");
    pushSequence(networkErr, SESSION_ROW);

    const opts = baseLaunchOpts();
    const result = await launchGameWithSync(opts);
    await flushBackgroundWork();

    assert.equal(pushGameSessionMock.mock.callCount(), 2);
    assert.equal(opts.applyLocal.mock.callCount(), 1);
    assert.equal(showAppAlertMock.mock.callCount(), 1);
    assert.equal(result.ok, false);
    assert.equal(result.usedFallback, true);
    assert.equal(result.error, networkErr);

    const initialWarn = findStructuredWarn(warnings, "initial_commit");
    assert.ok(initialWarn);
    assert.equal(initialWarn[1].attempt, 1);
    assert.equal(findStructuredWarn(warnings, "background_retry"), undefined);
  });

  it("3. commit initial échoué, retry échoué", async () => {
    const initialErr = new Error("initial fail");
    const retryErr = new Error("retry fail");
    pushSequence(initialErr, retryErr);

    const opts = baseLaunchOpts();
    const result = await launchGameWithSync(opts);
    await flushBackgroundWork();

    assert.equal(pushGameSessionMock.mock.callCount(), 2);
    assert.equal(opts.applyLocal.mock.callCount(), 1);
    assert.equal(showAppAlertMock.mock.callCount(), 1);
    assert.equal(result.error, initialErr);

    const retryWarn = findStructuredWarn(warnings, "background_retry");
    assert.ok(retryWarn);
    assert.deepEqual(retryWarn[1], {
      event: "mp_launch_commit_failed",
      phase: "background_retry",
      attempt: 2,
      gameId: "dilemma",
      screen: "dilemma",
      mode: "push",
      localFirst: false,
      errorName: "Error",
      errorMessage: "retry fail",
    });
  });

  it("4. applyLocal lève après commit réussi (localFirst false)", async () => {
    const localErr = new Error("local apply broke");
    const opts = baseLaunchOpts({
      applyLocal: mock.fn(() => {
        throw localErr;
      }),
    });

    await assert.rejects(() => launchGameWithSync(opts), localErr);
    assert.equal(pushGameSessionMock.mock.callCount(), 1);
    assert.equal(opts.applyLocal.mock.callCount(), 1);
    assert.equal(showAppAlertMock.mock.callCount(), 0);
    assert.equal(findStructuredWarn(warnings, "initial_commit"), undefined);
    assert.equal(findStructuredWarn(warnings, "background_retry"), undefined);
  });

  it("5. localFirst true, commit réussi", async () => {
    const onLocalApplied = mock.fn();
    const opts = baseLaunchOpts({
      localFirst: true,
      onLocalApplied,
    });

    const result = await launchGameWithSync(opts);

    assert.equal(opts.applyLocal.mock.callCount(), 1);
    assert.equal(onLocalApplied.mock.callCount(), 1);
    assert.equal(pushGameSessionMock.mock.callCount(), 1);
    assert.deepEqual(result, { ok: true });
  });

  it("6. localFirst true, commit initial et retry échoués", async () => {
    const initialErr = new Error("gl initial");
    const retryErr = new Error("gl retry");
    pushSequence(initialErr, retryErr);

    const onLocalApplied = mock.fn();
    const opts = baseLaunchOpts({
      localFirst: true,
      onLocalApplied,
    });

    const result = await launchGameWithSync(opts);
    await flushBackgroundWork();

    assert.equal(opts.applyLocal.mock.callCount(), 1);
    assert.equal(onLocalApplied.mock.callCount(), 1);
    assert.equal(pushGameSessionMock.mock.callCount(), 2);
    assert.equal(showAppAlertMock.mock.callCount(), 1);
    assert.equal(result.usedFallback, true);

    const retryWarn = findStructuredWarn(warnings, "background_retry");
    assert.ok(retryWarn);
    assert.equal(retryWarn[1].localFirst, true);
    assert.equal(retryWarn[1].attempt, 2);
  });

  it("7. localFirst true, applyLocal lève avant commit", async () => {
    const localErr = new Error("local before commit");
    const opts = baseLaunchOpts({
      localFirst: true,
      applyLocal: mock.fn(() => {
        throw localErr;
      }),
      onLocalApplied: mock.fn(),
    });

    await assert.rejects(() => launchGameWithSync(opts), localErr);
    assert.equal(pushGameSessionMock.mock.callCount(), 0);
    assert.equal(showAppAlertMock.mock.callCount(), 0);
  });

  it("8. getRemoteState appelé une seule fois malgré retry", async () => {
    pushSequence(new Error("fail once"), SESSION_ROW);

    const getRemoteState = mock.fn(() => REMOTE_STATE);
    await launchGameWithSync(baseLaunchOpts({ getRemoteState }));
    await flushBackgroundWork();

    assert.equal(getRemoteState.mock.callCount(), 1);
    assert.equal(pushGameSessionMock.mock.callCount(), 2);
    assert.deepEqual(
      pushGameSessionMock.mock.calls[0].arguments[0].state,
      pushGameSessionMock.mock.calls[1].arguments[0].state
    );
  });

  it("9. retry non bloquant — fallback avant fin du retry", async () => {
    const initialErr = new Error("fail initial");
    let rejectRetry;
    const retryControlled = new Promise((_resolve, reject) => {
      rejectRetry = reject;
    });

    pushSequence(initialErr, () => retryControlled);

    const opts = baseLaunchOpts();
    const resultPromise = launchGameWithSync(opts);

    const result = await resultPromise;
    assert.equal(result.usedFallback, true);
    assert.equal(showAppAlertMock.mock.callCount(), 1);
    assert.equal(pushGameSessionMock.mock.callCount(), 2);
    assert.equal(findStructuredWarn(warnings, "background_retry"), undefined);

    rejectRetry(new Error("late retry fail"));
    await retryControlled.catch(() => {});
    await flushBackgroundWork();
    assert.ok(findStructuredWarn(warnings, "background_retry"));
  });

  it("mode patch utilise patchGameState pour le commit", async () => {
    patchSequence(new Error("patch fail"), SESSION_ROW);

    await launchGameWithSync(
      baseLaunchOpts({
        screen: "guesslie",
        gameId: "guesslie",
        mode: "patch",
        getRemoteState: () => ({ guessLie: { lobbyComplete: true } }),
      })
    );
    await flushBackgroundWork();

    assert.equal(patchGameStateMock.mock.callCount(), 2);
    assert.equal(pushGameSessionMock.mock.callCount(), 0);
  });
});

describe("ARCH-08 contrats source", () => {
  it("10. ARCH-22 préservé dans launchGameWithSync", () => {
    const launchFnStart = mpLaunchSrc.indexOf("export async function launchGameWithSync");
    const runBtnStart = mpLaunchSrc.indexOf("export async function runLaunchButton");
    assert.ok(launchFnStart >= 0 && runBtnStart > launchFnStart);
    const launchBody = mpLaunchSrc.slice(launchFnStart, runBtnStart);
    assert.doesNotMatch(launchBody, /createSyncPending/);
    assert.doesNotMatch(launchBody, /withPatchTimeout/);
    assert.doesNotMatch(launchBody, /while\s*\(/);
    assert.match(launchBody, /retryLaunchCommitInBackground/);
    assert.doesNotMatch(launchBody, /\.catch\(\(\)\s*=>\s*\{\s*\}\)/);
  });

  it("commit et applyLocal post-succès sont séparés", () => {
    const launchFnStart = mpLaunchSrc.indexOf("export async function launchGameWithSync");
    const runBtnStart = mpLaunchSrc.indexOf("export async function runLaunchButton");
    const launchBody = mpLaunchSrc.slice(launchFnStart, runBtnStart);
    assert.match(launchBody, /try \{\s*\r?\n\s*await commit\(\);/);
    assert.match(
      launchBody,
      /if \(!localFirst\) applyLocalWithSideEffects\(\);\s*\r?\n\s*return \{ ok: true \}/
    );
    assert.doesNotMatch(
      launchBody,
      /try \{\s*\r?\n\s*await commit\(\);\s*\r?\n\s*if \(!localFirst\) applyLocalWithSideEffects\(\);/
    );
  });
});

describe("M-14b onLocalApplied contract", () => {
  /** @type {typeof console.warn} */
  let origWarn;
  /** @type {unknown[][]} */
  let warnings;

  beforeEach(() => {
    pushGameSessionMock.mock.resetCalls();
    patchGameStateMock.mock.resetCalls();
    showAppAlertMock.mock.resetCalls();
    isGameSyncActiveMock.mock.resetCalls();
    isLobbyHostMock.mock.resetCalls();
    isGameSyncActiveMock.mock.mockImplementation(() => true);
    isLobbyHostMock.mock.mockImplementation(() => true);
    pushGameSessionMock.mock.mockImplementation(async () => SESSION_ROW);
    showAppAlertMock.mock.mockImplementation(async () => {});

    warnings = [];
    origWarn = console.warn;
    console.warn = (...args) => {
      warnings.push(args);
      origWarn(...args);
    };
  });

  afterEach(() => {
    console.warn = origWarn;
  });

  function trackedSideEffects() {
    /** @type {string[]} */
    const events = [];
    return {
      events,
      applyLocal: mock.fn(() => {
        events.push("applyLocal");
      }),
      onLocalApplied: mock.fn(() => {
        events.push("onLocalApplied");
      }),
    };
  }

  it("1. remote-first, commit réussi — applyLocal puis onLocalApplied une fois", async () => {
    const { events, applyLocal, onLocalApplied } = trackedSideEffects();
    const result = await launchGameWithSync(
      baseLaunchOpts({ localFirst: false, applyLocal, onLocalApplied })
    );

    assert.equal(pushGameSessionMock.mock.callCount(), 1);
    assert.equal(applyLocal.mock.callCount(), 1);
    assert.equal(onLocalApplied.mock.callCount(), 1);
    assert.deepEqual(events, ["applyLocal", "onLocalApplied"]);
    assert.deepEqual(result, { ok: true });
    assert.equal(result.usedFallback, undefined);
    assert.equal(showAppAlertMock.mock.callCount(), 0);
    assert.equal(findStructuredWarn(warnings, "background_retry"), undefined);
  });

  it("2. remote-first, commit échoué — fallback avec hook une fois", async () => {
    const networkErr = new Error("network down");
    pushSequence(networkErr, SESSION_ROW);

    const { events, applyLocal, onLocalApplied } = trackedSideEffects();
    const result = await launchGameWithSync(
      baseLaunchOpts({ localFirst: false, applyLocal, onLocalApplied })
    );
    await flushBackgroundWork();

    assert.equal(pushGameSessionMock.mock.callCount(), 2);
    assert.equal(applyLocal.mock.callCount(), 1);
    assert.equal(onLocalApplied.mock.callCount(), 1);
    assert.deepEqual(events, ["applyLocal", "onLocalApplied"]);
    assert.equal(result.ok, false);
    assert.equal(result.usedFallback, true);
    assert.equal(result.error, networkErr);
    assert.equal(showAppAlertMock.mock.callCount(), 1);
    assert.ok(findStructuredWarn(warnings, "initial_commit"));
  });

  it("3. local-first, commit réussi — hook une fois avant commit", async () => {
    /** @type {string[]} */
    const events = [];
    const applyLocal = mock.fn(() => {
      events.push("applyLocal");
    });
    const onLocalApplied = mock.fn(() => {
      events.push("onLocalApplied");
    });
    pushGameSessionMock.mock.mockImplementation(async () => {
      events.push("commit");
      return SESSION_ROW;
    });

    const result = await launchGameWithSync(
      baseLaunchOpts({ localFirst: true, applyLocal, onLocalApplied })
    );

    assert.deepEqual(events, ["applyLocal", "onLocalApplied", "commit"]);
    assert.equal(applyLocal.mock.callCount(), 1);
    assert.equal(onLocalApplied.mock.callCount(), 1);
    assert.deepEqual(result, { ok: true });
  });

  it("4. local-first, commit échoué — hook une fois, pas de second appel fallback", async () => {
    const initialErr = new Error("gl initial");
    pushSequence(initialErr, new Error("gl retry"));

    const { events, applyLocal, onLocalApplied } = trackedSideEffects();
    const result = await launchGameWithSync(
      baseLaunchOpts({ localFirst: true, applyLocal, onLocalApplied })
    );
    await flushBackgroundWork();

    assert.equal(applyLocal.mock.callCount(), 1);
    assert.equal(onLocalApplied.mock.callCount(), 1);
    assert.deepEqual(events, ["applyLocal", "onLocalApplied"]);
    assert.equal(result.usedFallback, true);
    assert.equal(showAppAlertMock.mock.callCount(), 1);
    assert.equal(pushGameSessionMock.mock.callCount(), 2);
  });

  it("5. solo / sync désactivée — applyLocal puis onLocalApplied", async () => {
    isGameSyncActiveMock.mock.mockImplementation(() => false);

    const { events, applyLocal, onLocalApplied } = trackedSideEffects();
    const result = await launchGameWithSync(
      baseLaunchOpts({ applyLocal, onLocalApplied })
    );

    assert.equal(pushGameSessionMock.mock.callCount(), 0);
    assert.equal(applyLocal.mock.callCount(), 1);
    assert.equal(onLocalApplied.mock.callCount(), 1);
    assert.deepEqual(events, ["applyLocal", "onLocalApplied"]);
    assert.deepEqual(result, { ok: true });
  });

  it("6. callback absent — pas de throw", async () => {
    const applyLocal = mock.fn();
    const result = await launchGameWithSync(
      baseLaunchOpts({ localFirst: false, applyLocal, onLocalApplied: undefined })
    );

    assert.equal(applyLocal.mock.callCount(), 1);
    assert.deepEqual(result, { ok: true });
  });

  it("7. ordre contractuel remote-first succès et fallback", async () => {
    /** @type {string[]} */
    const successEvents = [];
    const successApply = mock.fn(() => successEvents.push("applyLocal"));
    const successHook = mock.fn(() => successEvents.push("onLocalApplied"));
    await launchGameWithSync(
      baseLaunchOpts({
        localFirst: false,
        applyLocal: successApply,
        onLocalApplied: successHook,
      })
    );
    assert.deepEqual(successEvents, ["applyLocal", "onLocalApplied"]);

    pushGameSessionMock.mock.resetCalls();
    pushSequence(new Error("fail once"), SESSION_ROW);

    /** @type {string[]} */
    const fallbackEvents = [];
    const fallbackApply = mock.fn(() => fallbackEvents.push("applyLocal"));
    const fallbackHook = mock.fn(() => fallbackEvents.push("onLocalApplied"));
    await launchGameWithSync(
      baseLaunchOpts({
        localFirst: false,
        applyLocal: fallbackApply,
        onLocalApplied: fallbackHook,
      })
    );
    assert.deepEqual(fallbackEvents, ["applyLocal", "onLocalApplied"]);
  });
});

describe("M-14b contrats source", () => {
  it("applyLocalWithSideEffects centralise le couple applyLocal / onLocalApplied", () => {
    const launchFnStart = mpLaunchSrc.indexOf("export async function launchGameWithSync");
    const runBtnStart = mpLaunchSrc.indexOf("export async function runLaunchButton");
    const launchBody = mpLaunchSrc.slice(launchFnStart, runBtnStart);
    assert.match(launchBody, /const applyLocalWithSideEffects = \(\) => \{/);
    assert.match(launchBody, /applyLocal\(\);\s*\r?\n\s*onLocalApplied\?\.\(\);/);
    assert.doesNotMatch(launchBody, /if \(!localFirst\) applyLocal\(\);/);
    assert.doesNotMatch(launchBody, /if \(localFirst\) \{\s*\r?\n\s*applyLocal\(\);/);
  });
});
