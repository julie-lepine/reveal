import {
  FIL_ROUGE_TILE,
  FIL_ROUGE_VALIDATION,
  FIL_ROUGE_STATUS,
} from "../../data/filRouge.js";
import { escapeHtml } from "./ui.js";
import {
  getFilRougeSession,
  getFilRougeStatusLabel,
  getLocalFilRougeMission,
  hostApproveFilRougeMission,
  hostRejectFilRougeMission,
  hostCloseFilRougeGame,
  requestFilRougeValidation,
} from "./filRougeSession.js";
import { isLobbyHost, nameForUserId } from "./gameSync.js";
import { getLobbyParticipants } from "./lobby.js";
import { getSupabaseUserId } from "./supabaseAuth.js";
import { userIdForName } from "./gameSync.js";
import { showAppConfirm, showAppAlert } from "./dialog.js";
import { showFilRougeResultsModal } from "./filRougeResultsModal.js";

/** Bandeau pleine largeur (état idle) — au-dessus de la grille de jeux. */
export function filRougeBannerHtml() {
  const session = getFilRougeSession();
  const status = session.status || FIL_ROUGE_STATUS.IDLE;
  if (status !== FIL_ROUGE_STATUS.IDLE) return "";

  const label = getFilRougeStatusLabel(status);

  return `
    <button type="button" class="fil-rouge-banner card" data-fil-rouge-tile>
      <div class="fil-rouge-banner__main">
        <span class="fil-rouge-banner__emoji" aria-hidden="true">${FIL_ROUGE_TILE.emoji}</span>
        <div class="fil-rouge-banner__text">
          <span class="fil-rouge-banner__title">${escapeHtml(FIL_ROUGE_TILE.title)}</span>
          <span class="fil-rouge-banner__desc">${escapeHtml(FIL_ROUGE_TILE.desc)}</span>
        </div>
      </div>
      <span class="fil-rouge-banner__badge badge">${escapeHtml(label)}</span>
    </button>`;
}

function playerStatusLine(p, validations) {
  const uid = p.userId || userIdForName(p.name) || p.name;
  const v = validations[uid];
  if (v?.status === FIL_ROUGE_VALIDATION.VALIDATED) {
    return `<span class="fil-rouge-box__player fil-rouge-box__player--done">${escapeHtml(p.name)} ✓</span>`;
  }
  if (v?.status === FIL_ROUGE_VALIDATION.PENDING) {
    return `<span class="fil-rouge-box__player fil-rouge-box__player--pending">${escapeHtml(p.name)} ⏳</span>`;
  }
  return `<span class="fil-rouge-box__player">${escapeHtml(p.name)} …</span>`;
}

export async function filRougeBoxHtml() {
  const session = getFilRougeSession();
  const status = session.status;

  if (status === FIL_ROUGE_STATUS.IDLE) return "";

  const participants = getLobbyParticipants();
  const validations = session.validations || {};
  const host = isLobbyHost();
  const label = getFilRougeStatusLabel(status);

  const validated = participants.filter((p) => {
    const uid = p.userId || userIdForName(p.name);
    return validations[uid]?.status === FIL_ROUGE_VALIDATION.VALIDATED;
  });
  const inProgress = participants.filter((p) => {
    const uid = p.userId || userIdForName(p.name);
    const st = validations[uid]?.status;
    return st !== FIL_ROUGE_VALIDATION.VALIDATED && st !== FIL_ROUGE_VALIDATION.PENDING;
  });
  const pending = participants.filter((p) => {
    const uid = p.userId || userIdForName(p.name);
    return validations[uid]?.status === FIL_ROUGE_VALIDATION.PENDING;
  });

  const mission = status === FIL_ROUGE_STATUS.ACTIVE ? await getLocalFilRougeMission() : null;

  const personalCard =
    mission && status === FIL_ROUGE_STATUS.ACTIVE
      ? `
      <div class="fil-rouge-box__personal card">
        <p class="label-upper label-upper--muted">Ta mission</p>
        <p class="fil-rouge-box__mission-line">Faire dire : <strong>« ${escapeHtml(mission.word)} »</strong></p>
        <p class="fil-rouge-box__mission-line">à <strong>${escapeHtml(mission.targetName)}</strong></p>
        <label class="fil-rouge-box__check">
          <input type="checkbox" id="fil-rouge-word-spoken" />
          Le mot a été prononcé
        </label>
        <button type="button" class="btn btn-primary btn--spaced" id="fil-rouge-validate" disabled>
          J'ai validé ma mission
        </button>
        <button type="button" class="btn-link" data-fil-rouge-mission>Voir ma mission</button>
      </div>`
      : "";

  const hostPending =
    host && pending.length
      ? `<div class="fil-rouge-box__host-pending card">
        <p class="label-upper label-upper--hot">Validations en attente</p>
        ${pending
          .map((p) => {
            const uid = p.userId || userIdForName(p.name);
            return `
            <div class="fil-rouge-box__pending-row">
              <span>${escapeHtml(p.name)}</span>
              <button type="button" class="btn btn-primary fil-rouge-box__btn-mini" data-fr-approve="${escapeHtml(uid)}">Valider +50</button>
              <button type="button" class="btn btn-secondary fil-rouge-box__btn-mini" data-fr-reject="${escapeHtml(uid)}">Rejeter</button>
            </div>`;
          })
          .join("")}
      </div>`
      : "";

  const hostClose =
    host && (status === FIL_ROUGE_STATUS.ACTIVE || status === FIL_ROUGE_STATUS.COMPLETED)
      ? `<button type="button" class="btn btn-secondary btn--spaced" id="fil-rouge-close">Clôturer le jeu</button>`
      : "";

  const ctaLabel =
    status === FIL_ROUGE_STATUS.ACTIVE ? "Voir ma mission" : "Ajouter mon mot";

  const setupCta =
    status === FIL_ROUGE_STATUS.COMPLETED
      ? ""
      : `<button type="button" class="btn btn-primary fil-rouge-box__cta" data-fil-rouge-tile>${escapeHtml(ctaLabel)}</button>`;

  return `
    <div class="fil-rouge-box card" id="fil-rouge-box">
      <header class="fil-rouge-box__head">
        <p class="label-upper fil-rouge-box__kicker">🧵 Fil Rouge</p>
        <div class="fil-rouge-box__head-row">
          <span class="fil-rouge-box__emoji" aria-hidden="true">${FIL_ROUGE_TILE.emoji}</span>
          <div class="fil-rouge-box__head-text">
            <h3 class="fil-rouge-box__name">${escapeHtml(FIL_ROUGE_TILE.title)}</h3>
            <p class="fil-rouge-box__tagline">${escapeHtml(FIL_ROUGE_TILE.desc)}</p>
          </div>
          <span class="fil-rouge-box__status-badge badge">${escapeHtml(label)}</span>
        </div>
      </header>
      ${setupCta}
      <div class="fil-rouge-box__cols">
        <div>
          <p class="fil-rouge-box__section-label">Missions validées</p>
          <div class="fil-rouge-box__players">
            ${validated.map((p) => playerStatusLine(p, validations)).join("") || '<span class="muted">—</span>'}
          </div>
        </div>
        <div>
          <p class="fil-rouge-box__section-label">Missions en cours</p>
          <div class="fil-rouge-box__players">
            ${inProgress.map((p) => playerStatusLine(p, validations)).join("") || '<span class="muted">—</span>'}
          </div>
        </div>
      </div>
      ${personalCard}
      ${hostPending}
      ${hostClose}
      ${
        status === FIL_ROUGE_STATUS.COMPLETED
          ? `<button type="button" class="btn-link" id="fil-rouge-view-results">Voir les résultats</button>`
          : ""
      }
    </div>`;
}

