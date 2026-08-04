import { TIER_LEVELS, TIER_COLORS } from "../../data/tierTopics.js";
import { getTierListById } from "../core/tierLists.js";
import { getActivePlayers } from "../core/players.js";
import {
  getTierNightTopicId,
  getLocalDisplayName,
  recordTierNightPlayed,
} from "../core/state.js";
import { buildRecapsFromPlacements } from "../core/tierNightSession.js";
import {
  getTierNightLiveSession,
  commitTierNightLivePlay,
  commitTierNightLiveVote,
  commitTierNightLiveRevealSafely,
  allTierNightLiveVotesIn,
  getTierNightLiveVoteProgress,
  buildTierNightLiveRecaps,
  consensusTierForVotes,
  tierNightLiveVotingPayload,
} from "../core/tierNightLiveSession.js";
import {
  createTierNightLiveRevealLock,
  decideTierNightLiveRevealAction,
  tierNightLiveRevealChromeState,
  TIER_NIGHT_LIVE_REVEAL_AUTO_ALERT,
} from "../core/tierNightLiveReveal.js";
import {
  displayNameForTierNightUid,
  mapVotesForTierNightLiveUi,
  sessionHasTierNightPlayerRoster,
} from "../core/tierNightRoster.js";
import { requireLobbyPlay } from "../core/gameGuard.js";
import {
  isGameSyncActive,
  canActAsHost,
  onGameSessionChange,
  getCachedGameSession,
  getEffectiveSessionScreen,
  stopGameSessionListenerOnPostGame,
  finalizeTierNightLiveToResults,
  nameForUserId,
} from "../core/gameSync.js";
import { showAppAlert } from "../core/dialog.js";
import { setLobbyPlaying } from "../core/lobby.js";
import { navigate } from "../core/router.js";
import { escapeHtml, pageShell, tierLogoHtml, bindTierLogos } from "../core/ui.js";
import { gameExitBarHtml, bindExitGame } from "../core/exitGame.js";
import { bindNav } from "../screens/nav.js";
import { withClickLock, createActionLock } from "../core/actionLock.js";
import { createMountGuard } from "../core/mountLifecycle.js";

const TIER_RANK = { S: 0, A: 1, B: 2, C: 3, D: 4 };

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function emptyPlaced() {
  const placed = {};
  TIER_LEVELS.forEach((t) => {
    placed[t] = [];
  });
  return placed;
}

function makeItemLabel(list, players) {
  const isRoster = Boolean(list.roster);
  const emojiByName = {};
  players.forEach((p) => {
    emojiByName[p.name] = p.emoji;
  });
  return (item) =>
    isRoster && emojiByName[item] ? `${emojiByName[item]} ${item}` : item;
}

function headerHtml(list, idx, total) {
  return `
    <p class="label-upper label-upper--gold">⚡ Tier Night · Rank live</p>
    <div class="tier-game-header">
      <div class="tier-game-header__logo tier-logo-wrap--card">${tierLogoHtml(list, "tier-list-logo tier-list-logo--fill")}</div>
      <h1 class="tier-game-header__title">${escapeHtml(list.name)}</h1>
    </div>
    <div class="game-header">
      <div class="dots">${Array.from({ length: total })
        .map(
          (_, i) =>
            `<span class="dot ${i === idx ? "dot--active" : i < idx ? "dot--done" : ""}"></span>`
        )
        .join("")}</div>
      <span class="muted">${idx + 1}/${total}</span>
    </div>`;
}

function voteButtonsHtml(disabled, mine) {
  return `
    <div class="tier-live-vote">
      ${TIER_LEVELS.map(
        (t) => `
        <button type="button" class="tier-live-vote__btn ${mine === t ? "tier-live-vote__btn--active" : ""}"
          data-live-tier="${t}" style="--tier-color:${TIER_COLORS[t]}" ${disabled ? "disabled" : ""}>${t}</button>`
      ).join("")}
    </div>`;
}

