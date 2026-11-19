/**
 * FEATURE-PROFILE-04 — carte share 9:16 (canvas + preview + share sheet).
 */
import { APP_LOGO } from "../../data/branding.js";
import { PACK_SIGNATURE_LABEL } from "../config/premiumPacks.js";
import { CARNET_LABEL } from "../config/signatureCarnet.js";
import { withClickLock } from "./actionLock.js";
import {
  catalogEmojiForSessionGameId,
  catalogTitleForSessionGameId,
} from "./gameCatalogTitle.js";
import { loadCapacitorFilesystem, loadCapacitorShare } from "./capacitorImports.js";
import { isNativeApp } from "./platform.js";
import {
  CARNET_CARD_FILE,
  CARNET_CARD_HEIGHT,
  CARNET_CARD_MIME,
  CARNET_CARD_WIDTH,
  carnetCardLayout,
  isShareCancelError,
} from "./signatureCarnetCardLogic.js";
import { formatCarnetWinrate } from "./signatureCarnetLogic.js";
import { escapeHtml } from "./ui.js";

const COLOR = {
  bg: "#0d0f1e",
  bgDeep: "#05060f",
  hero: "#12142a",
  card: "rgba(129, 140, 248, 0.14)",
  primary: "#ff3cac",
  primaryHot: "#ff6b6b",
  secondary: "#6366f1",
  secondarySoft: "#818cf8",
  gold: "#F5D76E",
  white: "#ffffff",
  muted: "rgba(255,255,255,0.72)",
  track: "rgba(255,255,255,0.14)",
  restBar: "#b4b8f5",
  lavender: "#c4b5fd",
  orange: "#fb923c",
};

const FONT = 'Inter, system-ui, -apple-system, sans-serif';
const DISPLAY_FONT = "Anton, Impact, Inter, sans-serif";
/** skewX(-6deg) des titres de l'app (--display-skew). */
const DISPLAY_SKEW = Math.tan((-6 * Math.PI) / 180);

let previewClose = null;
let logoCache = null;

function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  if (typeof ctx.roundRect === "function") {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, rr);
    return;
  }
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function fillRoundRect(ctx, x, y, w, h, r, fill) {
  roundRectPath(ctx, x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
}

function ellipsize(ctx, text, maxW) {
  const s = String(text || "");
  if (ctx.measureText(s).width <= maxW) return s;
  let out = s;
  while (out.length > 1 && ctx.measureText(`${out}…`).width > maxW) {
    out = out.slice(0, -1);
  }
  return `${out}…`;
}

async function waitFonts() {
  try {
    if (typeof document !== "undefined" && document.fonts?.ready) {
      await document.fonts.ready;
    }
  } catch {
    /* ignore */
  }
}

function loadLogo() {
  if (logoCache) return logoCache;
  logoCache = new Promise((resolve) => {
    if (typeof Image === "undefined") {
      resolve(null);
      return;
    }
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const img = new Image();
    img.onload = () => done(img.naturalWidth ? img : null);
    img.onerror = () => done(null);
    img.src = APP_LOGO;
    setTimeout(() => done(img.complete && img.naturalWidth ? img : null), 4000);
  });
  return logoCache;
}

function loadAvatarImage(url) {
  if (!url || typeof Image === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => done(img.naturalWidth ? img : null);
    img.onerror = () => done(null);
    img.src = url;
    setTimeout(() => done(img.complete && img.naturalWidth ? img : null), 4000);
  });
}

/** Dégradé du cadre : or → rose → indigo (carte de collection). */
function frameGradient(ctx, box) {
  const g = ctx.createLinearGradient(box.x, box.y, box.x + box.w, box.y + box.h);
  g.addColorStop(0, COLOR.gold);
  g.addColorStop(0.5, COLOR.primary);
  g.addColorStop(1, COLOR.secondary);
  return g;
}

