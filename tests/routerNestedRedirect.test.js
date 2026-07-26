import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  initRouter,
  registerScreen,
  navigate,
  goBack,
  resetNav,
  getCurrentScreen,
  getNavStack,
} from "../js/core/router.js";
import {
  createMountGuard,
  getMountGenerationForTests,
} from "../js/core/mountLifecycle.js";

function fakeApp() {
  return {
    scrollTop: 0,
    querySelectorAll() {
      return [];
    },
  };
}

beforeEach(() => {
  globalThis.requestAnimationFrame = (fn) => {
    fn();
    return 1;
  };
  initRouter(fakeApp());
  resetNav();
  currentCleanupProbe = { b: 0, a: 0, home: 0 };
});

let currentCleanupProbe = { b: 0, a: 0, home: 0 };

function registerRedirectFixture({ outerReturnsCleanup = false } = {}) {
  registerScreen("home", () => () => {
    currentCleanupProbe.home += 1;
  });
  registerScreen("screen-a", () => {
    navigate("screen-b");
    if (outerReturnsCleanup) {
      return () => {
        currentCleanupProbe.a += 1;
      };
    }
    return null;
  });
  registerScreen("screen-b", () => () => {
    currentCleanupProbe.b += 1;
  });
}

describe("M-08 / SYN-13 nested redirect in mount", () => {
  it("navigate(A) → mount A → navigate(B) → return null : pas de fantôme A dans navStack", () => {
    registerRedirectFixture();
    navigate("home", { reset: true });
    navigate("screen-a");

    assert.equal(getCurrentScreen(), "screen-b");
    assert.deepEqual(getNavStack(), ["home", "screen-b"]);
    assert.equal(getNavStack().includes("screen-a"), false);
  });

  it("goBack après redirect imbriqué revient à l’écran sous-jacent (pas au fantôme A)", () => {
    registerRedirectFixture();
    navigate("home", { reset: true });
    navigate("screen-a");
    assert.equal(getCurrentScreen(), "screen-b");

    goBack();

    assert.equal(getCurrentScreen(), "home");
    assert.deepEqual(getNavStack(), ["home"]);
  });

  it("cleanup destination préservé si outer return null", () => {
    registerRedirectFixture({ outerReturnsCleanup: false });
    navigate("home", { reset: true });
    navigate("screen-a");
    navigate("home", { reset: true });

    assert.equal(currentCleanupProbe.b, 1, "teardown de B doit tourner");
    assert.equal(currentCleanupProbe.a, 0);
  });

  it("cleanup destination préservé si outer return function (ne pas écraser)", () => {
    registerRedirectFixture({ outerReturnsCleanup: true });
    navigate("home", { reset: true });
    navigate("screen-a");
    navigate("home", { reset: true });

    assert.equal(currentCleanupProbe.b, 1, "teardown de B doit tourner");
    assert.equal(
      currentCleanupProbe.a,
      0,
      "cleanup fantôme de A ne doit pas remplacer celui de B"
    );
  });

  it("goBack : mount qui redirige retire le fantôme et garde la destination", () => {
    let bridgeMounts = 0;
    const screensSeen = [];
    registerScreen("home", () => {
      screensSeen.push("home");
      return () => {};
    });
    registerScreen("bridge", () => {
      bridgeMounts += 1;
      screensSeen.push("bridge");
      // First visit paints; remount via goBack redirects (in-mount pattern).
      if (bridgeMounts > 1) {
        navigate("elsewhere");
        return null;
      }
      return () => {};
    });
    registerScreen("play", () => {
      screensSeen.push("play");
      return () => {};
    });
    registerScreen("elsewhere", () => {
      screensSeen.push("elsewhere");
      return () => {};
    });

    navigate("home", { reset: true });
    navigate("bridge");
    navigate("play");
    assert.deepEqual(getNavStack(), ["home", "bridge", "play"]);

    goBack();

    assert.equal(getCurrentScreen(), "elsewhere");
    assert.deepEqual(getNavStack(), ["home", "elsewhere"]);
    assert.equal(getNavStack().includes("bridge"), false);
    assert.equal(screensSeen[screensSeen.length - 1], "elsewhere");
  });

  it("navigate vers un intermédiaire qui redirige vers l’écran déjà courant retire le fantôme", () => {
    registerScreen("home", () => () => {});
    registerScreen("dest", () => () => {});
    registerScreen("ghost", () => {
      navigate("dest");
      return null;
    });

    navigate("home", { reset: true });
    navigate("dest");
    navigate("ghost");

    assert.equal(getCurrentScreen(), "dest");
    assert.deepEqual(getNavStack(), ["home", "dest"]);
    assert.equal(getNavStack().includes("ghost"), false);
  });

  it("redirect inner avec reset:true ne casse pas le stack destination", () => {
    registerScreen("home", () => () => {});
    registerScreen("screen-a", () => {
      navigate("screen-b", { reset: true });
      return null;
    });
    registerScreen("screen-b", () => () => {});

    navigate("home", { reset: true });
    navigate("screen-a");

    assert.equal(getCurrentScreen(), "screen-b");
    assert.deepEqual(getNavStack(), ["screen-b"]);
  });

  it("double redirect A→B→C retire tous les fantômes", () => {
    registerScreen("home", () => () => {});
    registerScreen("screen-a", () => {
      navigate("screen-b");
      return null;
    });
    registerScreen("screen-b", () => {
      navigate("screen-c");
      return null;
    });
    registerScreen("screen-c", () => () => {});

    navigate("home", { reset: true });
    navigate("screen-a");

    assert.equal(getCurrentScreen(), "screen-c");
    assert.deepEqual(getNavStack(), ["home", "screen-c"]);
  });
});

