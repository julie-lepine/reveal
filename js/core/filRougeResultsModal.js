import { escapeHtml } from "./ui.js";
import { isLobbyHost } from "./gameSync.js";
/** MOT INTERDIT (Fil Rouge) - modal résultats ; voir data/filRouge.js */
import { hostResumeAfterFilRougeResults } from "./filRougeSession.js";
import { FIL_ROUGE_ENABLED, FIL_ROUGE_POINTS_MISSION } from "../../data/filRouge.js";
import { getCurrentScreen } from "./router.js";

let openModal = null;
let lastOpenToken = "";

function removeModal(root) {
  root.classList.remove("fil-rouge-modal--in");
  root.classList.add("fil-rouge-modal--out");
  const done = () => {
    root.remove();
    if (openModal === root) openModal = null;
  };
  root.addEventListener("transitionend", done, { once: true });
  setTimeout(done, 280);
}

function resultsBodyHtml(snapshot) {
  if (!snapshot) {
    return `<p class="hint">Aucune statistique disponible.</p>`;
  }

  const validatedList = (snapshot.validated || [])
    .map((p) => `<li>${escapeHtml(p.name)} ✓</li>`)
    .join("");
  const inProgressList = (snapshot.inProgress || [])
    .map((p) => `<li>${escapeHtml(p.name)} …</li>`)
    .join("");
  const pendingList = (snapshot.pending || [])
    .map((p) => `<li>${escapeHtml(p.name)} ⏳</li>`)
    .join("");

  const a = snapshot.analytics || {};

  return `
    <div class="fil-rouge-modal__section">
      <h3 class="fil-rouge-modal__subtitle">Missions validées</h3>
      <ul class="fil-rouge-modal__list">${validatedList || "<li class='muted'>Aucune</li>"}</ul>
    </div>
    ${
      inProgressList
        ? `<div class="fil-rouge-modal__section">
      <h3 class="fil-rouge-modal__subtitle">Non accomplies</h3>
      <ul class="fil-rouge-modal__list">${inProgressList}</ul>
    </div>`
        : ""
    }
    ${
      pendingList
        ? `<div class="fil-rouge-modal__section">
      <h3 class="fil-rouge-modal__subtitle">En attente de validation</h3>
      <ul class="fil-rouge-modal__list">${pendingList}</ul>
    </div>`
        : ""
    }
    <div class="fil-rouge-modal__analytics card">
      <p><strong>Meilleur manipulateur :</strong> ${escapeHtml(a.bestManipulator || "-")}</p>
      <p><strong>Validation la plus rapide :</strong> ${
        a.fastestValidationSec != null
          ? `${escapeHtml(a.fastestPlayer || "-")} (${a.fastestValidationSec}s)`
          : "-"
      }</p>
      <p class="muted">${a.totalValidated || 0} / ${a.totalPlayers || 0} missions validées · +${FIL_ROUGE_POINTS_MISSION} pts chacune</p>
    </div>`;
}

export function showFilRougeResultsModal(snapshot, { readOnly = false } = {}) {
  if (!FIL_ROUGE_ENABLED) return;
  const token = JSON.stringify(snapshot?.closedAt || snapshot);
  if (openModal && lastOpenToken === token) return;

  if (openModal) {
    removeModal(openModal);
    openModal = null;
  }

  lastOpenToken = token;
  const host = isLobbyHost() && !readOnly;

  const root = document.createElement("div");
  root.className = "fil-rouge-modal";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");

  root.innerHTML = `
    <div class="fil-rouge-modal__backdrop" aria-hidden="true"></div>
    <div class="fil-rouge-modal__panel app-dialog__panel--fil-rouge">
      <p class="fil-rouge-modal__icon" aria-hidden="true">🤫</p>
      <h2 class="fil-rouge-modal__title">Fil Rouge - Mot Interdit</h2>
      <div class="fil-rouge-modal__scroll">${resultsBodyHtml(snapshot)}</div>
      ${
        host
          ? `<button type="button" class="btn btn-primary btn--spaced" id="fil-rouge-resume">Reprendre la soirée</button>`
          : `<p class="hint fil-rouge-modal__wait">En attente de l'hôte pour reprendre…</p>`
      }
      <button type="button" class="btn btn-secondary btn--spaced" id="fil-rouge-modal-close">Fermer</button>
    </div>
  `;

  document.body.appendChild(root);
  openModal = root;
  requestAnimationFrame(() => root.classList.add("fil-rouge-modal--in"));

  root.querySelector("#fil-rouge-resume")?.addEventListener("click", async () => {
    await hostResumeAfterFilRougeResults();
  });
  root.querySelector("#fil-rouge-modal-close")?.addEventListener("click", () => {
    closeFilRougeResultsModal();
  });
  root.querySelector(".fil-rouge-modal__backdrop")?.addEventListener("click", () => {
    closeFilRougeResultsModal();
  });
}

export function closeFilRougeResultsModal() {
  if (openModal) {
    removeModal(openModal);
    lastOpenToken = "";
  }
}

export function initFilRougeResultsListener() {
  if (!FIL_ROUGE_ENABLED) return;
  import("./gameSync.js").then(({ onGameSessionChange }) => {
    onGameSessionChange(() => {
      import("./filRougeSession.js").then(({ getFilRougeSession }) => {
        const fr = getFilRougeSession();
        if (!fr.resultsModalOpen || !fr.resultsSnapshot) {
          closeFilRougeResultsModal();
          return;
        }
        /** Sur « Choisir un jeu », la box Fil Rouge suffit - pas de overlay bloquant. */
        if (getCurrentScreen() === "game-select") {
          closeFilRougeResultsModal();
          return;
        }
        showFilRougeResultsModal(fr.resultsSnapshot);
      });
    });
  });
}
