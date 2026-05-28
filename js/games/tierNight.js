import { TIER_LEVELS, TIER_COLORS, TIER_NIGHT_TIMER_SEC } from "../../data/tierTopics.js";
import { getTierListById } from "../core/tierLists.js";
import { getTierNightTopicId, recordTierNightPlayed } from "../core/state.js";
import { buildRecapsWithSimulation } from "../core/tierNightSession.js";
import { setLobbyPlaying } from "../core/lobby.js";
import {
  isGameSyncActive,
  syncTierNightSession,
  onGameSessionChange,
  getCachedGameSession,
  advanceTierNightToResultsWhenReady,
  ensureTierNightRecapsFromRemote,
  getTierNightLobbyProgress,
  refreshGameSession,
} from "../core/gameSync.js";
import { getSupabaseUserId } from "../core/supabaseAuth.js";
import { requireLobbyPlay } from "../core/gameGuard.js";
import { navigate } from "../core/router.js";
import { escapeHtml, pageShell, tierLogoHtml, bindTierLogos } from "../core/ui.js";
import { gameExitBarHtml, bindExitGame } from "../core/exitGame.js";
import { bindNav } from "../screens/nav.js";
import { onTimerSecond, primeTimerSound } from "../core/timerSound.js";
import { isEveningGameplayPaused } from "../core/filRougeSession.js";

