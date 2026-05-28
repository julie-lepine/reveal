import { escapeHtml } from "../core/ui.js";

function formatScore(value) {
  const rounded = Math.round((Number(value) || 0) * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function playerMetaMap(players = []) {
  return Object.fromEntries(
    players.map((player) => [
      player.name,
      {
        color: player.color || "#A78BFA",
        emoji: player.emoji || "🎭",
      },
    ])
  );
}

function bonusTags(name, lastRound, answerValue) {
  const tags = [];
  const anchorTag = (lastRound.anchorLabel || "Cible").toLowerCase();
  if ((lastRound.closestPlayers || []).includes(name)) tags.push(`🏆 ${anchorTag}`);
  if ((lastRound.precisionPlayers || []).includes(name)) tags.push("🎯 précision");
  if ((lastRound.intuitionPlayers || []).includes(name)) {
    tags.push(lastRound.modeId === "extremes" ? "🧠 bon côté" : "🧠 médiane");
  }
  if ((lastRound.consensusPlayers || []).includes(name)) tags.push("🤝 mode");
  if ((lastRound.modes || []).includes(answerValue)) {
    // Déjà compté ci-dessus, mais garde un fallback si la liste des joueurs n'est pas disponible.
  }
  return tags;
}

export function renderConsensusResults({
  question,
  answers = {},
  lastRound,
  players = [],
} = {}) {
  if (!question || !lastRound) {
    return `<p class="hint">Résultats indisponibles.</p>`;
  }

  const playerMap = playerMetaMap(players);

  const rows = Object.entries(answers)
    .filter(([, answer]) => Number.isFinite(answer?.value))
    .map(([name, answer]) => {
      const delta = lastRound.deltas?.[name] || 0;
      const distance = Math.abs((answer.value || 0) - (lastRound.anchor || lastRound.mean || 0));
      const tags = bonusTags(name, lastRound, answer.value);
      return {
        name,
        value: answer.value,
        delta,
        distance,
        tags,
        color: playerMap[name]?.color || "#A78BFA",
        emoji: playerMap[name]?.emoji || "🎭",
      };
    })
    .sort((a, b) => b.delta - a.delta || a.distance - b.distance || a.name.localeCompare(b.name));

  const spread =
    rows.length > 1 ? Math.max(...rows.map((row) => row.value)) - Math.min(...rows.map((row) => row.value)) : 0;
  const consensusMood =
    spread <= 18 ? "Très groupé" : spread <= 36 ? "Assez aligné" : spread <= 55 ? "Partagé" : "Éparpillé";
  const sortedByValue = [...rows].sort((a, b) => a.value - b.value || a.name.localeCompare(b.name));
  const modeLabel = lastRound.modes?.length
    ? lastRound.modes.map((value) => formatScore(value)).join(" · ")
    : "Aucun";
  const closestLabel = (lastRound.closestPlayers || []).length
    ? lastRound.closestPlayers.map((name) => escapeHtml(name)).join(", ")
    : "-";
  const precisionLabel = (lastRound.precisionPlayers || []).length
    ? lastRound.precisionPlayers.map((name) => escapeHtml(name)).join(", ")
    : "-";
  const heroLabel = lastRound.anchorLabel || "Point d'équilibre du groupe";
  const heroValue = formatScore(lastRound.anchor || lastRound.mean);
  const showMeanPill = (lastRound.anchorLabel || "").toLowerCase() !== "moyenne";
  const closestTitle =
    lastRound.modeId === "extremes"
      ? `Plus proche du ${heroLabel.toLowerCase()}`
      : "Plus proche de la moyenne";

  return `
    <div class="card consensus-reveal-card consensus-reveal-card--question">
      <p class="label-upper label-upper--gold">🤝 Reveal collectif</p>
      ${
        question.modeObjectiveTitle
          ? `<p class="hint"><strong>${escapeHtml(question.modeObjectiveTitle)}</strong> · ${escapeHtml(
              question.modeObjective || ""
            )}</p>`
          : ""
      }
      <p class="hot-take-text">${escapeHtml(question.question)}</p>
    </div>

    <div class="card consensus-stage">
      <div class="consensus-stage__hero">
        <p class="card-heading">${escapeHtml(heroLabel)}</p>
        <p class="consensus-stage__hero-value">${heroValue}</p>
        <p class="consensus-stage__hero-sub">${escapeHtml(consensusMood)} · écart global ${formatScore(spread)}</p>
      </div>

      <div class="consensus-stage__track-wrap">
        <div class="consensus-stage__track">
          <span class="consensus-stage__band" style="left:${Math.max(
            0,
            (lastRound.anchor || lastRound.mean) - 3
          )}%;width:${Math.min(
            100 - Math.max(0, (lastRound.anchor || lastRound.mean) - 3),
            6
          )}%"></span>
          <span class="consensus-stage__guide consensus-stage__guide--mean" style="left:${lastRound.anchor || lastRound.mean}%">
            <span class="consensus-stage__guide-label">${escapeHtml(
              lastRound.modeId === "extremes" ? "C" : "M"
            )}</span>
          </span>
          <span class="consensus-stage__guide consensus-stage__guide--median" style="left:${lastRound.median}%">
            <span class="consensus-stage__guide-label">Md</span>
          </span>
          ${(lastRound.modes || [])
            .map(
              (value) => `
            <span class="consensus-stage__guide consensus-stage__guide--mode" style="left:${value}%">
              <span class="consensus-stage__guide-label">Mo</span>
            </span>`
            )
            .join("")}
          ${sortedByValue
            .map(
              (row, index) => `
            <span
              class="consensus-stage__marker"
              style="left:${row.value}%;--marker-color:${row.color};--lane:${index % 3};--delay:${120 + index * 45}ms"
              title="${escapeHtml(row.name)} · ${formatScore(row.value)}"
            >
              <span class="consensus-stage__marker-core">${row.emoji}</span>
            </span>`
            )
            .join("")}
        </div>
        <div class="consensus-stage__scale">
          <span>0</span>
          <span>25</span>
          <span>50</span>
          <span>75</span>
          <span>100</span>
        </div>
      </div>

      <div class="consensus-stage__legend">
        ${
          showMeanPill
            ? `<span class="consensus-stage__pill consensus-stage__pill--mean">Moyenne ${formatScore(
                lastRound.mean
              )}</span>`
            : ""
        }
        <span class="consensus-stage__pill consensus-stage__pill--median">Médiane ${formatScore(lastRound.median)}</span>
        <span class="consensus-stage__pill consensus-stage__pill--mode">Mode ${modeLabel}</span>
      </div>
    </div>

    <div class="card consensus-highlights">
      <p class="card-heading">Temps forts</p>
      <div class="consensus-highlights__grid">
        <div class="consensus-highlights__item">
          <span class="consensus-highlights__label">${escapeHtml(closestTitle)}</span>
          <strong class="consensus-highlights__value">${closestLabel}</strong>
        </div>
        <div class="consensus-highlights__item">
          <span class="consensus-highlights__label">Bonus précision</span>
          <strong class="consensus-highlights__value">${precisionLabel}</strong>
        </div>
      </div>
    </div>

    <div class="card consensus-answer-list">
      <p class="card-heading">Scores de la manche</p>
      ${rows
        .map(
          (row, index) => `
        <div class="consensus-answer-list__row" style="--delay:${120 + index * 55}ms">
          <div class="consensus-answer-list__head">
            <span class="consensus-answer-list__name">${escapeHtml(row.name)}</span>
            <span class="consensus-answer-list__delta">+${formatScore(row.delta)}</span>
          </div>
          <div class="consensus-answer-list__meta">
            <span>${formatScore(row.value)} / 100</span>
            <span>écart ${formatScore(row.distance)}</span>
          </div>
          ${
            row.tags.length
              ? `<div class="consensus-answer-list__tags">
                  ${row.tags
                    .map((tag) => `<span class="consensus-answer-list__tag">${escapeHtml(tag)}</span>`)
                    .join("")}
                </div>`
              : ""
          }
        </div>`
        )
        .join("")}
    </div>`;
}