/** Bandeau (idle) ou box (setup/active/completed) — une seule zone au-dessus des jeux. */
export async function filRougeGameSelectSectionHtml() {
  const banner = filRougeBannerHtml();
  if (banner) return banner;
  return filRougeBoxHtml();
}

export function bindFilRougeTile(root, { onNavigate } = {}) {
  const go = (el) => {
    if (!el) return;
    el.addEventListener("click", () => {
      const session = getFilRougeSession();
      if (session.status === FIL_ROUGE_STATUS.COMPLETED) {
        if (session.resultsSnapshot) {
          showFilRougeResultsModal(session.resultsSnapshot, { readOnly: true });
        }
        return;
      }
      if (session.status === FIL_ROUGE_STATUS.ACTIVE) {
        onNavigate?.("filrouge-mission");
        return;
      }
      onNavigate?.("filrouge-setup");
    });
  };
  root.querySelectorAll("[data-fil-rouge-tile]").forEach(go);
}

export function bindFilRougeBox(root) {
  bindFilRougeTile(root, {
    onNavigate: (screen) => {
      import("../core/router.js").then(({ navigate }) => {
        navigate(screen, { navStack: ["home", "lobby", "game-select", screen] });
      });
    },
  });

  const checkbox = root.querySelector("#fil-rouge-word-spoken");
  const validateBtn = root.querySelector("#fil-rouge-validate");
  if (checkbox && validateBtn) {
    checkbox.addEventListener("change", () => {
      validateBtn.disabled = !checkbox.checked;
    });
    validateBtn.addEventListener("click", async () => {
      const ok = await showAppConfirm(
        "Confirmer que ta cible a bien prononcé le mot ?",
        { title: "Valider la mission", confirmLabel: "Confirmer", cancelLabel: "Annuler", icon: "🤫" }
      );
      if (!ok) return;
      const res = await requestFilRougeValidation();
      if (!res.ok) {
        await showAppAlert(res.error, { title: "Mission", icon: "⚠️" });
      }
    });
  }

  root.querySelector("[data-fil-rouge-mission]")?.addEventListener("click", () => {
    import("../core/router.js").then(({ navigate }) => {
      navigate("filrouge-mission", { navStack: ["home", "lobby", "game-select", "filrouge-mission"] });
    });
  });

  root.querySelectorAll("[data-fr-approve]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const uid = btn.getAttribute("data-fr-approve");
      await hostApproveFilRougeMission(uid);
    });
  });

  root.querySelectorAll("[data-fr-reject]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const uid = btn.getAttribute("data-fr-reject");
      await hostRejectFilRougeMission(uid);
    });
  });

  root.querySelector("#fil-rouge-close")?.addEventListener("click", async () => {
    const ok = await showAppConfirm(
      "Terminer le Fil Rouge et afficher les résultats à tout le monde ? La partie en cours sera mise en pause.",
      { title: "Clôturer le jeu", confirmLabel: "Clôturer", icon: "🤫" }
    );
    if (!ok) return;
    await hostCloseFilRougeGame();
  });

  root.querySelector("#fil-rouge-view-results")?.addEventListener("click", () => {
    const snap = getFilRougeSession().resultsSnapshot;
    if (snap) showFilRougeResultsModal(snap, { readOnly: true });
  });
}
