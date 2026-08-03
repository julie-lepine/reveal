import {
  WRONG_ANSWER_MAX_LEN,
  pickWrongAnswerNpcAnswer,
} from "../../data/wrongAnswer.js";
import {
  getWrongAnswerEntryScreen,
  getWrongAnswerSession,
  commitWrongAnswerAnswer,
  commitWrongAnswerVote,
  commitWrongAnswerPlay,
  startWrongAnswerRound,
  allWrongAnswersIn,
  allWrongAnswerVotesIn,
  sanitizeWrongAnswer,
} from "../core/wrongAnswerSession.js";
import { awardWrongAnswerRound } from "../core/scoring.js";
import { applyMatchScoreDeltas, gameCumulativeScoresHtml, refreshGameScoresBox } from "../core/gameScores.js";
import { getLocalDisplayName, recordWrongAnswerPlayed, setLastGame } from "../core/state.js";
import { getLobbyParticipants } from "../core/lobby.js";
import { getActivePlayerNames, getActivePlayers, getNpcPlayers } from "../core/players.js";
import { setLobbyPlaying, setLobbyWaiting } from "../core/lobby.js";
import { requireLobbyPlay } from "../core/gameGuard.js";
import { withClickLock } from "../core/actionLock.js";
import { createMountGuard } from "../core/mountLifecycle.js";
import { navigate } from "../core/router.js";
import { escapeHtml, pageShell } from "../core/ui.js";
import { bindNav } from "../screens/nav.js";
import { gameExitBarHtml, bindExitGame } from "../core/exitGame.js";
import { checkHotTakeModeration, getModerationNotice } from "../core/hotTakeSession.js";
import {
  isGameSyncActive,
  canActAsHost,
  isLobbyHost,
  onGameSessionChange,
  completeGameSession,
  stopGameSessionListenerOnPostGame,
  getActingHostUiRefreshToken,
  needsActingHostUiRefresh,
} from "../core/gameSync.js";
import {
  decideWrongAnswerRemoteUi,
  rebuildRootPreservingNode,
  wrongAnswerComposeStatusText,
  wrongAnswerVoteStatusText,
  wrongAnswerConfirmVoteState,
  wrongAnswerAuthorNames,
  wrongAnswerSubmitDisabled,
} from "../core/wrongAnswerUiRefresh.js";

/** Logs ciblés : `globalThis.__REVEAL_DEBUG_WAO02 = true` puis reproduire le scénario. */
function wao02Log(event, detail) {
  if (typeof globalThis === "undefined" || !globalThis.__REVEAL_DEBUG_WAO02) return;
  console.info("[WAO-02]", event, detail);
}

