/**
 * Création tier list Rank Live.
 *
 * Modes :
 * - contribute (`from=live-prep`) : sync customLiveTierLists → retour prep (pas de launch).
 * - legacy (sans from) : bibliothèque locale + mono launch (compat hors nouveau parcours).
 */
import {
  addCustomTierList,
  setTierNightMode,
  setTierNightModifier,
} from "../core/state.js";
import { getTierListById } from "../core/tierLists.js";
import { navigate, getScreenParams } from "../core/router.js";
import {
  isGameSyncActive,
  isLobbyHost,
} from "../core/gameSync.js";
import { markTierNightLiveLobbyStarted } from "../core/tierNightLiveSession.js";
import { navigateAfterGameLaunch } from "../core/mpLaunch.js";
import { pageShell, escapeHtml } from "../core/ui.js";
import { checkHotTakeModeration, getModerationNotice } from "../core/hotTakeSession.js";
import { showAppAlert } from "../core/dialog.js";
import { returnToTierNightSelectStep } from "../core/tierNightNav.js";
import {
  LIVE_TIER_LIST_ITEMS_MIN,
  LIVE_TIER_LIST_ITEMS_MAX,
  validateCustomLiveTierList,
} from "../core/customLiveTierLists.js";
import { addCustomLiveTierListAndSync } from "../core/customLiveTierListSession.js";
import { createActionLock } from "../core/actionLock.js";
import { bindNav } from "./nav.js";

function returnToLiveListSelect() {
  // FEATURE-TIERNIGHT-04D — step=list mort ; retour modes (live).
  returnToTierNightSelectStep({ step: "mode", mode: "live" });
}

function returnToLivePrep() {
  navigate("tiernight-live-prep", {
    navStack: ["home", "lobby", "game-select", "tiernight-select", "tiernight-live-prep"],
  });
}

function isContributeFromLivePrep() {
  return getScreenParams()?.from === "live-prep";
}

