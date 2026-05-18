import { getAllTierLists } from "../core/tierLists.js";
import { setTierNightTopicId } from "../core/state.js";
import { navigate } from "../core/router.js";
import { escapeHtml, pageShell, tierLogoHtml, bindTierLogos } from "../core/ui.js";
import { bindNav } from "./nav.js";

export function mountTierNightSelect(app) {
  const lists = getAllTierLists();

  app.innerHTML = pageShell({
    backTarget: "back",
    content: `
      <p class="label-upper label-upper--gold">🏆 Tier Night</p>
      <h2 class="screen-title">Choisis une tier list</h2>
      <p class="game-intro">Sélectionne un thème ou crée le tien.</p>

      <button type="button" class="card card--clickable card--highlight card--create-tier" data-nav="tiernight-create">
        <div class="card-row">
          <span class="card-row__icon">➕</span>
          <div class="card-row__text">
            <p class="card-row__title">Créer ma tier list</p>
            <p class="card-row__sub">Nom + items personnalisés</p>
          </div>
          <span class="card-row__chevron">›</span>
        </div>
      </button>

      <div class="tier-list-grid">
        ${lists
          .map(
            (list) => `
          <button type="button" class="tier-list-card ${list.custom ? "tier-list-card--custom" : ""}" data-tier-id="${escapeHtml(list.id)}">
            <div class="tier-list-card__logo">
              ${tierLogoHtml(list)}
            </div>
            <span class="tier-list-card__name">${escapeHtml(list.name)}</span>
            <span class="tier-list-card__count">${list.items.length} items</span>
          </button>`
          )
          .join("")}
      </div>
    `,
  });

  bindNav(app);
  bindTierLogos(app);

  app.querySelectorAll(".tier-list-card").forEach((card) => {
    card.addEventListener("click", () => {
      setTierNightTopicId(card.getAttribute("data-tier-id"));
      navigate("tiernight");
    });
  });

  return null;
}
