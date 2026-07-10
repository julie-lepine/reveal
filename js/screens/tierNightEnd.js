import { TIER_LEVELS, TIER_COLORS } from "../../data/tierTopics.js";
import {
  getTierNightRecaps,
  getTierNightSession,
  getTierNightRoundPointsSorted,
  getTierNightScoreBreakdownForPlayer,
} from "../core/tierNightSession.js";
import { getTierListById } from "../core/tierLists.js";
import { getTierNightTopicId } from "../core/state.js";
import { getLocalDisplayName, setLastGame } from "../core/state.js";
import { setLobbyWaiting } from "../core/lobby.js";
import {
  completeGameSession,
  isGameSyncActive,
  isLobbyHost,
  onGameSessionChange,
  suppressSessionRoute,
  refreshEveningScoresFromSession,
  refreshGameSession,
  ensureTierNightRecapsFromRemote,
} from "../core/gameSync.js";
import {
  gameCumulativeScoresHtml,
  tierNightRoundScoresHtml,
  refreshGameScoresBox,
} from "../core/gameScores.js";
import { navigate } from "../core/router.js";
import { escapeHtml, pageShell } from "../core/ui.js";
import { bindNav } from "./nav.js";
import {
  eveningRecapRestartButtonHtml,
  bindRestartGameButtons,
} from "../core/restartGame.js";

function tierOfItemIn(placed, item) {
  for (const tier of TIER_LEVELS) {
    if ((placed?.[tier] || []).includes(item)) return tier;
  }
  return null;
}

/** Pour le mode roster : préfixe les noms de joueurs par leur emoji. */
function makeItemLabel(session, recaps) {
  const isRoster = String(session.topicId || "").startsWith("roster:");
  if (!isRoster) return (item) => item;
  const emojiByName = {};
  recaps.forEach((r) => {
    emojiByName[r.player] = r.emoji;
  });
  return (item) => (emojiByName[item] ? `${emojiByName[item]} ${item}` : item);
}

/** Board du consensus du groupe (moyennes), affiché dans le récap. */
function consensusBoardHtml(consensus, labelFn = (i) => i) {
  if (!consensus) return "";
  const hasItems = TIER_LEVELS.some((t) => (consensus[t] || []).length > 0);
  if (!hasItems) return "";
  return `
    <div class="card tier-consensus-card">
      <p class="card-heading">📊 Le classement du groupe</p>
      <div class="tier-board tier-board--recap">
        ${TIER_LEVELS.map(
          (tier) => `
          <div class="tier-row">
            <span class="tier-label" style="--tier-color:${TIER_COLORS[tier]}">${tier}</span>
            <div class="tier-items">
              ${(consensus[tier] || [])
                .map(
                  (item) => `
                <span class="tier-chip tier-chip--static" style="--tier-color:${TIER_COLORS[tier]}">${escapeHtml(labelFn(item))}</span>`
                )
                .join("")}
            </div>
          </div>`
        ).join("")}
      </div>
    </div>`;
}

function tierScoreBreakdownHtml(playerName, session, labelFn = (i) => i) {
  const breakdown = getTierNightScoreBreakdownForPlayer(playerName, session);
  if (!breakdown?.rows?.length) return "";

  const rows = breakdown.rows
    .map(
      (row) => `
        <div class="tier-score-breakdown__row">
          <span class="tier-score-breakdown__item">${escapeHtml(labelFn(row.item))}</span>
          <span class="tier-score-breakdown__tiers">toi ${row.localTier} · groupe ${row.consensusTier}</span>
          <strong class="tier-score-breakdown__pts ${row.pts > 0 ? "tier-score-breakdown__pts--gain" : ""}">${row.pts > 0 ? `+${row.pts}` : "0"}</strong>
        </div>`
    )
    .join("");

  const outsiderLine =
    breakdown.outsiderBonus > 0
      ? `<div class="tier-score-breakdown__row tier-score-breakdown__row--bonus">
          <span class="tier-score-breakdown__item">Bonus outsider</span>
          <span class="tier-score-breakdown__tiers">item le plus clivant</span>
          <strong class="tier-score-breakdown__pts tier-score-breakdown__pts--gain">+${breakdown.outsiderBonus}</strong>
        </div>`
      : "";

  return `
    <div class="card tier-score-breakdown">
      <p class="card-heading">📋 Détail de tes points</p>
      <p class="hint">Moyenne sur ${breakdown.itemCount} item(s) · ${
        breakdown.reverse ? "mode à contre-courant" : "+15 même tier, +10 à 1 écart"
      }</p>
      <div class="tier-score-breakdown__list">
        ${rows}
        ${outsiderLine}
        <div class="tier-score-breakdown__total">
          <span>Total manche</span>
          <strong>+${breakdown.total}</strong>
        </div>
      </div>
    </div>`;
}

/** Mise en scène de l'item le plus clivant (#1) + bonus outsider (#3). */
function controversialHtml(session, recaps, labelFn = (i) => i) {
  const item = session.controversialItem;
  if (!item || (session.controversialSpread ?? 0) <= 0) return "";
  const votes = recaps
    .map((r) => ({ ...r, tier: tierOfItemIn(r.placed, item) }))
    .filter((r) => r.tier);
  if (votes.length < 2) return "";

  const outsiders = votes.filter((r) => (r.outsiderBonus ?? 0) > 0);
  const outsiderBonus = outsiders[0]?.outsiderBonus ?? 0;
  const outsiderLine = outsiders.length
    ? `<p class="tier-controversial__outsider">🎖️ Avis le plus tranché : ${outsiders
        .map((r) => escapeHtml(r.player))
        .join(", ")} · +${outsiderBonus} pts outsider</p>`
    : "";

  return `
    <div class="card tier-controversial-card">
      <p class="card-heading">🔥 L'item le plus clivant</p>
      <p class="tier-controversial__item">« ${escapeHtml(labelFn(item))} »</p>
      <p class="hint tier-controversial__sub">Personne n'était d'accord sur celui-là.</p>
      <div class="tier-controversial__votes">
        ${votes
          .map(
            (r) => `
          <span class="tier-controversial__vote ${(r.outsiderBonus ?? 0) > 0 ? "tier-controversial__vote--outsider" : ""}" style="--tier-color:${TIER_COLORS[r.tier]}" title="${escapeHtml(r.player)}">
            <span class="recap-card__avatar" style="background:${r.color}">${r.emoji}</span>
            <span class="tier-controversial__badge">${r.tier}</span>
          </span>`
          )
          .join("")}
      </div>
      ${outsiderLine}
    </div>`;
}

