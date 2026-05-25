import { escapeHtml } from "../core/ui.js";

export function renderTriviaQuestion({
  question,
  questionIdx = 0,
  totalQuestions = 0,
  selectedAnswer = null,
  locked = false,
  waitingMessage = "",
} = {}) {
  if (!question) {
    return `<p class="hint">Aucune question disponible.</p>`;
  }

  return `
    <div class="card card--speed trivia-question-card">
      <p class="label-upper label-upper--gold">🧠 Question ${questionIdx + 1} / ${totalQuestions}</p>
      <p class="trivia-question-card__theme">${escapeHtml(question.themeLabel || "")}</p>
      <p class="hot-take-text">${escapeHtml(question.question)}</p>
    </div>
    <div class="trivia-answer-grid">
      ${(question.answers || [])
        .map((answer, idx) => {
          const active = selectedAnswer === idx;
          return `
            <button
              type="button"
              class="trivia-answer-btn ${active ? "trivia-answer-btn--active" : ""}"
              data-trivia-answer="${idx}"
              ${locked ? "disabled" : ""}
            >
              <span class="trivia-answer-btn__letter">${String.fromCharCode(65 + idx)}</span>
              <span class="trivia-answer-btn__text">${escapeHtml(answer)}</span>
              ${active ? '<span class="trivia-answer-btn__check">✓</span>' : ""}
            </button>`;
        })
        .join("")}
    </div>
    <p class="hint trivia-question-card__wait">${escapeHtml(waitingMessage)}</p>`;
}