export function mountWrongAnswer(app) {
  if (!requireLobbyPlay()) return null;

  const entry = getWrongAnswerEntryScreen();
  if (entry !== "wronganswer") {
    navigate(entry);
    return null;
  }

  void setLobbyPlaying("wronganswer").catch(() => {});

  const mount = createMountGuard();
  let roundIdx = 0;
  let phase = "answer";
  let currentPrompt = null;
  let answers = {};
  let votes = {};
  let lastRound = null;
  let roundScored = false;
  let transitionInFlight = false;

  let selectedTarget = null;
  let draftText = "";
  let orderKey = "";
  let displayOrder = [];

  const localName = getLocalDisplayName();
  const mp = isGameSyncActive();
  const totalRounds = getWrongAnswerSession().roundCount ?? 5;

  function playerMeta(name) {
    const p = getLobbyParticipants().find((x) => x.name === name);
    return { color: p?.color || "#A78BFA", emoji: p?.emoji || "🎭" };
  }

  function sessionScores() {
    return getWrongAnswerSession().matchScores || {};
  }

  function myAnswerText() {
    return answers[localName]?.text || null;
  }

  function myVote() {
    return votes[localName] ?? null;
  }

  function roundKey() {
    return `${roundIdx}:${currentPrompt?.id || "none"}`;
  }

  /** Ordre d'affichage stable des réponses anonymisées (figé par manche). */
  function ensureDisplayOrder() {
    const key = roundKey();
    const names = Object.keys(answers).filter((n) => answers[n]?.text);
    const sig = `${key}|${names.sort().join(",")}`;
    if (sig === orderKey && displayOrder.length === names.length) return;
    orderKey = sig;
    // Mélange déterministe par manche pour ne pas trahir l'ordre de soumission.
    let seed = 0;
    for (const c of key) seed = (seed * 31 + c.charCodeAt(0)) % 100000;
    const arr = [...names];
    for (let i = arr.length - 1; i > 0; i -= 1) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const j = seed % (i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    displayOrder = arr;
  }

  function syncFromSession() {
    const s = getWrongAnswerSession();
    if (s.roundIdx != null) roundIdx = s.roundIdx;
    if (s.phase) phase = s.phase;
    currentPrompt = s.currentPrompt || currentPrompt;
    answers = { ...(s.answers || {}) };
    votes = { ...(s.votes || {}) };
    lastRound = s.lastRound ?? lastRound;
    roundScored = Boolean(s.roundScored);
    if (votes[localName] != null) selectedTarget = votes[localName];
  }

  // --- Mode solo : NPC ---

  function fillNpcAnswers() {
    const s = getWrongAnswerSession();
    const next = { ...(s.answers || {}) };
    getNpcPlayers().forEach((p, idx) => {
      if (next[p.name]?.text) return;
      next[p.name] = {
        text: pickWrongAnswerNpcAnswer((currentPrompt?.id || 0) + idx * 7 + roundIdx * 13),
        at: Date.now(),
      };
    });
    return next;
  }

  function fillNpcVotes(answersMap) {
    const s = getWrongAnswerSession();
    const next = { ...(s.votes || {}) };
    const authors = Object.keys(answersMap).filter((n) => answersMap[n]?.text);
    getNpcPlayers().forEach((p) => {
      if (next[p.name] != null) return;
      const options = authors.filter((a) => a !== p.name);
      if (!options.length) return;
      next[p.name] = options[Math.floor(Math.random() * options.length)];
    });
    return next;
  }

  // --- Transitions ---

  async function transitionToVoting() {
    if (transitionInFlight || phase !== "answer") return;
    if (mp && !canActAsHost()) return;
    transitionInFlight = true;
    try {
      await commitWrongAnswerPlay(
        { phase: "voting" },
        { screen: "wronganswer" }
      );
      // commitWrongAnswerPlay a déjà sauvegardé localement la phase : render() la relit.
      if (!mount.isMounted()) return;
      if (!mount.isCurrentMount()) return;
      render();
    } finally {
      transitionInFlight = false;
    }
  }

  async function transitionToReveal() {
    if (transitionInFlight || phase !== "voting") return;
    if (mp && !canActAsHost()) return;
    if (roundScored || getWrongAnswerSession().roundScored) return;
    transitionInFlight = true;
    try {
      const session = getWrongAnswerSession();
      const sessionAnswers = session.answers || {};
      const sessionVotes = session.votes || {};

      let award = { counts: {}, deltas: {} };
      if (!mp || canActAsHost()) {
        award = awardWrongAnswerRound(sessionAnswers, sessionVotes);
      }
      const matchScores = applyMatchScoreDeltas(session.matchScores || {}, award.deltas || {});
      const lastRoundData = {
        prompt: currentPrompt,
        answers: Object.fromEntries(
          Object.entries(sessionAnswers).map(([n, v]) => [n, v?.text || ""])
        ),
        votes: { ...sessionVotes },
        counts: award.counts || {},
        deltas: award.deltas || {},
      };

      await commitWrongAnswerPlay(
        {
          phase: "reveal",
          roundScored: true,
          answers: sessionAnswers,
          votes: sessionVotes,
          matchScores,
          lastRound: lastRoundData,
        },
        { withEveningScores: mp && isLobbyHost() }
      );
      // commitWrongAnswerPlay a déjà sauvegardé localement : render() relit la session.
      if (!mount.isMounted()) return;
      if (!mount.isCurrentMount()) return;
      render();
    } finally {
      transitionInFlight = false;
    }
  }

  // --- Rendu des phases ---

  function answerHtml() {
    const submitted = Boolean(myAnswerText());
    const answeredCount = getActivePlayerNames().filter((n) => answers[n]?.text).length;
    const total = getActivePlayerNames().length;
    const remaining = WRONG_ANSWER_MAX_LEN - (submitted ? myAnswerText().length : draftText.length);
    const showHostForce = (!mp || canActAsHost()) && answeredCount > 0;
    const forceVoteLabel = `Passer au vote (${answeredCount}/${total})`;

    const status = wrongAnswerComposeStatusText({
      submitted,
      mp,
      allIn: allWrongAnswersIn(),
      answeredCount,
      total,
    });

    // Pendant la rédaction : bouton toujours monté (hidden si inactif) pour que le
    // refresh distant ne fasse jamais slot.innerHTML (blur clavier iOS / WebView).
    let hostSlotInner = "";
    if (!submitted) {
      hostSlotInner = `<button type="button" class="btn btn-secondary btn--spaced" id="wrong-force-vote"${
        showHostForce ? "" : " hidden"
      }>${escapeHtml(forceVoteLabel)}</button>`;
    } else if (showHostForce) {
      hostSlotInner = `<button type="button" class="btn btn-secondary btn--spaced" id="wrong-force-vote">${escapeHtml(
        forceVoteLabel
      )}</button>`;
    }

    // BUG-WAO-04 : CTA désactivé tant que longueur utile (trim) = 0.
    const submitDisabled = wrongAnswerSubmitDisabled(draftText);
    const formHtml = `<div class="wrong-answer-form" id="wrong-answer-form">
              <textarea id="wrong-input" class="wrong-input" rows="2" maxlength="${WRONG_ANSWER_MAX_LEN}"
                placeholder="Ex. « Girafe. »">${escapeHtml(draftText)}</textarea>
              <p class="hint wrong-input__count"><span id="wrong-count">${remaining}</span> caractères restants</p>
              <p class="moderation-notice">${escapeHtml(getModerationNotice())}</p>
              <p class="auth-error hidden" id="wrong-error"></p>
              <button type="button" class="btn ${submitDisabled ? "btn-secondary" : "btn-primary"} btn--spaced" id="wrong-submit"${
                submitDisabled ? " disabled" : ""
              }>Valider ma réponse</button>
            </div>`;

    return `
      <div class="card wrong-prompt">
        <p class="label-upper label-upper--pink">↩️ La pire réponse</p>
        <p class="wrong-prompt__q">${escapeHtml(currentPrompt?.prompt || "…")}</p>
      </div>
      ${
        submitted
          ? `<div class="card card--feedback card--ok" id="wrong-answer-feedback">
              <p class="feedback-title">Ta pire réponse</p>
              <p class="feedback-sub">« ${escapeHtml(myAnswerText())} »</p>
            </div>`
          : formHtml
      }
      <p class="hint" id="wrong-answer-status" style="text-align:center">${escapeHtml(status)}</p>
      <div id="wrong-answer-host-slot">${hostSlotInner}</div>`;
  }

  function votingHtml() {
    ensureDisplayOrder();
    const voted = myVote() != null;
    const votedCount = getActivePlayerNames().filter((n) => votes[n] != null).length;
    const total = getActivePlayerNames().length;
    const displayPick = selectedTarget ?? myVote();
    const { confirmDisabled, label: confirmLabel } = wrongAnswerConfirmVoteState({
      displayPick,
      localName,
      voted,
    });

    const cards = displayOrder
      .map((author, i) => {
        const isMine = author === localName;
        const picked = displayPick === author;
        const cls = [
          "wrong-vote-card",
          isMine ? "wrong-vote-card--mine" : "",
          picked ? "wrong-vote-card--picked" : "",
        ]
          .filter(Boolean)
          .join(" ");
        return `
          <button type="button" class="${cls}" data-vote="${escapeHtml(author)}" ${isMine ? "disabled" : ""}>
            <span class="wrong-vote-card__num">${i + 1}</span>
            <span class="wrong-vote-card__text">${escapeHtml(answers[author]?.text || "")}</span>
            ${isMine ? `<span class="wrong-vote-card__tag">ta réponse</span>` : ""}
          </button>`;
      })
      .join("");

    const hint = wrongAnswerVoteStatusText({
      voted,
      allIn: allWrongAnswerVotesIn(),
      votedCount,
      total,
    });

    return `
      <div class="card wrong-prompt">
        <p class="label-upper label-upper--pink">↩️ Vote la pire</p>
        <p class="wrong-prompt__q">${escapeHtml(currentPrompt?.prompt || "…")}</p>
      </div>
      <p class="hint" id="wrong-vote-status">${escapeHtml(hint)}</p>
      <div class="wrong-vote-list" id="wrong-vote-list">${cards}</div>
      <button type="button" class="btn ${confirmDisabled ? "btn-secondary" : "btn-primary"} btn--spaced" id="wrong-confirm-vote" ${confirmDisabled ? "disabled" : ""}>
        ${confirmLabel}
      </button>
      <div id="wrong-vote-host-slot">
      ${
        (!mp || canActAsHost()) && votedCount > 0
          ? `<button type="button" class="btn btn-secondary btn--spaced" id="wrong-force-reveal">
              Révéler maintenant (${votedCount}/${total})
            </button>`
          : ""
      }
      </div>`;
  }

  function revealHtml() {
    const data = lastRound || {};
    const counts = data.counts || {};
    const deltas = data.deltas || {};
    const answersMap = data.answers || {};

    const rows = Object.keys(answersMap)
      .map((name) => ({ name, text: answersMap[name], n: counts[name] || 0 }))
      .sort((a, b) => b.n - a.n);

    const topVotes = rows.length ? rows[0].n : 0;

    const cards = rows
      .map((row) => {
        const meta = playerMeta(row.name);
        const isWorst = topVotes > 0 && row.n === topVotes;
        const pts = deltas[row.name];
        return `
          <div class="wrong-reveal-row ${isWorst ? "wrong-reveal-row--worst" : ""}">
            <span class="wrong-reveal-row__avatar" style="--wrong-chip:${meta.color}">${meta.emoji}</span>
            <span class="wrong-reveal-row__body">
              <span class="wrong-reveal-row__text">« ${escapeHtml(row.text)} »</span>
              <span class="wrong-reveal-row__author" style="color:${meta.color}">${escapeHtml(row.name)}${isWorst ? " 👑" : ""}</span>
            </span>
            <span class="wrong-reveal-row__votes">${row.n} vote${row.n > 1 ? "s" : ""}</span>
            <span class="wrong-reveal-row__pts ${pts ? "wrong-reveal-row__pts--gain" : ""}">${pts ? `+${pts}` : "-"}</span>
          </div>`;
      })
      .join("");

    return `
      <div class="card wrong-prompt">
        <p class="label-upper label-upper--pink">↩️ Verdict</p>
        <p class="wrong-prompt__q">${escapeHtml((data.prompt || currentPrompt)?.prompt || "…")}</p>
      </div>
      <div class="wrong-reveal-list">${cards}</div>
      <div class="reveal-mid-action">
      ${
        !mp || canActAsHost()
          ? `<button type="button" class="btn btn-primary btn--spaced" id="next-round">
              ${roundIdx < totalRounds - 1 ? "Manche suivante →" : "Voir les résultats →"}
            </button>`
          : `<p class="hint">En attente de l'hôte pour la suite…</p>`
      }
      </div>
      ${gameCumulativeScoresHtml({
        gameLabel: "Wrong Answer Only",
        title: "Cumul des scores",
        scores: sessionScores(),
      })}`;
  }

  /** BUG-WAO-02 — chrome phase réponse sans toucher #wrong-input ni slot.innerHTML. */
  function refreshWrongAnswerResponseProgress() {
    if (!mount.isMounted() || !mount.isCurrentMount()) return;
    if (phase !== "answer") return;
    const answeredCount = getActivePlayerNames().filter((n) => answers[n]?.text).length;
    const total = getActivePlayerNames().length;
    const submitted = Boolean(myAnswerText());
    const beforeInput = app.querySelector("#wrong-input");
    const statusEl = app.querySelector("#wrong-answer-status");
    if (statusEl) {
      statusEl.textContent = wrongAnswerComposeStatusText({
        submitted,
        mp,
        allIn: allWrongAnswersIn(),
        answeredCount,
        total,
      });
    }
    const btn = app.querySelector("#wrong-force-vote");
    if (btn) {
      const showHost = (!mp || canActAsHost()) && answeredCount > 0;
      btn.hidden = !showHost;
      btn.textContent = `Passer au vote (${answeredCount}/${total})`;
    }
    // BUG-WAO-04 : les refresh hôte (answers distants) doivent réaffirmer le CTA gated.
    if (!submitted) syncWrongAnswerSubmitEnabled();
    const afterInput = app.querySelector("#wrong-input");
    wao02Log("refresh only", {
      beforeEqualsAfter: beforeInput === afterInput,
      answeredCount,
      total,
      submitted,
      hadForceBtn: Boolean(btn),
    });
  }

  /** BUG-WAO-03 — chrome phase vote sans reconstruire #wrong-vote-list. */
  function refreshWrongAnswerVoteProgress() {
    if (!mount.isMounted() || !mount.isCurrentMount()) return;
    if (phase !== "voting") return;
    const voted = myVote() != null;
    const votedCount = getActivePlayerNames().filter((n) => votes[n] != null).length;
    const total = getActivePlayerNames().length;
    const displayPick = selectedTarget ?? myVote();

    const statusEl = app.querySelector("#wrong-vote-status");
    if (statusEl) {
      statusEl.textContent = wrongAnswerVoteStatusText({
        voted,
        allIn: allWrongAnswerVotesIn(),
        votedCount,
        total,
      });
    }

    app.querySelectorAll("#wrong-vote-list [data-vote]").forEach((btn) => {
      const author = btn.getAttribute("data-vote");
      btn.classList.toggle("wrong-vote-card--picked", displayPick === author);
    });

    const confirm = app.querySelector("#wrong-confirm-vote");
    if (confirm) {
      const { confirmDisabled, label } = wrongAnswerConfirmVoteState({
        displayPick,
        localName,
        voted,
      });
      confirm.disabled = confirmDisabled;
      confirm.textContent = label;
      confirm.classList.toggle("btn-primary", !confirmDisabled);
      confirm.classList.toggle("btn-secondary", confirmDisabled);
    }

    const slot = app.querySelector("#wrong-vote-host-slot");
    if (!slot) return;
    const showHost = (!mp || canActAsHost()) && votedCount > 0;
    let btn = app.querySelector("#wrong-force-reveal");
    if (showHost) {
      const label = `Révéler maintenant (${votedCount}/${total})`;
      if (!btn) {
        slot.innerHTML = `<button type="button" class="btn btn-secondary btn--spaced" id="wrong-force-reveal">${label}</button>`;
        btn = app.querySelector("#wrong-force-reveal");
        btn?.addEventListener("click", () => void transitionToReveal());
      } else {
        btn.textContent = label;
      }
    } else if (btn) {
      slot.innerHTML = "";
    }
  }

  function composeLayoutIsForm() {
    return Boolean(app.querySelector("#wrong-input") || app.querySelector("#wrong-answer-form"));
  }

  function voteListAuthorsSig() {
    return wrongAnswerAuthorNames(answers).join(",");
  }

  function render({ preserveComposeInput = false } = {}) {
    if (!mount.isMounted()) return;
    if (!mount.isCurrentMount()) return;
    syncFromSession();

    let phaseHtml = "";
    if (phase === "answer") phaseHtml = answerHtml();
    else if (phase === "voting") phaseHtml = votingHtml();
    else if (phase === "reveal") phaseHtml = revealHtml();

    const shellHtml = pageShell({
      backTarget: "back",
      scroll: true,
      content: `
        <div class="game-header">
          <div class="dots">${Array.from({ length: totalRounds }, (_, i) =>
            `<span class="dot ${i === roundIdx ? "dot--active" : i < roundIdx ? "dot--done" : ""}"></span>`
          ).join("")}</div>
          <span class="muted">${roundIdx + 1}/${totalRounds}</span>
        </div>
        <div class="logo logo--sm"><h1>WRONG ANSWER ONLY</h1></div>
        ${phaseHtml}
        ${gameExitBarHtml()}
      `,
    });

    // BUG-WAO-02 : si un full render reste nécessaire pendant la rédaction, réattacher
    // le même nœud <textarea> (focus()/clavier mobile non fiables après recreation).
    const wantPreserve =
      preserveComposeInput ||
      (phase === "answer" && !myAnswerText() && Boolean(app.querySelector("#wrong-input")));
    const beforeInput = wantPreserve ? app.querySelector("#wrong-input") : null;
    if (beforeInput) draftText = beforeInput.value ?? draftText;

    let preserveMeta = null;
    if (wantPreserve && beforeInput) {
      preserveMeta = rebuildRootPreservingNode(app, shellHtml, "#wrong-input");
      wao02Log(
        preserveMeta.sameNode ? "textarea reused" : "textarea replaced",
        {
          path: preserveMeta.path,
          sameNode: preserveMeta.sameNode,
          phase,
        }
      );
    } else {
      wao02Log("layout rebuilt", { phase, preserveComposeInput: wantPreserve });
      app.innerHTML = shellHtml;
    }

    bindNav(app);
    bindExitGame(app);
    bindPhaseEvents();
  }

  /** BUG-WAO-04 — sync disabled du CTA depuis la valeur live du textarea (pas draft stale). */
  function syncWrongAnswerSubmitEnabled() {
    const submit = app.querySelector("#wrong-submit");
    if (!submit) return;
    const input = app.querySelector("#wrong-input");
    if (input) draftText = input.value ?? draftText;
    const disabled = wrongAnswerSubmitDisabled(draftText);
    submit.disabled = disabled;
    submit.setAttribute("aria-disabled", disabled ? "true" : "false");
    submit.classList.toggle("btn-primary", !disabled);
    submit.classList.toggle("btn-secondary", disabled);
  }

  function bindPhaseEvents() {
    const input = app.querySelector("#wrong-input");
    if (input && input.dataset.waoBound !== "1") {
      input.dataset.waoBound = "1";
      input.addEventListener("input", () => {
        draftText = input.value;
        const countEl = app.querySelector("#wrong-count");
        if (countEl) countEl.textContent = String(WRONG_ANSWER_MAX_LEN - draftText.length);
        app.querySelector("#wrong-error")?.classList.add("hidden");
        syncWrongAnswerSubmitEnabled();
      });
    }
    syncWrongAnswerSubmitEnabled();

    app.querySelector("#wrong-submit")?.addEventListener("click", async () => {
      if (myAnswerText()) return;
      const text = sanitizeWrongAnswer(draftText);
      if (!text) return; // défense : bouton déjà disabled si vide
      const mod = checkHotTakeModeration(text);
      if (mod.blocked) {
        const errEl = app.querySelector("#wrong-error");
        if (errEl) {
          errEl.textContent = mod.message;
          errEl.classList.remove("hidden");
        }
        return;
      }
      try {
        await commitWrongAnswerAnswer(text);
      } catch {
        // Feedback déjà affiché. Session answers rollbackée ; draftText conservé
        // pour retry sans fermer le clavier (WAO-02).
        if (!mount.isMounted() || !mount.isCurrentMount()) return;
        syncFromSession();
        refreshWrongAnswerResponseProgress();
        syncWrongAnswerSubmitEnabled();
        return;
      }
      if (!mount.isMounted()) return;
      if (!mount.isCurrentMount()) return;
      draftText = "";
      if (!mp) {
        // Mode solo : on complète les NPC puis on passe au vote.
        const filled = fillNpcAnswers();
        await commitWrongAnswerPlay({ answers: filled });
        if (!mount.isMounted()) return;
        if (!mount.isCurrentMount()) return;
      }
      render();
      if (!mp) {
        if (allWrongAnswersIn()) await transitionToVoting();
      } else if (allWrongAnswersIn() && canActAsHost()) {
        await transitionToVoting();
      }
    });

    app.querySelector("#wrong-force-vote")?.addEventListener("click", () => void transitionToVoting());

    app.querySelectorAll("[data-vote]").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (phase !== "voting") return;
        const target = btn.getAttribute("data-vote");
        if (target === localName) return;
        selectedTarget = target;
        // BUG-WAO-03 : pas de full render — conserve scroll + nœuds de liste.
        refreshWrongAnswerVoteProgress();
      });
    });

    app.querySelector("#wrong-confirm-vote")?.addEventListener("click", async () => {
      if (phase !== "voting") return;
      const target = selectedTarget;
      if (target == null || target === localName) return;
      try {
        await commitWrongAnswerVote(target);
      } catch {
        if (!mount.isMounted() || !mount.isCurrentMount()) return;
        syncFromSession();
        // WAO-03 : refresh chrome vote ciblé (pas de full render destructif).
        refreshWrongAnswerVoteProgress();
        return;
      }
      if (!mount.isMounted()) return;
      if (!mount.isCurrentMount()) return;
      if (!mp) {
        const filled = fillNpcVotes(getWrongAnswerSession().answers || {});
        await commitWrongAnswerPlay({ votes: filled });
        if (!mount.isMounted()) return;
        if (!mount.isCurrentMount()) return;
      }
      syncFromSession();
      refreshWrongAnswerVoteProgress();
      if (!mp) {
        if (allWrongAnswerVotesIn()) await transitionToReveal();
      } else if (allWrongAnswerVotesIn() && canActAsHost()) {
        await transitionToReveal();
      }
    });

    app.querySelector("#wrong-force-reveal")?.addEventListener("click", () => void transitionToReveal());

    app.querySelector("#next-round")?.addEventListener("click", withClickLock(async () => {
      if (roundIdx < totalRounds - 1) {
        await startWrongAnswerRound(roundIdx + 1);
        if (!mount.isMounted()) return;
        if (!mount.isCurrentMount()) return;
        syncFromSession();
        selectedTarget = null;
        draftText = "";
        render();
      } else {
        if (!mp || canActAsHost()) recordWrongAnswerPlayed();
        const worst = topAuthorOf(lastRound);
        setLastGame({
          gameId: "wronganswer",
          title: "Wrong Answer Only",
          summary: `${totalRounds} manches · pire réponse : ${worst || "-"}`,
        });
        if (mp) {
          try {
            await completeGameSession({ gameId: "wronganswer", screen: "results", state: {} });
          } catch (e) {
            console.warn("REVEAL completeGameSession:", e);
            if (!mount.isMounted()) return;
            if (!mount.isCurrentMount()) return;
            navigate("results", { navStack: ["home", "lobby", "game-select", "results"] });
          }
        } else {
          setLobbyWaiting();
          if (!mount.isMounted()) return;
          if (!mount.isCurrentMount()) return;
          navigate("results", { navStack: ["home", "lobby", "game-select", "results"] });
        }
      }
    }));
  }

  function topAuthorOf(data) {
    if (!data?.counts) return null;
    let best = null;
    let max = 0;
    Object.entries(data.counts).forEach(([name, n]) => {
      if (n > max) {
        max = n;
        best = name;
      }
    });
    return max > 0 ? best : null;
  }

  let lastAckedActingHostToken = getActingHostUiRefreshToken();

  const unsub = onGameSessionChange((row) => {
    if (!mount.isMounted()) return;
    if (!mount.isCurrentMount()) return;
    if (stopGameSessionListenerOnPostGame(row)) return;

    // Snapshot AVANT sync — vérité du dernier rendu local (pas le store déjà muté).
    const prevPhase = phase;
    const prevRound = roundIdx;
    const prevAuthorsSig = voteListAuthorsSig();
    const wasComposeForm = phase === "answer" && composeLayoutIsForm();
    const beforeRemoteInput = app.querySelector("#wrong-input");
    const ahTokenNow = getActingHostUiRefreshToken();
    const actingHostUiRefresh = needsActingHostUiRefresh(
      lastAckedActingHostToken,
      ahTokenNow
    );
    syncFromSession();

    // Nouvelle manche poussée par l'hôte : on repart d'une saisie / sélection vierge.
    if (roundIdx !== prevRound) {
      draftText = "";
      selectedTarget = null;
      orderKey = "";
    }

    // Filets hôte : avancer automatiquement quand tout le monde a répondu / voté.
    if (mp && canActAsHost()) {
      if (phase === "answer" && allWrongAnswersIn()) {
        lastAckedActingHostToken = ahTokenNow;
        void transitionToVoting();
        return;
      }
      if (phase === "voting" && allWrongAnswerVotesIn() && !roundScored) {
        lastAckedActingHostToken = ahTokenNow;
        void transitionToReveal();
        return;
      }
    }

    const submitted = Boolean(myAnswerText());
    const composeFormAlive = composeLayoutIsForm();
    const composeLayoutMismatch =
      phase === "answer" &&
      ((wasComposeForm && submitted) || (!wasComposeForm && !submitted && prevPhase === "answer"));

    let voteListAuthorsChanged = false;
    if (phase === "voting" && prevPhase === "voting") {
      const nextSig = voteListAuthorsSig();
      voteListAuthorsChanged = nextSig !== prevAuthorsSig;
    }

    const decision = decideWrongAnswerRemoteUi({
      prevPhase,
      phase,
      prevRound,
      roundIdx,
      composeFormAlive,
      localSubmitted: submitted,
      actingHostUiRefresh,
      composeLayoutMismatch,
      voteListAuthorsChanged,
    });

    wao02Log(decision.mode === "full" ? "render()" : "refresh only", {
      reason: decision.reason,
      prevPhase,
      phase,
      prevRound,
      roundIdx,
      actingHostUiRefresh,
      composeLayoutMismatch,
      composeFormAlive,
      localSubmitted: submitted,
      voteListAuthorsChanged,
      beforeInputAlive: Boolean(beforeRemoteInput),
    });

    if (decision.mode === "full") {
      render({
        preserveComposeInput:
          phase === "answer" && composeFormAlive && !submitted,
      });
      const afterInput = app.querySelector("#wrong-input");
      wao02Log(
        beforeRemoteInput && afterInput && beforeRemoteInput === afterInput
          ? "textarea reused"
          : "textarea replaced",
        {
          sameNode: Boolean(
            beforeRemoteInput && afterInput && beforeRemoteInput === afterInput
          ),
        }
      );
      lastAckedActingHostToken = ahTokenNow;
      return;
    }

    if (decision.mode === "refresh-reveal-scores") {
      lastAckedActingHostToken = ahTokenNow;
      refreshGameScoresBox(app, {
        gameLabel: "Wrong Answer Only",
        title: "Cumul des scores",
        scores: sessionScores(),
      });
      return;
    }

    if (decision.mode === "refresh-answer") {
      refreshWrongAnswerResponseProgress();
      const afterInput = app.querySelector("#wrong-input");
      wao02Log("textarea reused", {
        sameNode: beforeRemoteInput === afterInput,
        beforeEqualsAfter: beforeRemoteInput === afterInput,
      });
      lastAckedActingHostToken = ahTokenNow;
      return;
    }

    if (decision.mode === "refresh-vote") {
      refreshWrongAnswerVoteProgress();
      lastAckedActingHostToken = ahTokenNow;
      return;
    }

    render({
      preserveComposeInput: phase === "answer" && composeFormAlive && !submitted,
    });
    lastAckedActingHostToken = ahTokenNow;
  });

  render();

  return () => {
    mount.dispose();
    unsub();
  };
}