/** Dégradé des chiffres : indigo → rose (accent de la soirée). */
function valueGradient(ctx, x, y, w, h) {
  const g = ctx.createLinearGradient(x, y, x + w, y + h);
  g.addColorStop(0, COLOR.secondarySoft);
  g.addColorStop(1, COLOR.primary);
  return g;
}

function drawBackground(ctx, layout) {
  ctx.fillStyle = COLOR.bg;
  ctx.fillRect(0, 0, layout.w, layout.h);
  const glow = (x, y, r, color) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, layout.w, layout.h);
  };
  glow(layout.w * 0.15, layout.h * 0.08, 900, "rgba(255, 60, 172, 0.32)");
  glow(layout.w * 0.95, layout.h * 0.95, 950, "rgba(99, 102, 241, 0.38)");
}

function drawCardFrame(ctx, box) {
  const border = box.border;
  ctx.save();
  ctx.shadowColor = "rgba(245, 215, 110, 0.35)";
  ctx.shadowBlur = 70;
  ctx.shadowOffsetY = 30;
  fillRoundRect(ctx, box.x, box.y, box.w, box.h, box.r, frameGradient(ctx, box));
  ctx.restore();
  const inner = ctx.createLinearGradient(box.x, box.y, box.x + box.w * 0.4, box.y + box.h);
  inner.addColorStop(0, "#1d1a3a");
  inner.addColorStop(1, "#120f27");
  fillRoundRect(
    ctx,
    box.x + border,
    box.y + border,
    box.w - border * 2,
    box.h - border * 2,
    box.r - border,
    inner
  );
}

function drawCardTop(ctx, box, label) {
  ctx.fillStyle = COLOR.gold;
  ctx.font = `800 30px ${FONT}`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  if ("letterSpacing" in ctx) ctx.letterSpacing = "4px";
  ctx.fillText(label.toUpperCase(), box.x, box.y + box.h / 2);
  ctx.textAlign = "right";
  ctx.fillText("✦", box.x + box.w, box.y + box.h / 2);
  if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
}

function drawAvatar(ctx, box, identity, photo) {
  const { cx, cy, r, ring } = box;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  if (typeof ctx.createConicGradient === "function") {
    const g = ctx.createConicGradient(0, cx, cy);
    g.addColorStop(0, COLOR.gold);
    g.addColorStop(0.33, COLOR.primary);
    g.addColorStop(0.66, COLOR.secondary);
    g.addColorStop(1, COLOR.gold);
    ctx.fillStyle = g;
  } else {
    ctx.fillStyle = frameGradient(ctx, { x: cx - r, y: cy - r, w: r * 2, h: r * 2 });
  }
  ctx.fill();
  ctx.restore();

  const inner = r - ring;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, inner, 0, Math.PI * 2);
  ctx.fillStyle = "#16173a";
  ctx.fill();
  if (photo) {
    ctx.clip();
    ctx.drawImage(photo, cx - inner, cy - inner, inner * 2, inner * 2);
  }
  ctx.restore();
  if (!photo) {
    ctx.font = `${Math.round(inner * 1.05)}px ${FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = COLOR.white;
    ctx.fillText(identity.emoji, cx, cy + inner * 0.06);
  }
}

/** Texte Anton incliné (comme les titres de l'app). */
function fillDisplayText(ctx, text, x, y, { size, maxW, fill, align = "center" }) {
  ctx.save();
  ctx.font = `400 ${size}px ${DISPLAY_FONT}`;
  ctx.textAlign = align;
  ctx.textBaseline = "alphabetic";
  const s = ellipsize(ctx, String(text || "").toUpperCase(), maxW);
  ctx.translate(x, y);
  ctx.transform(1, 0, DISPLAY_SKEW, 1, 0, 0);
  ctx.fillStyle = fill;
  ctx.fillText(s, 0, 0);
  ctx.restore();
}

function drawName(ctx, box, identity) {
  fillDisplayText(ctx, identity.name, box.x + box.w / 2, box.y + box.h, {
    size: box.size,
    maxW: box.w,
    fill: identity.nameColorHex || COLOR.white,
  });
}

function drawBadge(ctx, box) {
  const label = `✨ ${PACK_SIGNATURE_LABEL.toUpperCase()}`;
  ctx.font = `800 30px ${FONT}`;
  if ("letterSpacing" in ctx) ctx.letterSpacing = "3px";
  const w = ctx.measureText(label).width + 56;
  const x = box.x + (box.w - w) / 2;
  const g = ctx.createLinearGradient(x, box.y, x + w, box.y + box.h);
  g.addColorStop(0, COLOR.gold);
  g.addColorStop(1, "#fbbf24");
  fillRoundRect(ctx, x, box.y, w, box.h, box.h / 2, g);
  ctx.fillStyle = "#1b1404";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, box.x + box.w / 2, box.y + box.h / 2 + 1);
  if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
}

function drawHook(ctx, box, hook) {
  if (!hook) return;
  ctx.fillStyle = COLOR.gold;
  ctx.font = `800 40px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(ellipsize(ctx, hook, box.w), box.x + box.w / 2, box.y + box.h / 2);
}

