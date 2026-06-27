import {
  RACE_TO_ZERO_GRACE_MS,
  formatRaceToZeroSeconds,
  formatRaceToZeroGap,
} from "../../data/raceToZero.js";
import {
  getRaceToZeroEntryScreen,
  getRaceToZeroSession,
  commitRaceToZeroTap,
  commitRaceToZeroPlay,
  allRaceToZeroTapsIn,
  rankRaceToZeroResults,
  startRaceToZeroRound,
} from "../core/raceToZeroSession.js";
import { awardRaceToZeroRound } from "../core/scoring.js";
import { applyMatchScoreDeltas, gameCumulativeScoresHtml, refreshGameScoresBox } from "../core/gameScores.js";
import { getLocalDisplayName, recordRaceToZeroPlayed, setLastGame } from "../core/state.js";
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
  onGameSessionChange,
  completeGameSession,
} from "../core/gameSync.js";

export function mountRaceToZero(app) {
  if (!requireLobbyPlay()) return null;

  const entry = getRaceToZeroEntryScreen();
  if (entry !== "racetozero") {
    navigate(entry);
    return null;
  }

  void setLobbyPlaying("racetozero").catch(() => {});

  let roundIdx = 0;
  let phase = "active";
  let targetMs = null;
  let taps = {};
  let lastRound = null;
  let lastAward = null;
  let takeScored = false;
  let revealInFlight = false;

  let localStart = null;
  let activeKey = null;
  let localWindowClosed = false;
  let graceTimer = null;

  const localName = getLocalDisplayName();
  const mp = isGameSyncActive();
  const totalRounds = getRaceToZeroSession().roundCount ?? 5;

  function myTapMs() {
    const t = taps[localName];
    return t && typeof t.ms === "number" ? t.ms : null;
  }

  function clearGrace() {
    if (graceTimer) clearTimeout(graceTimer);
    graceTimer = null;
  }

  function alreadyScoredThisRound() {
    if (phase !== "reveal") return false;
    return takeScored || Boolean(getRaceToZeroSession().roundScored);
  }

  function syncFromSession() {
    const s = getRaceToZeroSession();
    if (s.roundIdx != null) roundIdx = s.roundIdx;
    if (s.phase) phase = s.phase;
    if (s.targetMs != null) targetMs = s.targetMs;
    taps = { ...(s.taps || {}) };
    lastRound = s.lastRound ?? lastRound;
    takeScored = Boolean(s.roundScored);
  }

  /** Démarre le chrono local d'une nouvelle manche active + programme la clôture (cible + grâce). */
  function ensureRoundTiming() {
    const s = getRaceToZeroSession();
    if (phase === "active") {
      const key = `${roundIdx}:${s.roundStartAt || ""}`;
      if (key !== activeKey) {
        activeKey = key;
        localStart = performance.now();
        localWindowClosed = false;
        clearGrace();
        const windowMs = (targetMs || 0) + RACE_TO_ZERO_GRACE_MS;
        graceTimer = setTimeout(onGraceElapsed, windowMs);
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
      const session = getRaceToZeroSession();
      const names = getActivePlayerNames();
      const ranking = rankRaceToZeroResults(session.taps || {}, targetMs, names);
      let matchScores = session.matchScores || {};
      if (!mp || canActAsHost()) {
        lastAward = awardRaceToZeroRound(ranking);
        matchScores = applyMatchScoreDeltas(matchScores, lastAward.deltas || {});
      } else {
        lastAward = { ranking, deltas: {} };
      }
      const lastRoundData = { targetMs, ranking, deltas: lastAward.deltas || {} };
      await commitRaceToZeroPlay(
        {
          phase: "reveal",
          roundScored: true,
          taps: session.taps || {},
          roundEndsAt: null,
          matchScores,
          lastRound: lastRoundData,
        },
        { withEveningScores: mp && canActAsHost() }
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
    return getRaceToZeroSession().matchScores || {};
  }

  function activeHtml() {
    const tapped = myTapMs() != null;
    const host = !mp || canActAsHost();
    const tappedCount = Object.values(taps).filter((t) => t?.ms != null).length;
    const totalPlayers = getActivePlayerNames().length;

    const targetLabel = formatRaceToZeroSeconds(targetMs);
    const status = localWindowClosed
      ? "Temps écoulé - en attente du verdict…"
      : tapped
        ? mp
          ? allRaceToZeroTapsIn()
            ? "Tout le monde a tapé !"
            : "C'est noté ! En attente des autres…"
          : "C'est noté !"
        : "Concentre-toi… et tape au bon moment 💥";

    return `
      <div class="card card--speed" style="text-align:center">
        <p class="label-upper label-upper--gold">🎯 Cible de la manche</p>
        <p class="hot-take-text" style="font-size:2.2rem;font-weight:900">${escapeHtml(targetLabel)}</p>
        <p class="hint">Le chrono est caché. Tape pile quand il atteint 0.</p>
      </div>
      <button type="button" id="race-zero-target"
        ${tapped || localWindowClosed ? "disabled" : ""}
        style="width:220px;height:220px;margin:24px auto;display:flex;align-items:center;justify-content:center;
          border-radius:50%;border:none;cursor:${tapped || localWindowClosed ? "default" : "pointer"};
          font-size:1.4rem;font-weight:900;color:#fff;
          background:${tapped ? "linear-gradient(145deg,#34D399,#60A5FA)" : "radial-gradient(circle at 50% 35%, #FF6B6B 0%, #FF3CAC 55%, #2B2D66 100%)"};
          box-shadow:0 12px 40px rgba(255,60,172,.35);opacity:${localWindowClosed && !tapped ? ".5" : "1"}">
        ${tapped ? "✓ Tapé" : "TAP !"}
      </button>
      <p class="hint" style="text-align:center">${escapeHtml(status)}</p>
      ${
        host
          ? `<button type="button" class="btn btn-secondary btn--spaced" id="race-zero-force">
              Révéler maintenant (${tappedCount}/${totalPlayers})
            </button>`
          : ""
      }`;
  }

  function revealHtml() {
    const ranking = lastRound?.ranking || rankRaceToZeroResults(taps, targetMs, getActivePlayerNames());
    const host = !mp || canActAsHost();
    const deltas = lastRound?.deltas || {};

    const rows = ranking
      .map((entry, idx) => {
        const meta = playerMeta(entry.name);
        const medal = entry.tapped && idx < 3 ? ["🥇", "🥈", "🥉"][idx] : "";
        const pts = deltas[entry.name];
        const gapLabel = entry.tapped
          ? formatRaceToZeroGap(entry.ms, targetMs)
          : "pas tapé";
        return `
          <div class="result-row">
            <div class="result-row__head">
              <span style="color:${meta.color}">${medal ? `${medal} ` : ""}${escapeHtml(entry.name)}</span>
              <span class="muted">${escapeHtml(gapLabel)}${pts ? ` · <strong>+${pts}</strong>` : ""}</span>
            </div>
          </div>`;
      })
      .join("");

    return `
      <h3 class="section-title">Verdict de la manche</h3>
      <p class="hint">🎯 La cible était <strong>${escapeHtml(formatRaceToZeroSeconds(targetMs))}</strong></p>
      ${gameCumulativeScoresHtml({
        gameLabel: "Race to Zero",
        title: "Cumul des scores",
        scores: sessionScores(),
      })}
      ${rows}
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
        <div class="logo logo--sm"><h1>RACE TO ZERO 💥</h1></div>
        ${phaseHtml}
        ${gameExitBarHtml()}
      `,
    });

    bindNav(app);
    bindExitGame(app);

    app.querySelector("#race-zero-target")?.addEventListener("click", () => {
      if (phase !== "active" || myTapMs() != null || localWindowClosed || isEveningGameplayPaused()) {
        return;
      }
      const ms = Math.round(performance.now() - localStart);
      taps = { ...taps, [localName]: { ms, at: Date.now() } };
      render();
      void commitRaceToZeroTap(ms).then(() => {
        if (!mp) {
          void goToReveal();
          return;
        }
        if (allRaceToZeroTapsIn() && canActAsHost()) void goToReveal();
      });
    });

    app.querySelector("#race-zero-force")?.addEventListener("click", () => {
      void goToReveal();
    });

    app.querySelector("#next-round")?.addEventListener("click", withClickLock(async () => {
      if (roundIdx < totalRounds - 1) {
        await startRaceToZeroRound(roundIdx + 1);
        syncFromSession();
        render();
      } else {
        recordRaceToZeroPlayed();
        const winner = (lastRound?.ranking || []).find((r) => r.tapped)?.name || "-";
        setLastGame({
          gameId: "racetozero",
          title: "Race to Zero",
          summary: `${totalRounds} manches · dernier gagnant : ${winner}`,
        });
        if (mp) {
          try {
            await completeGameSession({ gameId: "racetozero", screen: "results", state: {} });
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

  const unsub = onGameSessionChange(() => {
    const prevPhase = phase;
    syncFromSession();
    ensureRoundTiming();
    if (phase === "active" && canActAsHost() && allRaceToZeroTapsIn()) {
      void goToReveal();
      return;
    }
    if (phase === "reveal" && prevPhase === "reveal") {
      refreshGameScoresBox(app, {
        gameLabel: "Race to Zero",
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
    unsub();
  };
}
