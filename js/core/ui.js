import { APP_LOGO } from "../../data/branding.js";

const EL = "di" + "v";

export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function orbsHtml() {
  return `<${EL} class="orb orb1"></${EL}><${EL} class="orb orb2"></${EL}>`;
}

export function backButton(label = "Retour", target = "back") {
  return `<button type="button" class="back" data-nav="${escapeHtml(target)}" aria-label="${escapeHtml(label)}">‹</button>`;
}

export function pageShell({ back = true, backTarget = "back", content, orb = true, scroll = false }) {
  return `
    <${EL} class="page${scroll ? " page--scroll" : ""}">
      ${orb ? orbsHtml() : ""}
      ${back ? backButton("Retour", backTarget) : ""}
      <${EL} class="container">${content}</${EL}>
    </${EL}>
  `;
}

/** Remet la vue en haut après navigation ou nouvelle manche (WebView mobile). */
export function resetPageScroll(root = document.getElementById("app")) {
  if (!root) return;
  root.scrollTop = 0;
  if (typeof window !== "undefined") {
    window.scrollTo(0, 0);
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }
  root.querySelectorAll(".page").forEach((page) => {
    page.scrollTop = 0;
  });
  root.querySelectorAll(".container").forEach((el) => {
    el.scrollTop = 0;
  });
}

/** Double rAF : le layout WebView est prêt avant le reset (iOS / Android). */
export function schedulePageScrollReset(root = document.getElementById("app")) {
  if (!root || typeof requestAnimationFrame !== "function") {
    resetPageScroll(root);
    return;
  }
  requestAnimationFrame(() => {
    resetPageScroll(root);
    requestAnimationFrame(() => resetPageScroll(root));
  });
}

export function logoHtml({ className = "app-logo", alt = "REVEAL" } = {}) {
  return `<img src="${APP_LOGO}" alt="${escapeHtml(alt)}" class="${className}" />`;
}

export function tierLogoHtml(list, className = "tier-list-logo") {
  const emoji = list.emoji || "🏆";
  const logo = list.logo ? escapeHtml(list.logo) : "";
  return `
    <img src="${logo}" alt="" class="${className}" data-tier-img />
    <span class="tier-list-logo--emoji" hidden>${emoji}</span>`;
}

function gameTileBorderGradient(game) {
  return game.borderGradient
    ? escapeHtml(game.borderGradient)
    : "linear-gradient(135deg, #FF6B6B 0%, #2B2D66 100%)";
}

function gameTileWrapClass(game) {
  return game.cssClass ? ` game-tile__logo-wrap--${escapeHtml(game.cssClass)}` : "";
}

/** Cadre logo + image (jeux actifs). */
export function gameTileLogoHtml(game) {
  const logo = game.logo ? escapeHtml(game.logo) : "";
  const emoji = game.emoji || "🎮";
  const mod = gameTileWrapClass(game);
  return `
    <span class="game-tile__logo-wrap${mod}" style="--logo-border:${gameTileBorderGradient(game)}">
      <span class="game-tile__logo-inner">
        <img src="${logo}" alt="" class="game-tile__logo" data-game-logo width="108" height="108" />
        <span class="game-tile__emoji game-tile__emoji--fallback" hidden>${emoji}</span>
      </span>
    </span>`;
}

/** Même cadre que les jeux actifs, emoji centré (jeux à venir). */
export function gameTileEmojiFrameHtml(game) {
  const emoji = game.emoji || "🎮";
  const mod = gameTileWrapClass(game);
  return `
    <span class="game-tile__logo-wrap${mod}" style="--logo-border:${gameTileBorderGradient(game)}">
      <span class="game-tile__logo-inner game-tile__logo-inner--emoji">
        <span class="game-tile__emoji game-tile__emoji--framed" aria-hidden="true">${emoji}</span>
      </span>
    </span>`;
}

export function gameTileVisualHtml(game) {
  return game.logo ? gameTileLogoHtml(game) : gameTileEmojiFrameHtml(game);
}

/** Affiche l’emoji si le logo jeu ne charge pas */
export function bindGameTileLogos(root) {
  root.querySelectorAll("[data-game-logo]").forEach((img) => {
    const wrap = img.closest(".game-tile__logo-wrap");
    const fb = wrap?.querySelector(".game-tile__emoji--fallback");
    const showEmoji = () => {
      img.style.display = "none";
      if (fb) fb.hidden = false;
    };
    if (!img.getAttribute("src")) {
      showEmoji();
      return;
    }
    img.addEventListener("error", showEmoji);
    if (img.complete && !img.naturalWidth) showEmoji();
  });
}

/** Affiche l’emoji si l’image logo est absente ou en erreur */
export function bindTierLogos(root) {
  root.querySelectorAll("[data-tier-img]").forEach((img) => {
    const fb = img.nextElementSibling;
    const showEmoji = () => {
      img.style.display = "none";
      if (fb?.classList.contains("tier-list-logo--emoji")) {
        fb.hidden = false;
      }
    };
    if (!img.getAttribute("src")) {
      showEmoji();
      return;
    }
    img.addEventListener("error", showEmoji);
    if (img.complete && !img.naturalWidth) showEmoji();
  });
}

export function playerRow(p, extra = "") {
  return `
    <${EL} class="player-row">
      <${EL} class="avatar avatar--sm" style="background:${p.color}">${p.emoji}</${EL}>
      <span class="player-name">${escapeHtml(p.name)}</span>
      ${extra}
    </${EL}>
  `;
}