function drawStatTiles(ctx, tiles, model) {
  const favId = model.stats.favoriteGame;
  const favTitle = catalogTitleForSessionGameId(favId) || CARNET_LABEL.favoriteNone;
  const favEmoji = catalogEmojiForSessionGameId(favId) || CARNET_LABEL.statsFavoriteEmoji;
  const cells = [
    {
      value: String(model.stats.evenings),
      label: `${CARNET_LABEL.statsEveningsEmoji} ${CARNET_LABEL.statsEvenings}`,
    },
    {
      value: String(model.stats.mvp),
      label: `${CARNET_LABEL.statsMvpEmoji} ${CARNET_LABEL.statsMvp}`,
    },
    {
      value: formatCarnetWinrate(model.stats.winrate),
      label: CARNET_LABEL.statsWinrate,
    },
    {
      value: `${favEmoji} ${favTitle}`,
      label: `${CARNET_LABEL.statsFavoriteEmoji} ${CARNET_LABEL.statsFavorite}`,
      small: true,
    },
  ];
  cells.forEach((cell, i) => {
    const box = tiles[i];
    fillRoundRect(ctx, box.x, box.y, box.w, box.h, box.r, "rgba(255,255,255,0.06)");
    const padX = 30;
    const size = cell.small ? 52 : 88;
    fillDisplayText(ctx, cell.value, box.x + padX, box.y + 34 + size * 0.82, {
      size,
      maxW: box.w - padX * 2,
      fill: valueGradient(ctx, box.x, box.y, box.w, box.h),
      align: "left",
    });
    ctx.fillStyle = COLOR.muted;
    ctx.font = `700 28px ${FONT}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(ellipsize(ctx, cell.label, box.w - padX * 2), box.x + padX, box.y + box.h - 30);
  });
}

function drawRankDots(ctx, box, tones) {
  const n = tones.length || 20;
  const d = box.dot;
  const gap = (box.w - n * d) / Math.max(1, n - 1);
  const y = box.y + box.h / 2;
  for (let i = 0; i < n; i += 1) {
    const x = box.x + d / 2 + i * (d + gap);
    const tone = tones[i];
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, d / 2, 0, Math.PI * 2);
    if (tone === "first") {
      ctx.shadowColor = "rgba(245, 215, 110, 0.6)";
      ctx.shadowBlur = 14;
      ctx.fillStyle = COLOR.gold;
      ctx.fill();
    } else if (tone === "second") {
      ctx.fillStyle = COLOR.lavender;
      ctx.fill();
    } else if (tone === "rest") {
      ctx.fillStyle = COLOR.orange;
      ctx.fill();
    } else {
      ctx.fillStyle = "rgba(255,255,255,0.12)";
      ctx.fill();
    }
    ctx.restore();
  }
}

function drawLogo(ctx, box, img) {
  if (img && img.naturalWidth) {
    const scale = Math.min(box.w / img.naturalWidth, box.h / img.naturalHeight);
    const dw = img.naturalWidth * scale;
    const dh = img.naturalHeight * scale;
    ctx.drawImage(img, box.x + (box.w - dw) / 2, box.y + (box.h - dh) / 2, dw, dh);
    return;
  }
  fillDisplayText(ctx, "REVEAL", box.x + box.w / 2, box.y + box.h * 0.6, {
    size: 72,
    maxW: box.w,
    fill: valueGradient(ctx, box.x, box.y, box.w, box.h),
  });
}

async function waitDisplayFont() {
  try {
    if (typeof document !== "undefined" && document.fonts?.load) {
      await document.fonts.load(`400 120px ${DISPLAY_FONT}`);
    }
  } catch {
    /* police de secours */
  }
}

/** Carte de collection 9:16 : cadre doré, avatar, pseudo, accroche, 4 stats, 20 soirées, logo. */
export async function renderCarnetSharePng(model) {
  await waitFonts();
  await waitDisplayFont();
  const layout = carnetCardLayout();
  const canvas = document.createElement("canvas");
  canvas.width = CARNET_CARD_WIDTH;
  canvas.height = CARNET_CARD_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");

  drawBackground(ctx, layout);
  drawCardFrame(ctx, layout.card);
  drawCardTop(ctx, layout.top, CARNET_LABEL.pageTitle);
  const photo = await loadAvatarImage(model.identity?.avatarUrl);
  drawAvatar(ctx, layout.avatar, model.identity, photo);
  drawName(ctx, layout.name, model.identity);
  drawBadge(ctx, layout.badge);
  drawHook(ctx, layout.hook, model.hook);
  drawStatTiles(ctx, layout.tiles, model);
  drawRankDots(ctx, layout.dots, model.dots);
  drawLogo(ctx, layout.logo, await loadLogo());

  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob((out) => {
      if (out) resolve(out);
      else reject(new Error("png"));
    }, CARNET_CARD_MIME);
  });
  return blob;
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const s = String(reader.result || "");
      const comma = s.indexOf(",");
      resolve(comma >= 0 ? s.slice(comma + 1) : s);
    };
    reader.onerror = () => reject(reader.error || new Error("base64"));
    reader.readAsDataURL(blob);
  });
}

async function sharePngNative(blob) {
  const shareMod = await loadCapacitorShare();
  const fsMod = await loadCapacitorFilesystem();
  const Share = shareMod?.Share;
  const Filesystem = fsMod?.Filesystem;
  if (!Share?.share || !Filesystem?.writeFile || !Filesystem?.getUri) {
    throw new Error("share");
  }
  const data = await blobToBase64(blob);
  await Filesystem.writeFile({
    path: CARNET_CARD_FILE,
    data,
    directory: "CACHE",
  });
  const got = await Filesystem.getUri({
    path: CARNET_CARD_FILE,
    directory: "CACHE",
  });
  const uri = got?.uri;
  if (!uri) throw new Error("share");
  try {
    await Share.share({
      title: "REVEAL",
      files: [uri],
      dialogTitle: CARNET_LABEL.shareConfirm,
    });
    return { ok: true, method: "share" };
  } catch (e) {
    if (isShareCancelError(e)) return { ok: true, method: "cancel" };
    throw e;
  }
}

async function shareOrDownloadPng(blob) {
  if (isNativeApp()) {
    return sharePngNative(blob);
  }
  const file = new File([blob], CARNET_CARD_FILE, { type: CARNET_CARD_MIME });
  const canFiles =
    typeof navigator !== "undefined" &&
    typeof navigator.share === "function" &&
    typeof navigator.canShare === "function" &&
    navigator.canShare({ files: [file] });
  if (canFiles) {
    try {
      await navigator.share({ files: [file], title: "REVEAL" });
      return { ok: true, method: "share" };
    } catch (e) {
      if (isShareCancelError(e)) return { ok: true, method: "cancel" };
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = CARNET_CARD_FILE;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2500);
  return { ok: true, method: "download" };
}

function closePreview() {
  previewClose?.();
}

export function openCarnetSharePreview(model) {
  closePreview();
  let closed = false;
  let blob = null;
  let objectUrl = null;

  const root = document.createElement("div");
  root.className = "app-dialog carnet-share-dialog";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-labelledby", "carnet-share-title");
  root.innerHTML = `
    <div class="app-dialog__backdrop" data-carnet-share-dismiss aria-hidden="true"></div>
    <div class="app-dialog__panel carnet-share-dialog__panel">
      <p class="app-dialog__title" id="carnet-share-title">${escapeHtml(CARNET_LABEL.sharePreviewTitle)}</p>
      <div class="carnet-share-dialog__stage">
        <p class="hint carnet-share-dialog__status" data-carnet-share-status>${escapeHtml(
          CARNET_LABEL.shareGenerating
        )}</p>
        <img class="carnet-share-dialog__img" data-carnet-share-img alt="${escapeHtml(
          CARNET_LABEL.sharePreviewTitle
        )}" hidden />
      </div>
        <p class="hint carnet-share-dialog__hint" data-carnet-share-hint hidden>${escapeHtml(
          CARNET_LABEL.shareHint
        )}</p>
      <button type="button" class="btn btn-primary app-dialog__btn" data-carnet-share-send disabled>${escapeHtml(
        CARNET_LABEL.shareConfirm
      )}</button>
      <button type="button" class="btn btn-secondary app-dialog__btn" data-carnet-share-close>${escapeHtml(
        CARNET_LABEL.shareClose
      )}</button>
    </div>
  `;

  const statusEl = root.querySelector("[data-carnet-share-status]");
  const imgEl = root.querySelector("[data-carnet-share-img]");
  const hintEl = root.querySelector("[data-carnet-share-hint]");
  const sendBtn = root.querySelector("[data-carnet-share-send]");
  let painting = false;

  const paintPreview = () => {
    if (closed || painting) return;
    painting = true;
    if (sendBtn) sendBtn.disabled = true;
    if (statusEl) {
      statusEl.hidden = false;
      statusEl.textContent = CARNET_LABEL.shareGenerating;
    }
    if (imgEl) imgEl.hidden = true;
    void renderCarnetSharePng(model)
      .then((out) => {
        if (closed) return;
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        blob = out;
        objectUrl = URL.createObjectURL(out);
        if (imgEl) {
          imgEl.src = objectUrl;
          imgEl.hidden = false;
        }
        if (statusEl) statusEl.hidden = true;
        if (hintEl) {
          hintEl.hidden = false;
          hintEl.textContent = CARNET_LABEL.shareHint;
        }
        if (sendBtn) sendBtn.disabled = false;
      })
      .catch(() => {
        if (closed) return;
        if (statusEl) statusEl.textContent = CARNET_LABEL.shareError;
      })
      .finally(() => {
        painting = false;
      });
  };

  const close = () => {
    if (closed) return;
    closed = true;
    if (previewClose === close) previewClose = null;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = null;
    blob = null;
    root.classList.remove("app-dialog--in");
    root.classList.add("app-dialog--out");
    const done = () => root.remove();
    root.addEventListener("transitionend", done, { once: true });
    setTimeout(done, 280);
  };

  previewClose = close;
  root.querySelector("[data-carnet-share-close]")?.addEventListener("click", close);
  root.querySelector("[data-carnet-share-dismiss]")?.addEventListener("click", close);
  root.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });
  sendBtn?.addEventListener(
    "click",
    withClickLock(async () => {
      if (!blob) return;
      try {
        await shareOrDownloadPng(blob);
      } catch {
        if (statusEl) statusEl.textContent = CARNET_LABEL.shareError;
      }
    })
  );

  document.body.appendChild(root);
  requestAnimationFrame(() => root.classList.add("app-dialog--in"));
  sendBtn?.focus();
  paintPreview();

  return close;
}

export function closeCarnetSharePreview() {
  closePreview();
}
