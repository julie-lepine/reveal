import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { resetPageScrollToElement } from "../js/core/ui.js";

const MARGIN = 88;
const BOARD_Y = 200;

function chain(boardY, { htmlOverflow = false, bodyOverflow = false } = {}) {
  let htmlTop = 0;
  let bodyTop = 0;
  const html = {
    get scrollTop() {
      return htmlTop;
    },
    set scrollTop(v) {
      htmlTop = Math.max(0, Number(v) || 0);
    },
    scrollHeight: htmlOverflow ? 2000 : 800,
    clientHeight: 800,
    parentElement: null,
  };
  const body = {
    get scrollTop() {
      return bodyTop;
    },
    set scrollTop(v) {
      bodyTop = Math.max(0, Number(v) || 0);
    },
    scrollHeight: bodyOverflow ? 2000 : 800,
    clientHeight: 800,
    parentElement: html,
  };
  const app = {
    scrollTop: 0,
    scrollHeight: 2000,
    clientHeight: 2000,
    parentElement: body,
    querySelectorAll() {
      return [];
    },
  };
  const page = {
    scrollTop: 0,
    scrollHeight: 2000,
    clientHeight: 2000,
    parentElement: app,
  };
  const board = {
    parentElement: page,
    getBoundingClientRect() {
      return { top: boardY - htmlTop - bodyTop };
    },
  };
  return { html, body, app, page, board };
}

describe("resetPageScrollToElement — scroller réel", () => {
  const originals = {};

  beforeEach(() => {
    originals.document = globalThis.document;
    originals.window = globalThis.window;
    originals.getComputedStyle = globalThis.getComputedStyle;
  });

  afterEach(() => {
    globalThis.document = originals.document;
    globalThis.window = originals.window;
    globalThis.getComputedStyle = originals.getComputedStyle;
  });

  it("OxygenOS : aligne via body.scrollTop si window.scrollBy est un no-op", () => {
    const { html, body, app, page, board } = chain(BOARD_Y, { bodyOverflow: true });
    globalThis.getComputedStyle = () => ({ scrollMarginTop: `${MARGIN}px` });
    globalThis.window = { scrollBy() {} };
    globalThis.document = {
      documentElement: html,
      body,
      scrollingElement: html,
      getElementById: () => app,
    };

    resetPageScrollToElement(board, app);

    assert.equal(body.scrollTop, BOARD_Y - MARGIN);
    assert.equal(html.scrollTop, 0);
    assert.equal(page.scrollTop, 0);
    assert.equal(board.getBoundingClientRect().top, MARGIN);
  });

  it("Samsung : n'applique le delta qu'une fois sur documentElement", () => {
    const { html, body, app, page, board } = chain(BOARD_Y, { htmlOverflow: true });
    globalThis.getComputedStyle = () => ({ scrollMarginTop: `${MARGIN}px` });
    let windowDelta = 0;
    globalThis.window = {
      scrollBy(_x, y) {
        windowDelta += Number(y) || 0;
      },
    };
    globalThis.document = {
      documentElement: html,
      body,
      scrollingElement: html,
      getElementById: () => app,
    };

    resetPageScrollToElement(board, app);

    assert.equal(html.scrollTop, BOARD_Y - MARGIN);
    assert.equal(body.scrollTop, 0);
    assert.equal(page.scrollTop, 0);
    assert.equal(windowDelta, 0);
    assert.equal(board.getBoundingClientRect().top, MARGIN);
  });
});
