export function renderTriviaTimer({
  timer = 0,
  total = 15,
  label = "Temps restant",
  modifierClass = "timer--speed",
} = {}) {
  const width = total > 0 ? Math.max(0, Math.min(100, (timer / total) * 100)) : 0;
  return `
    <div class="trivia-timer-wrap">
      <p class="label-upper label-upper--muted">${label}</p>
      <div class="timer ${modifierClass}" id="trivia-timer-el">${timer}</div>
      <div class="progress progress--timer">
        <div class="progress-fill" id="trivia-progress-el" style="width:${width}%"></div>
      </div>
    </div>`;
}