export function mountTierNightEnd(app) {
  let session = getTierNightSession();
  let recaps = getTierNightRecaps();
  const localName = getLocalDisplayName();
  let bootstrapping = false;

  function reloadSession() {
    session = getTierNightSession();
    recaps = getTierNightRecaps();
  }

  async function bootstrapRecaps() {
    if (bootstrapping) return;
    bootstrapping = true;
    try {
      const topicId = getTierNightTopicId();
      const list = topicId ? getTierListById(topicId) : null;

      if (isGameSyncActive()) {
        const maxAttempts = 12;
        for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
          await ensureTierNightRecapsFromRemote(list);
          reloadSession();
          const ready =
            getTierNightRecaps().length > 0 &&
            getTierNightRecaps().some(
              (r) => Object.values(r.placed || {}).flat().length > 0
            );
          if (ready) break;
          await new Promise((r) => setTimeout(r, 450));
        }
        if (!isLobbyHost()) {
          await refreshEveningScoresFromSession();
        }
      }
      reloadSession();
      render();
    } finally {
      bootstrapping = false;
    }
  }

  async function goToResults() {
    setLastGame({
      gameId: "tiernight",
      title: "Tier Night",
      summary: `« ${session.listName || "Tier list"} » · +${session.localConsensusPoints || 0} pts consensus`,
    });

    const resultsNav = { navStack: ["home", "lobby", "game-select", "results"] };

    if (isGameSyncActive()) {
      if (isLobbyHost()) {
        try {
          await completeGameSession({ gameId: "tiernight", screen: "results", state: {} });
        } catch (e) {
          console.warn("REVEAL completeGameSession:", e);
          navigate("results", resultsNav);
        }
      } else {
        suppressSessionRoute(120000);
        navigate("results", resultsNav);
      }
      return;
    }

    await setLobbyWaiting();
    navigate("results", resultsNav);
  }

  function render() {
    reloadSession();
    const roundSorted = getTierNightRoundPointsSorted();
    const labelFn = makeItemLabel(session, recaps);
    const content = `
        <p class="label-upper label-upper--gold">🏆 Tier Night</p>
        <h2 class="screen-title">Récap des classements</h2>
        <p class="game-intro">« ${escapeHtml(session.listName || "Tier list")} » - +${session.localConsensusPoints ?? 0} pts consensus pour toi cette manche.</p>
        ${consensusBoardHtml(session.consensus, labelFn)}
        ${controversialHtml(session, recaps, labelFn)}
        ${tierScoreBreakdownHtml(localName, session, labelFn)}
        ${tierNightRoundScoresHtml(roundSorted)}
        ${gameCumulativeScoresHtml({ gameId: "tiernight", gameLabel: "Tier Night", title: "Cumul des scores" })}
        <div class="recap-list">
          ${recaps.length
            ? recaps
                .map(
                  (r) => `
            <div class="card recap-card">
              <div class="recap-card__head">
                <span class="recap-card__avatar" style="background:${r.color}">${r.emoji}</span>
                <span class="recap-card__name">${escapeHtml(r.player)}</span>
                <span class="recap-card__pts">+${r.consensusPoints ?? 0} pts</span>
              </div>
              ${TIER_LEVELS.map((tier) => {
                const items = r.placed[tier] || [];
                if (!items.length) return "";
                return `
                <div class="recap-tier">
                  <span class="recap-tier__label" style="color:${TIER_COLORS[tier]}">${tier}</span>
                  <span class="recap-tier__items">${items.map((i) => escapeHtml(labelFn(i))).join(" · ")}</span>
                </div>`;
              }).join("")}
            </div>`
                )
                .join("")
            : `<p class="hint">Chargement des classements…</p>`}
        </div>
        ${eveningRecapRestartButtonHtml({ gameId: "tiernight", title: "TierNight" })}
        <button type="button" class="btn btn-primary" data-nav="results">Voir les résultats →</button>`;

    app.innerHTML = pageShell({
      backTarget: "back",
      content,
    });

    bindNav(app, { results: goToResults });
    bindRestartGameButtons(app);

    if (isGameSyncActive()) {
      refreshGameScoresBox(app, {
        gameId: "tiernight",
        gameLabel: "Tier Night",
        title: "Cumul des scores",
      });
    }
  }

  const unsubSession = onGameSessionChange((row) => {
    if (row?.screen === "results") {
      navigate("results", { navStack: ["home", "lobby", "game-select", "results"] });
      return;
    }
    if (row?.state?.scores || row?.state?.tierNight?.recap) {
      void bootstrapRecaps();
    }
  });

  render();
  void bootstrapRecaps();

  return () => {
    unsubSession();
    // En MP, la fin de partie passe par completeGameSession (setLobbyBetweenGames) : ne pas
    // repasser le lobby en "waiting" ici, sinon on annule l'état "en soirée" et on reset les prêt.
    if (!isGameSyncActive()) setLobbyWaiting();
  };
}