export function mountTierNightCreate(app) {
  const contribute = isContributeFromLivePrep();
  const submitLock = createActionLock();

  app.innerHTML = pageShell({
    backTarget: contribute ? "tiernight-live-prep" : "tiernight-live-lists",
    content: `
      <p class="label-upper label-upper--gold">⚡ Rank Live</p>
      <h2 class="screen-title">${
        contribute ? "Ajouter une liste custom" : "Créer ma tier list"
      }</h2>
      <p class="game-intro">${
        contribute
          ? `Nom + items (${LIVE_TIER_LIST_ITEMS_MIN}–${LIVE_TIER_LIST_ITEMS_MAX}), un par ligne. La liste rejoint le prep partagé - pas de lancement.`
          : "Donne un nom et liste les items (un par ligne, 4 minimum). Tu joueras ensuite en Rank live."
      }</p>

      <div class="card">
        <label class="field-label" for="tier-name">Nom de la tier list</label>
        <input type="text" class="field-input" id="tier-name" maxlength="40" placeholder="Ex : Meilleurs desserts" />

        <label class="field-label" for="tier-emoji">Emoji (optionnel)</label>
        <input type="text" class="field-input field-input--emoji" id="tier-emoji" maxlength="4" placeholder="🍰" />

        <label class="field-label" for="tier-items">Items à classer</label>
        <textarea class="field-textarea" id="tier-items" rows="8" placeholder="Ex :&#10;Tiramisu&#10;Brownie&#10;Crêpe&#10;Mochi"></textarea>
      </div>

      <p class="hint" id="create-hint">Minimum ${LIVE_TIER_LIST_ITEMS_MIN} items, un par ligne.</p>

      <p class="moderation-notice">${getModerationNotice()}</p>
      <p class="auth-error hidden" id="tier-error"></p>

      <button type="button" class="btn btn-primary btn--spaced" id="btn-create" disabled>
        ${contribute ? "Ajouter au prep →" : "Créer et jouer en Rank live →"}
      </button>
    `,
  });

  const nameEl = app.querySelector("#tier-name");
  const emojiEl = app.querySelector("#tier-emoji");
  const itemsEl = app.querySelector("#tier-items");
  const createBtn = app.querySelector("#btn-create");
  const hint = app.querySelector("#create-hint");
  const errEl = app.querySelector("#tier-error");

  function parseItems() {
    return itemsEl.value
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function showError(message) {
    if (!errEl) return;
    errEl.textContent = message || "";
    errEl.classList.toggle("hidden", !message);
  }

  function validate() {
    const name = nameEl.value.trim();
    const items = parseItems();
    let ok = name.length >= 2 && items.length >= LIVE_TIER_LIST_ITEMS_MIN;
    if (contribute && items.length > LIVE_TIER_LIST_ITEMS_MAX) ok = false;
    createBtn.disabled = !ok || createBtn.dataset.busy === "1";
    if (!name) hint.textContent = "Donne un nom à ta tier list.";
    else if (items.length < LIVE_TIER_LIST_ITEMS_MIN) {
      hint.textContent = `${items.length}/${LIVE_TIER_LIST_ITEMS_MIN} items - ajoute-en encore.`;
    } else if (contribute && items.length > LIVE_TIER_LIST_ITEMS_MAX) {
      hint.textContent = `Maximum ${LIVE_TIER_LIST_ITEMS_MAX} items.`;
    } else hint.textContent = `${items.length} items - prêt à créer !`;
  }

  function captureDraft() {
    return {
      name: nameEl.value,
      emoji: emojiEl.value,
      items: itemsEl.value,
    };
  }

  function restoreDraft(draft) {
    if (!draft) return;
    nameEl.value = draft.name ?? "";
    emojiEl.value = draft.emoji ?? "";
    itemsEl.value = draft.items ?? "";
    validate();
  }

  [nameEl, emojiEl, itemsEl].forEach((el) =>
    el?.addEventListener("input", () => {
      showError("");
      validate();
    })
  );

  createBtn.addEventListener("click", () => {
    void submitLock.run(async () => {
      const draft = captureDraft();
      const name = nameEl.value.trim();
      const items = parseItems();
      const emoji = emojiEl.value.trim() || "✨";
      if (!name || items.length < LIVE_TIER_LIST_ITEMS_MIN) return;

      const blocked = [name, ...items]
        .map((s) => checkHotTakeModeration(s))
        .find((m) => m.blocked);
      if (blocked) {
        showError(blocked.message);
        return;
      }

      if (contribute) {
        const preview = validateCustomLiveTierList({
          id: "custom-live-draft-preview",
          name,
          emoji,
          items,
          author: "draft",
          authorUid: "00000000-0000-0000-0000-000000000001",
          custom: true,
        });
        if (!preview.ok) {
          showError(preview.message || "Liste invalide.");
          restoreDraft(draft);
          return;
        }

        createBtn.dataset.busy = "1";
        createBtn.disabled = true;
        try {
          const res = await addCustomLiveTierListAndSync({ name, emoji, items });
          if (!res?.ok) {
            showError(res?.error || "Ajout impossible.");
            restoreDraft(draft);
            return;
          }
          returnToLivePrep();
        } catch (err) {
          showError(err?.message || "Ajout impossible.");
          restoreDraft(draft);
        } finally {
          createBtn.dataset.busy = "0";
          validate();
        }
        return;
      }

      // Legacy mono launch (hors from=live-prep).
      if (isGameSyncActive() && !isLobbyHost()) {
        await showAppAlert("Seul l'hôte peut créer une liste et lancer Rank live.", {
          title: "Action réservée",
          icon: "👑",
        });
        return;
      }

      setTierNightMode("live");
      setTierNightModifier("normal");
      const topicId = addCustomTierList({ name, items, emoji });
      const list = getTierListById(topicId);
      if (!list) return;

      if (isGameSyncActive()) {
        const result = await markTierNightLiveLobbyStarted({
          topicId,
          listName: list.name,
          items: list.items,
        });
        navigateAfterGameLaunch({ gameScreen: "tiernight-live", result });
      } else {
        navigate("tiernight-live");
      }
    });
  });

  bindNav(app, {
    "tiernight-live-lists": returnToLiveListSelect,
    "tiernight-live-prep": returnToLivePrep,
  });
  validate();
  return null;
}

/** Discrimination contribute (tests / audit). */
export function isTierNightCreateContributeMode() {
  return isContributeFromLivePrep();
}

export { escapeHtml };
