import { PACK_SIGNATURE_LABEL } from "../config/premiumPacks.js";
import {
  SIGNATURE_EMOJI_CHOICES,
  SIGNATURE_NAME_COLORS,
  canUseProfileEmoji,
  emojiFromUtf8Hex,
  isSignatureProfileEmoji,
  resolvedNameColorHex,
  utf8HexFromEmoji,
} from "../../data/signatureIdentity.js";
import { PROFILE_EMOJI_CHOICES } from "../../data/profileEmojis.js";
import { isProfilePack } from "./entitlements.js";

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function signatureIdentityFrom(p = {}) {
  return {
    name: p.name || "Joueur",
    emoji: p.emoji || "👤",
    color: p.color || "#60A5FA",
    nameColor: p.nameColor || p.name_color || null,
    signature: p.signature === true,
  };
}

export function playerNameHtml(p, className = "player-name") {
  const ident = signatureIdentityFrom(p);
  const hex = resolvedNameColorHex(ident);
  const style = hex ? ` style="color:${escapeHtml(hex)}"` : "";
  const badge = ident.signature
    ? `<span class="signature-badge" title="${escapeHtml(PACK_SIGNATURE_LABEL)}" aria-hidden="true">✦</span>`
    : "";
  return `<span class="${escapeHtml(className)}"${style}>${escapeHtml(ident.name)}${badge}</span>`;
}

export function signatureRingClass(p, baseClass) {
  const ident = signatureIdentityFrom(p);
  return ident.signature ? `${baseClass} signature-ring` : baseClass;
}

export function playerAvatarHtml(p, baseClass = "avatar avatar--sm") {
  const ident = signatureIdentityFrom(p);
  const cls = signatureRingClass(ident, baseClass);
  return `<span class="${escapeHtml(cls)}" style="background:${escapeHtml(ident.color)}">${escapeHtml(ident.emoji)}</span>`;
}

/** Mini carte salon : avatar + pseudo, pour que le joueur se voie comme les autres. */
export function signatureSelfPreviewHtml(p, { caption = "Les autres te voient comme ça" } = {}) {
  const ident = signatureIdentityFrom(p);
  return `
    <div class="signature-self-preview" id="settings-signature-preview">
      <p class="hint signature-self-preview__caption">${escapeHtml(caption)}</p>
      <div class="signature-self-preview__row">
        ${playerAvatarHtml(ident, "signature-self-preview__avatar")}
        ${playerNameHtml(ident, "signature-self-preview__name")}
      </div>
    </div>`;
}

export function nameColorChipsHtml(selectedId, { unlocked = false } = {}) {
  return `
    <p class="field-label">Couleur du pseudo</p>
    <div class="name-color-chips" role="listbox" aria-label="Couleur du pseudo">
      ${SIGNATURE_NAME_COLORS.map((c) => {
        const active = selectedId === c.id;
        const locked = !unlocked;
        return `<button type="button" class="name-color-chip${active ? " name-color-chip--active" : ""}${locked ? " name-color-chip--locked" : ""}" data-name-color="${escapeHtml(c.id)}" style="--chip:${escapeHtml(c.hex)}" aria-label="${escapeHtml(c.label)}" ${locked ? 'data-signature-lock="1"' : ""} ${active ? 'aria-selected="true"' : ""}></button>`;
      }).join("")}
    </div>
    ${
      unlocked
        ? ""
        : `<p class="hint settings-section__hint">Couleur de pseudo : inclus dans ${escapeHtml(PACK_SIGNATURE_LABEL)}.</p>`
    }`;
}

function emojiBtnHtml(emoji, selectedEmoji, { locked = false } = {}) {
  const active = emoji === selectedEmoji;
  const lockCls = locked ? " emoji-picker__btn--locked" : "";
  const activeCls = active ? " emoji-picker__btn--active" : "";
  const lockAttr = locked ? ' data-signature-lock="1"' : "";
  const hex = utf8HexFromEmoji(emoji);
  return `<button type="button" class="emoji-picker__btn${activeCls}${lockCls}" data-emoji="${emoji}" data-emoji-hex="${hex}" aria-label="${emoji}"${lockAttr}>${emoji}</button>`;
}

export function pickerEmojiFromButton(btn) {
  if (!btn) return "";
  return (
    emojiFromUtf8Hex(btn.getAttribute("data-emoji-hex")) ||
    btn.getAttribute("data-emoji") ||
    ""
  );
}

export function profileEmojiPickerHtml(selectedEmoji, { includeSignatureExtras = true, unlocked = false } = {}) {
  const free = PROFILE_EMOJI_CHOICES.map((e) => emojiBtnHtml(e, selectedEmoji)).join("");
  if (!includeSignatureExtras) {
    return `<div class="emoji-picker" role="listbox" aria-label="Choisir un emoji">${free}</div>`;
  }
  const extras = SIGNATURE_EMOJI_CHOICES.map((e) =>
    emojiBtnHtml(e, selectedEmoji, { locked: !unlocked })
  ).join("");
  return `
    <div class="emoji-picker" role="listbox" aria-label="Choisir un emoji">${free}</div>
    <div class="emoji-picker-signature-wrap">
      <p class="emoji-picker__sig-label">${escapeHtml(PACK_SIGNATURE_LABEL)}</p>
      <div class="emoji-picker emoji-picker--signature" role="listbox" aria-label="Emojis ${escapeHtml(PACK_SIGNATURE_LABEL)}">${extras}</div>
    </div>
    ${
      unlocked
        ? ""
        : `<p class="hint settings-section__hint">Emojis extra : inclus dans ${escapeHtml(PACK_SIGNATURE_LABEL)}.</p>`
    }`;
}

export function localCanUseEmoji(emoji, user) {
  return canUseProfileEmoji(emoji, {
    profilePack: user?.profilePack === true,
    isGuest: user?.isGuest === true,
  });
}

export function isLockedSignatureEmojiClick(emoji, user) {
  return isSignatureProfileEmoji(emoji) && !localCanUseEmoji(emoji, user);
}

export { isProfilePack };
