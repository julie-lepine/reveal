import { escapeHtml } from "../core/ui.js";
import { CONSENSUS_DEFAULT_SLIDER_VALUE } from "../../data/consensus.js";

function sliderDisplayValue(value) {
  if (value === null || value === undefined || value === "") {
    return CONSENSUS_DEFAULT_SLIDER_VALUE;
  }
  const num = Number(value);
  if (!Number.isFinite(num)) return CONSENSUS_DEFAULT_SLIDER_VALUE;
  return Math.max(0, Math.min(100, Math.round(num)));
}

export function renderConsensusQuestion({
  question,
  questionIdx = 0,
  totalQuestions = 0,
  value = CONSENSUS_DEFAULT_SLIDER_VALUE,
  answerState = "draft",
  answerLocked = false,
  waitingMessage = "",
} = {}) {
  if (!question) {
    return `<p class="hint">Aucune question disponible.</p>`;
  }

  const clamped = sliderDisplayValue(value);
  const locked = answerLocked || answerState === "submitted";
  const submittedLabel = locked ? "" : "Déplace le slider puis valide.";

  return `
    <div class="card consensus-question-card">
      <p class="label-upper label-upper--gold">🤝 Question ${questionIdx + 1} / ${totalQuestions}</p>
      ${
        question.modeObjective
          ? `<div class="consensus-question-card__objective">
              <p class="consensus-question-card__objective-title">${escapeHtml(
                question.modeObjectiveTitle || `Mode ${question.modeLabel || ""}`.trim()
              )}</p>
              <p class="consensus-question-card__objective-body">${escapeHtml(question.modeObjective)}</p>
            </div>`
          : ""
      }
      <p class="hot-take-text">${escapeHtml(question.question)}</p>
    </div>

    <div class="truth-meter__slider-wrap consensus-slider ${locked ? "consensus-slider--locked" : ""}">
      <p class="truth-meter__pct" id="consensus-slider-pct">${clamped}%</p>
      ${submittedLabel ? `<p class="consensus-slider__sub">${escapeHtml(submittedLabel)}</p>` : ""}
      <div class="truth-meter__range-labels">
        <span>Pas du tout</span>
        <span>Complètement</span>
      </div>
      <input
        type="range"
        class="truth-meter__range"
        id="consensus-slider"
        min="0"
        max="100"
        step="1"
        value="${clamped}"
        ${locked ? "disabled" : ""}
      />
      <div class="consensus-slider__ticks" aria-hidden="true">
        <span>0</span>
        <span>25</span>
        <span>50</span>
        <span>75</span>
        <span>100</span>
      </div>
      <p class="hint truth-meter__hint">${escapeHtml(waitingMessage)}</p>
    </div>

    ${
      locked
        ? `<p class="hint btn--spaced">Réponse enregistrée ✓</p>`
        : `<button type="button" class="btn btn-primary btn--spaced" id="btn-consensus-submit">Valider ma réponse</button>`
    }`;
}
