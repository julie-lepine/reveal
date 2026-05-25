import { escapeHtml } from "../core/ui.js";

export function renderConsensusQuestion({
  question,
  questionIdx = 0,
  totalQuestions = 0,
  value = 50,
  timer = 15,
  totalTime = 15,
  answerState = "draft",
  waitingMessage = "",
} = {}) {
  if (!question) {
    return `<p class="hint">Aucune question disponible.</p>`;
  }

  const clamped = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
  const submittedLabel =
    answerState === "submitted" ? "" : "Déplace le slider puis valide quand tu veux.";

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

    <p class="timer consensus-timer" id="consensus-timer-el">${timer}</p>
    <div class="progress progress--timer">
      <div class="progress-fill" id="consensus-progress-el" style="width:${(timer / totalTime) * 100}%"></div>
    </div>

    <div class="truth-meter__slider-wrap consensus-slider">
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

    <button type="button" class="btn btn-primary btn--spaced" id="btn-consensus-submit">
      ${answerState === "submitted" ? "Mettre à jour ma réponse" : "Valider ma réponse"}
    </button>`;
}
