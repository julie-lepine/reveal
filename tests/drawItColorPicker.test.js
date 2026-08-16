/**
 * Draw it ! — color picker libre (FEATURE-DRAWIT-COLORPICKER).
 */
import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

mock.module("../js/core/supabaseClient.js", {
  namedExports: {
    isSupabaseConfigured: () => false,
    supabase: null,
  },
});

const DRAWER = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

const strokes = await import("../js/core/drawItStrokes.js");
const { applyDrawItNextRound } = await import("../js/core/drawItRound.js");

const {
  DRAW_IT_DEFAULT_COLOR,
  DRAW_IT_TOOL_DRAW,
  DRAW_IT_TOOL_ERASE,
  applyDrawItBrushColor,
  applyDrawItDurableAppend,
  beginDrawItStroke,
  createDrawItBrush,
  createDrawItRecapBoardFromSession,
  createEmptyDrawItBoard,
  endDrawItStroke,
  extendDrawItStroke,
  resolveDrawItToolColor,
  toDurableDrawItStroke,
} = strokes;

function session(extra = {}) {
  return {
    lobbyStarted: true,
    phase: "drawing",
    runId: "run-picker",
    roundIdx: 0,
    roundCount: 3,
    canvasEpoch: 0,
    drawerUid: DRAWER,
    strokeSeq: 0,
    strokes: [],
    drawerOrder: [DRAWER],
    participants: [{ userId: DRAWER, name: "Emma" }],
    ...extra,
  };
}

function paint(board, color, from = [0.1, 0.1], to = [0.2, 0.2]) {
  let next = beginDrawItStroke(board, from, {
    ...createDrawItBrush({ color }),
  });
  next = endDrawItStroke(next, to);
  return next;
}

