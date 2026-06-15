import { TRAITRE_POINTS } from "../../data/traitre.js";
import {
  allTraitreDealAcksIn,
  allTraitreVotesIn,
  awardTraitreGame,
  buildTraitreEliminationPatch,
  buildTraitreTieSpeakPatch,
  commitTraitreDealAck,
  commitTraitrePlay,
  commitTraitreVote,
  countTraitreVotes,
  countTraitreVotesCast,
  normalizeTraitreVotes,
  getCurrentTraitreSpeaker,
  getMyTraitreWord,
  getTraitreEntryScreen,
  getTraitreResultPair,
  getTraitreSession,
  getTraitreSpeakOrder,
  getTraitrePendingVoters,
  getTraitreVoteTargets,
  isTraitrePrivateRoleReady,
  isTraitreTieSpeakRound,
  isTraitreWordDealReady,
  simulateTraitreVotes,
} from "../core/traitreSession.js";
import { getLobbyParticipants } from "../core/lobby.js";
import { getLocalDisplayName, recordTraitrePlayed, setLastGame } from "../core/state.js";
import { setLobbyPlaying, setLobbyWaiting } from "../core/lobby.js";
import { requireLobbyPlay } from "../core/gameGuard.js";
import { rulesButtonHtml } from "../core/gameRulesUi.js";
import { navigate } from "../core/router.js";
import { escapeHtml, pageShell } from "../core/ui.js";
import { bindNav } from "../screens/nav.js";
import { gameExitBarHtml, bindExitGame } from "../core/exitGame.js";
import {
  isGameSyncActive,
  isLobbyHost,
  onGameSessionChange,
  returnToGameSelect,
} from "../core/gameSync.js";

