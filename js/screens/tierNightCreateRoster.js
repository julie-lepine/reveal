import { addCustomRosterTopic } from "../core/state.js";
import { navigate } from "../core/router.js";
import { isGameSyncActive, isLobbyHost } from "../core/gameSync.js";
import { pageShell } from "../core/ui.js";
import { checkHotTakeModeration, getModerationNotice } from "../core/hotTakeSession.js";
import { showAppAlert } from "../core/dialog.js";
import {
  ROSTER_TOPIC_NAME_MAX,
  ROSTER_TOPIC_NAME_MIN,
} from "../core/customRosterTopics.js";
import { bindNav } from "./nav.js";

export function mountTierNightCreateRoster(app) {
  app.innerHTML = pageShell({
    backTarget: "back",
    content: `
      <p class="label-upper label-upper--gold">👥 Classe le groupe</p>
      <h2 class="screen-title">Créer mon thème</h2>
      <p class="game-intro">Formule une question pour classer les joueurs du lobby sur le plateau S/A/B/C/D. Les joueurs seront les items à classer.</p>

      <div class="card">
        <label class="field-label" for="roster-topic-name">Question ou thème</label>
        <input type="text" class="field-input" id="roster-topic-name" maxlength="${ROSTER_TOPIC_NAME_MAX}" placeholder="Ex : Qui survivrait le plus longtemps sur une île ?" />
      </div>

      <p class="hint" id="create-hint">Minimum ${ROSTER_TOPIC_NAME_MIN} caractères.</p>

      <p class="moderation-notice">${getModerationNotice()}</p>
      <p class="auth-error hidden" id="roster-topic-error"></p>

      <button type="button" class="btn btn-primary btn--spaced" id="btn-create-roster" disabled>
        Enregistrer le thème →
      </button>
    `,
  });

  const nameEl = app.querySelector("#roster-topic-name");
  const createBtn = app.querySelector("#btn-create-roster");
  const hint = app.querySelector("#create-hint");

  function validate() {
    const name = nameEl.value.trim();
    const ok = name.length >= ROSTER_TOPIC_NAME_MIN;
    createBtn.disabled = !ok;
    if (!name) hint.textContent = "Donne un nom à ton thème.";
    else if (name.length < ROSTER_TOPIC_NAME_MIN) {
      hint.textContent = `${name.length}/${ROSTER_TOPIC_NAME_MIN} caractères minimum.`;
    } else hint.textContent = "Prêt à enregistrer !";
  }

  nameEl?.addEventListener("input", () => {
    app.querySelector("#roster-topic-error")?.classList.add("hidden");
    validate();
  });

  createBtn.addEventListener("click", () => {
    void (async () => {
      const name = nameEl.value.trim();
      if (name.length < ROSTER_TOPIC_NAME_MIN) return;

      const blocked = checkHotTakeModeration(name);
      if (blocked.blocked) {
        const errEl = app.querySelector("#roster-topic-error");
        if (errEl) {
          errEl.textContent = blocked.message;
          errEl.classList.remove("hidden");
        }
        return;
      }

      if (isGameSyncActive() && !isLobbyHost()) {
        await showAppAlert("Seul l'hôte peut créer un thème pour le lobby.", {
          title: "Action réservée",
          icon: "👑",
        });
        return;
      }

      const result = addCustomRosterTopic({ name });
      if (!result.ok) {
        const errEl = app.querySelector("#roster-topic-error");
        if (errEl) {
          errEl.textContent = result.error || "Thème invalide.";
          errEl.classList.remove("hidden");
        }
        return;
      }

      navigate("tiernight-select");
    })();
  });

  bindNav(app);
  validate();
  return null;
}
