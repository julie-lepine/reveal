import {
  TRUTH_METER_VOTE_TIMER_SEC,
  TRUTH_METER_DISPLAY_SEC,
  TRUTH_METER_REVEAL_PENDING_MS,
  TRUTH_METER_REVEAL_HOLD_SEC,
  TRUTH_METER_INTERMISSION_SEC,
  TRUTH_METER_BLUFF_GAP,
  TRUTH_METER_CONSENSUS_GAP,
  TRUTH_METER_EXAMPLES,
} from "../../data/truthMeter.js";
import {
  getTruthMeterEntryScreen,
  getTruthMeterSession,
  getCurrentAuthor,
  getVoterNames,
  truthLabel,
  validateAffirmation,
  commitTruthMeterPlay,
  allTruthMeterVotesIn,
  simulateTruthMeterVotes,
  computeRoundMetrics,
  filterVoterVotes,
} from "../core/truthMeterSession.js";
import { awardTruthMeterRound, EVENING_POINTS } from "../core/scoring.js";
import { gameCumulativeScoresHtml, refreshGameScoresBox } from "../core/gameScores.js";
import { getActivePlayers } from "../core/players.js";
import { getLocalDisplayName, recordTruthMeterPlayed, setLastGame } from "../core/state.js";
import { setLobbyPlaying, setLobbyWaiting } from "../core/lobby.js";
import { requireLobbyPlay } from "../core/gameGuard.js";
import { navigate } from "../core/router.js";
import { escapeHtml, pageShell } from "../core/ui.js";
import { bindNav } from "../screens/nav.js";
import { gameExitBarHtml, bindExitGame } from "../core/exitGame.js";
import { isEveningGameplayPaused } from "../core/filRougeSession.js";
import {
  isGameSyncActive,
  isLobbyHost,
  onGameSessionChange,
  completeGameSession,
  syncLobbyScores,
} from "../core/gameSync.js";

function sliderBlockHtml({
  id,
  value = 50,
  disabled = false,
  hint,
  question,
}) {
  const v = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
  return `
    <div class="truth-meter__slider-wrap">
      ${question ? `<p class="truth-meter__question">${escapeHtml(question)}</p>` : ""}
      <p class="truth-meter__pct" id="${id}-pct">${v}%</p>
      <p class="truth-meter__label" id="${id}-label">${truthLabel(v)}</p>
      <div class="truth-meter__range-labels">
        <span>Faux</span>
        <span>Vrai</span>
      </div>
      <input type="range" class="truth-meter__range" id="${id}" min="0" max="100" step="1" value="${v}"
        ${disabled ? "disabled" : ""} />
      ${hint ? `<p class="hint truth-meter__hint">${escapeHtml(hint)}</p>` : ""}
    </div>`;
}

function blurAffirmationInput(container) {
  const textEl = container?.querySelector("#affirmation-text");
  if (textEl && document.activeElement === textEl) textEl.blur();
}

function bindSlider(app, id, { onInput, disabled, onInteract } = {}) {
  const input = app.querySelector(`#${id}`);
  const wrap = input?.closest(".truth-meter__slider-wrap");
  if (!input || !wrap || disabled) return;

  const pctEl = app.querySelector(`#${id}-pct`);
  const labelEl = app.querySelector(`#${id}-label`);

  const update = () => {
    const v = Number(input.value);
    if (pctEl) pctEl.textContent = `${v}%`;
    if (labelEl) labelEl.textContent = truthLabel(v);
    onInput?.(v);
  };

  const setFromClientX = (clientX) => {
    const rect = input.getBoundingClientRect();
    if (!rect.width) return;
    const pct = Math.round(((clientX - rect.left) / rect.width) * 100);
    input.value = String(Math.max(0, Math.min(100, pct)));
    update();
  };

  if (input.dataset.bound !== "1") {
    input.dataset.bound = "1";
    input.addEventListener("input", update);
    input.addEventListener("change", update);
    input.addEventListener("focus", () => blurAffirmationInput(app));
  }

  if (wrap.dataset.dragBound !== "1") {
    wrap.dataset.dragBound = "1";
    wrap.addEventListener("pointerdown", (e) => {
      if (input.disabled) return;
      if (e.target.closest("button")) return;
      blurAffirmationInput(app);
      onInteract?.();
      // On ne capture pas tout de suite : on attend de savoir si le geste est
      // horizontal (réglage du slider) ou vertical (scroll de la page).
      const startX = e.clientX;
      const startY = e.clientY;
      const DRAG_THRESHOLD = 6;
      let mode = "pending";

      function cleanup() {
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        document.removeEventListener("pointercancel", onCancel);
      }

      const onMove = (ev) => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        if (mode === "pending") {
          if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
          if (Math.abs(dy) > Math.abs(dx)) {
            mode = "scroll";
            cleanup();
            return;
          }
          mode = "drag";
          input.setPointerCapture?.(ev.pointerId);
        }
        if (ev.cancelable) ev.preventDefault();
        setFromClientX(ev.clientX);
      };
      const onUp = (ev) => {
        if (mode === "drag") input.releasePointerCapture?.(ev.pointerId);
        else if (mode === "pending") setFromClientX(ev.clientX);
        cleanup();
      };
      const onCancel = () => cleanup();

      document.addEventListener("pointermove", onMove, { passive: false });
      document.addEventListener("pointerup", onUp);
      document.addEventListener("pointercancel", onCancel);
    });
  }

  update();
}

