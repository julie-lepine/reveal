import {
  CLUTCH_GRACE_MS,
  CLUTCH_HIDE_BEFORE_MS,
  CLUTCH_PRECOUNT_MS,
  formatClutchSeconds,
  formatClutchSecondsMs,
  formatClutchGap,
} from "../../data/clutch.js";
import {
  getClutchEntryScreen,
  getClutchSession,
  commitClutchTap,
  commitClutchPlay,
  allClutchTapsIn,
  rankClutchResults,
  startClutchRound,
} from "../core/clutchSession.js";
import { awardClutchRound } from "../core/scoring.js";
import { applyMatchScoreDeltas, gameCumulativeScoresHtml, refreshGameScoresBox } from "../core/gameScores.js";
import { getLocalDisplayName, recordClutchPlayed, setLastGame } from "../core/state.js";
import { getLobbyParticipants } from "../core/lobby.js";
import { getActivePlayerNames } from "../core/players.js";
import { setLobbyPlaying, setLobbyWaiting } from "../core/lobby.js";
import { requireLobbyPlay } from "../core/gameGuard.js";
import { withClickLock } from "../core/actionLock.js";
import { navigate } from "../core/router.js";
import { escapeHtml, pageShell } from "../core/ui.js";
import { bindNav } from "../screens/nav.js";
import { gameExitBarHtml, bindExitGame } from "../core/exitGame.js";
import { isEveningGameplayPaused } from "../core/filRougeSession.js";
import {
  isGameSyncActive,
  canActAsHost,
  isLobbyHost,
  onGameSessionChange,
  completeGameSession,
  stopGameSessionListenerOnPostGame,
} from "../core/gameSync.js";