function consensusRevealHtml(item, votesByName, players, itemLabel) {
  const consTier = consensusTierForVotes(votesByName) || "C";
  const rows = players
    .map((p) => ({ p, tier: votesByName[p.name] }))
    .filter((r) => r.tier);
  return `
    <p class="label-upper label-upper--gold">Le groupe a tranché</p>
    <div class="tier-live-consensus">
      <span class="tier-live-consensus__label" style="--tier-color:${TIER_COLORS[consTier]}">${consTier}</span>
      <span class="tier-live-consensus__item">« ${escapeHtml(itemLabel(item))} »</span>
    </div>
    <div class="tier-live-votes">
      ${rows
        .map(
          (r) => `
        <span class="tier-live-vote-chip" style="--tier-color:${TIER_COLORS[r.tier]}" title="${escapeHtml(r.p.name)}">
          <span class="recap-card__avatar" style="background:${r.p.color}">${r.p.emoji}</span>
          <span class="tier-live-vote-chip__tier">${r.tier}</span>
        </span>`
        )
        .join("")}
    </div>`;
}

/** Joueurs d'affichage : roster session prioritaire (BUG-TIERNIGHT-04). */
function expectedPlayersForLive(session) {
  if (sessionHasTierNightPlayerRoster(session)) {
    return session.playerRoster.map((r) => {
      const live = getActivePlayers().find((p) => p.name === r.displayName);
      return {
        name: displayNameForTierNightUid(r.userId, session.playerRoster, nameForUserId),
        color: live?.color || "#64748B",
        emoji: live?.emoji || "👤",
        userId: r.userId,
        isLocal: Boolean(live?.isLocal),
        isHost: Boolean(live?.isHost),
      };
    });
  }
  return getActivePlayers();
}

function votesUiForLive(session) {
  if (sessionHasTierNightPlayerRoster(session)) {
    return mapVotesForTierNightLiveUi(session.votes || {}, session.playerRoster, nameForUserId);
  }
  return session.votes || {};
}

/* ============================== SOLO ============================== */

function mountSolo(app, list) {
  const localName = getLocalDisplayName();
  const players = getActivePlayers();
  const itemLabel = makeItemLabel(list, players);
  const items = shuffle(list.items);

  const placementsByName = {};
  players.forEach((p) => {
    placementsByName[p.name] = emptyPlaced();
  });
  players
    .filter((p) => p.name !== localName)
    .forEach((p) => {
      items.forEach((item) => {
        const tier = TIER_LEVELS[Math.floor(Math.random() * TIER_LEVELS.length)];
        placementsByName[p.name][tier].push(item);
      });
    });

  let idx = 0;
  let phase = "vote";
  let myTier = null;

  function votesForItem(item) {
    const out = {};
    players.forEach((p) => {
      if (p.name === localName) {
        if (myTier) out[p.name] = myTier;
        return;
      }
      const placed = placementsByName[p.name];
      const tier = TIER_LEVELS.find((t) => placed[t].includes(item));
      if (tier) out[p.name] = tier;
    });
    return out;
  }

  function finish() {
    buildRecapsFromPlacements(list.id, list.name, list.items, placementsByName);
    recordTierNightPlayed();
    navigate("tiernight-end");
  }

  function pickTier(tier) {
    if (phase !== "vote" || myTier) return;
    myTier = tier;
    placementsByName[localName][tier].push(items[idx]);
    phase = "reveal";
    render();
  }

  function nextItem() {
    if (idx < items.length - 1) {
      idx += 1;
      phase = "vote";
      myTier = null;
      render();
    } else {
      finish();
    }
  }

  function render() {
    const phaseHtml =
      phase === "vote"
        ? `${voteButtonsHtml(false, null)}
           <p class="hint">Choisis un tier pour « ${escapeHtml(itemLabel(items[idx]))} ».</p>`
        : `${consensusRevealHtml(items[idx], votesForItem(items[idx]), players, itemLabel)}
           <button type="button" class="btn btn-primary btn--spaced" id="live-next">
             ${idx < items.length - 1 ? "Item suivant →" : "Voir le classement →"}
           </button>`;

    app.innerHTML = pageShell({
      backTarget: "back",
      content: `
        ${headerHtml(list, idx, items.length)}
        <div class="card card--speed"><p class="hot-take-text">${escapeHtml(itemLabel(items[idx]))}</p></div>
        ${phaseHtml}
        ${gameExitBarHtml()}
      `,
    });

    bindTierLogos(app);
    bindNav(app);
    bindExitGame(app);
    app.querySelectorAll("[data-live-tier]").forEach((btn) => {
      btn.addEventListener("click", () => pickTier(btn.getAttribute("data-live-tier")));
    });
    app.querySelector("#live-next")?.addEventListener("click", nextItem);
  }

  render();
  return null;
}

