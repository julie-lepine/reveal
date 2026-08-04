import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  shouldFullRenderWrongAnswer,
  decideWrongAnswerRemoteUi,
  rebuildRootPreservingNode,
  wrongAnswerComposeStatusText,
  wrongAnswerVoteStatusText,
  wrongAnswerConfirmVoteState,
  wrongAnswerAuthorNames,
  wrongAnswerSubmitDisabled,
} from "../js/core/wrongAnswerUiRefresh.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const gameSrc = () => readFileSync(join(root, "js/games/wrongAnswer.js"), "utf8");

describe("BUG-WAO-02/03 - shouldFullRenderWrongAnswer", () => {
  it("1. même phase answer + answers-only → pas de full render", () => {
    assert.equal(
      shouldFullRenderWrongAnswer({
        prevPhase: "answer",
        phase: "answer",
        prevRound: 0,
        roundIdx: 0,
      }),
      false
    );
  });

  it("2. même phase voting → pas de full render", () => {
    assert.equal(
      shouldFullRenderWrongAnswer({
        prevPhase: "voting",
        phase: "voting",
        prevRound: 1,
        roundIdx: 1,
      }),
      false
    );
  });

  it("8. réponse → vote → full render", () => {
    assert.equal(
      shouldFullRenderWrongAnswer({
        prevPhase: "answer",
        phase: "voting",
        prevRound: 0,
        roundIdx: 0,
      }),
      true
    );
  });

  it("9. nouveau roundIdx → full render", () => {
    assert.equal(
      shouldFullRenderWrongAnswer({
        prevPhase: "reveal",
        phase: "answer",
        prevRound: 0,
        roundIdx: 1,
      }),
      true
    );
  });

  it("vote → reveal → full render", () => {
    assert.equal(
      shouldFullRenderWrongAnswer({
        prevPhase: "voting",
        phase: "reveal",
        prevRound: 0,
        roundIdx: 0,
      }),
      true
    );
  });

  it("compose layout mismatch (form → feedback) → full render", () => {
    assert.equal(
      shouldFullRenderWrongAnswer({
        prevPhase: "answer",
        phase: "answer",
        prevRound: 0,
        roundIdx: 0,
        composeLayoutMismatch: true,
      }),
      true
    );
  });

  it("vote list authors changed → full render", () => {
    assert.equal(
      shouldFullRenderWrongAnswer({
        prevPhase: "voting",
        phase: "voting",
        prevRound: 0,
        roundIdx: 0,
        voteListAuthorsChanged: true,
      }),
      true
    );
  });
});

describe("BUG-WAO-02 - decideWrongAnswerRemoteUi hard gate composition", () => {
  it("answers-only + formulaire vivant → refresh-answer (pas full)", () => {
    const d = decideWrongAnswerRemoteUi({
      prevPhase: "answer",
      phase: "answer",
      prevRound: 0,
      roundIdx: 0,
      composeFormAlive: true,
      localSubmitted: false,
    });
    assert.equal(d.mode, "refresh-answer");
    assert.equal(d.reason, "compose-alive-answers-only");
  });

  it("actingHostUiRefresh pendant rédaction → refresh-answer (pas full)", () => {
    const d = decideWrongAnswerRemoteUi({
      prevPhase: "answer",
      phase: "answer",
      prevRound: 0,
      roundIdx: 0,
      composeFormAlive: true,
      localSubmitted: false,
      actingHostUiRefresh: true,
    });
    assert.equal(d.mode, "refresh-answer");
    assert.equal(d.reason, "compose-alive-answers-only");
  });

  it("faux positif composeLayoutMismatch pendant rédaction → refresh-answer", () => {
    const d = decideWrongAnswerRemoteUi({
      prevPhase: "answer",
      phase: "answer",
      prevRound: 0,
      roundIdx: 0,
      composeFormAlive: true,
      localSubmitted: false,
      composeLayoutMismatch: true,
    });
    assert.equal(d.mode, "refresh-answer");
  });

  it("soumission locale form→feedback → full", () => {
    const d = decideWrongAnswerRemoteUi({
      prevPhase: "answer",
      phase: "answer",
      prevRound: 0,
      roundIdx: 0,
      composeFormAlive: false,
      localSubmitted: true,
      composeLayoutMismatch: true,
    });
    assert.equal(d.mode, "full");
  });

  it("phase answer → voting → full", () => {
    const d = decideWrongAnswerRemoteUi({
      prevPhase: "answer",
      phase: "voting",
      prevRound: 0,
      roundIdx: 0,
      composeFormAlive: false,
      localSubmitted: true,
    });
    assert.equal(d.mode, "full");
  });
});