describe("ARCH-06 Vague C0 — génération routeur", () => {
  it("navigate same-screen avance la génération ; ancien mount non courant", () => {
    let guardA = null;
    let guardB = null;
    let mounts = 0;
    registerScreen("home", () => () => {});
    registerScreen("play", () => {
      mounts += 1;
      const g = createMountGuard();
      if (mounts === 1) guardA = g;
      else guardB = g;
      return () => g.dispose();
    });

    navigate("home", { reset: true });
    const gen0 = getMountGenerationForTests();
    navigate("play");
    assert.ok(getMountGenerationForTests() > gen0);
    assert.equal(guardA.isCurrentMount(), true);

    navigate("play"); // remount same id
    assert.equal(guardA.isMounted(), false);
    assert.equal(guardA.isCurrentMount(), false);
    assert.equal(guardB.isCurrentMount(), true);
  });

  it("nested navigate : guard A non courant, B courant (même sans dispose A)", () => {
    let guardA = null;
    let guardB = null;
    registerScreen("home", () => () => {});
    registerScreen("screen-a", () => {
      guardA = createMountGuard();
      navigate("screen-b");
      return null; // pas de dispose — trou mode B
    });
    registerScreen("screen-b", () => {
      guardB = createMountGuard();
      return () => guardB.dispose();
    });

    navigate("home", { reset: true });
    navigate("screen-a");
    assert.equal(getCurrentScreen(), "screen-b");
    assert.equal(guardA.isMounted(), true);
    assert.equal(guardA.isCurrentMount(), false);
    assert.equal(guardB.isCurrentMount(), true);
  });

  it("goBack avance la génération", () => {
    let lastGuard = null;
    registerScreen("home", () => {
      lastGuard = createMountGuard();
      return () => lastGuard.dispose();
    });
    registerScreen("play", () => {
      lastGuard = createMountGuard();
      return () => lastGuard.dispose();
    });

    navigate("home", { reset: true });
    navigate("play");
    const genPlay = getMountGenerationForTests();
    const playGuard = lastGuard;
    goBack();
    assert.ok(getMountGenerationForTests() > genPlay);
    assert.equal(playGuard.isCurrentMount(), false);
    assert.equal(lastGuard.isCurrentMount(), true);
  });
});
