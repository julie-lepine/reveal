import { TRAITRE_POINTS } from "../../data/traitre.js";
import {
  allTraitreDealAcksIn,
  allTraitreVotesIn,
  awardTraitreGame,
  buildTraitreEliminationPatch,
  buildTraitreTieRevotePatch,
  commitTraitreDealAck,
  commitTraitrePlay,
  commitTraitreVote,
  countTraitreVotes,
  countTraitreVotesCast,
  normalizeTraitreVotes,
  getCurrentTraitreSpeaker,
  getMyTraitreWord,
  getTraitreEntryScreen,
  getTraitrePair,
  getTraitreSession,
  getTraitreSpeakOrder,
  getTraitrePendingVoters,
  getTraitreVoteTargets,
  isTraitrePrivateRoleReady,
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
  let revotePending = false;
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
    revotePending = Boolean(s.revotePending);
    lastEliminated = s.lastEliminated || null;
    impostorRevealed = Boolean(s.impostorRevealed);
    winner = s.winner || null;
    voteSurvivals = s.voteSurvivals ?? 0;
  }

  function playerMeta(name) {
    const p = getLobbyParticipants().find((x) => x.name === name);
    return { color: p?.color || "#A78BFA", emoji: p?.emoji || "🎭" };
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
          ...buildTraitreTieRevotePatch(s),
        });
        return;
      }

      const eliminatedName = leaders[0];
      const patch = buildTraitreEliminationPatch({ ...s, votes: votesToUse }, eliminatedName);
      let merged = { ...s, ...patch, votes: votesToUse };
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

  function speakOrderHtml(session) {
    const order = getTraitreSpeakOrder(session);
    const current = getCurrentTraitreSpeaker(session);
    return `
      <div class="traitre-order card">
        <p class="card-heading">Ordre des indices — manche ${session.speakRound || 1}</p>
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
            ? `<p class="hint traitre-order__now">C'est au tour de <strong>${escapeHtml(current)}</strong> — dis un indice à voix haute (sans prononcer ton mot).</p>`
            : ""
        }
        ${
          (session.speakRound || 1) > 1
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
      </div>
      ${
        revotePending
          ? `<p class="hint traitre-vote-tie">Égalité au vote — <strong>revote obligatoire</strong>.</p>`
          : ""
      }`;
  }

  function render() {
    syncFromSession();
    const session = getTraitreSession();
    const pair = getTraitrePair(session);
    const myWord = getMyTraitreWord(session);
    const host = !mp || isLobbyHost();
    const roleReady = isTraitrePrivateRoleReady(session);
    let phaseHtml = "";

    if (phase === "deal") {
      phaseHtml = roleReady
        ? `
        <div class="card traitre-word-card">
          <p class="label-upper label-upper--gold">Ton mot secret</p>
          <p class="traitre-word">${escapeHtml(myWord || "…")}</p>
          <p class="hint">Ne montre pas ton écran. Mémorise ce mot — tu devras donner un indice sans le prononcer.</p>
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
          <p class="hint">${revotePending ? "Revote obligatoire." : "Qui est le fake ?"} ${votedCount}/${alive.length} vote(s).</p>
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
            : `<p class="hint">Tu as été éliminé — tu ne peux plus voter.</p>`
        }
        ${
          host
            ? `<button type="button" class="btn btn-secondary btn--spaced" id="btn-force-vote">Clôturer le vote (${votedCount}/${alive.length})</button>`
            : isAlive
              ? `<p class="hint">En attente des votes…</p>`
              : `<p class="hint">En attente de la clôture du vote…</p>`
        }`;
    } else if (phase === "final") {
      const impostor = session.impostorName;
      const lastRound = session.lastRound || {};
      const deltas = lastRound.deltas || {};
      phaseHtml = `
        <div class="card traitre-final">
          <p class="card-heading">${winner === "traitre" ? "Le fake gagne !" : "Le fake est démasqué !"}</p>
          <p class="hint">Le fake était <strong>${escapeHtml(impostor || "?")}</strong>.</p>
          ${
            pair
              ? `<p class="hint">Mots : majorité « ${escapeHtml(pair.a)} » · fake « ${escapeHtml(pair.b)} » (${escapeHtml(pair.theme || "")})</p>`
              : ""
          }
          ${
            winner === "traitre"
              ? `<p class="hint">+${TRAITRE_POINTS.INTRUS_WIN} pts victoire${voteSurvivals ? ` · +${voteSurvivals * TRAITRE_POINTS.INTRUS_SURVIVE_VOTE} pts survie` : ""}</p>`
              : `<p class="hint">+${TRAITRE_POINTS.CIVIL_CORRECT_VOTE} pts pour ceux qui ont voté le fake au bon moment.</p>`
          }
          <div class="traitre-delta-list">
            ${Object.entries(deltas)
              .map(
                ([name, pts]) => `
              <div class="traitre-delta-list__row">
                <span>${escapeHtml(name)}</span>
                <strong>+${pts}</strong>
              </div>`
              )
              .join("") || `<p class="hint">Aucun point cette partie.</p>`}
          </div>
        </div>
        <button type="button" class="btn btn-primary btn--spaced" id="btn-traitre-exit">Retour au menu jeux</button>`;
    }

    if (lastEliminated && phase === "speak" && speakRound > 1) {
      phaseHtml = `
        <p class="hint traitre-elim-banner">${escapeHtml(lastEliminated)} a été éliminé — nouvelle manche d'indices.</p>
        ${phaseHtml}`;
    }

    app.innerHTML = pageShell({
      backTarget: "back",
      scroll: true,
      content: `
        <div class="screen-title-row">
          <p class="label-upper label-upper--gold">🎭 Spot the fake</p>
          ${rulesButtonHtml("traitre")}
        </div>
        <p class="hint">${alive.length} survivant(s) · manche indices ${speakRound}${voteSurvivals ? ` · ${voteSurvivals} vote(s) survécu(s) par le fake` : ""}</p>
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
      void advanceSpeaker();
    });

    app.querySelector("#btn-continue")?.addEventListener("click", () => {
      void continueSpeakRound();
    });

    app.querySelector("#btn-vote-now")?.addEventListener("click", () => {
      void startVoteFromDecision();
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
