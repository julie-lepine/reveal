import { escapeHtml } from "./ui.js";
import { getCurrentScreen } from "./router.js";

/** Carte « Joueurs prêts » (HTML initial). */
export function playersReadySectionHtml(members, readyMap, { readyKey = (m) => m.name } = {}) {
  return `
    <p class="card-heading">Joueurs prêts</p>
    ${members
      .map(
        (m) => `
      <div class="lobby-player ${readyMap[readyKey(m)] ? "lobby-player--ready" : ""}">
        <span class="lobby-player__status">${readyMap[readyKey(m)] ? "✓" : "…"}</span>
        <span class="lobby-player__name">${escapeHtml(m.name)}</span>
      </div>`
      )
      .join("")}`;
}

export function updatePlayersReadyCard(cardEl, members, readyMap, options) {
  if (!cardEl) return;
  cardEl.innerHTML = playersReadySectionHtml(members, readyMap, options);
}

export function updateReadyButton(btn, localReady) {
  if (!btn) return;
  btn.classList.toggle("btn-ready--active", Boolean(localReady));
  btn.textContent = localReady ? "Prêt ✓" : "Je suis prêt !";
}

/**
 * Bouton de lancement / attente en bas de l'écran prep.
 */
export function prepStartSlotHtml({
  poolEmpty,
  poolEmptyLabel = "Aucun contenu disponible",
  allReady,
  isHost,
  launchLabel,
  startButtonId = "btn-start-game",
  waitingHostLabel = "En attente de l'hôte…",
  waitingPlayersLabel = "En attente des joueurs…",
}) {
  if (poolEmpty) {
    return `<button type="button" class="btn btn-secondary btn--spaced" disabled>${escapeHtml(poolEmptyLabel)}</button>`;
  }
  if (allReady && isHost) {
    return `<button type="button" class="btn btn-primary btn--spaced" id="${escapeHtml(startButtonId)}">${escapeHtml(launchLabel)}</button>`;
  }
  if (allReady) {
    return `<p class="hint btn--spaced">${escapeHtml(waitingHostLabel)}</p>`;
  }
  return `<button type="button" class="btn btn-secondary btn--spaced" disabled>${escapeHtml(waitingPlayersLabel)}</button>`;
}

/** Met à jour le slot lancement et re-bind le bouton hôte. */
export function updatePrepStartSlot(slotEl, html, onStartGame) {
  if (!slotEl) return;
  slotEl.innerHTML = html;
  slotEl.querySelector("#btn-start-game")?.addEventListener("click", () => {
    void onStartGame();
  });
}

/** Rafraîchit carte joueurs + bouton prêt (sans re-render complet). */
export function refreshPrepReadyUi(
  root,
  {
    playersSelector,
    readyBtnSelector,
    members,
    readyMap,
    readyKey,
    localReady,
  }
) {
  updatePlayersReadyCard(root.querySelector(playersSelector), members, readyMap, { readyKey });
  updateReadyButton(root.querySelector(readyBtnSelector), localReady);
}

/**
 * Met à jour une liste dynamique dans une .card sans re-render complet.
 */
export function patchDynamicListInCard(
  card,
  { listSelector, listHtml, hintSelector, hintHtml, insertAfterSelectors = [] }
) {
  if (!card) return;

  let list = listSelector ? card.querySelector(listSelector) : null;
  if (!listHtml) list?.remove();
  else if (list) list.outerHTML = listHtml;
  else {
    let anchor = null;
    for (const sel of insertAfterSelectors) {
      anchor = card.querySelector(sel);
      if (anchor) break;
    }
    anchor?.insertAdjacentHTML("afterend", listHtml);
  }

  if (!hintSelector) return;
  let hint = card.querySelector(hintSelector);
  if (!hintHtml) hint?.remove();
  else if (hint) hint.outerHTML = hintHtml;
  else card.insertAdjacentHTML("beforeend", hintHtml);
}

/** Liste custom avec bouton supprimer (Hot Take, Dilemma, etc.). */
export function customEntryListHtml(items, { listClass, itemClass, removeClass, renderItem, removeAttr }) {
  if (!items.length) return "";
  const liClass = itemClass || `${listClass.split(" ")[0]}__item`;
  const btnClass = removeClass || `${listClass.split(" ")[0]}__remove`;
  return `<ul class="${listClass}">${items
    .map(
      (item) => `
    <li class="${liClass}">
      ${renderItem(item)}
      <button type="button" class="btn-link ${btnClass}" ${removeAttr}="${escapeHtml(item.id)}" aria-label="Supprimer">Supprimer</button>
    </li>`
    )
    .join("")}</ul>`;
}

/**
 * Délégation clic sur #app pour [data-remove-*] - survit aux outerHTML des listes.
 */
export function bindPrepRemoveDelegation(app, { screenId, attr, onRemove }) {
  async function onClick(e) {
    if (getCurrentScreen() !== screenId) return;
    const btn = e.target.closest(`[${attr}]`);
    if (!btn) return;
    e.preventDefault();
    const id = btn.getAttribute(attr);
    if (!id) return;
    await onRemove(id);
  }
  app.addEventListener("click", onClick);
  return () => app.removeEventListener("click", onClick);
}
