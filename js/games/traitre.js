import { TRAITRE_POINTS } from "../../data/traitre.js";
import {
  allTraitreDealAcksIn,
  allTraitreVotesIn,
  countTraitreDealAcks,
  awardTraitreGame,
  buildTraitreEliminationPatch,
  buildTraitreTieSpeakPatch,
  commitTraitreDealAck,
  commitTraitrePlay,
  commitTraitreVote,
  countTraitreVotes,
  countTraitreVotesCast,
  normalizeTraitreVotes,
  getMyTraitreWord,
  getTraitreEntryScreen,
  getTraitreResultPair,
  getTraitreSession,
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
  eveningRecapRestartButtonHtml,
  bindRestartGameButtons,
} from "../core/restartGame.js";
import {
  isGameSyncActive,
  isLobbyHost,
  canActAsHost,
  onGameSessionChange,
  returnToGameSelect,
  stopGameSessionListenerOnPostGame,
} from "../core/gameSync.js";
import { voteConfirmChrome, pickForVoteConfirm } from "../core/voteConfirm.js";

export function mountTraitre(app) {
  if (!requireLobbyPlay()) return null;

  const entry = getTraitreEntryScreen();
  if (entry !== "traitre") {
    navigate(entry);
    return null;
  }

  void setLobbyPlaying("traitre").catch(() => {});

  let phase = "deal";
  let speakRound = 1;
  let alive = [];
  let eliminated = [];
  let votes = {};
  /** Cible locale avant « Valider mon vote » (phase vote). */
  let selectedVote = null;
  let lastEliminated = null;
  let impostorRevealed = false;
  let winner = null;
  let voteSurvivals = 0;
  let resolveInFlight = false;
  let roleSyncInFlight = false;
  /** Évite effets UI après démontage (I-05). Distinct du tableau `alive` (joueurs). */
  let mountAlive = true;

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
    alive = [...(s.alive || [])];
    eliminated = [...(s.eliminated || [])];
    votes = { ...(s.votes || {}) };
    if (phase !== "vote") {
      selectedVote = null;
    }
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
    const breakdown = lastRound.breakdown || {};
    const fakeWon = resultWinner === "traitre";
    const impostorMeta = playerMeta(resultImpostor || "?");
    const localLost = fakeWon && Boolean(localName) && localName !== resultImpostor;
    const resultEmoji = localLost ? "😔" : fakeWon ? "🥳" : "🎯";
    const showHostActions = !mp || isLobbyHost();

    const scoreNames = [
      ...new Set(
        [...(session.alive || []), ...(session.eliminated || []), resultImpostor].filter(Boolean)
      ),
    ].sort((a, b) => (deltas[b] || 0) - (deltas[a] || 0));

    const scoreRows = scoreNames
      .map((name) => {
        const pts = deltas[name] || 0;
        const meta = playerMeta(name);
        const isFake = name === resultImpostor;
        const detail = (breakdown[name] || [])
          .map((b) => `${b.label} +${b.pts}`)
          .join(" · ");
        return `
          <div class="traitre-delta-list__row ${pts > 0 ? "traitre-delta-list__row--scored" : ""} ${isFake ? "traitre-delta-list__row--fake" : ""}">
            <span class="traitre-delta-list__player">
              <span class="recap-card__avatar" style="background:${meta.color}">${meta.emoji}</span>
              <span class="traitre-delta-list__name">${escapeHtml(name)}${isFake ? '<span class="traitre-final__fake-tag">fake</span>' : ""}</span>
            </span>
            <span class="traitre-delta-list__score-col">
              <strong class="traitre-delta-list__pts ${pts > 0 ? "traitre-delta-list__pts--gain" : "traitre-delta-list__pts--zero"}">${pts > 0 ? `+${pts}` : "0"}</strong>
              ${detail ? `<span class="traitre-delta-list__detail hint">${escapeHtml(detail)}</span>` : ""}
            </span>
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
      ? `+${TRAITRE_POINTS.FAKE_WIN} victoire fake${resultVoteSurvivals ? ` · +${TRAITRE_POINTS.FAKE_SURVIVE_VOTE}/vote survécu` : ""}`
      : `+${TRAITRE_POINTS.SURVIVOR} survivant · +${TRAITRE_POINTS.DETECTIVE_BONUS} détective · +${TRAITRE_POINTS.GOOD_INTUITION} bonne intuition · fake garde +${TRAITRE_POINTS.FAKE_SURVIVE_VOTE}/vote survécu`;

    const actionsHtml = showHostActions
      ? `<div class="btn-row btn-row--stack">
        ${eveningRecapRestartButtonHtml({ gameId: "traitre", title: "Spot the fake" })}
        <button type="button" class="btn btn-primary" id="btn-traitre-exit">Retour au menu jeux</button>
      </div>`
      : `<p class="hint">En attente de l'hôte pour recommencer ou quitter…</p>`;

    return `
      <div class="card traitre-final ${fakeWon ? "traitre-final--fake-wins" : "traitre-final--fake-caught"}">
        <div class="traitre-final__hero">
          <span class="traitre-final__emoji" aria-hidden="true">${resultEmoji}</span>
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
      ${actionsHtml}`;
  }

  async function maybeAdvanceFromDeal() {
    if (phase !== "deal" || !allTraitreDealAcksIn()) return;
    if (mp && !canActAsHost()) return;
    await commitTraitrePlay({
      ...getTraitreSession(),
      phase: "speak",
      speakerIndex: 0,
    });
  }

  async function finishSpeakRound() {
    if (mp && !canActAsHost()) return;
    const s = getTraitreSession();
    const basePatch = s.lastEliminated ? { lastEliminated: null, speakerIndex: 0 } : { speakerIndex: 0 };
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
    if (mp && !canActAsHost()) return;
    const s = getTraitreSession();
    await commitTraitrePlay({
      ...s,
      phase: "speak",
      speakRound: (s.speakRound || 1) + 1,
      speakerIndex: 0,
    });
  }

  async function startVoteFromDecision() {
    if (mp && !canActAsHost()) return;
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

  async function resolveVoteRound({ force = false } = {}) {
    if (resolveInFlight) return;
    if (mp && !canActAsHost()) return;
    const s = getTraitreSession();
    if (s.phase !== "vote") return;

    const aliveNow = s.alive || [];
    let votesToUse = normalizeTraitreVotes(s.votes || {}, aliveNow);
    const votedCount = countTraitreVotesCast(votesToUse, aliveNow);

    if (force) {
      if (votedCount === 0) return;
    } else if (!allTraitreVotesIn(s)) {
      return;
    }

    resolveInFlight = true;
    try {
      if (!mp && !force) {
        aliveNow.forEach((name) => {
          if (votesToUse[name] == null) {
            const pool = aliveNow.filter((n) => n !== name);
            if (pool.length) votesToUse[name] = pool[Math.floor(Math.random() * pool.length)];
          }
        });
      }

      const { leaders, isTie } = countTraitreVotes(votesToUse, aliveNow);
      if (isTie) {
        // commitTraitrePlay sauvegarde l'état local avant le patch distant :
        // on avale une erreur de sync pour ne pas bloquer le re-render hôte.
        try {
          await commitTraitrePlay({
            ...s,
            ...buildTraitreTieSpeakPatch(s),
          });
        } catch (e) {
          console.warn("traitre tie resolve sync:", e);
        }
        return;
      }

      const eliminatedName = leaders[0];
      const patch = buildTraitreEliminationPatch({ ...s, votes: votesToUse }, eliminatedName);
      let merged = { ...s, ...patch };
      if (patch.phase === "final" && (!mp || canActAsHost())) {
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
      // L'état final est déjà appliqué localement ; un échec du patch distant
      // (patch « withEveningScores » plus lourd) ne doit pas priver l'hôte du
      // re-render - sinon il reste bloqué sur l'écran de vote.
      try {
        await commitTraitrePlay(merged, {
          withEveningScores: patch.phase === "final" && mp && canActAsHost(),
        });
      } catch (e) {
        console.warn("traitre resolve sync:", e);
      }
    } finally {
      resolveInFlight = false;
      if (!mountAlive) return;
      render();
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
        <p class="hint">Nouveau tour d'indices avec les mêmes mots. Pense à un indice différent.</p>
      </div>`;
  }

  function speakCollectiveHtml(session) {
    const players = session.alive || [];
    const round = session.speakRound || 1;
    return `
      ${tieSpeakBannerHtml(session)}
      <div class="card traitre-speak-collective">
        <p class="card-heading">Tour des mots ${round}</p>
        <p class="hint traitre-speak-collective__lead">
          Chacun dit <strong>un indice à voix haute</strong>, dans l'ordre que vous voulez.
          Ne prononce pas ton mot secret.
        </p>
        <div class="traitre-speak-collective__players">
          ${players
            .map(
              (name) => `
            <div class="traitre-speak-collective__player">
              <span class="recap-card__avatar" style="background:${playerMeta(name).color}">${playerMeta(name).emoji}</span>
              <span>${escapeHtml(name)}</span>
            </div>`
            )
            .join("")}
        </div>
        ${
          round > 1 && !isTraitreTieSpeakRound(session)
            ? `<p class="hint">Rappel : indices <strong>différents</strong> des tours précédents.</p>`
            : ""
        }
      </div>`;
  }

  function voteGridHtml(displayPick) {
    const targets = getTraitreVoteTargets();
    return `
      <div class="traitre-vote-grid">
        ${targets
          .map((p) => {
            const active = displayPick === p.name;
            return `
            <button type="button" class="traitre-vote-btn ${active ? "traitre-vote-btn--active" : ""}"
              data-traitre-vote="${escapeHtml(p.name)}">
              <span class="recap-card__avatar" style="background:${p.color}">${p.emoji}</span>
              <span>${escapeHtml(p.name)}</span>
            </button>`;
          })
          .join("")}
      </div>`;
  }

  function traitrePhaseTitle(currentPhase) {
    const titles = {
      deal: "Révélation des mots",
      speak: "Tour des mots à l'oral",
      decision: "Fin du tour 1",
      vote: "Vote d'élimination",
      final: "Résultat",
    };
    return titles[currentPhase] || "Partie";
  }

  function decisionBtnsHtml(host) {
    const disabledAttr = host ? "" : " disabled";
    return `
        ${
          host
            ? ""
            : `<p class="hint traitre-host-hint">Choix de l'hôte - tu ne peux pas agir.</p>`
        }
        <div class="traitre-decision-btns">
          <button type="button" class="btn btn-secondary btn--spaced" id="btn-continue"${disabledAttr}>Continuer (indices)</button>
          <button type="button" class="btn btn-primary btn--spaced" id="btn-vote-now"${disabledAttr}>Voter maintenant</button>
        </div>`;
  }

  function render() {
    syncFromSession();
    const session = getTraitreSession();
    const myWord = getMyTraitreWord(session);
    const host = !mp || canActAsHost();
    const wordDealReady = isTraitreWordDealReady(session);
    let phaseHtml = "";

    if (phase === "deal") {
      const dealAckCount = countTraitreDealAcks(session);
      const dealTotal = alive.length;
      phaseHtml = wordDealReady
        ? `
        <div class="card card--highlight traitre-deal-banner">
          <p class="card-heading">Tour dédié - lis ton mot en privé</p>
          <p class="hint">Chacun découvre son mot sur son téléphone, puis valide quand c'est mémorisé. Ne montre pas ton écran.</p>
          <p class="hint traitre-deal-progress">${dealAckCount}/${dealTotal} joueur(s) prêt(s)</p>
        </div>
        <div class="card traitre-word-card">
          <p class="label-upper label-upper--gold">Ton mot secret</p>
          <p class="traitre-word">${escapeHtml(myWord)}</p>
          <p class="hint">Mémorise ce mot - tu devras donner un indice à voix haute sans le prononcer.</p>
          ${
            session.dealAcks?.[localName]
              ? `<p class="hint traitre-deal-wait">✓ Mot mémorisé - en attente des autres joueurs…</p>`
              : `<button type="button" class="btn btn-primary btn--spaced" id="btn-deal-ack">J'ai mémorisé mon mot</button>`
          }
        </div>`
        : `
        <div class="card card--highlight traitre-deal-banner">
          <p class="card-heading">Tour dédié - lis ton mot en privé</p>
          <p class="hint">Chargement de la partie…</p>
        </div>
        <div class="card traitre-word-card">
          <p class="label-upper label-upper--gold">Ton mot secret</p>
          <p class="hint">Chargement de ton mot…</p>
        </div>`;
    } else if (phase === "speak") {
      phaseHtml = `
        ${speakCollectiveHtml(session)}
        ${
          host
            ? `<button type="button" class="btn btn-primary btn--spaced" id="btn-finish-speak">Finaliser le tour des mots →</button>`
            : `<p class="hint">En attente que l'hôte finalise le tour quand tout le monde a parlé…</p>`
        }`;
    } else if (phase === "decision") {
      phaseHtml = `
        <div class="card">
          <p class="card-heading">Fin du tour 1</p>
          <p class="hint">Continuer un tour d'indices ou passer au vote d'élimination ?</p>
        </div>
        ${decisionBtnsHtml(host)}`;
    } else if (phase === "vote") {
      const normalizedVotes = normalizeTraitreVotes(votes, alive);
      const committedVote = normalizedVotes[localName];
      const votedCount = countTraitreVotesCast(normalizedVotes, alive);
      const isAlive = alive.includes(localName);
      const pendingVoters = getTraitrePendingVoters({ ...session, votes: normalizedVotes });
      const allIn = allTraitreVotesIn({ ...session, votes: normalizedVotes });
      const confirm = voteConfirmChrome({
        selected: selectedVote,
        committed: committedVote,
        allIn,
        emptyHint: "Qui est le fake ?",
      });
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
            ? `${voteGridHtml(confirm.displayPick)}
          <p class="hint">${escapeHtml(confirm.hint)}</p>
          <button type="button" class="btn ${confirm.confirmClass} btn--spaced" id="traitre-confirm-vote"
            ${confirm.confirmDisabled ? "disabled" : ""}>${escapeHtml(confirm.confirmLabel)}</button>`
            : `<p class="hint">Tu as été éliminé - tu ne peux plus voter.</p>`
        }
        ${
          host
            ? `<button type="button" class="btn btn-secondary btn--spaced" id="btn-force-vote" ${votedCount === 0 ? "disabled" : ""}>Clôturer le vote (${votedCount}/${alive.length})</button>`
            : isAlive
              ? `<p class="hint">En attente des votes…</p>`
              : `<p class="hint">En attente de la clôture du vote…</p>`
        }`;
    } else if (phase === "final") {
      phaseHtml = traitreFinalHtml(session);
    }

    if (lastEliminated && phase === "speak" && speakRound > 1) {
      phaseHtml = `
        <p class="hint traitre-elim-banner">${escapeHtml(lastEliminated)} a été éliminé - nouveau tour d'indices.</p>
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
            : `<p class="hint">${alive.length} survivant(s) · tour des mots ${speakRound}${voteSurvivals ? ` · ${voteSurvivals} vote(s) survécu(s) par le fake` : ""}</p>`
        }
        ${phaseHtml}
        ${
          phase === "final" && (!mp || isLobbyHost())
            ? ""
            : gameExitBarHtml()
        }
      `,
    });

    bindNav(app);
    bindExitGame(app);
    if (phase === "final") bindRestartGameButtons(app);

    app.querySelector("#btn-deal-ack")?.addEventListener("click", async () => {
      await commitTraitreDealAck();
      if (!mountAlive) return;
      if (!mp) {
        const s = getTraitreSession();
        const acks = { ...(s.dealAcks || {}) };
        alive.filter((n) => n !== localName).forEach((n) => {
          acks[n] = true;
        });
        await commitTraitrePlay({ ...s, dealAcks: acks });
        if (!mountAlive) return;
      }
      await maybeAdvanceFromDeal();
      if (!mountAlive) return;
      render();
    });

    app.querySelector("#btn-finish-speak")?.addEventListener("click", () => {
      void finishSpeakRound().then(() => {
        if (!mountAlive) return;
        render();
      });
    });

    app.querySelector("#btn-continue")?.addEventListener("click", () => {
      void continueSpeakRound().then(() => {
        if (!mountAlive) return;
        render();
      });
    });

    app.querySelector("#btn-vote-now")?.addEventListener("click", () => {
      void startVoteFromDecision().then(() => {
        if (!mountAlive) return;
        render();
      });
    });

    app.querySelectorAll("[data-traitre-vote]").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (phase !== "vote" || !alive.includes(localName)) return;
        selectedVote = btn.getAttribute("data-traitre-vote");
        render();
      });
    });

    app.querySelector("#traitre-confirm-vote")?.addEventListener("click", async () => {
      if (phase !== "vote" || !alive.includes(localName)) return;
      const normalizedVotes = normalizeTraitreVotes(votes, alive);
      const pick = pickForVoteConfirm(selectedVote, normalizedVotes[localName]);
      if (pick == null) return;
      await commitTraitreVote(pick);
      if (!mountAlive) return;
      selectedVote = null;
      if (!mp) {
        const s = getTraitreSession();
        const merged = simulateTraitreVotes(pick, s);
        await commitTraitrePlay({ ...s, votes: { ...merged, [localName]: pick } });
        if (!mountAlive) return;
      }
      if (allTraitreVotesIn(getTraitreSession()) && (!mp || canActAsHost())) {
        await resolveVoteRound();
        if (!mountAlive) return;
      }
      render();
    });

    app.querySelector("#btn-force-vote")?.addEventListener("click", () => {
      void resolveVoteRound({ force: true }).then(() => {
        if (!mountAlive) return;
        render();
      });
    });

    app.querySelector("#btn-traitre-exit")?.addEventListener("click", () => {
      void finishAndExit();
    });
  }

  const unsub = onGameSessionChange(async (row) => {
    if (!mountAlive) return;
    if (stopGameSessionListenerOnPostGame(row)) return;

    const entry = getTraitreEntryScreen();
    if (entry !== "traitre") {
      if (!mountAlive) return;
      navigate(entry);
      return;
    }
    syncFromSession();
    await ensurePrivateRole();
    if (!mountAlive) return;
    if (phase === "deal") {
      await maybeAdvanceFromDeal();
      if (!mountAlive) return;
    }
    if (phase === "vote" && canActAsHost() && allTraitreVotesIn(getTraitreSession())) {
      await resolveVoteRound();
      if (!mountAlive) return;
    }
    render();
  });

  void ensurePrivateRole().then(() => {
    if (!mountAlive) return;
    render();
  });
  render();

  return () => {
    mountAlive = false;
    unsub();
  };
}
