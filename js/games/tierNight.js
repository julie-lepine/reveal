import {
  TIER_LEVELS,
  TIER_COLORS,
  getTierNightModifierById,
} from "../../data/tierTopics.js";
import { getTierListById } from "../core/tierLists.js";
import { getActivePlayers } from "../core/players.js";
import {
  getTierNightTopicId,
  getTierNightModifier,
  recordTierNightPlayed,
} from "../core/state.js";
import { buildRecapsWithSimulation } from "../core/tierNightSession.js";
import { tierNightPointsHintText } from "../core/tierNightScoring.js";
import { setLobbyPlaying } from "../core/lobby.js";
import {
  isGameSyncActive,
  syncTierNightSession,
  onGameSessionChange,
  getCachedGameSession,
  advanceTierNightToResultsWhenReady,
  ensureTierNightRecapsFromRemote,
  getTierNightLobbyProgress,
  refreshGameSession,
  isLobbyHost,
  canForceTierNightResults,
} from "../core/gameSync.js";
import { getSupabaseUserId } from "../core/supabaseAuth.js";
import { requireLobbyPlay } from "../core/gameGuard.js";
import { navigate } from "../core/router.js";
import { escapeHtml, pageShell, tierLogoHtml, bindTierLogos } from "../core/ui.js";
import { gameExitBarHtml, bindExitGame } from "../core/exitGame.js";
import { bindNav } from "../screens/nav.js";

