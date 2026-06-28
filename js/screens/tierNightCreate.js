import { addCustomTierList } from "../core/state.js";
import { navigate } from "../core/router.js";
import { escapeHtml, pageShell } from "../core/ui.js";
import { checkHotTakeModeration, getModerationNotice } from "../core/hotTakeSession.js";
import { bindNav } from "./nav.js";

export function mountTierNightCreate(app) {
  app.innerHTML = pageShell({
    backTarget: "back",
    content: `
      <p class="label-upper label-upper--gold">🏆 Tier Night</p>
      <h2 class="screen-title">Créer ma tier list</h2>
      <p class="game-intro">Donne un nom et liste les items (un par ligne, 4 minimum).</p>

      <div class="card">
        <label class="field-label" for="tier-name">Nom de la tier list</label>
        <input type="text" class="field-input" id="tier-name" maxlength="40" placeholder="Ex : Meilleurs desserts" />

        <label class="field-label" for="tier-emoji">Emoji (optionnel)</label>
        <input type="text" class="field-input field-input--emoji" id="tier-emoji" maxlength="4" placeholder="🍰" />

        <label class="field-label" for="tier-items">Items à classer</label>
        <textarea class="field-textarea" id="tier-items" rows="8" placeholder="Ex :&#10;Tiramisu&#10;Brownie&#10;Crêpe&#10;Mochi"></textarea>
      </div>

      <p class="hint" id="create-hint">Minimum 4 items, un par ligne.</p>

      <p class="moderation-notice">${getModerationNotice()}</p>
      <p class="auth-error hidden" id="tier-error"></p>

      <button type="button" class="btn btn-primary btn--spaced" id="btn-create" disabled>
        Créer et jouer →
      </button>
    `,
  });

  const nameEl = app.querySelector("#tier-name");
  const emojiEl = app.querySelector("#tier-emoji");
  const itemsEl = app.querySelector("#tier-items");
  const createBtn = app.querySelector("#btn-create");
  const hint = app.querySelector("#create-hint");

  function parseItems() {
    return itemsEl.value
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function validate() {
    const name = nameEl.value.trim();
    const items = parseItems();
    const ok = name.length >= 2 && items.length >= 4;
    createBtn.disabled = !ok;
    if (!name) hint.textContent = "Donne un nom à ta tier list.";
    else if (items.length < 4) hint.textContent = `${items.length}/4 items - ajoute-en encore.`;
    else hint.textContent = `${items.length} items - prêt à créer !`;
  }

  [nameEl, emojiEl, itemsEl].forEach((el) =>
    el?.addEventListener("input", () => {
      app.querySelector("#tier-error")?.classList.add("hidden");
      validate();
    })
  );

  createBtn.addEventListener("click", () => {
    const name = nameEl.value.trim();
    const items = parseItems();
    const emoji = emojiEl.value.trim() || "✨";
    if (!name || items.length < 4) return;
    const blocked = [name, ...items].map((s) => checkHotTakeModeration(s)).find((m) => m.blocked);
    if (blocked) {
      const errEl = app.querySelector("#tier-error");
      if (errEl) {
        errEl.textContent = blocked.message;
        errEl.classList.remove("hidden");
      }
      return;
    }
    addCustomTierList({ name, items, emoji });
    navigate("tiernight");
  });

  bindNav(app);
  validate();
  return null;
}