describe("BUG-WAO-02 - identité DOM #wrong-input (before === after)", () => {
  /** Mini DOM suffisant pour querySelector / innerHTML / replaceWith. */
  function miniDom(initialInner) {
    function el(tag, attrs = {}, children = []) {
      const node = {
        tagName: tag.toUpperCase(),
        id: attrs.id || "",
        attrs: { ...attrs },
        children: [...children],
        parent: null,
        get hidden() {
          return Boolean(this.attrs.hidden);
        },
        set hidden(v) {
          if (v) this.attrs.hidden = true;
          else delete this.attrs.hidden;
        },
        get textContent() {
          return this._text || "";
        },
        set textContent(v) {
          this._text = String(v);
        },
        get value() {
          return this._value || "";
        },
        set value(v) {
          this._value = String(v);
        },
        querySelector(sel) {
          if (sel.startsWith("#")) {
            const id = sel.slice(1);
            const walk = (n) => {
              if (n.id === id) return n;
              for (const c of n.children || []) {
                const hit = walk(c);
                if (hit) return hit;
              }
              return null;
            };
            return walk(this);
          }
          return null;
        },
        replaceWith(other) {
          if (!this.parent) return;
          const idx = this.parent.children.indexOf(this);
          if (idx >= 0) {
            this.parent.children[idx] = other;
            other.parent = this.parent;
            this.parent = null;
          }
        },
        set innerHTML(html) {
          this.children = [];
          const m = String(html).match(/id="([^"]+)"/g) || [];
          for (const piece of m) {
            const id = piece.slice(4, -1);
            const child = el(id === "wrong-input" ? "textarea" : "div", { id });
            child.parent = this;
            if (id === "wrong-input") child._value = "DRAFT";
            this.children.push(child);
          }
        },
        get innerHTML() {
          return this.children.map((c) => `<${c.tagName} id="${c.id}">`).join("");
        },
      };
      for (const c of node.children) c.parent = node;
      return node;
    }

    const root = el("div", { id: "app" });
    root.innerHTML = initialInner;
    return root;
  }

  it("answers-only rebuild : beforeTextarea === afterTextarea", () => {
    const app = miniDom(`<textarea id="wrong-input"></textarea><div id="wrong-answer-status"></div>`);
    const before = app.querySelector("#wrong-input");
    before.value = "ma pire idée";

    const result = rebuildRootPreservingNode(
      app,
      `<div id="wrap"><textarea id="wrong-input"></textarea><div id="wrong-answer-status"></div></div>`,
      "#wrong-input"
    );

    const after = app.querySelector("#wrong-input");
    assert.equal(result.path, "reused");
    assert.equal(result.sameNode, true);
    assert.equal(before === after, true);
    assert.equal(before === result.after, true);
    assert.equal(after.value, "ma pire idée");
  });

  it("sans préservation : nouveau nœud (contraste)", () => {
    const app = miniDom(`<textarea id="wrong-input"></textarea>`);
    const before = app.querySelector("#wrong-input");
    app.innerHTML = `<textarea id="wrong-input"></textarea>`;
    const after = app.querySelector("#wrong-input");
    assert.equal(before === after, false);
  });
});

describe("BUG-WAO-02 - textes chrome composition", () => {
  it("en rédaction : message secret", () => {
    assert.match(
      wrongAnswerComposeStatusText({
        submitted: false,
        mp: true,
        allIn: false,
        answeredCount: 0,
        total: 3,
      }),
      /pire réponse/
    );
  });

  it("soumis MP : compteur X/Y", () => {
    assert.equal(
      wrongAnswerComposeStatusText({
        submitted: true,
        mp: true,
        allIn: false,
        answeredCount: 1,
        total: 3,
      }),
      "Réponse envoyée - en attente des autres (1/3)…"
    );
  });

  it("draft non compté dans le contrat status (seulement answeredCount passé)", () => {
    assert.equal(
      wrongAnswerComposeStatusText({
        submitted: true,
        mp: true,
        allIn: false,
        answeredCount: 2,
        total: 3,
      }),
      "Réponse envoyée - en attente des autres (2/3)…"
    );
  });
});