export function mountTierNight(app) {
  if (!requireLobbyPlay()) return null;

  const topicId = getTierNightTopicId();
  if (!topicId) {
    navigate("tiernight-select");
    return null;
  }

  const list = getTierListById(topicId);
  if (!list) {
    navigate("tiernight-select");
    return null;
  }

  const modifier = getTierNightModifierById(getTierNightModifier());
  const activeTiers = Array.isArray(modifier.tiers) ? modifier.tiers : TIER_LEVELS;
  const blind = Boolean(modifier.blind);

  const isRoster = Boolean(list.roster);
  const rosterEmoji = {};
  if (isRoster) {
    getActivePlayers().forEach((p) => {
      rosterEmoji[p.name] = p.emoji;
    });
  }
  const itemLabel = (item) =>
    isRoster && rosterEmoji[item] ? `${rosterEmoji[item]} ${item}` : item;

  let placed = {};
  TIER_LEVELS.forEach((t) => {
    placed[t] = [];
  });
  let dragItem = null;
  let finished = false;

  function unplaced() {
    const allPlaced = Object.values(placed).flat();
    return list.items.filter((item) => !allPlaced.includes(item));
  }

  function placeItem(item, tier) {
    const next = { ...placed };
    Object.keys(next).forEach((t) => {
      next[t] = (next[t] || []).filter((x) => x !== item);
    });
    next[tier] = [...(next[tier] || []), item];
    placed = next;
    render();
  }

  function unplaceItem(item) {
    const next = { ...placed };
    Object.keys(next).forEach((t) => {
      next[t] = (next[t] || []).filter((x) => x !== item);
    });
    placed = next;
    render();
  }

  async function finishGame() {
    if (finished) return;
    finished = true;
    void setLobbyPlaying("tiernight").catch(() => {});

    if (isGameSyncActive()) {
      const uid = getSupabaseUserId();
      const row = getCachedGameSession();
      const tn = row?.state?.tierNight || {};
      const placements = { ...(tn.placements || {}), [uid]: placed };
      const done = { ...(tn.finished || {}), [uid]: true };
      await syncTierNightSession({
        topicId: list.id,
        placements,
        finished: done,
      });

      render();
      await advanceTierNightToResultsWhenReady(list);
      return;
    }

    buildRecapsWithSimulation(list.id, list.name, list.items, placed);
    recordTierNightPlayed();
    navigate("tiernight-end");
  }

  function lobbyWaitHtml() {
    const progress = getTierNightLobbyProgress();
    const doneCount = progress.filter((p) => p.done).length;
    const total = progress.length;
    const host = isLobbyHost();
    const canForce = host && canForceTierNightResults();
    const waitingNames = progress.filter((p) => !p.done).map((p) => p.name);
    return `
      <div class="card tier-lobby-wait">
        <p class="card-heading">En attente du lobby</p>
        <p class="hint">Les résultats s’affichent quand tout le monde a terminé son classement.</p>
        <p class="hint tier-lobby-wait__count">${doneCount} / ${total} joueur(s) ont terminé</p>
        <div class="lobby-ready-list">
          ${progress
            .map(
              (p) => `
            <div class="lobby-player ${p.done ? "lobby-player--ready" : ""}">
              <span class="recap-card__avatar" style="background:${p.color}">${p.emoji}</span>
              <span class="lobby-player__name">${escapeHtml(p.name)}</span>
              <span class="tier-lobby-wait__status">${p.done ? "Terminé ✓" : "En cours…"}</span>
            </div>`
            )
            .join("")}
        </div>
        ${
          canForce
            ? `<button type="button" class="btn btn-secondary btn--spaced" id="btn-tiernight-force">
                Voir les résultats (${doneCount}/${total})
              </button>
              <p class="hint">${
                waitingNames.length
                  ? `${escapeHtml(waitingNames.join(", "))} n’${waitingNames.length > 1 ? "ont" : "a"} pas terminé et ne sera${waitingNames.length > 1 ? "ont" : ""} pas compté${waitingNames.length > 1 ? "s" : ""} dans le classement du groupe.`
                  : "Les joueurs en attente ne seront pas comptés dans le classement du groupe."
              }</p>`
            : ""
        }
      </div>`;
  }

  async function forceResults() {
    if (!isLobbyHost()) return;
    await advanceTierNightToResultsWhenReady(list, { force: true });
  }

  function render() {
    const remaining = unplaced();
    const waitingLobby = finished && isGameSyncActive();
    // Conserve la position de scroll : render() remplace tout le DOM à chaque
    // placement, donc on relit/restaure le scrollTop du conteneur scrollable.
    const prevScroll = app.querySelector(".page")?.scrollTop || 0;

    app.innerHTML = pageShell({
      backTarget: "back",
      scroll: true,
      content: `
        <p class="label-upper label-upper--gold">🏆 Tier Night</p>
        <div class="tier-game-header">
          <div class="tier-game-header__logo tier-logo-wrap--card">${tierLogoHtml(list, "tier-list-logo tier-list-logo--fill")}</div>
          <h1 class="tier-game-header__title">${escapeHtml(list.name)}</h1>
        </div>

        ${
          modifier.id !== "normal"
            ? `<div class="tier-modifier-banner"><span class="tier-modifier-banner__emoji">${modifier.emoji}</span><span><strong>${escapeHtml(modifier.name)}</strong> · ${escapeHtml(modifier.desc)}</span></div>`
            : ""
        }

        ${
          waitingLobby
            ? ""
            : `<p class="hint tier-points-hint">${escapeHtml(tierNightPointsHintText({ reverse: modifier.reverseScore }))}</p>`
        }

        <div class="tier-board">
          ${activeTiers
            .map(
              (tier) => `
            <div class="tier-row" data-tier="${tier}">
              <span class="tier-label" style="--tier-color:${TIER_COLORS[tier]}">${tier}</span>
              <div class="tier-items">
                ${(placed[tier] || [])
                  .map(
                    (item) => `
                  <button type="button" class="tier-chip${blind ? " tier-chip--static" : ""}" data-item="${escapeHtml(item)}"
                    style="--tier-color:${TIER_COLORS[tier]}"
                    title="${blind ? "Classement verrouillé" : "Retirer du classement"}">${escapeHtml(itemLabel(item))}</button>`
                  )
                  .join("")}
              </div>
            </div>`
            )
            .join("")}
        </div>

        ${
          waitingLobby
            ? ""
            : blind
              ? `<p class="hint tier-unplace-hint">🙈 Mode à l'aveugle : une fois classée, une tuile ne bouge plus. Réfléchis bien !</p>`
              : `<p class="hint tier-unplace-hint">Touche une tuile classée pour la remettre en bas · glisse ou utilise les boutons pour classer.</p>`
        }

        ${waitingLobby ? lobbyWaitHtml() : ""}

        ${
          waitingLobby
            ? ""
            : remaining.length > 0
              ? `
          <p class="hint">${remaining.length} item(s) restant(s)</p>
          <div class="unplaced">
            ${remaining
              .map(
                (item) => `
              <span class="unplaced-chip" draggable="true" data-item="${escapeHtml(item)}">${escapeHtml(itemLabel(item))}</span>`
              )
              .join("")}
          </div>
          <div class="quick-place">
            <p class="quick-place__item">« ${escapeHtml(itemLabel(remaining[0]))} » →</p>
            <div class="quick-place__btns">
              ${activeTiers
                .map(
                  (t) => `
                <button type="button" class="quick-tier-btn" data-quick-tier="${t}"
                  style="--tier-color:${TIER_COLORS[t]}">${t}</button>`
                )
                .join("")}
            </div>
          </div>`
              : `<p class="hint tier-done-hint">Tous les items sont classés 🎉 Réajuste si besoin, puis valide.</p>
          <button type="button" class="btn btn-primary btn--spaced" id="btn-validate">Valider ma tierlist</button>`
        }
        ${gameExitBarHtml()}
      `,
    });

    bindTierLogos(app);
    bindNav(app);
    bindExitGame(app);
    const page = app.querySelector(".page");
    if (page) page.scrollTop = prevScroll;
    if (!finished) bindGameEvents(remaining);
    if (waitingLobby) {
      app.querySelector("#btn-tiernight-force")?.addEventListener("click", () => {
        void forceResults();
      });
    }
  }

  function clearTierDropHighlight() {
    app.querySelectorAll(".tier-row--drop-target").forEach((row) => {
      row.classList.remove("tier-row--drop-target");
    });
  }

  function tierRowAtPoint(clientX, clientY) {
    const el = document.elementFromPoint(clientX, clientY);
    return el?.closest?.(".tier-row") || null;
  }

  function bindGameEvents(remaining) {
    app.querySelectorAll(".unplaced-chip").forEach((chip) => {
      chip.addEventListener("dragstart", () => {
        dragItem = chip.getAttribute("data-item");
      });

      chip.addEventListener("pointerdown", (e) => {
        if (e.button !== 0 || finished) return;
        dragItem = chip.getAttribute("data-item");
        chip.classList.add("unplaced-chip--dragging");
        chip.setPointerCapture(e.pointerId);
        e.preventDefault();
      });

      chip.addEventListener("pointermove", (e) => {
        if (!dragItem || !chip.classList.contains("unplaced-chip--dragging")) return;
        if (e.cancelable) e.preventDefault();
        clearTierDropHighlight();
        const row = tierRowAtPoint(e.clientX, e.clientY);
        row?.classList.add("tier-row--drop-target");
      });

      const endPointerDrag = (e) => {
        if (!chip.classList.contains("unplaced-chip--dragging")) return;
        chip.classList.remove("unplaced-chip--dragging");
        chip.releasePointerCapture?.(e.pointerId);
        const row = tierRowAtPoint(e.clientX, e.clientY);
        if (dragItem && row) placeItem(dragItem, row.getAttribute("data-tier"));
        dragItem = null;
        clearTierDropHighlight();
      };

      chip.addEventListener("pointerup", endPointerDrag);
      chip.addEventListener("pointercancel", endPointerDrag);
    });

    app.querySelectorAll(".tier-row").forEach((row) => {
      row.addEventListener("dragover", (e) => e.preventDefault());
      row.addEventListener("drop", () => {
        if (dragItem) placeItem(dragItem, row.getAttribute("data-tier"));
        dragItem = null;
        clearTierDropHighlight();
      });
    });

    if (!blind) {
      app.querySelectorAll(".tier-chip").forEach((chip) => {
        chip.addEventListener("click", () => {
          const item = chip.getAttribute("data-item");
          if (item) unplaceItem(item);
        });
      });
    }

    app.querySelectorAll("[data-quick-tier]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const item = remaining[0];
        if (item) placeItem(item, btn.getAttribute("data-quick-tier"));
      });
    });

    app.querySelector("#btn-validate")?.addEventListener("click", finishGame);
  }

  const unsub = onGameSessionChange(async () => {
    const row = getCachedGameSession();
    if (row?.screen === "tiernight-end") {
      await refreshGameSession();
      await ensureTierNightRecapsFromRemote(list);
      navigate("tiernight-end");
      return;
    }
    if (finished && isGameSyncActive()) {
      render();
      await advanceTierNightToResultsWhenReady(list);
    }
  });

  render();

  return () => {
    unsub();
  };
}


