import { setLocalGuessLieSubmission } from "../core/state.js";
import { navigate } from "../core/router.js";
import { logoHtml, pageShell } from "../core/ui.js";
import { bindNav } from "./nav.js";

export function mountGuessLieSetup(app) {
  let lieIndex = null;

  app.innerHTML = pageShell({
    backTarget: "back",
    content: `
      <div class="logo logo--with-img">
        ${logoHtml({ className: "app-logo app-logo--sm" })}
      </div>
      <p class="label-upper label-upper--green">🕵️ Guess The Lie</p>
      <h2 class="screen-title">Prépare tes 3 affirmations</h2>
      <p class="game-intro">
        Écris <strong>2 vérités</strong> et <strong>1 mensonge</strong> sur toi, puis choisis la lettre du mensonge.
      </p>

      <div class="card">
        <label class="field-label" for="stmt-0">Affirmation A</label>
        <input type="text" class="field-input" id="stmt-0" maxlength="120" placeholder="Ex : J'ai vécu en Italie…" />

        <label class="field-label" for="stmt-1">Affirmation B</label>
        <input type="text" class="field-input" id="stmt-1" maxlength="120" placeholder="Ex : Je déteste le café…" />

        <label class="field-label" for="stmt-2">Affirmation C</label>
        <input type="text" class="field-input" id="stmt-2" maxlength="120" placeholder="Ex : J'ai un tatouage…" />
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

      <button type="button" class="btn btn-primary btn--spaced" id="btn-go" disabled>
        GO — envoyer au lobby
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
      hint.textContent = "Tout est prêt — envoie au lobby !";
    }
  }

  lieButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      lieIndex = Number(btn.getAttribute("data-lie"));
      updateLieButtons();
      validate();
    });
  });

  inputs.forEach((el) => el?.addEventListener("input", validate));

  goBtn.addEventListener("click", async () => {
    const statements = inputs.map((el) => el.value.trim());
    if (statements.some((s) => !s) || lieIndex === null) return;
    await setLocalGuessLieSubmission(statements, lieIndex);
    navigate("guesslie-wait", { reset: true });
  });

  bindNav(app);

  validate();
  return null;
}
