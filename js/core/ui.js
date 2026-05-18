import { PLAYERS } from "../../data/players.js";
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

export function pageShell({ back = true, backTarget = "back", content, orb = true }) {
  return `
    <${EL} class="page">
      ${orb ? orbsHtml() : ""}
      ${back ? backButton("Retour", backTarget) : ""}
      <${EL} class="container">${content}</${EL}>
    </${EL}>
  `;
}

export function avatarsHtml() {
  return `
    <${EL} class="avatars">
      ${PLAYERS.map(
        (p, i) => `
        <${EL} class="avatar" style="background:${p.color};z-index:${10 - i}" title="${escapeHtml(p.name)}">
          ${p.emoji}
        </${EL}>`
      ).join("")}
    </${EL}>
  `;
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
