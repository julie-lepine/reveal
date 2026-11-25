/**
 * Audit mise à jour n°6 — écran de reprise plein écran (salon ouvert pendant une partie).
 * « Rester ici » mène au menu des jeux ; un compte à rebours impossible disparaît.
 */
import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

const isGameSyncActiveMock = mock.fn(() => true);
const suppressMock = mock.fn();
const dismissMock = mock.fn();
const routeToSessionScreenMock = mock.fn();

mock.module("../js/core/gameSync.js", {
  namedExports: {
    clearSessionRouteSuppress: mock.fn(),
    applyRemoteSession: mock.fn(),
    getCachedGameSession: mock.fn(() => ({ state: {}, screen: "hottake-prep", game_id: "hottake" })),
    getResumableSessionScreen: mock.fn(() => "hottake-prep"),
    isGameSyncActive: isGameSyncActiveMock,
    isLobbyHost: mock.fn(() => false),
    isOnGameSetupScreen: mock.fn(() => true),
    isResumableSessionDestination: mock.fn(() => true),
    refreshGameSession: mock.fn(async () => null),
    routeToActiveGameIfNeeded: mock.fn(),
    routeToSessionScreen: routeToSessionScreenMock,
    suppressRoutingForScoreView: suppressMock,
  },
});
mock.module("../js/core/resumeBannerDismiss.js", {
  namedExports: {
    clearResumeBannerDismiss: mock.fn(),
    dismissResumeBannerForSession: dismissMock,
    shouldShowResumeBannerAfterDismiss: mock.fn(() => true),
    resumeBannerSessionKey: mock.fn(() => "k"),
    evaluateResumeBannerVisibility: mock.fn(() => true),
    getResumeBannerDismissedKey: mock.fn(() => null),
  },
});
mock.module("../js/core/router.js", {
  namedExports: { getCurrentScreen: mock.fn(() => "lobby"), navigate: mock.fn() },
});
mock.module("../js/core/state.js", {
  namedExports: { getState: mock.fn(() => ({ lobby: { id: "l1" } })), saveStatePatch: mock.fn() },
});
mock.module("../js/screens/nav.js", { namedExports: { bindNav: mock.fn() } });

const { mountGameResumeInterstitial } = await import("../js/core/gameResume.js");

/** Faux conteneur : retrouve les éléments par id / classe dans le HTML posé. */
function fakeApp() {
  const els = new Map();
  return {
    _html: "",
    set innerHTML(v) {
      this._html = v;
      els.clear();
    },
    get innerHTML() {
      return this._html;
    },
    querySelector(sel) {
      const needle = sel.startsWith("#") ? `id="${sel.slice(1)}"` : sel.slice(1);
      if (!this._html.includes(needle)) return null;
      if (!els.has(sel)) {
        const app = this;
        els.set(sel, {
          listeners: {},
          textContent: "",
          addEventListener(type, fn) {
            this.listeners[type] = fn;
          },
          click() {
            this.listeners.click?.();
          },
          remove() {
            app._html = app._html.replace(needle, "removed");
            els.delete(sel);
          },
        });
      }
      return els.get(sel);
    },
  };
}

const tick = () => new Promise((r) => setImmediate(r));

describe("écran de reprise", () => {
  beforeEach(() => {
    isGameSyncActiveMock.mock.mockImplementation(() => true);
    suppressMock.mock.resetCalls();
    dismissMock.mock.resetCalls();
    routeToSessionScreenMock.mock.resetCalls();
  });

  it("« Rester ici » mène au menu des jeux, sans reprise automatique ensuite", async () => {
    const app = fakeApp();
    const nav = mock.fn();
    const cleanup = mountGameResumeInterstitial(app, "hottake-prep", {
      allowStay: true,
      navigateTo: nav,
    });
    app.querySelector("#game-resume-stay").click();
    assert.equal(suppressMock.mock.callCount(), 1, "même effet que le bandeau, préparation comprise");
    assert.equal(dismissMock.mock.callCount(), 1);
    assert.equal(nav.mock.callCount(), 1);
    assert.equal(nav.mock.calls[0].arguments[0], "game-select");
    await new Promise((r) => setTimeout(r, 2700));
    assert.equal(routeToSessionScreenMock.mock.callCount(), 0, "le minuteur est arrêté");
    cleanup();
  });

  it("reprise impossible : le compte à rebours disparaît au lieu de rester figé", async () => {
    isGameSyncActiveMock.mock.mockImplementation(() => false);
    const app = fakeApp();
    const cleanup = mountGameResumeInterstitial(app, "hottake", { navigateTo: mock.fn() });
    assert.ok(app.querySelector(".game-resume__countdown"));
    app.querySelector("#game-resume-now").click();
    await tick();
    assert.equal(app.querySelector(".game-resume__countdown"), null);
    assert.ok(app.querySelector("#game-resume-now"), "le bouton reste disponible");
    cleanup();
  });

  it("reprise possible : on part vers la partie", async () => {
    const app = fakeApp();
    const cleanup = mountGameResumeInterstitial(app, "hottake", { navigateTo: mock.fn() });
    app.querySelector("#game-resume-now").click();
    await tick();
    assert.equal(routeToSessionScreenMock.mock.callCount(), 1);
    cleanup();
  });
});