describe("Draw it ! color picker — couleur", () => {
  it("A. couleur par défaut d'une nouvelle manche : #f4f4f5", () => {
    assert.equal(DRAW_IT_DEFAULT_COLOR, "#f4f4f5");
    assert.equal(createDrawItBrush().color, "#f4f4f5");
    const src = read("js/games/drawIt.js");
    assert.match(src, /brush = createDrawItBrush\(\)/);
  });

  it("B. sélection libre #ff69b4", () => {
    const brush = applyDrawItBrushColor(createDrawItBrush(), "#ff69b4");
    assert.equal(brush.color, "#ff69b4");
    assert.equal(resolveDrawItToolColor("#ff69b4"), "#ff69b4");
  });

  it("C. sélection orange #f97316", () => {
    assert.equal(applyDrawItBrushColor(createDrawItBrush(), "#f97316").color, "#f97316");
  });

  it("D. sélection gris #6b7280", () => {
    assert.equal(applyDrawItBrushColor(createDrawItBrush(), "#6b7280").color, "#6b7280");
  });

  it("E. sélection arbitraire #12abef", () => {
    assert.equal(resolveDrawItToolColor("#12ABEF"), "#12abef");
    assert.equal(applyDrawItBrushColor(createDrawItBrush(), "#12abef").color, "#12abef");
    assert.equal(resolveDrawItToolColor("red"), "#f4f4f5");
    assert.equal(resolveDrawItToolColor("rgba(255,0,0,0.5)"), "#f4f4f5");
  });

  it("F. nouveau stroke reçoit la couleur sélectionnée", () => {
    const board = paint(createEmptyDrawItBoard({ runId: "run-picker" }), "#ff69b4");
    assert.equal(board.strokes[0].color, "#ff69b4");
    assert.equal(board.strokes[0].tool, DRAW_IT_TOOL_DRAW);
  });

  it("G. changer de couleur ne modifie pas les anciens strokes", () => {
    let board = paint(createEmptyDrawItBoard({ runId: "run-picker" }), "#ef4444");
    const firstId = board.strokes[0].strokeId;
    board = paint(board, "#38bdf8", [0.3, 0.3], [0.4, 0.4]);
    assert.equal(board.strokes.find((entry) => entry.strokeId === firstId).color, "#ef4444");
    assert.equal(board.strokes[1].color, "#38bdf8");
  });

  it("H. changer la couleur pendant currentStroke ne modifie pas le trait", () => {
    let board = beginDrawItStroke(
      createEmptyDrawItBoard({ runId: "run-picker" }),
      [0.1, 0.1],
      createDrawItBrush({ color: "#ef4444" })
    );
    const nextBrush = applyDrawItBrushColor(createDrawItBrush({ color: "#ef4444" }), "#38bdf8");
    board = extendDrawItStroke(board, [0.2, 0.2]);
    board = endDrawItStroke(board, [0.3, 0.3]);
    assert.equal(board.strokes[0].color, "#ef4444");
    assert.notEqual(board.strokes[0].color, nextBrush.color);
    const ui = read("js/games/drawIt.js");
    const bindStart = ui.indexOf("function bindTools");
    const bind = ui.slice(bindStart, ui.indexOf("function guessChatHtml"));
    assert.match(bind, /if \(toolsBusy\(\)\) \{/);
    assert.match(bind, /if \(toolsBusy\(\)\) return;/);
  });
});

describe("Draw it ! color picker — gomme / manche", () => {
  it("I. dessin → gomme → dessin conserve la couleur", () => {
    let brush = createDrawItBrush({ color: "#ec4899" });
    brush = createDrawItBrush({
      color: brush.color,
      width: brush.width,
      tool: DRAW_IT_TOOL_ERASE,
    });
    assert.equal(brush.tool, DRAW_IT_TOOL_ERASE);
    assert.equal(brush.color, "#ec4899");
    brush = applyDrawItBrushColor(brush, "#ec4899");
    assert.equal(brush.tool, DRAW_IT_TOOL_ERASE);
    brush = createDrawItBrush({
      color: brush.color,
      width: brush.width,
      tool: DRAW_IT_TOOL_DRAW,
    });
    assert.equal(brush.tool, DRAW_IT_TOOL_DRAW);
    assert.equal(brush.color, "#ec4899");
  });

  it("J. nouvelle manche reset à #f4f4f5", () => {
    const custom = createDrawItBrush({ color: "#12abef", width: 12, tool: DRAW_IT_TOOL_ERASE });
    assert.equal(custom.color, "#12abef");
    const reset = createDrawItBrush();
    assert.equal(reset.color, "#f4f4f5");
    assert.equal(reset.width, 4);
    assert.equal(reset.tool, DRAW_IT_TOOL_DRAW);
    const round0 = session({
      strokes: [
        {
          strokeId: "s1",
          seq: 1,
          canvasEpoch: 0,
          color: "#12abef",
          width: 7,
          points: [
            [0.1, 0.1],
            [0.2, 0.2],
          ],
        },
      ],
      strokeSeq: 1,
      phase: "reveal",
    });
    const advanced = applyDrawItNextRound(round0, { nowMs: Date.now() });
    assert.equal(advanced.ok, true);
    assert.deepEqual(advanced.session.strokes, []);
    const src = read("js/games/drawIt.js");
    assert.match(
      src,
      /lastPlayIdentity\.runId !== \(session\.runId \|\| null\)[\s\S]*brush = createDrawItBrush\(\)/
    );
  });

  it("K. recap conserve la couleur custom", () => {
    const recap = createDrawItRecapBoardFromSession(
      session({
        strokes: [
          {
            strokeId: "s1",
            seq: 1,
            canvasEpoch: 0,
            color: "#ff69b4",
            width: 7,
            points: [
              [0.1, 0.2],
              [0.2, 0.3],
            ],
          },
        ],
        strokeSeq: 1,
        phase: "reveal",
      })
    );
    assert.equal(recap.strokes[0].color, "#ff69b4");
    assert.equal(recap.currentStroke, null);
  });

  it("L. color custom compatible sanitize V1", () => {
    const durable = toDurableDrawItStroke(
      {
        strokeId: "s12",
        seq: 12,
        canvasEpoch: 0,
        points: [
          [0.1, 0.2],
          [0.2, 0.3],
        ],
        color: "#ff69b4",
        width: 7,
      },
      session({ strokeSeq: 12 })
    );
    assert.equal(durable.color, "#ff69b4");
    assert.equal(durable.width, 7);
    const persisted = applyDrawItDurableAppend(session(), durable, { uid: DRAWER });
    assert.equal(persisted.ok, true);
    assert.equal(persisted.session.strokes[0].color, "#ff69b4");
  });
});

describe("Draw it ! color picker — UI / régressions", () => {
  it("M. plus de palette prédéfinie dans la toolbar", () => {
    const ui = read("js/games/drawIt.js");
    assert.doesNotMatch(ui, /DRAW_IT_TOOL_COLORS/);
    assert.doesNotMatch(ui, /data-color/);
    assert.doesNotMatch(ui, /draw-it-swatch/);
    assert.doesNotMatch(ui, /aria-label="Couleur"/);
  });

  it("N. picker natif compact : ouverture / fermeture", () => {
    const ui = read("js/games/drawIt.js");
    assert.match(ui, /type="color"/);
    assert.match(ui, /id="draw-it-color-input"/);
    assert.match(ui, /aria-label="Choisir une couleur"/);
    const bindStart = ui.indexOf("function bindTools");
    const bind = ui.slice(bindStart, ui.indexOf("function guessChatHtml"));
    assert.match(bind, /closest\?\.\("#draw-it-color-input"\)/);
    assert.match(bind, /addEventListener\("input"/);
    assert.match(bind, /addEventListener\("change"/);
    assert.doesNotMatch(bind, /preventDefault\(\);[\s\S]*color-input/);
  });

  it("O. aucune dépendance externe", () => {
    const pkg = JSON.parse(read("package.json"));
    const names = [
      ...Object.keys(pkg.dependencies || {}),
      ...Object.keys(pkg.devDependencies || {}),
    ].join(" ");
    assert.doesNotMatch(names, /iro|pickr|spectrum|coloris|vanilla-picker|tinycolor/i);
    const ui = read("js/games/drawIt.js");
    assert.doesNotMatch(ui, /from ["'][^"']*color/i);
  });

  it("P. pas de render global / teardownChat / focus artificiel", () => {
    const src = read("js/games/drawIt.js");
    const bindStart = src.indexOf("function bindTools");
    const bind = src.slice(bindStart, src.indexOf("function guessChatHtml"));
    assert.doesNotMatch(bind, /\brender\(\)/);
    assert.doesNotMatch(bind, /teardownChat/);
    assert.doesNotMatch(bind, /teardownCanvas/);
    assert.doesNotMatch(bind, /app\.innerHTML/);
    assert.doesNotMatch(bind, /\.focus\(/);
    assert.doesNotMatch(bind, /chatPanel\.refresh/);
    assert.match(src, /canKeepDrawItGuessComposer\(lastPlayIdentity/);
    const patchStart = src.indexOf("function patchDrawingLive");
    const patch = src.slice(patchStart, src.indexOf("function bindGuessChat"));
    assert.doesNotMatch(patch, /\.focus\(/);
  });

  it("Q. aucune régression du tool erase", () => {
    const erase = createDrawItBrush({ tool: DRAW_IT_TOOL_ERASE, color: "#12abef" });
    assert.equal(erase.tool, DRAW_IT_TOOL_ERASE);
    assert.equal(erase.color, "#12abef");
    const ui = read("js/games/drawIt.js");
    assert.match(ui, /id="draw-it-erase"/);
    assert.match(ui, /commitDrawItEraseSegments/);
    assert.doesNotMatch(ui, /#ffffff/);
    const sql = read("supabase/feature-drawit-05-erase.sql");
    assert.match(sql, /erase_drawit_strokes/);
  });

  it("R. T7/T8 inchangés", () => {
    const live = read("js/core/drawItLive.js");
    assert.match(live, /drawit:\$\{intent\.lobbyId\}/);
    assert.match(live, /ALLOWED_TYPES = new Set\(\["start", "chunk", "end", "clear", "undo", "erase", "erase_segments"\]\)/);
    const rpc = read("js/core/gameSessionRpc.js");
    assert.match(rpc, /append_drawit_stroke/);
    assert.match(rpc, /undo_drawit_stroke/);
    assert.match(rpc, /clear_drawit_canvas/);
    assert.match(rpc, /erase_drawit_strokes/);
    assert.doesNotMatch(rpc, /color_picker|set_drawit_color/);
    const sql04 = read("supabase/feature-drawit-04-strokes.sql");
    assert.match(sql04, /append_drawit_stroke/);
    assert.doesNotMatch(read("js/games/drawIt.js"), /rpcEraseDrawItStrokes|append_drawit_stroke/);
  });
});
