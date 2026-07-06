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
  accumulatePlacements,
  commitTierNightLivePlay,
  commitTierNightLiveVote,
  allTierNightLiveVotesIn,
  buildTierNightLiveRecaps,
  consensusTierForVotes,
  tierNightLiveVotingPayload,
} from "../core/tierNightLiveSession.js";
import { requireLobbyPlay } from "../core/gameGuard.js";
import {
  isGameSyncActive,
  canActAsHost,
  onGameSessionChange,
  getCachedGameSession,
  finalizeTierNightLiveToResults,
} from "../core/gameSync.js";
import { setLobbyPlaying } from "../core/lobby.js";
import { navigate } from "../core/router.js";
import { escapeHtml, pageShell, tierLogoHtml, bindTierLogos } from "../core/ui.js";
import { gameExitBarHtml, bindExitGame } from "../core/exitGame.js";
import { bindNav } from "../screens/nav.js";

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
    <p class="label-upper label-upper--gold">⚡ Tier Night · En direct</p>
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
  let revealInFlight = false;

  const players = () => getActivePlayers();
  const itemLabel = makeItemLabel(list, players());
  const deck = () => session.deck || list.items;
  const total = () => deck().length;
  const currentItem = () => deck()[session.roundIdx];
  const myVote = () => session.votes?.[localName] || null;

  function reload() {
    session = getTierNightLiveSession();
  }

  async function transitionToReveal() {
    if (session.phase !== "voting" || !canActAsHost() || revealInFlight) return;
    revealInFlight = true;
    try {
      const placements = accumulatePlacements(session);
      await commitTierNightLivePlay({ phase: "reveal", placements });
      reload();
      render();
    } finally {
      revealInFlight = false;
    }
  }

  async function nextRound() {
    if (!canActAsHost()) return;
    if (session.roundIdx < total() - 1) {
      await commitTierNightLivePlay(tierNightLiveVotingPayload(session.roundIdx + 1));
      reload();
      render();
    } else {
      buildTierNightLiveRecaps(session);
      recordTierNightPlayed();
      await finalizeTierNightLiveToResults();
    }
  }

  async function pickTier(tier) {
    if (session.phase !== "voting" || myVote()) return;
    await commitTierNightLiveVote(tier);
    reload();
    if (canActAsHost() && allTierNightLiveVotesIn()) {
      await transitionToReveal();
      return;
    }
    render();
  }

  function votingPhaseHtml() {
    const host = canActAsHost();
    const votedCount = Object.keys(session.votes || {}).length;
    const totalPlayers = players().length;
    const mine = myVote();
    const hint = mine
      ? allTierNightLiveVotesIn()
        ? "Tout le monde a voté !"
        : "En attente des autres joueurs…"
      : "Choisis un tier !";
    return `
      <p class="label-upper label-upper--muted">Vote simultané</p>
      ${voteButtonsHtml(Boolean(mine), mine)}
      <p class="hint">${hint}</p>
      ${
        host
          ? `<button type="button" class="btn btn-secondary btn--spaced" id="live-reveal">Révéler maintenant (${votedCount}/${totalPlayers})</button>`
          : ""
      }`;
  }

  function revealPhaseHtml() {
    const host = canActAsHost();
    return `
      ${consensusRevealHtml(currentItem(), session.votes || {}, players(), itemLabel)}
      ${
        host
          ? `<button type="button" class="btn btn-primary btn--spaced" id="live-next">
              ${session.roundIdx < total() - 1 ? "Item suivant →" : "Voir le classement →"}
            </button>`
          : `<p class="hint">En attente de l'hôte pour la suite…</p>`
      }`;
  }

  function render() {
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
    app.querySelector("#live-reveal")?.addEventListener("click", () => void transitionToReveal());
    app.querySelector("#live-next")?.addEventListener("click", () => void nextRound());
  }

  const unsub = onGameSessionChange((row) => {
    if (row?.screen === "tiernight-end" || getTierNightLiveSession().finished) {
      navigate("tiernight-end");
      return;
    }
    reload();
    if (session.phase === "voting" && canActAsHost() && allTierNightLiveVotesIn()) {
      void transitionToReveal();
      return;
    }
    render();
  });

  render();

  return () => {
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
    roster: false,
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