describe("BUG-WAO-04 - submit désactivé si réponse vide", () => {
  it("vide / espaces / null → disabled", () => {
    assert.equal(wrongAnswerSubmitDisabled(""), true);
    assert.equal(wrongAnswerSubmitDisabled("   "), true);
    assert.equal(wrongAnswerSubmitDisabled("\n\t"), true);
    assert.equal(wrongAnswerSubmitDisabled(null), true);
    assert.equal(wrongAnswerSubmitDisabled(undefined), true);
  });

  it("texte utile → enabled", () => {
    assert.equal(wrongAnswerSubmitDisabled("a"), false);
    assert.equal(wrongAnswerSubmitDisabled("  girafe  "), false);
  });
});

describe("BUG-WAO-03 - textes chrome vote", () => {
  it("compteur votes + confirm state", () => {
    assert.match(
      wrongAnswerVoteStatusText({
        voted: true,
        allIn: false,
        votedCount: 2,
        total: 4,
      }),
      /2\/4/
    );
    const st = wrongAnswerConfirmVoteState({
      displayPick: "Bob",
      localName: "Alice",
      voted: false,
    });
    assert.equal(st.confirmDisabled, false);
    assert.equal(st.label, "Valider mon vote");
  });

  it("auteurs stables triés", () => {
    assert.deepEqual(
      wrongAnswerAuthorNames({
        Bob: { text: "x" },
        Alice: { text: "y" },
        Zoe: {},
      }),
      ["Alice", "Bob"]
    );
  });
});

describe("BUG-WAO-02/03 - wiring wrongAnswer.js", () => {
  it("expose refresh ciblés et hard-gate decideWrongAnswerRemoteUi", () => {
    const src = gameSrc();
    assert.match(src, /function refreshWrongAnswerResponseProgress/);
    assert.match(src, /function refreshWrongAnswerVoteProgress/);
    assert.match(src, /decideWrongAnswerRemoteUi/);
    assert.match(src, /rebuildRootPreservingNode/);
    assert.match(src, /id="wrong-input"/);
    assert.match(src, /id="wrong-vote-list"/);
    assert.match(src, /id="wrong-answer-status"/);
    assert.match(src, /id="wrong-vote-status"/);
    assert.match(
      src,
      /selectedTarget = target;\s*[\s\S]*?refreshWrongAnswerVoteProgress\(\)/
    );
  });

  it("BUG-WAO-04 - CTA submit gated + sync sur input", () => {
    const src = gameSrc();
    assert.match(src, /wrongAnswerSubmitDisabled/);
    assert.match(src, /function syncWrongAnswerSubmitEnabled/);
    assert.match(src, /syncWrongAnswerSubmitEnabled\(\)/);
    assert.match(src, /id="wrong-submit"/);
    assert.match(src, /submitDisabled \? " disabled"/);
    // Refresh chrome hôte (answers distants) réaffirme aussi le CTA.
    const refreshFn = src.match(
      /function refreshWrongAnswerResponseProgress\(\) \{[\s\S]*?\n  \}/
    )?.[0];
    assert.ok(refreshFn);
    assert.match(refreshFn, /syncWrongAnswerSubmitEnabled\(\)/);
  });

  it("refresh réponse ne fait plus slot.innerHTML (bouton pré-monté)", () => {
    const src = gameSrc();
    const refreshFn = src.match(
      /function refreshWrongAnswerResponseProgress\(\) \{[\s\S]*?\n  \}/
    )?.[0];
    assert.ok(refreshFn, "refreshWrongAnswerResponseProgress introuvable");
    assert.equal(/slot\.innerHTML/.test(refreshFn), false);
    assert.match(refreshFn, /btn\.hidden/);
  });

  it("ne force pas focus\(\) sur le textarea après sync distant", () => {
    const src = gameSrc();
    assert.equal(/#wrong-input[\s\S]{0,80}\.focus\(/.test(src), false);
    assert.equal(/wrong-input"\)\.focus/.test(src), false);
  });
});