/* ============================== MULTI ============================== */

function mountMp(app, list) {
  const localName = getLocalDisplayName();
  let session = getTierNightLiveSession();
  /** BUG-TIERNIGHT-03 - verrou partagé auto + manuel (anti double patch). */
  const revealLockState = createTierNightLiveRevealLock();
  revealLockState.ensureSessionKey(session);
  /** ARCH-06 : partagé entre re-binds après render. */
  const nextRoundLock = createActionLock();
  const revealClickLock = createActionLock();
  /** ARCH-06 Vague B3 : effets UI / navigate après unmount. */
  const mount = createMountGuard();
  let revealPendingUi = false;

  const players = () => expectedPlayersForLive(session);
  const itemLabel = makeItemLabel(list, players());
  const deck = () => session.deck || list.items;
  const total = () => deck().length;
  const currentItem = () => deck()[session.roundIdx];
  const myVote = () => {
    const ui = votesUiForLive(session);
    return ui[localName] || session.votes?.[localName] || null;
  };

  function reload() {
    session = getTierNightLiveSession();
    revealLockState.ensureSessionKey(session);
    if (session.phase !== "voting") {
      revealPendingUi = false;
    }
  }

  /** Chrome vote ciblé - pas de full render (préserve roster/chips 04/05). */
  function refreshVotingChrome() {
    if (!mount.isMounted() || !mount.isCurrentMount()) return;
    if (session.phase !== "voting") return;
    const host = canActAsHost();
    const { confirmed: votedCount, expected: totalPlayers } = getTierNightLiveVoteProgress(session);
    const allIn = allTierNightLiveVotesIn(session);
    const chrome = tierNightLiveRevealChromeState({
      allIn,
      revealPending: revealPendingUi,
      votedCount,
      totalPlayers,
      hasLocalVote: Boolean(myVote()),
    });
    const hintEl = app.querySelector(".hint");
    if (hintEl) hintEl.textContent = chrome.hint;
    const btn = app.querySelector("#live-reveal");
    if (btn) {
      btn.textContent = chrome.buttonLabel;
      btn.disabled = chrome.buttonDisabled;
    } else if (host && !revealPendingUi) {
      // Bouton absent (premier paint sans host slot) - full render minimal via caller.
    }
  }

  function setRevealPending(pending) {
    revealPendingUi = Boolean(pending);
    refreshVotingChrome();
  }

  /**
   * Helper unique auto + `#live-reveal`.
   * @param {{ source: "auto"|"auto-retry"|"manual" }} opts
   */
  async function runRevealSafely({ source }) {
    reload();
    const decision = decideTierNightLiveRevealAction({
      phase: session.phase,
      canActAsHost: canActAsHost(),
      allVotesIn: allTierNightLiveVotesIn(session),
      source,
      inFlight: revealLockState.isInFlight(),
      retryUsed: revealLockState.getRetryUsed(),
    });

    if (decision.action === "noop") {
      return { ok: decision.reason === "already-reveal", reason: decision.reason };
    }
    if (decision.action === "await-inflight") {
      return revealLockState.getInFlight();
    }

    const requireAllVotes = decision.requireAllVotes !== false;
    const work = (async () => {
      setRevealPending(true);
      try {
        let result = await commitTierNightLiveRevealSafely({
          requireAllVotes,
          source,
        });

        // Retry one-shot borné (auto uniquement) si encore voting après incertitude.
        // Note : on est déjà dans la promesse in-flight → tester retryUsed, pas canAutoRetry().
        if (
          !result.ok &&
          result.uncertain &&
          source === "auto" &&
          !revealLockState.getRetryUsed()
        ) {
          revealLockState.markRetryUsed();
          reload();
          if (
            session.phase === "voting" &&
            canActAsHost() &&
            allTierNightLiveVotesIn(session)
          ) {
            result = await commitTierNightLiveRevealSafely({
              requireAllVotes: true,
              source: "auto-retry",
            });
          }
        }

        if (!mount.isMounted() || !mount.isCurrentMount()) return result;

        reload();
        if (result.ok || session.phase === "reveal") {
          revealPendingUi = false;
          render();
          return { ...result, ok: true };
        }

        // Échec réel : chrome restauré, alerte hôte si auto (retry déjà tenté ou certain).
        revealPendingUi = false;
        if (source === "auto" || source === "auto-retry") {
          revealLockState.markRetryUsed();
          if (canActAsHost()) {
            try {
              await showAppAlert(TIER_NIGHT_LIVE_REVEAL_AUTO_ALERT, {
                title: "Rank live",
                icon: "⚡",
              });
            } catch {
              /* ignore */
            }
          }
        } else if (source === "manual" && result.error) {
          try {
            const { formatSyncErrorMessage } = await import("../core/authErrors.js");
            await showAppAlert(formatSyncErrorMessage(result.error?.message), {
              title: "Connexion",
              icon: "📡",
            });
          } catch {
            /* ignore */
          }
        }
        render();
        return result;
      } finally {
        if (getTierNightLiveSession().phase !== "reveal") {
          revealPendingUi = false;
        }
      }
    })();

    revealLockState.begin(work);
    try {
      return await work;
    } finally {
      revealLockState.clearInFlightIf(work);
    }
  }

  async function nextRound() {
    if (!canActAsHost()) return;
    if (session.roundIdx < total() - 1) {
      await commitTierNightLivePlay(tierNightLiveVotingPayload(session.roundIdx + 1));
      if (!mount.isMounted()) return;
      if (!mount.isCurrentMount()) return;
      reload();
      revealPendingUi = false;
      render();
    } else {
      buildTierNightLiveRecaps(session);
      recordTierNightPlayed();
      await finalizeTierNightLiveToResults({
        shouldContinue: () => mount.isMounted() && mount.isCurrentMount(),
      });
    }
  }

  async function pickTier(tier) {
    if (session.phase !== "voting" || myVote()) return;
    try {
      await commitTierNightLiveVote(tier);
    } catch (error) {
      // Catch terminal UI : feedback + rollback déjà faits ; pas de 2e notif.
      void error;
      if (!mount.isMounted() || !mount.isCurrentMount()) return;
      reload();
      render();
      return;
    }
    if (!mount.isMounted()) return;
    if (!mount.isCurrentMount()) return;
    reload();
    if (canActAsHost() && allTierNightLiveVotesIn()) {
      // Chrome all-in avant le commit (pas de return silencieux).
      render();
      await runRevealSafely({ source: "auto" });
      return;
    }
    render();
  }

  function maybeAutoRevealFromSession(source = "auto") {
    if (!canActAsHost()) return;
    if (session.phase !== "voting") return;
    if (!allTierNightLiveVotesIn()) return;
    // Met à jour le chrome (Tout le monde a voté) puis lance le helper partagé.
    render();
    void runRevealSafely({ source });
  }

  function votingPhaseHtml() {
    const host = canActAsHost();
    const { confirmed: votedCount, expected: totalPlayers } = getTierNightLiveVoteProgress(session);
    const allIn = allTierNightLiveVotesIn(session);
    const chrome = tierNightLiveRevealChromeState({
      allIn,
      revealPending: revealPendingUi,
      votedCount,
      totalPlayers,
      hasLocalVote: Boolean(myVote()),
    });
    return `
      <p class="label-upper label-upper--muted">Vote simultané</p>
      ${voteButtonsHtml(Boolean(myVote()), myVote())}
      <p class="hint">${escapeHtml(chrome.hint)}</p>
      ${
        host
          ? `<button type="button" class="btn btn-secondary btn--spaced" id="live-reveal"${
              chrome.buttonDisabled ? " disabled" : ""
            }>${escapeHtml(chrome.buttonLabel)}</button>`
          : ""
      }`;
  }

  function revealPhaseHtml() {
    const host = canActAsHost();
    return `
      ${consensusRevealHtml(currentItem(), votesUiForLive(session), players(), itemLabel)}
      ${
        host
          ? `<button type="button" class="btn btn-primary btn--spaced" id="live-next">
              ${session.roundIdx < total() - 1 ? "Item suivant →" : "Voir le classement →"}
            </button>`
          : `<p class="hint">En attente de l'hôte pour la suite…</p>`
      }`;
  }

  function render() {
    if (!mount.isMounted()) return;
    if (!mount.isCurrentMount()) return;
    const phaseHtml = session.phase === "reveal" ? revealPhaseHtml() : votingPhaseHtml();
    app.innerHTML = pageShell({
      backTarget: "back",
      content: `
        ${headerHtml(list, session.roundIdx, total())}
        <div class="card card--speed"><p class="hot-take-text">${escapeHtml(itemLabel(currentItem()))}</p></div>
        ${phaseHtml}
        ${gameExitBarHtml()}
      `,
    });

    bindTierLogos(app);
    bindNav(app);
    bindExitGame(app);
    app.querySelectorAll("[data-live-tier]").forEach((btn) => {
      btn.addEventListener("click", () => void pickTier(btn.getAttribute("data-live-tier")));
    });
    app.querySelector("#live-reveal")?.addEventListener(
      "click",
      withClickLock(() => runRevealSafely({ source: "manual" }), { lock: revealClickLock })
    );
    app.querySelector("#live-next")?.addEventListener(
      "click",
      withClickLock(() => nextRound(), { lock: nextRoundLock })
    );
  }

  const unsub = onGameSessionChange((row) => {
    if (!mount.isMounted()) return;
    if (!mount.isCurrentMount()) return;
    if (stopGameSessionListenerOnPostGame(row)) return;

    const effective = getEffectiveSessionScreen(row);
    if (effective === "tiernight-end" || getTierNightLiveSession().finished) {
      navigate("tiernight-end");
      return;
    }
    reload();
    if (session.phase === "reveal") {
      revealPendingUi = false;
      render();
      return;
    }
    if (session.phase === "voting" && canActAsHost() && allTierNightLiveVotesIn()) {
      // Plus de `void transition + return` sans chrome : render all-in puis helper awaitable.
      maybeAutoRevealFromSession("auto");
      return;
    }
    render();
  });

  render();
  // Mount / catch-up : tous les votes déjà présents → auto-reveal acting host.
  maybeAutoRevealFromSession("auto");

  return () => {
    mount.dispose();
    revealLockState.reset("unmount");
    unsub();
  };
}

/* ============================== ENTRY ============================== */

/** Liste de secours construite depuis la session synchronisée (tier lists custom non partagées). */
function listFromSession(session) {
  if (!session?.deck?.length) return null;
  return {
    id: session.topicId || "live",
    name: session.listName || "Tier list",
    items: session.deck,
    roster: Boolean(session.topicId?.startsWith?.("roster:")),
    playerRoster: session.playerRoster || null,
  };
}

export function mountTierNightLive(app) {
  if (!requireLobbyPlay()) return null;

  if (isGameSyncActive()) {
    const session = getTierNightLiveSession();
    const remoteStarted = Boolean(getCachedGameSession()?.state?.tierNightLive?.lobbyStarted);
    if (!session.lobbyStarted && !remoteStarted) {
      navigate("tiernight-select");
      return null;
    }
    const list = getTierListById(session.topicId) || listFromSession(session);
    if (!list) {
      navigate("tiernight-select");
      return null;
    }
    void setLobbyPlaying("tiernight").catch(() => {});
    return mountMp(app, list);
  }

  const topicId = getTierNightTopicId();
  const list = topicId ? getTierListById(topicId) : null;
  if (!list) {
    navigate("tiernight-select");
    return null;
  }
  return mountSolo(app, list);
}