export function mountTruthMeter(app) {
  if (!requireLobbyPlay()) return null;

  const entry = getTruthMeterEntryScreen();
  if (entry !== "truthmeter") {
    navigate(entry);
    return null;
  }

  setLobbyPlaying("truthmeter");

  let phase = "writing";
  let roundIdx = 0;
  let affirmation = null;
  let authorEstimate = null;
  let votes = {};
  let myVote = null;
  let draftEstimate = 50;
  let draftText = "";
  let lastAward = null;
  let roundScored = false;
  let revealAnimId = null;
  let authorRevealed = false;
  let voteCommitInFlight = null;
  let displayTimeoutId = null;
  let revealPendingTimeoutId = null;
  let nextRoundInFlight = false;
  let revealInFlight = false;
  let authorFocusRound = -1;
  let suppressAuthorAutoFocus = false;
  const localName = getLocalDisplayName();
  const mp = isGameSyncActive();

  const totalRounds = () => getTruthMeterSession().authorOrder?.length || getActivePlayers().length;

  function cancelRevealAnim() {
    if (revealAnimId) {
      cancelAnimationFrame(revealAnimId);
      revealAnimId = null;
    }
  }

  function syncFromSession() {
    const s = getTruthMeterSession();
    if (s.roundIdx != null) roundIdx = s.roundIdx;
    if (s.phase) phase = s.phase;
    affirmation = s.affirmation || null;
    authorEstimate = s.authorEstimate;
    votes = { ...(s.votes || {}) };
    myVote = votes[localName] ?? null;
    if (voteCommitInFlight != null && phase === "voting" && myVote == null) {
      myVote = voteCommitInFlight;
      votes = { ...votes, [localName]: voteCommitInFlight };
    }
    roundScored = Boolean(s.roundScored);
  }

  function votesForAward() {
    const author = affirmation?.author || getCurrentAuthor();
    let fromSession = { ...(getTruthMeterSession().votes || {}) };
    if (voteCommitInFlight != null && fromSession[localName] == null) {
      fromSession[localName] = voteCommitInFlight;
    }
    if (!mp && Object.keys(fromSession).length === 0 && Object.keys(votes).length > 0) {
      fromSession = { ...votes };
    }
    return filterVoterVotes(fromSession, author);
  }

  function alreadyScoredThisRound() {
    return roundScored || Boolean(getTruthMeterSession().roundScored);
  }

  function scheduleRevealFromPending() {
    if (revealPendingTimeoutId || revealInFlight || phase !== "reveal-pending") return;
    if (mp && !isLobbyHost()) return;
    revealPendingTimeoutId = setTimeout(() => {
      revealPendingTimeoutId = null;
      void transitionToReveal();
    }, TRUTH_METER_REVEAL_PENDING_MS);
  }

  function playerMeta(name) {
    const p = getActivePlayers().find((x) => x.name === name);
    return { color: p?.color || "#A78BFA", emoji: p?.emoji || "🎭" };
  }

  function spreadHtml(votesMap, showAuthor) {
    const author = affirmation?.author;
    const rows = Object.entries(votesMap)
      .filter(([name]) => name !== author)
      .map(([name, v]) => {
        const meta = playerMeta(name);
        return `
          <div class="truth-meter__spread-row">
            <span class="truth-meter__spread-name">${escapeHtml(name)}</span>
            <div class="truth-meter__spread-track">
              <span class="truth-meter__spread-dot" style="left:${v}%;background:${meta.color}"></span>
            </div>
            <span class="truth-meter__spread-val">${v}%</span>
          </div>`;
      })
      .join("");

    const authorRow =
      showAuthor && author && authorEstimate != null
        ? `
        <div class="truth-meter__spread-row truth-meter__spread-row--author">
          <span class="truth-meter__spread-name">${escapeHtml(author)} (auteur)</span>
          <div class="truth-meter__spread-track">
            <span class="truth-meter__spread-dot truth-meter__spread-dot--author" style="left:${authorEstimate}%"></span>
          </div>
          <span class="truth-meter__spread-val">${authorEstimate}%</span>
        </div>`
        : "";

    return `
      <div class="truth-meter__spread">
        ${rows}
        ${authorRow}
      </div>`;
  }

  function animateRevealGauge(targetPct) {
    const fill = app.querySelector("#truth-gauge-fill");
    const pctEl = app.querySelector("#truth-gauge-pct");
    const authorPin = app.querySelector("#truth-gauge-author-pin");
    if (!fill || !pctEl) return;

    authorRevealed = false;
    if (authorPin) authorPin.classList.add("hidden");

    const start = performance.now();
    const duration = 900;

    const step = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - t) ** 3;
      const current = Math.round(targetPct * eased);
      fill.style.width = `${current}%`;
      pctEl.textContent = `${current}%`;
      if (t < 1) {
        revealAnimId = requestAnimationFrame(step);
      } else {
        revealAnimId = null;
        authorRevealed = true;
        if (authorPin) authorPin.classList.remove("hidden");
      }
    };
    cancelRevealAnim();
    revealAnimId = requestAnimationFrame(step);
  }

  async function goToRevealPending() {
    if (mp) {
      await commitTruthMeterPlay({
        phase: "reveal-pending",
        voteEndsAt: null,
      });
    } else {
      phase = "reveal-pending";
      render();
      scheduleRevealFromPending();
    }
  }

  async function transitionToReveal() {
    if (alreadyScoredThisRound()) {
      if (!mp && phase !== "reveal") {
        phase = "reveal";
        render();
      }
      return;
    }
    if (mp && !isLobbyHost()) return;
    if (revealInFlight) return;

    revealInFlight = true;
    try {
      const author = affirmation?.author;
      const votesToScore = votesForAward();
      const est = authorEstimate;

      roundScored = true;
      await commitTruthMeterPlay({
        phase: "reveal",
        roundScored: true,
        votes: votesToScore,
        voteEndsAt: null,
      });

      if (author && (!mp || isLobbyHost())) {
        lastAward = awardTruthMeterRound(votesToScore, author, est);
        if (mp) await syncLobbyScores();
      } else if (!lastAward && author) {
        lastAward = {
          ...computeRoundMetrics(votesToScore, est),
          bluffWin: false,
          consensus: false,
          mindReader: null,
        };
      }

      if (!mp) {
        phase = "reveal";
        render();
        const avg = lastAward?.groupAvg ?? computeRoundMetrics(votesToScore, est).groupAvg;
        animateRevealGauge(avg);
      }
    } finally {
      revealInFlight = false;
    }
  }

  async function goToReveal() {
    await transitionToReveal();
  }

  async function startVotingPhase() {
    if (mp && !isLobbyHost()) return;
    const endsAt = new Date(Date.now() + TRUTH_METER_VOTE_TIMER_SEC * 1000).toISOString();
    if (mp) {
      await commitTruthMeterPlay({
        phase: "voting",
        votes: {},
        roundScored: false,
        voteEndsAt: endsAt,
      });
    } else {
      phase = "voting";
      myVote = null;
      votes = {};
      render();
    }
  }

  /** Filet de sécurité hôte : clôt la manche même si un votant est absent. */
  async function forceReveal() {
    if (mp && !isLobbyHost()) return;
    await goToRevealPending();
  }

  async function startDisplayPhase() {
    if (mp && !isLobbyHost()) return;
    if (mp) {
      await commitTruthMeterPlay({ phase: "display", votes: {}, roundScored: false });
    } else {
      phase = "display";
      render();
      setTimeout(() => {
        if (!mp || isLobbyHost()) startVotingPhase();
      }, TRUTH_METER_DISPLAY_SEC * 1000);
    }
  }

  function render() {
    syncFromSession();
    const author = getCurrentAuthor() || affirmation?.author;
    const total = totalRounds();
    const isAuthor = localName === author;
    const host = !mp || isLobbyHost();
    let phaseHtml = "";

    if (phase === "writing") {
      if (isAuthor) {
        phaseHtml = `
          <p class="hint">Tu es l'auteur - écris une affirmation personnelle et place sa vérité.</p>
          <div class="card card--hot">
            <label class="field-label" for="affirmation-text">Ton affirmation</label>
            <textarea class="field-textarea" id="affirmation-text" rows="4" maxlength="200" autocomplete="off"
              placeholder="Ex : J'ai déjà volé quelque chose sans m'en rendre compte"></textarea>
            <p class="hint">Exemples : ${TRUTH_METER_EXAMPLES.slice(0, 2).map((e) => escapeHtml(e)).join(" · ")}</p>
          </div>
          ${sliderBlockHtml({
            id: "author-slider",
            value: draftEstimate,
            question: "Pour toi, cette affirmation est…",
            hint: "0 = Faux · 100 = Vrai (honnête)",
          })}
          <button type="button" class="btn btn-primary btn--spaced" id="btn-submit-affirmation">Envoyer →</button>`;
      } else {
        phaseHtml = `
          <p class="hint truth-meter__waiting">✍️ <strong>${escapeHtml(author || "…")}</strong> écrit son affirmation…</p>`;
      }
    }

    if (phase === "display" && affirmation) {
      phaseHtml = `
        <div class="card card--hot truth-meter__affirmation-card">
          <p class="label-upper label-upper--hot">Affirmation</p>
          <p class="hot-take-text">"${escapeHtml(affirmation.text)}"</p>
          <p class="hint">- ${escapeHtml(affirmation.author)}</p>
        </div>
        <p class="hint">${host ? "Le vote commence dans un instant…" : "Le vote va commencer…"}</p>`;
    }

    if (phase === "voting" && affirmation) {
      const voteLocked = myVote != null;
      if (isAuthor) {
        phaseHtml = `
          <div class="card card--hot truth-meter__affirmation-card">
            <p class="hot-take-text">"${escapeHtml(affirmation.text)}"</p>
          </div>
          <p class="hint truth-meter__waiting">Les autres jugent ton affirmation…</p>`;
      } else {
        phaseHtml = `
          <div class="card card--hot truth-meter__affirmation-card">
            <p class="hot-take-text">"${escapeHtml(affirmation.text)}"</p>
            <p class="hint">- ${escapeHtml(affirmation.author)}</p>
          </div>
          ${sliderBlockHtml({
            id: "vote-slider",
            value: myVote ?? 50,
            disabled: voteLocked,
            question: "À quel point tu crois cette affirmation ?",
            hint: voteLocked ? "Vote enregistré - en attente des autres…" : "0 = Faux · 100 = Vrai",
          })}
          <button type="button" class="btn btn-primary btn--spaced" id="btn-confirm-vote"
            ${voteLocked ? "disabled" : ""}>Valider mon vote</button>`;
      }
      if (host) {
        const votedCount = Object.keys(votesForAward()).length;
        const totalVoters = getVoterNames().length;
        phaseHtml += `
          <button type="button" class="btn btn-secondary btn--spaced" id="truth-force">
            Révéler maintenant (${votedCount}/${totalVoters})
          </button>`;
      }
    }

    if (phase === "reveal-pending") {
      phaseHtml = `
        <div class="truth-meter__suspense">
          <p class="truth-meter__suspense-title">Calcul du TruthMeter…</p>
          <div class="truth-meter__suspense-pulse" aria-hidden="true"></div>
        </div>`;
    }

    if (phase === "reveal" && affirmation) {
      const authorName = affirmation.author;
      const votesToShow = votesForAward();
      const metrics = {
        ...buildRevealMetrics(votesToShow, authorName),
        ...(lastAward || {}),
      };
      const verdictPct = metrics.groupAvg;
      const awardLine = metrics.bluffWin
        ? `<p class="hint">🎭 Bluff réussi ! Écart <strong>${metrics.gap}</strong> - <strong>${escapeHtml(affirmation.author)}</strong> +${EVENING_POINTS.BONUS} pts</p>`
        : metrics.consensus
          ? `<p class="hint">🤝 Consensus - <strong>${escapeHtml(affirmation.author)}</strong> +${EVENING_POINTS.WIN} pts (écart ${metrics.gap}).</p>`
          : `<p class="hint">Écart auteur/groupe : <strong>${metrics.gap}</strong> pts</p>`;
      const mindLine = metrics.mindReader
        ? `<p class="hint">🧠 Le plus proche : <strong>${escapeHtml(metrics.mindReader)}</strong> +${metrics.voterPoints || EVENING_POINTS.WIN} pts</p>`
        : "";

      phaseHtml = `
        <h3 class="section-title">TruthMeter</h3>
        <div class="card card--hot truth-meter__affirmation-card">
          <p class="hot-take-text">"${escapeHtml(affirmation.text)}"</p>
        </div>
        <div class="truth-meter__gauge card">
          <p class="truth-meter__gauge-title">Verdict du groupe</p>
          <p class="truth-meter__pct truth-meter__pct--lg" id="truth-gauge-pct">${verdictPct}%</p>
          <div class="truth-meter__gauge-track">
            <div class="truth-meter__gauge-fill" id="truth-gauge-fill"
              style="width:${authorRevealed ? verdictPct : 0}%"></div>
            <span class="truth-meter__gauge-pin hidden" id="truth-gauge-author-pin"
              style="left:${authorEstimate ?? 0}%"
              title="Position auteur"></span>
          </div>
          <div class="truth-meter__range-labels">
            <span>Faux</span>
            <span>Vrai</span>
          </div>
          ${awardLine}
          ${mindLine}
        </div>
        ${spreadHtml(votesToShow, authorRevealed)}
        ${gameCumulativeScoresHtml({ gameLabel: "TruthMeter", title: "Cumul des scores" })}
        ${
          host
            ? `<button type="button" class="btn btn-primary btn--spaced" id="next-round">
          ${roundIdx < total - 1 ? "Joueur suivant →" : "Voir les résultats →"}
        </button>`
            : `<p class="hint">En attente de l'hôte…</p>`
        }`;
    }

    app.innerHTML = pageShell({
      backTarget: "back",
      content: `
        <div class="game-header">
          <div class="dots">${Array.from({ length: total }, (_, i) =>
            `<span class="dot ${i === roundIdx ? "dot--active" : i < roundIdx ? "dot--done" : ""}"></span>`
          ).join("")}</div>
          <span class="muted">${roundIdx + 1}/${total}</span>
        </div>
        <div class="logo logo--sm"><h1>TRUTHMETER</h1></div>
        ${author ? `<p class="hint">Auteur : <strong>${escapeHtml(author)}</strong></p>` : ""}
        ${phaseHtml}
        ${gameExitBarHtml()}
      `,
    });

    bindNav(app);
    bindExitGame(app);

    if (phase === "writing" && isAuthor) {
      const textEl = app.querySelector("#affirmation-text");
      if (textEl) {
        if (!textEl.dataset.bound) {
          textEl.dataset.bound = "1";
          textEl.addEventListener("input", () => {
            draftText = textEl.value;
          });
        }
        textEl.value = draftText;
        if (authorFocusRound !== roundIdx && !suppressAuthorAutoFocus) {
          authorFocusRound = roundIdx;
          requestAnimationFrame(() => {
            if (suppressAuthorAutoFocus || phase !== "writing" || getCurrentAuthor() !== localName) {
              return;
            }
            if (document.activeElement?.closest(".truth-meter__slider-wrap")) return;
            textEl.focus({ preventScroll: true });
          });
        }
      }
      bindSlider(app, "author-slider", {
        onInput: (v) => {
          suppressAuthorAutoFocus = true;
          draftEstimate = v;
        },
        onInteract: () => {
          suppressAuthorAutoFocus = true;
        },
      });
      app.querySelector("#btn-submit-affirmation")?.addEventListener("click", async () => {
        const text = app.querySelector("#affirmation-text")?.value || "";
        const val = Number(app.querySelector("#author-slider")?.value ?? 50);
        const check = validateAffirmation(text);
        if (!check.ok) {
          await import("../core/dialog.js").then(({ showAppAlert }) =>
            showAppAlert(check.error, { title: "Affirmation", icon: "⚠️" })
          );
          return;
        }
        draftText = check.text;
        draftEstimate = val;
        await commitTruthMeterPlay({
          affirmation: { text: check.text, author: localName },
          authorEstimate: val,
          phase: "display",
          votes: {},
          roundScored: false,
        });
        if (!mp) startDisplayPhase();
      });
    }

    if (phase === "display" && host && !displayTimeoutId) {
      displayTimeoutId = setTimeout(() => {
        displayTimeoutId = null;
        startVotingPhase();
      }, TRUTH_METER_DISPLAY_SEC * 1000);
    }

    if (phase === "voting" && !isAuthor) {
      if (myVote == null) {
        bindSlider(app, "vote-slider", {
          onInput: (v) => {
            draftEstimate = v;
          },
        });
      }
      app.querySelector("#btn-confirm-vote")?.addEventListener("click", async () => {
        if (myVote != null) return;
        const choice = Number(app.querySelector("#vote-slider")?.value ?? 50);
        myVote = choice;
        votes = { ...votes, [localName]: choice };
        if (mp) {
          voteCommitInFlight = choice;
          render();
          try {
            await commitTruthMeterPlay({ votes });
            if (allTruthMeterVotesIn() && isLobbyHost()) await goToRevealPending();
          } finally {
            voteCommitInFlight = null;
          }
        } else {
          votes = simulateTruthMeterVotes(choice);
          render();
          if (allTruthMeterVotesIn()) {
            goToRevealPending();
          }
        }
        render();
      });
    }

    if (phase === "voting") {
      app.querySelector("#truth-force")?.addEventListener("click", () => {
        void forceReveal();
      });
    }

    if (phase === "reveal") {
      const authorName = affirmation?.author;
      const verdictPct = buildRevealMetrics(votesForAward(), authorName).groupAvg;
      if (!revealAnimId && !authorRevealed && app.querySelector("#truth-gauge-fill")) {
        requestAnimationFrame(() => animateRevealGauge(verdictPct));
      }
    }

    if (phase === "reveal-pending" && host && mp) {
      scheduleRevealFromPending();
    }
  }

  function captureAuthorDraftFromDom() {
    if (phase !== "writing" || getCurrentAuthor() !== localName) return;
    const textEl = app.querySelector("#affirmation-text");
    if (textEl) draftText = textEl.value;
    const slider = app.querySelector("#author-slider");
    if (slider) draftEstimate = Number(slider.value);
  }

  function captureVoteDraftFromDom() {
    if (phase !== "voting" || getCurrentAuthor() === localName) return;
    const slider = app.querySelector("#vote-slider");
    if (slider) draftEstimate = Number(slider.value);
  }

  /** Valeur du curseur (même si « Valider » n’a pas encore été pressé). */
  function getPendingVoteValue() {
    const slider = app.querySelector("#vote-slider");
    if (slider && !slider.disabled) return clampPct(slider.value);
    return clampPct(draftEstimate);
  }

  function buildRevealMetrics(votesToShow, authorName) {
    const m = computeRoundMetrics(votesToShow, authorEstimate, authorName);
    const voterVotes = filterVoterVotes(votesToShow, authorName);
    let mindReader = null;
    let bestDist = Infinity;
    Object.entries(voterVotes).forEach(([name, v]) => {
      const d = Math.abs(v - m.groupAvg);
      if (d < bestDist) {
        bestDist = d;
        mindReader = name;
      }
    });
    return {
      ...m,
      bluffWin: m.gap >= TRUTH_METER_BLUFF_GAP,
      consensus: m.gap <= TRUTH_METER_CONSENSUS_GAP,
      mindReader,
    };
  }

  /** Évite de détruire le textarea / slider à chaque poll multijoueur. */
  function shouldSkipFullRender(prevPhase, prevRound) {
    if (phase !== prevPhase || roundIdx !== prevRound) return false;
    if (phase === "writing" && getCurrentAuthor() === localName) return true;
    if (phase === "voting") return true;
    if (phase === "reveal-pending") return true;
    if (phase === "reveal") return true;
    return false;
  }

  function scheduleDisplayToVote() {
    if (displayTimeoutId) return;
    displayTimeoutId = setTimeout(() => {
      displayTimeoutId = null;
      startVotingPhase();
    }, TRUTH_METER_DISPLAY_SEC * 1000);
  }

  async function onNextRound() {
    if (nextRoundInFlight) return;
    if (mp && !isLobbyHost()) return;

    nextRoundInFlight = true;
    const btn = app.querySelector("#next-round");
    if (btn) btn.disabled = true;

    try {
      const total = totalRounds();
      if (roundIdx < total - 1) {
        const nextIdx = roundIdx + 1;
        draftText = "";
        draftEstimate = 50;
        suppressAuthorAutoFocus = false;
        authorFocusRound = -1;
        myVote = null;
        votes = {};
        lastAward = null;
        roundScored = false;
        authorRevealed = false;
        cancelRevealAnim();
        roundIdx = nextIdx;
        phase = "writing";
        affirmation = null;
        authorEstimate = null;

        if (mp) {
          await commitTruthMeterPlay({
            roundIdx: nextIdx,
            phase: "writing",
            affirmation: null,
            authorEstimate: null,
            votes: {},
            voteEndsAt: null,
            roundScored: false,
          });
          syncFromSession();
        }
        render();
      } else {
        recordTruthMeterPlayed();
        setLastGame({
          gameId: "truthmeter",
          title: "TruthMeter",
          summary: `${total} manches · dernier verdict ${lastAward?.groupAvg ?? "-"}%`,
        });
        if (mp) {
          try {
            await completeGameSession({ gameId: "truthmeter", screen: "results", state: {} });
          } catch (e) {
            console.warn("REVEAL completeGameSession:", e);
            navigate("results", { navStack: ["home", "lobby", "game-select", "results"] });
          }
        } else {
          setLobbyWaiting();
        }
        navigate("results");
      }
    } finally {
      nextRoundInFlight = false;
      const btnAfter = app.querySelector("#next-round");
      if (btnAfter) btnAfter.disabled = false;
    }
  }

  const unsubGame = onGameSessionChange(() => {
    const prevPhase = phase;
    const prevRound = roundIdx;
    captureAuthorDraftFromDom();
    captureVoteDraftFromDom();
    syncFromSession();

    if (phase === "voting" && isLobbyHost() && allTruthMeterVotesIn()) {
      void goToRevealPending();
      return;
    }

    if (shouldSkipFullRender(prevPhase, prevRound)) {
      if (phase === "reveal" || phase === "voting") {
        refreshGameScoresBox(app, { gameLabel: "TruthMeter", title: "Cumul des scores" });
      }
      return;
    }

    render();
    if (phase === "display" && prevPhase !== "display" && (!mp || isLobbyHost())) {
      scheduleDisplayToVote();
    }
    if (phase === "reveal-pending" && prevPhase !== "reveal-pending" && isLobbyHost()) {
      scheduleRevealFromPending();
    }
    if (phase === "reveal" && prevPhase !== "reveal") {
      const authorName = affirmation?.author;
      const verdictPct = buildRevealMetrics(votesForAward(), authorName).groupAvg;
      authorRevealed = false;
      requestAnimationFrame(() => animateRevealGauge(verdictPct));
    }
  });

  const onAppClick = (e) => {
    if (!e.target.closest("#next-round")) return;
    void onNextRound();
  };
  app.addEventListener("click", onAppClick);

  syncFromSession();
  render();
  if (phase === "display" && (!mp || isLobbyHost())) {
    scheduleDisplayToVote();
  }

  return () => {
    app.removeEventListener("click", onAppClick);
    if (displayTimeoutId) clearTimeout(displayTimeoutId);
    if (revealPendingTimeoutId) clearTimeout(revealPendingTimeoutId);
    cancelRevealAnim();
    unsubGame();
    if (!mp) setLobbyWaiting();
  };
}