export function mountTraitre(app) {
  if (!requireLobbyPlay()) return null;

  const entry = getTraitreEntryScreen();
  if (entry !== "traitre") {
    navigate(entry);
    return null;
  }

  setLobbyPlaying("traitre");

  let phase = "deal";
  let speakRound = 1;
  let speakerIndex = 0;
  let alive = [];
  let eliminated = [];
  let votes = {};
  let lastEliminated = null;
  let impostorRevealed = false;
  let winner = null;
  let voteSurvivals = 0;
  let resolveInFlight = false;
  let roleSyncInFlight = false;

  const localName = getLocalDisplayName();
  const mp = isGameSyncActive();

  async function ensurePrivateRole() {
    if (!mp || isLobbyHost() || isTraitrePrivateRoleReady()) return;
    if (roleSyncInFlight) return;
    const pairId = getTraitreSession().pairId;
    if (!pairId) return;
    roleSyncInFlight = true;
    try {
      const { syncTraitrePrivateRole } = await import("../core/traitrePrivate.js");
      await syncTraitrePrivateRole(pairId, { maxAttempts: 8, delayMs: 500 });
    } finally {
      roleSyncInFlight = false;
    }
  }

  function syncFromSession() {
    const s = getTraitreSession();
    phase = s.phase || "deal";
    speakRound = s.speakRound ?? 1;
    speakerIndex = s.speakerIndex ?? 0;
    alive = [...(s.alive || [])];
    eliminated = [...(s.eliminated || [])];
    votes = { ...(s.votes || {}) };
    lastEliminated = s.lastEliminated || null;
    impostorRevealed = Boolean(s.impostorRevealed);
    winner = s.winner || null;
    voteSurvivals = s.voteSurvivals ?? 0;
  }

  function playerMeta(name) {
    const p = getLobbyParticipants().find((x) => x.name === name);
    return { color: p?.color || "#A78BFA", emoji: p?.emoji || "🎭" };
  }

  function traitreFinalHtml(session) {
    const lastRound = session.lastRound || {};
    const resultWinner = lastRound.winner ?? winner;
    const resultImpostor = lastRound.impostorName ?? session.impostorName;
    const resultPair = getTraitreResultPair(session);
    const resultVoteSurvivals = lastRound.voteSurvivals ?? voteSurvivals;
    const deltas = lastRound.deltas || {};
    const fakeWon = resultWinner === "traitre";
    const impostorMeta = playerMeta(resultImpostor || "?");

    const scoreRows = Object.entries(deltas)
      .sort(([, a], [, b]) => b - a)
      .map(([name, pts]) => {
        const meta = playerMeta(name);
        const isFake = name === resultImpostor;
        return `
          <div class="traitre-delta-list__row ${pts > 0 ? "traitre-delta-list__row--scored" : ""} ${isFake ? "traitre-delta-list__row--fake" : ""}">
            <span class="traitre-delta-list__player">
              <span class="recap-card__avatar" style="background:${meta.color}">${meta.emoji}</span>
              <span class="traitre-delta-list__name">${escapeHtml(name)}${isFake ? '<span class="traitre-final__fake-tag">fake</span>' : ""}</span>
            </span>
            <strong class="traitre-delta-list__pts ${pts > 0 ? "traitre-delta-list__pts--gain" : "traitre-delta-list__pts--zero"}">${pts > 0 ? `+${pts}` : "0"}</strong>
          </div>`;
      })
      .join("");

    const wordsHtml = resultPair
      ? `
        <div class="traitre-final__words">
          <p class="traitre-final__words-label">Les mots de la partie</p>
          <div class="traitre-final__word-pair">
            <div class="traitre-final__word traitre-final__word--majority">
              <span class="traitre-final__word-role">Majorité</span>
              <span class="traitre-final__word-value">${escapeHtml(resultPair.a)}</span>
            </div>
            <div class="traitre-final__word traitre-final__word--fake">
              <span class="traitre-final__word-role">Fake</span>
              <span class="traitre-final__word-value">${escapeHtml(resultPair.b)}</span>
            </div>
          </div>
          ${resultPair.theme ? `<p class="traitre-final__theme">${escapeHtml(resultPair.theme)}</p>` : ""}
        </div>`
      : "";

    const pointsHint = fakeWon
      ? `+${TRAITRE_POINTS.INTRUS_WIN} pts victoire${resultVoteSurvivals ? ` · +${resultVoteSurvivals * TRAITRE_POINTS.INTRUS_SURVIVE_VOTE} pts par vote survécu` : ""}`
      : `+${TRAITRE_POINTS.CIVIL_CORRECT_VOTE} pts pour un vote correct sur le fake`;

    return `
      <div class="card traitre-final ${fakeWon ? "traitre-final--fake-wins" : "traitre-final--fake-caught"}">
        <div class="traitre-final__hero">
          <span class="traitre-final__emoji" aria-hidden="true">${fakeWon ? "🥳" : "🎯"}</span>
          <p class="traitre-final__title">${fakeWon ? "Le fake gagne !" : "Le fake est démasqué !"}</p>
        </div>

        <div class="traitre-final__impostor">
          <span class="recap-card__avatar traitre-final__impostor-avatar" style="background:${impostorMeta.color}">${impostorMeta.emoji}</span>
          <div class="traitre-final__impostor-text">
            <span class="traitre-final__impostor-label">${fakeWon ? "Le fake" : "C'était"}</span>
            <strong class="traitre-final__impostor-name">${escapeHtml(resultImpostor || "?")}</strong>
          </div>
        </div>

        ${wordsHtml}

        <div class="traitre-final__scores">
          <p class="traitre-final__points-rule">${pointsHint}</p>
          <div class="traitre-delta-list">
            ${scoreRows || `<p class="hint traitre-final__no-points">Aucun point cette partie.</p>`}
          </div>
        </div>
      </div>
      <button type="button" class="btn btn-primary btn--spaced" id="btn-traitre-exit">Retour au menu jeux</button>`;
  }

  async function maybeAdvanceFromDeal() {
    if (phase !== "deal" || !allTraitreDealAcksIn()) return;
    if (mp && !isLobbyHost()) return;
    await commitTraitrePlay({
      ...getTraitreSession(),
      phase: "speak",
      speakerIndex: 0,
    });
  }

  async function advanceSpeaker() {
    if (mp && !isLobbyHost()) return;
    const s = getTraitreSession();
    const order = getTraitreSpeakOrder(s);
    const nextIndex = (s.speakerIndex || 0) + 1;
    const basePatch = s.lastEliminated ? { lastEliminated: null } : {};
    if (nextIndex < order.length) {
      await commitTraitrePlay({ ...s, ...basePatch, speakerIndex: nextIndex });
      return;
    }
    if (s.speakRound === 1) {
      await commitTraitrePlay({ ...s, ...basePatch, phase: "decision" });
      return;
    }
    await commitTraitrePlay({
      ...s,
      ...basePatch,
      phase: "vote",
      votes: {},
      revotePending: false,
      revoteCount: 0,
      tieAfterVote: false,
    });
  }

  async function continueSpeakRound() {
    if (mp && !isLobbyHost()) return;
    const s = getTraitreSession();
    await commitTraitrePlay({
      ...s,
      phase: "speak",
      speakRound: (s.speakRound || 1) + 1,
      speakerIndex: 0,
    });
  }

  async function startVoteFromDecision() {
    if (mp && !isLobbyHost()) return;
    const s = getTraitreSession();
    await commitTraitrePlay({
      ...s,
      phase: "vote",
      votes: {},
      revotePending: false,
      revoteCount: 0,
      tieAfterVote: false,
    });
  }

  async function resolveVoteRound() {
    if (resolveInFlight) return;
    if (mp && !isLobbyHost()) return;
    const s = getTraitreSession();
    if (s.phase !== "vote" || !allTraitreVotesIn(s)) return;

    resolveInFlight = true;
    try {
      const aliveNow = s.alive || [];
      let votesToUse = normalizeTraitreVotes(s.votes || {}, aliveNow);
      if (!mp) {
        aliveNow.forEach((name) => {
          if (votesToUse[name] == null) {
            const pool = aliveNow.filter((n) => n !== name);
            if (pool.length) votesToUse[name] = pool[Math.floor(Math.random() * pool.length)];
          }
        });
      }

      const { leaders, isTie } = countTraitreVotes(votesToUse, aliveNow);
      if (isTie) {
        await commitTraitrePlay({
          ...s,
          ...buildTraitreTieSpeakPatch(s),
        });
        render();
        return;
      }

      const eliminatedName = leaders[0];
      const patch = buildTraitreEliminationPatch({ ...s, votes: votesToUse }, eliminatedName);
      let merged = { ...s, ...patch };
      if (patch.phase === "final" && (!mp || isLobbyHost())) {
        merged = awardTraitreGame(merged);
        recordTraitrePlayed();
        setLastGame({
          gameId: "traitre",
          title: "Spot the fake",
          summary:
            patch.winner === "traitre"
              ? `Victoire du fake · ${s.impostorName}`
              : `Fake éliminé · ${eliminatedName}`,
        });
      }
      await commitTraitrePlay(merged, {
        withEveningScores: patch.phase === "final" && mp && isLobbyHost(),
      });
      render();
    } finally {
      resolveInFlight = false;
    }
  }

  async function finishAndExit() {
    try {
      if (mp) {
        await returnToGameSelect();
        return;
      }
      await setLobbyWaiting();
      navigate("game-select", { navStack: ["home", "lobby", "game-select"] });
    } catch (e) {
      console.warn("traitre exit:", e);
      navigate("game-select", { navStack: ["home", "lobby", "game-select"] });
    }
  }

  function tieSpeakBannerHtml(session) {
    if (!isTraitreTieSpeakRound(session)) return "";
    return `
      <div class="card card--highlight traitre-tie-speak-banner">
        <p class="card-heading">Égalité au vote</p>
        <p class="hint">Impossible de trancher : personne n'est éliminé.</p>
        <p class="hint">Nouvelle manche d'indices avec les mêmes mots. Pense à un indice différent.</p>
      </div>`;
  }

  function speakOrderHtml(session) {
    const order = getTraitreSpeakOrder(session);
    const current = getCurrentTraitreSpeaker(session);
    return `
      ${tieSpeakBannerHtml(session)}
      <div class="traitre-order card">
        <p class="card-heading">Ordre des indices - manche ${session.speakRound || 1}</p>
        <ol class="traitre-order__list">
          ${order
            .map(
              (name, idx) => `
            <li class="traitre-order__item ${name === current ? "traitre-order__item--active" : ""} ${idx < (session.speakerIndex || 0) ? "traitre-order__item--done" : ""}">
              <span class="recap-card__avatar" style="background:${playerMeta(name).color}">${playerMeta(name).emoji}</span>
              <span>${escapeHtml(name)}${name === current ? " · en cours" : ""}</span>
            </li>`
            )
            .join("")}
        </ol>
        ${
          current
            ? `<p class="hint traitre-order__now">C'est au tour de <strong>${escapeHtml(current)}</strong> - dis un indice à voix haute (sans prononcer ton mot).</p>`
            : ""
        }
        ${
          (session.speakRound || 1) > 1 && !isTraitreTieSpeakRound(session)
            ? `<p class="hint">Rappel : indices <strong>différents</strong> des manches précédentes.</p>`
            : ""
        }
      </div>`;
  }

  function voteGridHtml() {
    const targets = getTraitreVoteTargets();
    const normalizedVotes = normalizeTraitreVotes(votes, alive);
    const myVote = normalizedVotes[localName];
    return `
      <div class="traitre-vote-grid">
        ${targets
          .map((p) => {
            const active = myVote === p.name;
            return `
            <button type="button" class="traitre-vote-btn ${active ? "traitre-vote-btn--active" : ""}"
              data-traitre-vote="${escapeHtml(p.name)}" ${myVote && !active ? "disabled" : ""}>
              <span class="recap-card__avatar" style="background:${p.color}">${p.emoji}</span>
              <span>${escapeHtml(p.name)}</span>
            </button>`;
          })
          .join("")}
      </div>`;
  }

  function traitrePhaseTitle(currentPhase) {
    const titles = {
      deal: "Mot secret",
      speak: "Indices oraux",
      decision: "Fin de manche 1",
      vote: "Vote d'élimination",
      final: "Résultat",
    };
    return titles[currentPhase] || "Partie";
  }

  function render() {
    syncFromSession();
    const session = getTraitreSession();
    const myWord = getMyTraitreWord(session);
    const host = !mp || isLobbyHost();
    const wordDealReady = isTraitreWordDealReady(session);
    let phaseHtml = "";

    if (phase === "deal") {
      phaseHtml = wordDealReady
        ? `
        <div class="card traitre-word-card">
          <p class="label-upper label-upper--gold">Ton mot secret</p>
          <p class="traitre-word">${escapeHtml(myWord)}</p>
          <p class="hint">Ne montre pas ton écran. Mémorise ce mot - tu devras donner un indice sans le prononcer.</p>
          ${
            session.dealAcks?.[localName]
              ? `<p class="hint">En attente des autres joueurs…</p>`
              : `<button type="button" class="btn btn-primary btn--spaced" id="btn-deal-ack">J'ai mémorisé mon mot</button>`
          }
        </div>`
        : `
        <div class="card traitre-word-card">
          <p class="label-upper label-upper--gold">Ton mot secret</p>
          <p class="hint">Chargement de ton mot…</p>
        </div>`;
    } else if (phase === "speak") {
      phaseHtml = `
        ${speakOrderHtml(session)}
        ${
          host
            ? `<button type="button" class="btn btn-primary btn--spaced" id="btn-next-speaker">
                ${getCurrentTraitreSpeaker(session) ? "Indice suivant →" : "Commencer les indices →"}
              </button>`
            : `<p class="hint">En attente de l'hôte pour avancer…</p>`
        }`;
    } else if (phase === "decision") {
      phaseHtml = `
        <div class="card">
          <p class="card-heading">Fin de la manche 1</p>
          <p class="hint">Continuer une manche d'indices ou passer au vote d'élimination ?</p>
        </div>
        ${
          host
            ? `<div class="traitre-decision-btns">
                <button type="button" class="btn btn-secondary btn--spaced" id="btn-continue">Continuer (indices)</button>
                <button type="button" class="btn btn-primary btn--spaced" id="btn-vote-now">Voter maintenant</button>
              </div>`
            : `<p class="hint">En attente du choix de l'hôte…</p>`
        }`;
    } else if (phase === "vote") {
      const normalizedVotes = normalizeTraitreVotes(votes, alive);
      const votedCount = countTraitreVotesCast(normalizedVotes, alive);
      const isAlive = alive.includes(localName);
      const pendingVoters = getTraitrePendingVoters({ ...session, votes: normalizedVotes });
      phaseHtml = `
        <div class="card">
          <p class="card-heading">Vote d'élimination</p>
          <p class="hint">Qui est le fake ? ${votedCount}/${alive.length} vote(s).</p>
          ${
            eliminated.length
              ? `<p class="hint">Éliminé(s) : ${eliminated.map((n) => escapeHtml(n)).join(", ")}</p>`
              : ""
          }
          ${
            host && pendingVoters.length
              ? `<p class="hint">En attente : ${pendingVoters.map((n) => escapeHtml(n)).join(", ")}</p>`
              : ""
          }
        </div>
        ${
          isAlive
            ? voteGridHtml()
            : `<p class="hint">Tu as été éliminé - tu ne peux plus voter.</p>`
        }
        ${
          host
            ? `<button type="button" class="btn btn-secondary btn--spaced" id="btn-force-vote">Clôturer le vote (${votedCount}/${alive.length})</button>`
            : isAlive
              ? `<p class="hint">En attente des votes…</p>`
              : `<p class="hint">En attente de la clôture du vote…</p>`
        }`;
    } else if (phase === "final") {
      phaseHtml = traitreFinalHtml(session);
    }

    if (lastEliminated && phase === "speak" && speakRound > 1) {
      phaseHtml = `
        <p class="hint traitre-elim-banner">${escapeHtml(lastEliminated)} a été éliminé - nouvelle manche d'indices.</p>
        ${phaseHtml}`;
    }

    app.innerHTML = pageShell({
      backTarget: "back",
      scroll: true,
      content: `
        <p class="label-upper label-upper--gold">🎭 Spot the fake</p>
        <div class="screen-title-row">
          <h2 class="screen-title">${escapeHtml(traitrePhaseTitle(phase))}</h2>
          ${rulesButtonHtml("traitre")}
        </div>
        ${
          phase === "final"
            ? ""
            : `<p class="hint">${alive.length} survivant(s) · manche indices ${speakRound}${voteSurvivals ? ` · ${voteSurvivals} vote(s) survécu(s) par le fake` : ""}</p>`
        }
        ${phaseHtml}
        ${gameExitBarHtml()}
      `,
    });

    bindNav(app);
    bindExitGame(app);

    app.querySelector("#btn-deal-ack")?.addEventListener("click", async () => {
      await commitTraitreDealAck();
      if (!mp) {
        const s = getTraitreSession();
        const acks = { ...(s.dealAcks || {}) };
        alive.filter((n) => n !== localName).forEach((n) => {
          acks[n] = true;
        });
        await commitTraitrePlay({ ...s, dealAcks: acks });
      }
      await maybeAdvanceFromDeal();
      render();
    });

    app.querySelector("#btn-next-speaker")?.addEventListener("click", () => {
      void advanceSpeaker().then(() => render());
    });

    app.querySelector("#btn-continue")?.addEventListener("click", () => {
      void continueSpeakRound().then(() => render());
    });

    app.querySelector("#btn-vote-now")?.addEventListener("click", () => {
      void startVoteFromDecision().then(() => render());
    });

    app.querySelectorAll("[data-traitre-vote]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (phase !== "vote" || !alive.includes(localName)) return;
        const target = btn.getAttribute("data-traitre-vote");
        await commitTraitreVote(target);
        if (!mp) {
          const s = getTraitreSession();
          const merged = simulateTraitreVotes(target, s);
          await commitTraitrePlay({ ...s, votes: { ...merged, [localName]: target } });
        }
        if (allTraitreVotesIn(getTraitreSession()) && (!mp || isLobbyHost())) {
          await resolveVoteRound();
        }
        render();
      });
    });

    app.querySelector("#btn-force-vote")?.addEventListener("click", () => {
      void resolveVoteRound().then(() => render());
    });

    app.querySelector("#btn-traitre-exit")?.addEventListener("click", () => {
      void finishAndExit();
    });
  }

  const unsub = onGameSessionChange(async () => {
    syncFromSession();
    await ensurePrivateRole();
    if (phase === "deal") {
      await maybeAdvanceFromDeal();
    }
    if (phase === "vote" && isLobbyHost() && allTraitreVotesIn(getTraitreSession())) {
      await resolveVoteRound();
    }
    render();
  });

  void ensurePrivateRole().then(() => render());
  render();

  return () => {
    unsub();
  };
}
