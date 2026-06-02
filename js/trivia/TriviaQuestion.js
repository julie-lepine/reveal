import { escapeHtml } from "../core/ui.js";

export function renderTriviaQuestion({
  question,
  questionIdx = 0,
  totalQuestions = 0,
  selectedAnswer = null,
  locked = false,
  waitingMessage = "",
  revealed = false,
  correctIndex = null,
} = {}) {
  if (!question) {
    return `<p class="hint">Aucune question disponible.</p>`;
  }

  const showResults = revealed && Number.isInteger(correctIndex);

  return `
    <div class="card card--speed trivia-question-card">
      <p class="label-upper label-upper--gold">🧠 Question ${questionIdx + 1} / ${totalQuestions}</p>
      <p class="trivia-question-card__theme">${escapeHtml(question.themeLabel || "")}</p>
      <p class="hot-take-text">${escapeHtml(question.question)}</p>
    </div>
    <div class="trivia-answer-grid">
      ${(question.answers || [])
        .map((answer, idx) => {
          const isSelected = selectedAnswer === idx;
          const isCorrect = showResults && idx === correctIndex;
          const isWrongPick = showResults && isSelected && idx !== correctIndex;
          const active = !showResults && isSelected;
          let stateClass = "";
          if (isCorrect) stateClass = "trivia-answer-btn--correct";
          else if (isWrongPick) stateClass = "trivia-answer-btn--wrong";
          else if (active) stateClass = "trivia-answer-btn--active";

          let suffix = "";
          if (isCorrect) suffix = '<span class="trivia-answer-btn__mark trivia-answer-btn__mark--ok">✓</span>';
          else if (isWrongPick) suffix = '<span class="trivia-answer-btn__mark trivia-answer-btn__mark--ko">✗</span>';
          else if (active) suffix = '<span class="trivia-answer-btn__check">✓</span>';

          return `
            <button
              type="button"
              class="trivia-answer-btn ${stateClass}"
              data-trivia-answer="${idx}"
              ${locked || showResults ? "disabled" : ""}
            >
              <span class="trivia-answer-btn__letter">${String.fromCharCode(65 + idx)}</span>
              <span class="trivia-answer-btn__text">${escapeHtml(answer)}</span>
              ${suffix}
            </button>`;
        })
        .join("")}
    </div>
    ${waitingMessage ? `<p class="hint trivia-question-card__wait">${escapeHtml(waitingMessage)}</p>` : ""}`;
}