export function mountClutch(app) {
  if (!requireLobbyPlay()) return null;

  const entry = getClutchEntryScreen();
  if (entry !== "clutch") {
    navigate(entry);
    return null;
  }

  void setLobbyPlaying("clutch").catch(() => {});

  let roundIdx = 0;
  let phase = "active";
  let targetMs = null;
  let taps = {};
  let lastRound = null;
  let lastAward = null;
  let takeScored = false;
  let revealInFlight = false;

  let localStart = null;
  let countdownEndsAt = null;
  let activeKey = null;
  let localWindowClosed = false;
  let graceTimer = null;
  let clockRaf = null;
  let hideBeforeMs = null;
  let copyTimer = null;
  let blindVibrated = false;

  const localName = getLocalDisplayName();
  const mp = isGameSyncActive();
  const totalRounds = getClutchSession().roundCount ?? 5;

  // Punchlines qui défilent pendant la phase aveugle (vitesse fixe : ne révèle rien).
  const BLIND_LINES = [
    "👀 Bientôt…",
    "😬 Concentre-toi…",
    "🫣 Maintenant ?!",
    "🔥 Au feeling !",
  ];

  function myTapMs() {
    const t = taps[localName];
    return t && typeof t.ms === "number" ? t.ms : null;
  }

  function hideClockAtMs() {
    return (targetMs || 0) - (hideBeforeMs || CLUTCH_HIDE_BEFORE_MS);
  }

  function currentlyHidden() {
    return localStart != null && performance.now() - localStart >= hideClockAtMs();
  }

  function clearGrace() {
    if (graceTimer) clearTimeout(graceTimer);
    graceTimer = null;
  }

  function stopClock() {
    if (clockRaf) cancelAnimationFrame(clockRaf);
    clockRaf = null;
  }

  function clearCopyTimer() {
    if (copyTimer) clearInterval(copyTimer);
    copyTimer = null;
  }

  function vibrate(ms) {
    try {
      navigator.vibrate?.(ms);
    } catch {
      /* pas de vibration dispo */
    }
  }

  /** Liste (pseudos) des joueurs ayant déjà tapé sur la manche en cours. */
  function tappedNames() {
    return getActivePlayerNames().filter((n) => taps[n]?.ms != null);
  }

  /**
   * Chips « X a tapé ! » — affichées UNIQUEMENT en phase aveugle. En phase visible
   * elles fuiteraient l'estimation (on verrait le chrono ET le moment du tap).
   */
  function tappedChipsHtml(showBlind) {
    if (!showBlind) return "";
    const names = tappedNames();
    if (!names.length) return "";
    return names
      .map((n) => {
        const meta = playerMeta(n);
        const label = n === localName ? "Toi" : n;
        return `<span class="clutch-chip" style="--clutch-chip:${meta.color}">${meta.emoji} ${escapeHtml(label)} a tapé&nbsp;!</span>`;
      })
      .join("");
  }

  function refreshTappedChips() {
    const box = app.querySelector("#clutch-tapped");
    if (box) box.innerHTML = tappedChipsHtml(currentlyHidden());
  }

  /** Rotation des punchlines de suspense pendant la phase aveugle. */
  function startBlindCopy() {
    clearCopyTimer();
    let i = 0;
    const sub = app.querySelector("#clutch-clock-sub");
    if (sub) sub.textContent = BLIND_LINES[0];
    copyTimer = setInterval(() => {
      const el = app.querySelector("#clutch-clock-sub");
      if (!el || phase !== "active" || myTapMs() != null) {
        clearCopyTimer();
        return;
      }
      i = (i + 1) % BLIND_LINES.length;
      el.textContent = BLIND_LINES[i];
    }, 650);
  }

  /** Bascule l'UI en mode aveugle : chrono caché, bouton qui pulse, suspense, vibration. */
  function enterBlind() {
    const clock = app.querySelector("#clutch-clock");
    if (clock) clock.textContent = "👀";
    refreshTappedChips();
    if (!blindVibrated) {
      blindVibrated = true;
      vibrate(60);
    }
    const sub = app.querySelector("#clutch-clock-sub");
    const btn = app.querySelector("#clutch-target");
    if (myTapMs() != null) {
      clearCopyTimer();
      if (sub) sub.textContent = "👀 Chrono caché - en attente…";
      return;
    }
    btn?.classList.add("clutch-tap--blind");
    startBlindCopy();
  }

  /** Anime le chrono visible montant jusqu'au masquage, puis bascule en phase aveugle. */
  function startClock() {
    stopClock();
    const tick = () => {
      if (phase !== "active" || localStart == null) {
        stopClock();
        return;
      }
      const clock = app.querySelector("#clutch-clock");
      if (!clock) {
        stopClock();
        return;
      }
      const elapsed = performance.now() - localStart;
      if (elapsed >= hideClockAtMs()) {
        enterBlind();
        stopClock();
        return;
      }
      clock.textContent = formatClutchSecondsMs(Math.max(0, elapsed));
      clockRaf = requestAnimationFrame(tick);
    };
    clockRaf = requestAnimationFrame(tick);
  }

  /** Pré-décompte « 3 · 2 · 1 » : on affiche la cible, le chrono ne monte pas encore. */
  function startCountdown() {
    stopClock();
    const tick = () => {
      if (phase !== "active" || localStart != null) return;
      const clock = app.querySelector("#clutch-clock");
      if (!clock) {
        stopClock();
        return;
      }
      const remain = (countdownEndsAt || 0) - performance.now();
      if (remain <= 0) {
        beginClock();
        return;
      }
      clock.textContent = String(Math.ceil(remain / 1000));
      clockRaf = requestAnimationFrame(tick);
    };
    clockRaf = requestAnimationFrame(tick);
  }

  /** Fin du décompte : départ réel du chrono + programmation de la clôture (cible + grâce). */
  function beginClock() {
    localStart = performance.now();
    clearGrace();
    const windowMs = (targetMs || 0) + CLUTCH_GRACE_MS;
    graceTimer = setTimeout(onGraceElapsed, windowMs);
    render();
  }

  /** Maj légère en phase aveugle (tap distant) sans casser chrono/anim. */
  function refreshActiveLive() {
    refreshTappedChips();
  }

  function alreadyScoredThisRound() {
    if (phase !== "reveal") return false;
    return takeScored || Boolean(getClutchSession().roundScored);
  }

  function syncFromSession() {
    const s = getClutchSession();
    if (s.roundIdx != null) roundIdx = s.roundIdx;
    if (s.phase) phase = s.phase;
    if (s.targetMs != null) targetMs = s.targetMs;
    if (s.hideBeforeMs != null) hideBeforeMs = s.hideBeforeMs;
    taps = { ...(s.taps || {}) };
    lastRound = s.lastRound ?? lastRound;
    takeScored = Boolean(s.roundScored);
  }

  /** Démarre le chrono local d'une nouvelle manche active + programme la clôture (cible + grâce). */
  function ensureRoundTiming() {
    const s = getClutchSession();
    if (phase === "active") {
      const key = `${roundIdx}:${s.roundStartAt || ""}`;
      if (key !== activeKey) {
        activeKey = key;
        localStart = null;
        countdownEndsAt = performance.now() + CLUTCH_PRECOUNT_MS;
        localWindowClosed = false;
        blindVibrated = false;
        clearCopyTimer();
        clearGrace();
      }
    } else {
      clearGrace();
    }
  }

  function onGraceElapsed() {
    graceTimer = null;
    if (phase !== "active") return;
    localWindowClosed = true;
    if (!mp || canActAsHost()) {
      void goToReveal();
      return;
    }
    // Invité : fenêtre fermée localement, on attend la révélation de l'hôte.
    render();
  }

  async function transitionToReveal() {
    if (takeScored || alreadyScoredThisRound()) return;
    if (mp && !canActAsHost()) return;
    if (revealInFlight) return;

    revealInFlight = true;
    try {
      takeScored = true;
      const session = getClutchSession();
      const names = getActivePlayerNames();
      const ranking = rankClutchResults(session.taps || {}, targetMs, names);
      let matchScores = session.matchScores || {};
      if (!mp || canActAsHost()) {
        lastAward = awardClutchRound(ranking);
        matchScores = applyMatchScoreDeltas(matchScores, lastAward.deltas || {});
      } else {
        lastAward = { ranking, deltas: {} };
      }
      const lastRoundData = { targetMs, ranking, deltas: lastAward.deltas || {} };
      await commitClutchPlay(
        {
          phase: "reveal",
          roundScored: true,
          taps: session.taps || {},
          roundEndsAt: null,
          matchScores,
          lastRound: lastRoundData,
        },
        { withEveningScores: mp && isLobbyHost() }
      );
      if (!mp) {
        phase = "reveal";
        lastRound = lastRoundData;
        render();
      }
    } finally {
      revealInFlight = false;
    }
  }

  async function goToReveal() {
    await transitionToReveal();
  }

  function playerMeta(name) {
    const p = getLobbyParticipants().find((x) => x.name === name);
    return { color: p?.color || "#A78BFA", emoji: p?.emoji || "🎭" };
  }

  function sessionScores() {
    return getClutchSession().matchScores || {};
  }

  function activeHtml() {
    const tapped = myTapMs() != null;
    const counting = localStart == null;

    const targetLabel = formatClutchSeconds(targetMs);
    const elapsedNow = localStart != null ? performance.now() - localStart : 0;
    const hidden = !counting && elapsedNow >= hideClockAtMs();

    const clockText = counting
      ? String(Math.max(1, Math.ceil(((countdownEndsAt || performance.now()) - performance.now()) / 1000)))
      : hidden
        ? "👀"
        : formatClutchSecondsMs(Math.max(0, elapsedNow));
    const clockSub = counting
      ? "Mémorise la cible… 🎯"
      : hidden
        ? tapped
          ? "👀 Chrono caché - en attente…"
          : BLIND_LINES[0]
        : "Le chrono monte vers la cible";

    const status = localWindowClosed
      ? "Temps écoulé - en attente du verdict…"
      : counting
        ? "Prépare-toi… le chrono démarre !"
        : tapped
          ? mp
            ? allClutchTapsIn()
              ? "Tout le monde a tapé !"
              : "C'est noté ! En attente des autres…"
            : "C'est noté !"
          : "Tape pile au moment où le chrono atteint la cible 💥";

    const btnDisabled = tapped || localWindowClosed || counting;
    const btnClasses = [
      "clutch-tap",
      tapped ? "clutch-tap--tapped" : "",
      hidden && !tapped ? "clutch-tap--blind" : "",
    ]
      .filter(Boolean)
      .join(" ");

    return `
      <div class="card card--speed clutch-clock-card ${hidden ? "clutch-clock-card--blind" : ""}" style="text-align:center">
        <p class="label-upper label-upper--gold">🎯 Objectif : ${escapeHtml(targetLabel)}</p>
        <p id="clutch-clock" class="clutch-clock" style="font-variant-numeric:tabular-nums">${escapeHtml(clockText)}</p>
        <p class="hint" id="clutch-clock-sub">${escapeHtml(clockSub)}</p>
        <div class="clutch-tapped" id="clutch-tapped">${tappedChipsHtml(hidden)}</div>
      </div>
      <button type="button" id="clutch-target" class="${btnClasses}"
        ${btnDisabled ? "disabled" : ""}
        style="width:220px;height:220px;margin:24px auto;display:flex;align-items:center;justify-content:center;
          border-radius:50%;border:none;cursor:${btnDisabled ? "default" : "pointer"};
          font-size:1.4rem;font-weight:900;color:#fff;
          background:${tapped ? "linear-gradient(145deg,#34D399,#60A5FA)" : "radial-gradient(circle at 50% 35%, #FF6B6B 0%, #FF3CAC 55%, #2B2D66 100%)"};
          box-shadow:0 12px 40px rgba(255,60,172,.35);opacity:${(localWindowClosed && !tapped) || counting ? ".5" : "1"}">
        ${tapped ? "✓ Tapé" : "TAP !"}
      </button>
      <p class="hint" style="text-align:center">${escapeHtml(status)}</p>`;
  }

  function revealHtml() {
    const ranking = lastRound?.ranking || rankClutchResults(taps, targetMs, getActivePlayerNames());
    const host = !mp || canActAsHost();
    const deltas = lastRound?.deltas || {};

    const rows = ranking
      .map((entry, idx) => {
        const meta = playerMeta(entry.name);
        const medal = entry.tapped && idx < 3 ? ["🥇", "🥈", "🥉"][idx] : "";
        const pts = deltas[entry.name];
        const posHtml = medal
          ? medal
          : `<span class="clutch-rank__num">${idx + 1}</span>`;
        const detail = entry.tapped
          ? `tapé à <strong>${escapeHtml(formatClutchSecondsMs(entry.ms))}</strong> · écart ${escapeHtml(formatClutchGap(entry.ms, targetMs))}`
          : "pas tapé";
        return `
          <div class="clutch-rank__row ${entry.tapped ? "" : "clutch-rank__row--out"}">
            <span class="clutch-rank__pos">${posHtml}</span>
            <span class="clutch-rank__avatar" style="--clutch-chip:${meta.color}">${meta.emoji}</span>
            <span class="clutch-rank__body">
              <span class="clutch-rank__name" style="color:${meta.color}">${escapeHtml(entry.name)}</span>
              <span class="clutch-rank__detail">${detail}</span>
            </span>
            <span class="clutch-rank__pts ${pts ? "clutch-rank__pts--gain" : ""}">${pts ? `+${pts}` : "-"}</span>
          </div>`;
      })
      .join("");

    return `
      <h3 class="section-title">Verdict de la manche</h3>
      <p class="hint">🎯 La cible était <strong>${escapeHtml(formatClutchSeconds(targetMs))}</strong></p>
      <div class="clutch-rank">${rows}</div>
      ${gameCumulativeScoresHtml({
        gameLabel: "Clutch",
        title: "Cumul des scores",
        scores: sessionScores(),
      })}
      ${
        host
          ? `<button type="button" class="btn btn-primary btn--spaced" id="next-round">
              ${roundIdx < totalRounds - 1 ? "Manche suivante →" : "Voir les résultats →"}
            </button>`
          : `<p class="hint">En attente de l'hôte pour la suite…</p>`
      }`;
  }

  function render() {
    syncFromSession();
    ensureRoundTiming();
    stopClock();
    clearCopyTimer();

    let phaseHtml = "";
    if (phase === "active") phaseHtml = activeHtml();
    if (phase === "reveal") phaseHtml = revealHtml();

    app.innerHTML = pageShell({
      backTarget: "back",
      content: `
        <div class="game-header">
          <div class="dots">${Array.from({ length: totalRounds }, (_, i) =>
            `<span class="dot ${i === roundIdx ? "dot--active" : i < roundIdx ? "dot--done" : ""}"></span>`
          ).join("")}</div>
          <span class="muted">${roundIdx + 1}/${totalRounds}</span>
        </div>
        <div class="logo logo--sm"><h1>CLUTCH 💥</h1></div>
        ${phaseHtml}
        ${gameExitBarHtml()}
      `,
    });

    bindNav(app);
    bindExitGame(app);

    if (phase === "active") {
      if (localStart == null) startCountdown();
      else startClock();
    }

    app.querySelector("#clutch-target")?.addEventListener("click", () => {
      if (
        phase !== "active" ||
        localStart == null ||
        myTapMs() != null ||
        localWindowClosed ||
        isEveningGameplayPaused()
      ) {
        return;
      }
      const ms = Math.round(performance.now() - localStart);
      taps = { ...taps, [localName]: { ms, at: Date.now() } };
      vibrate(35);
      render();
      void commitClutchTap(ms).then(() => {
        if (!mp) {
          void goToReveal();
          return;
        }
        if (allClutchTapsIn() && canActAsHost()) void goToReveal();
      });
    });

    app.querySelector("#next-round")?.addEventListener("click", withClickLock(async () => {
      if (roundIdx < totalRounds - 1) {
        await startClutchRound(roundIdx + 1);
        syncFromSession();
        render();
      } else {
        recordClutchPlayed();
        const winner = (lastRound?.ranking || []).find((r) => r.tapped)?.name || "-";
        setLastGame({
          gameId: "clutch",
          title: "Clutch",
          summary: `${totalRounds} manches · dernier gagnant : ${winner}`,
        });
        if (mp) {
          try {
            await completeGameSession({ gameId: "clutch", screen: "results", state: {} });
          } catch (e) {
            console.warn("REVEAL completeGameSession:", e);
            navigate("results", { navStack: ["home", "lobby", "game-select", "results"] });
          }
        } else {
          setLobbyWaiting();
          navigate("results", { navStack: ["home", "lobby", "game-select", "results"] });
        }
      }
    }));
  }

  const unsub = onGameSessionChange((row) => {
    if (stopGameSessionListenerOnPostGame(row, { cleanup: () => {
      clearGrace();
      stopClock();
    } })) return;

    const prevPhase = phase;
    const prevKey = activeKey;
    syncFromSession();
    ensureRoundTiming();
    if (phase === "active" && canActAsHost() && allClutchTapsIn()) {
      void goToReveal();
      return;
    }
    // Tap distant pendant la même manche active : maj légère (chips + compteur)
    // pour ne pas réinitialiser le chrono ni les animations.
    if (phase === "active" && prevPhase === "active" && activeKey === prevKey) {
      refreshActiveLive();
      return;
    }
    if (phase === "reveal" && prevPhase === "reveal") {
      refreshGameScoresBox(app, {
        gameLabel: "Clutch",
        title: "Cumul des scores",
        scores: sessionScores(),
      });
      return;
    }
    render();
  });

  render();

  return () => {
    clearGrace();
    stopClock();
    clearCopyTimer();
    unsub();
  };
}
