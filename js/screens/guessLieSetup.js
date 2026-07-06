import { setLocalGuessLieSubmission } from "../core/state.js";
import { hasLocalSubmission } from "../core/guessLieSession.js";
import { navigate } from "../core/router.js";
import { pageShell } from "../core/ui.js";
import { rulesButtonHtml } from "../core/gameRulesUi.js";
import { checkHotTakeModeration, getModerationNotice } from "../core/hotTakeSession.js";
import {
  charCountHtml,
  bindCharCounter,
} from "../core/prepScreen.js";
import {
  isPlayerTextTooLong,
  PLAYER_TEXT_MAX_LEN,
  playerTextMaxError,
} from "../../data/playerTextLimits.js";
import { bindNav } from "./nav.js";

export function mountGuessLieSetup(app) {
  if (hasLocalSubmission()) {
    navigate("guesslie-wait", { reset: true });
    return null;
  }

  let lieIndex = null;
  let unbindCharCounters = () => {};

  app.innerHTML = pageShell({
    backTarget: "back",
    content: `
      <p class="label-upper label-upper--green">🕵️ Guess The Lie</p>
      <div class="screen-title-row">
        <h2 class="screen-title">Prépare tes 3 affirmations</h2>
        ${rulesButtonHtml("guesslie")}
      </div>
      <p class="game-intro">
        Écris <strong>2 vérités</strong> et <strong>1 mensonge</strong> sur toi, puis choisis la lettre du mensonge.
        <span class="muted"> (${PLAYER_TEXT_MAX_LEN} caractères max. par affirmation)</span>
      </p>

      <div class="card">
        <label class="field-label" for="stmt-0">Affirmation A</label>
        <input type="text" class="field-input" id="stmt-0" maxlength="${PLAYER_TEXT_MAX_LEN}" placeholder="Ex : J'ai vécu en Italie…" />
        ${charCountHtml("stmt-0-count")}

        <label class="field-label" for="stmt-1">Affirmation B</label>
        <input type="text" class="field-input" id="stmt-1" maxlength="${PLAYER_TEXT_MAX_LEN}" placeholder="Ex : Je déteste le café…" />
        ${charCountHtml("stmt-1-count")}

        <label class="field-label" for="stmt-2">Affirmation C</label>
        <input type="text" class="field-input" id="stmt-2" maxlength="${PLAYER_TEXT_MAX_LEN}" placeholder="Ex : J'ai un tatouage…" />
        ${charCountHtml("stmt-2-count")}
      </div>

      <p class="field-label field-label--spaced">Laquelle est le mensonge ?</p>
      <div class="lie-pick-row" id="lie-picks">
        ${[0, 1, 2]
          .map(
            (i) => `
          <button type="button" class="lie-pick" data-lie="${i}" aria-pressed="false">
            ${String.fromCharCode(65 + i)}
          </button>`
          )
          .join("")}
      </div>

      <p class="hint" id="setup-hint">Remplis les 3 champs et sélectionne le mensonge.</p>

      <p class="moderation-notice">${getModerationNotice()}</p>
      <p class="auth-error hidden" id="guesslie-error"></p>

      <button type="button" class="btn btn-primary btn--spaced" id="btn-go" disabled>
        GO - envoyer au lobby
      </button>

      <button type="button" class="btn btn-accent btn--spaced" data-nav="game-select">
        Retour aux jeux
      </button>
    `,
  });

  const inputs = [0, 1, 2].map((i) => app.querySelector(`#stmt-${i}`));
  const goBtn = app.querySelector("#btn-go");
  const hint = app.querySelector("#setup-hint");
  const lieButtons = app.querySelectorAll("[data-lie]");

  unbindCharCounters();
  const unsubs = inputs.map((input, i) =>
    bindCharCounter(input, app.querySelector(`#stmt-${i}-count`))
  );
  unbindCharCounters = () => unsubs.forEach((u) => u());

  function updateLieButtons() {
    lieButtons.forEach((btn) => {
      const i = Number(btn.getAttribute("data-lie"));
      const active = lieIndex === i;
      btn.classList.toggle("lie-pick--active", active);
      btn.setAttribute("aria-pressed", active ? "true" : "false");
    });
  }

  function validate() {
    const filled = inputs.every((el) => el?.value.trim());
    const ok = filled && lieIndex !== null;
    goBtn.disabled = !ok;

    if (!filled) {
      hint.textContent = "Remplis les 3 affirmations pour continuer.";
    } else if (lieIndex === null) {
      hint.textContent = "Indique laquelle est le mensonge (A, B ou C).";
    } else {
      hint.textContent = "Tout est prêt - envoie au lobby !";
    }
  }

  lieButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      lieIndex = Number(btn.getAttribute("data-lie"));
      updateLieButtons();
      validate();
    });
  });

  inputs.forEach((el) =>
    el?.addEventListener("input", () => {
      app.querySelector("#guesslie-error")?.classList.add("hidden");
      validate();
    })
  );

  goBtn.addEventListener("click", async () => {
    const statements = inputs.map((el) => el.value.trim());
    if (statements.some((s) => !s) || lieIndex === null) return;
    if (statements.some((s) => isPlayerTextTooLong(s))) {
      const errEl = app.querySelector("#guesslie-error");
      if (errEl) {
        errEl.textContent = playerTextMaxError();
        errEl.classList.remove("hidden");
      }
      return;
    }
    const blocked = statements.map((s) => checkHotTakeModeration(s)).find((m) => m.blocked);
    if (blocked) {
      const errEl = app.querySelector("#guesslie-error");
      if (errEl) {
        errEl.textContent = blocked.message;
        errEl.classList.remove("hidden");
      }
      return;
    }
    goBtn.disabled = true;
    try {
      await setLocalGuessLieSubmission(statements, lieIndex);
      navigate("guesslie-wait", { reset: true });
    } finally {
      if (goBtn.isConnected) goBtn.disabled = false;
    }
  });

  bindNav(app);

  validate();
  return () => unbindCharCounters();
}