export function mountTierNight(app) {
  if (!requireLobbyPlay()) return null;

  const topicId = getTierNightTopicId();
  if (!topicId) {
    navigate("tiernight-select");
    return null;
  }

  const list = getTierListById(topicId);
  if (!list) {
    navigate("tiernight-select");
    return null;
  }

  let placed = {};
  TIER_LEVELS.forEach((t) => {
    placed[t] = [];
  });
  let dragItem = null;
  let timerSec = TIER_NIGHT_TIMER_SEC;
  let intervalId = null;
  let finished = false;

  function clearTimer() {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
  }

  function unplaced() {
    const allPlaced = Object.values(placed).flat();
    return list.items.filter((item) => !allPlaced.includes(item));
  }

  function placeItem(item, tier) {
    const next = { ...placed };
    Object.keys(next).forEach((t) => {
      next[t] = (next[t] || []).filter((x) => x !== item);
    });
    next[tier] = [...(next[tier] || []), item];
    placed = next;
    render();
    if (unplaced().length === 0) void finishGame();
  }

  async function finishGame() {
    if (finished) return;
    finished = true;
    clearTimer();
    setLobbyPlaying("tiernight");

    if (isGameSyncActive()) {
      const uid = getSupabaseUserId();
      const row = getCachedGameSession();
      const tn = row?.state?.tierNight || {};
      const placements = { ...(tn.placements || {}), [uid]: placed };
      const done = { ...(tn.finished || {}), [uid]: true };
      await syncTierNightSession({
        topicId: list.id,
        placements,
        finished: done,
      });

      render();
      await advanceTierNightToResultsWhenReady(list);
      return;
    }

    buildRecapsWithSimulation(list.id, list.name, list.items, placed);
    recordTierNightPlayed();
    navigate("tiernight-end");
  }

  function formatTime(sec) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  function timerRingHtml() {
    const pct = timerSec / TIER_NIGHT_TIMER_SEC;
    const r = 32;
    const c = 2 * Math.PI * r;
    const urgent = timerSec <= 20;
    return `
      <div class="tier-timer-wrap" id="tier-timer">
        <svg width="80" height="80" viewBox="0 0 80 80" aria-hidden="true">
          <circle cx="40" cy="40" r="${r}" fill="none" stroke="rgba(255,255,255,.1)" stroke-width="5"/>
          <circle class="tier-timer-arc" cx="40" cy="40" r="${r}" fill="none" stroke="${urgent ? "#F87171" : "#FBBF24"}" stroke-width="5"
            stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - pct)}" transform="rotate(-90 40 40)"/>
          <text class="tier-timer-text" x="40" y="46" text-anchor="middle" fill="#fff" font-size="18" font-weight="800">${formatTime(timerSec)}</text>
        </svg>
        <span class="tier-timer-label">1 min 30 pour classer</span>
      </div>`;
  }

  function lobbyWaitHtml() {
    const progress = getTierNightLobbyProgress();
    const doneCount = progress.filter((p) => p.done).length;
    const total = progress.length;
    return `
      <div class="card tier-lobby-wait">
        <p class="card-heading">En attente du lobby</p>
        <p class="hint">Les résultats s’affichent quand tout le monde a terminé son classement.</p>
        <p class="hint tier-lobby-wait__count">${doneCount} / ${total} joueur(s) ont terminé</p>
        <div class="lobby-ready-list">
          ${progress
            .map(
              (p) => `
            <div class="lobby-player ${p.done ? "lobby-player--ready" : ""}">
              <span class="recap-card__avatar" style="background:${p.color}">${p.emoji}</span>
              <span class="lobby-player__name">${escapeHtml(p.name)}</span>
              <span class="tier-lobby-wait__status">${p.done ? "Terminé ✓" : "En cours…"}</span>
            </div>`
            )
            .join("")}
        </div>
      </div>`;
  }

  function render() {
    const remaining = unplaced();
    const waitingLobby = finished && isGameSyncActive();

    app.innerHTML = pageShell({
      backTarget: "back",
      scroll: true,
      content: `
        <p class="label-upper label-upper--gold">🏆 Tier Night</p>
        <div class="tier-game-header">
          <div class="tier-game-header__logo tier-logo-wrap--card">${tierLogoHtml(list, "tier-list-logo tier-list-logo--fill")}</div>
          <h1 class="tier-game-header__title">${escapeHtml(list.name)}</h1>
        </div>

        ${waitingLobby ? "" : timerRingHtml()}

        <div class="tier-board">
          ${TIER_LEVELS.map(
            (tier) => `
            <div class="tier-row" data-tier="${tier}">
              <span class="tier-label" style="--tier-color:${TIER_COLORS[tier]}">${tier}</span>
              <div class="tier-items">
                ${(placed[tier] || [])
                  .map(
                    (item) => `
                  <span class="tier-chip" style="--tier-color:${TIER_COLORS[tier]}">${escapeHtml(item)}</span>`
                  )
                  .join("")}
              </div>
            </div>`
          ).join("")}
        </div>

        ${waitingLobby ? lobbyWaitHtml() : ""}

        ${
          waitingLobby
            ? ""
            : remaining.length > 0
              ? `
          <p class="hint">${remaining.length} item(s) restant(s)</p>
          <div class="unplaced">
            ${remaining
              .map(
                (item) => `
              <span class="unplaced-chip" draggable="true" data-item="${escapeHtml(item)}">${escapeHtml(item)}</span>`
              )
              .join("")}
          </div>
          <div class="quick-place">
            <p class="quick-place__item">« ${escapeHtml(remaining[0])} » →</p>
            <div class="quick-place__btns">
              ${TIER_LEVELS.map(
                (t) => `
                <button type="button" class="quick-tier-btn" data-quick-tier="${t}"
                  style="--tier-color:${TIER_COLORS[t]}">${t}</button>`
              ).join("")}
            </div>
          </div>
          <button type="button" class="btn btn-secondary btn--spaced" id="btn-finish-early">Terminer maintenant</button>`
              : `<p class="hint tier-done-hint">Tous les items sont classés.</p>`
        }
        ${gameExitBarHtml()}
      `,
    });

    bindTierLogos(app);
    bindNav(app);
    bindExitGame(app);
    if (!finished) bindGameEvents(remaining);
    else if (remaining.length > 0) {
      requestAnimationFrame(() => {
        app.querySelector(".quick-place")?.scrollIntoView({ behavior: "smooth", block: "end" });
      });
    }
  }

  function bindGameEvents(remaining) {
    app.querySelectorAll(".unplaced-chip").forEach((chip) => {
      chip.addEventListener("dragstart", () => {
        dragItem = chip.getAttribute("data-item");
      });
    });

    app.querySelectorAll(".tier-row").forEach((row) => {
      row.addEventListener("dragover", (e) => e.preventDefault());
      row.addEventListener("drop", () => {
        if (dragItem) placeItem(dragItem, row.getAttribute("data-tier"));
        dragItem = null;
      });
    });

    app.querySelectorAll("[data-quick-tier]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const item = remaining[0];
        if (item) placeItem(item, btn.getAttribute("data-quick-tier"));
      });
    });

    app.querySelector("#btn-finish-early")?.addEventListener("click", finishGame);
  }

  function updateTimerUi() {
    const text = app.querySelector(".tier-timer-text");
    const arc = app.querySelector(".tier-timer-arc");
    if (text) text.textContent = formatTime(timerSec);
    if (arc) {
      const r = 32;
      const c = 2 * Math.PI * r;
      const pct = timerSec / TIER_NIGHT_TIMER_SEC;
      arc.setAttribute("stroke-dashoffset", String(c * (1 - pct)));
      arc.setAttribute("stroke", timerSec <= 20 ? "#F87171" : "#FBBF24");
    }
  }

  function startTimer() {
    clearTimer();
    primeTimerSound();
    intervalId = setInterval(() => {
      if (isEveningGameplayPaused()) return;
      timerSec -= 1;
      onTimerSecond({ remaining: timerSec, urgentAt: 20 });
      if (timerSec <= 0) {
        finishGame();
        return;
      }
      updateTimerUi();
    }, 1000);
  }

  const unsub = onGameSessionChange(async () => {
    const row = getCachedGameSession();
    if (row?.screen === "tiernight-end") {
      await refreshGameSession();
      await ensureTierNightRecapsFromRemote(list);
      navigate("tiernight-end");
      return;
    }
    if (finished && isGameSyncActive()) {
      render();
      await advanceTierNightToResultsWhenReady(list);
    }
  });

  render();
  startTimer();

  return () => {
    clearTimer();
    unsub();
  };
}


