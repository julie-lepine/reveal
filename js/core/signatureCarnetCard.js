/**
 * FEATURE-PROFILE-04 — carte share 9:16 (canvas + preview + share sheet).
 */
import { APP_LOGO } from "../../data/branding.js";
import { CARNET_LABEL } from "../config/signatureCarnet.js";
import { withClickLock } from "./actionLock.js";
import {
  catalogEmojiForSessionGameId,
  catalogTitleForSessionGameId,
} from "./gameCatalogTitle.js";
import {
  CARNET_CARD_FILE,
  CARNET_CARD_HEIGHT,
  CARNET_CARD_MIME,
  CARNET_CARD_WIDTH,
  carnetCardLayout,
} from "./signatureCarnetCardLogic.js";
import {
  carnetSparklineLayout,
  carnetWinrateRing,
  formatCarnetWinrate,
} from "./signatureCarnetLogic.js";
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
};

const FONT = 'Inter, system-ui, -apple-system, sans-serif';

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

function drawHero(ctx, box, hook) {
  fillRoundRect(ctx, box.x, box.y, box.w, box.h, box.r, COLOR.hero);
  ctx.save();
  roundRectPath(ctx, box.x, box.y, box.w, box.h, box.r);
  ctx.clip();
  const g1 = ctx.createRadialGradient(
    box.x + box.w * 0.22,
    box.y + box.h * 0.28,
    20,
    box.x + box.w * 0.22,
    box.y + box.h * 0.28,
    box.w * 0.62
  );
  g1.addColorStop(0, "rgba(255, 60, 172, 0.42)");
  g1.addColorStop(1, "rgba(255, 60, 172, 0)");
  ctx.fillStyle = g1;
  ctx.fillRect(box.x, box.y, box.w, box.h);
  const g2 = ctx.createRadialGradient(
    box.x + box.w * 0.82,
    box.y + box.h * 0.78,
    10,
    box.x + box.w * 0.82,
    box.y + box.h * 0.78,
    box.w * 0.7
  );
  g2.addColorStop(0, "rgba(99, 102, 241, 0.5)");
  g2.addColorStop(1, "rgba(99, 102, 241, 0)");
  ctx.fillStyle = g2;
  ctx.fillRect(box.x, box.y, box.w, box.h);
  if (hook) {
    const fade = ctx.createLinearGradient(box.x, box.y + box.h - 150, box.x, box.y + box.h);
    fade.addColorStop(0, "rgba(5, 6, 15, 0)");
    fade.addColorStop(1, "rgba(5, 6, 15, 0.58)");
    ctx.fillStyle = fade;
    ctx.fillRect(box.x, box.y + box.h - 150, box.w, 150);
    ctx.fillStyle = COLOR.white;
    ctx.font = `800 44px ${FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.shadowColor = "rgba(0, 0, 0, 0.45)";
    ctx.shadowBlur = 12;
    ctx.fillText(ellipsize(ctx, hook, box.w - 56), box.x + box.w / 2, box.y + box.h - 32);
    ctx.shadowBlur = 0;
  }
  ctx.restore();
  ctx.save();
  roundRectPath(ctx, box.x, box.y, box.w, box.h, box.r);
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}

function drawIdentity(ctx, box, identity, photo) {
  const r = box.avatar / 2;
  const cx = box.x + r;
  const cy = box.y + box.h / 2;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = identity.color;
  ctx.fill();
  if (photo) {
    ctx.clip();
    ctx.drawImage(photo, cx - r, cy - r, box.avatar, box.avatar);
  }
  ctx.restore();
  if (!photo) {
    ctx.font = `48px ${FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = COLOR.white;
    ctx.fillText(identity.emoji, cx, cy + 2);
  }
  if (identity.signature) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = COLOR.gold;
    ctx.lineWidth = 4;
    ctx.shadowColor = "rgba(245, 215, 110, 0.45)";
    ctx.shadowBlur = 10;
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  const nameX = box.x + box.avatar + 22;
  const nameMax = box.w - box.avatar - 22;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = identity.nameColorHex || COLOR.white;
  ctx.font = `700 42px ${FONT}`;
  const name = ellipsize(ctx, identity.name, nameMax - (identity.signature ? 40 : 0));
  ctx.fillText(name, nameX, cy);
  if (identity.signature) {
    const nw = ctx.measureText(name).width;
    ctx.fillStyle = COLOR.gold;
    ctx.font = `700 32px ${FONT}`;
    ctx.fillText("✦", nameX + nw + 10, cy);
  }
}

function drawRing(ctx, box, winrate) {
  fillRoundRect(ctx, box.x, box.y, box.w, box.h, box.r, COLOR.card);
  const ring = carnetWinrateRing(winrate, { radius: 72, stroke: 14 });
  const cx = box.x + box.w / 2;
  const cy = box.y + 118;
  ctx.beginPath();
  ctx.arc(cx, cy, ring.radius, 0, Math.PI * 2);
  ctx.strokeStyle = COLOR.track;
  ctx.lineWidth = ring.stroke;
  ctx.stroke();
  const pct =
    winrate == null || !Number.isFinite(winrate) ? 0 : Math.max(0, Math.min(1, winrate));
  if (pct > 0) {
    ctx.beginPath();
    ctx.arc(cx, cy, ring.radius, -Math.PI / 2, -Math.PI / 2 + pct * Math.PI * 2);
    ctx.strokeStyle = COLOR.primary;
    ctx.lineCap = "round";
    ctx.lineWidth = ring.stroke;
    ctx.shadowColor = "rgba(255, 60, 172, 0.55)";
    ctx.shadowBlur = 12;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.lineCap = "butt";
  }
  ctx.fillStyle = COLOR.primary;
  ctx.font = `800 36px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(formatCarnetWinrate(winrate), cx, cy);
  ctx.fillStyle = COLOR.muted;
  ctx.font = `600 22px ${FONT}`;
  ctx.textBaseline = "alphabetic";
  ctx.fillText(CARNET_LABEL.statsWinrate, cx, box.y + box.h - 22);
}

function drawSpark(ctx, box, scores) {
  fillRoundRect(ctx, box.x, box.y, box.w, box.h, box.r, COLOR.card);
  ctx.fillStyle = COLOR.muted;
  ctx.font = `600 22px ${FONT}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(CARNET_LABEL.chartScores, box.x + 18, box.y + 32);

  const padX = 16;
  const padBottom = 14;
  const titleY = 44;
  const chart = {
    x: box.x + padX,
    y: box.y + titleY,
    w: box.w - padX * 2,
    h: Math.max(96, box.h - titleY - padBottom),
  };
  const finite = (Array.isArray(scores) ? scores : []).filter((n) => Number.isFinite(n));
  const layout = carnetSparklineLayout(finite, {
    width: chart.w,
    height: chart.h,
    pad: 8,
  });
  ctx.save();
  ctx.translate(chart.x, chart.y);
  if (layout.dots.length === 1) {
    ctx.beginPath();
    ctx.arc(layout.dots[0].x, layout.dots[0].y, 5, 0, Math.PI * 2);
    ctx.fillStyle = COLOR.secondarySoft;
    ctx.fill();
  } else if (layout.dots.length > 1) {
    ctx.beginPath();
    ctx.moveTo(layout.dots[0].x, layout.height - 8);
    for (const d of layout.dots) ctx.lineTo(d.x, d.y);
    ctx.lineTo(layout.dots[layout.dots.length - 1].x, layout.height - 8);
    ctx.closePath();
    ctx.fillStyle = "rgba(99, 102, 241, 0.22)";
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(layout.dots[0].x, layout.dots[0].y);
    for (let i = 1; i < layout.dots.length; i += 1) {
      ctx.lineTo(layout.dots[i].x, layout.dots[i].y);
    }
    ctx.strokeStyle = COLOR.secondarySoft;
    ctx.lineWidth = 3;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke();
    const last = layout.dots[layout.dots.length - 1];
    ctx.beginPath();
    ctx.arc(last.x, last.y, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = COLOR.secondarySoft;
    ctx.fill();
  }
  ctx.restore();

  if (layout.yMin != null && layout.yMax != null) {
    ctx.fillStyle = COLOR.secondarySoft;
    ctx.font = `800 28px ${FONT}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(String(layout.yMin), chart.x, chart.y + chart.h - 4);
    ctx.textAlign = "right";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(String(layout.yMax), chart.x + chart.w, chart.y + 26);
  }
}

function drawRanks(ctx, box, split, percents) {
  fillRoundRect(ctx, box.x, box.y, box.w, box.h, box.r, COLOR.card);
  ctx.fillStyle = COLOR.muted;
  ctx.font = `600 22px ${FONT}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(CARNET_LABEL.chartRanks, box.x + 18, box.y + 32);

  const rows = [
    { label: CARNET_LABEL.chartRankFirst, n: split.first, pct: percents.first, fill: COLOR.primary },
    { label: CARNET_LABEL.chartRankSecond, n: split.second, pct: percents.second, fill: COLOR.secondarySoft },
    { label: CARNET_LABEL.chartRankRest, n: split.rest, pct: percents.rest, fill: COLOR.restBar },
  ];
  rows.forEach((row, i) => {
    const y = box.y + 58 + i * 40;
    ctx.fillStyle = COLOR.white;
    ctx.font = `600 22px ${FONT}`;
    ctx.textAlign = "left";
    ctx.fillText(row.label, box.x + 18, y + 16);
    const trackX = box.x + 86;
    const trackW = box.w - 86 - 64;
    fillRoundRect(ctx, trackX, y + 6, trackW, 12, 99, "rgba(255,255,255,0.1)");
    if (row.pct > 0) {
      fillRoundRect(ctx, trackX, y + 6, Math.max(12, (trackW * row.pct) / 100), 12, 99, row.fill);
    }
    ctx.textAlign = "right";
    ctx.fillStyle = COLOR.muted;
    ctx.fillText(String(row.n), box.x + box.w - 18, y + 16);
  });
}

function drawTiles(ctx, tiles, model) {
  const favId = model.stats.favoriteGame;
  const favTitle = catalogTitleForSessionGameId(favId) || CARNET_LABEL.favoriteNone;
  const favEmoji = catalogEmojiForSessionGameId(favId) || CARNET_LABEL.statsFavoriteEmoji;
  const cells = [
    {
      box: tiles[0],
      emoji: CARNET_LABEL.statsEveningsEmoji,
      value: String(model.stats.evenings),
      label: CARNET_LABEL.statsEvenings,
      fill: "rgba(255, 60, 172, 0.18)",
      valueColor: COLOR.primary,
    },
    {
      box: tiles[1],
      emoji: CARNET_LABEL.statsGamesEmoji,
      value: String(model.stats.games),
      label: CARNET_LABEL.statsGames,
      fill: "rgba(99, 102, 241, 0.22)",
      valueColor: COLOR.secondarySoft,
    },
    {
      box: tiles[2],
      emoji: CARNET_LABEL.statsMvpEmoji,
      value: String(model.stats.mvp),
      label: CARNET_LABEL.statsMvp,
      fill: "rgba(255, 107, 107, 0.18)",
      valueColor: COLOR.primaryHot,
    },
    {
      box: tiles[3],
      emoji: favEmoji,
      value: favTitle,
      label: CARNET_LABEL.statsFavorite,
      fill: "rgba(129, 140, 248, 0.2)",
      valueColor: COLOR.secondarySoft,
    },
  ];
  for (const cell of cells) {
    const { box } = cell;
    fillRoundRect(ctx, box.x, box.y, box.w, box.h, box.r, cell.fill);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.font = `800 32px ${FONT}`;
    ctx.fillStyle = cell.valueColor;
    const value = ellipsize(ctx, `${cell.emoji}  ${cell.value}`, box.w - 28);
    ctx.fillText(value, box.x + 16, box.y + 52);
    ctx.fillStyle = COLOR.muted;
    ctx.font = `600 20px ${FONT}`;
    ctx.fillText(cell.label, box.x + 16, box.y + box.h - 22);
  }
}

function drawDots(ctx, box, tones) {
  ctx.fillStyle = COLOR.muted;
  ctx.font = `600 22px ${FONT}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(CARNET_LABEL.shareDotsTitle, box.x, box.y + 22);

  const n = tones.length || 20;
  const d = 22;
  const span = box.w - d;
  const rowY = box.y + box.h - d / 2;
  ctx.lineWidth = 2;
  for (let i = 0; i < n; i += 1) {
    const x = n === 1 ? box.x + box.w / 2 : box.x + d / 2 + (i / (n - 1)) * span;
    const y = rowY;
    const tone = tones[i];
    ctx.beginPath();
    ctx.arc(x, y, d / 2, 0, Math.PI * 2);
    if (tone === "first") {
      ctx.fillStyle = COLOR.primary;
      ctx.fill();
    } else if (tone === "second") {
      ctx.fillStyle = COLOR.secondarySoft;
      ctx.fill();
    } else if (tone === "rest") {
      ctx.fillStyle = "rgba(255,255,255,0.28)";
      ctx.fill();
    } else {
      ctx.strokeStyle = "rgba(255,255,255,0.16)";
      ctx.stroke();
    }
  }
}

function drawLogo(ctx, box, img) {
  if (img && img.naturalWidth) {
    const maxW = Math.min(box.w * 0.72, 640);
    const maxH = box.h;
    const scale = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight);
    const dw = img.naturalWidth * scale;
    const dh = img.naturalHeight * scale;
    ctx.drawImage(img, box.x + (box.w - dw) / 2, box.y + (box.h - dh) / 2, dw, dh);
    return;
  }
  ctx.fillStyle = COLOR.gold;
  ctx.font = `800 42px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("REVEAL", box.x + box.w / 2, box.y + box.h / 2);
}

export async function renderCarnetSharePng(model) {
  await waitFonts();
  const layout = carnetCardLayout();
  const canvas = document.createElement("canvas");
  canvas.width = CARNET_CARD_WIDTH;
  canvas.height = CARNET_CARD_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  ctx.fillStyle = COLOR.bg;
  ctx.fillRect(0, 0, layout.w, layout.h);
  const bgGlow = ctx.createRadialGradient(layout.w * 0.5, 80, 40, layout.w * 0.5, 400, 900);
  bgGlow.addColorStop(0, COLOR.bgDeep);
  bgGlow.addColorStop(1, COLOR.bg);
  ctx.fillStyle = bgGlow;
  ctx.fillRect(0, 0, layout.w, layout.h);

  drawHero(ctx, layout.hero, model.hook);
  const photo = await loadAvatarImage(model.identity?.avatarUrl);
  drawIdentity(ctx, layout.ident, model.identity, photo);
  drawRing(ctx, layout.ring, model.stats.winrate);
  drawSpark(ctx, layout.spark, model.sparkScores);
  drawRanks(ctx, layout.ranks, model.rankSplit, model.rankPercents);
  drawTiles(ctx, layout.tiles, model);
  drawDots(ctx, layout.dots, model.dots);
  drawLogo(ctx, layout.logo, await loadLogo());

  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob((out) => {
      if (out) resolve(out);
      else reject(new Error("png"));
    }, CARNET_CARD_MIME);
  });
  return blob;
}

async function shareOrDownloadPng(blob) {
  const file = new File([blob], CARNET_CARD_FILE, { type: CARNET_CARD_MIME });
  if (typeof navigator !== "undefined" && navigator.share) {
    const payload = { files: [file], title: "REVEAL", text: CARNET_LABEL.shareCard };
    const canFiles =
      typeof navigator.canShare !== "function" || navigator.canShare({ files: [file] });
    try {
      if (canFiles) {
        await navigator.share(payload);
        return { ok: true, method: "share" };
      }
    } catch (e) {
      if (e?.name === "AbortError") return { ok: true, method: "cancel" };
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
