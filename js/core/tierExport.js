import { TIER_LEVELS, TIER_COLORS } from "../../data/tierTopics.js";

/** Export du board tier en PNG via canvas */
export function exportTierBoardPng({ listName, placed }) {
  const width = 720;
  const rowH = 56;
  const labelW = 48;
  const height = 40 + TIER_LEVELS.length * rowH;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.fillStyle = "#0D0F1E";
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = "#fff";
  ctx.font = "bold 20px Inter, sans-serif";
  ctx.fillText(listName, 16, 28);

  TIER_LEVELS.forEach((tier, i) => {
    const y = 40 + i * rowH;
    ctx.fillStyle = TIER_COLORS[tier] || "#888";
    ctx.fillRect(8, y + 8, labelW, rowH - 16);
    ctx.fillStyle = "#0D0F1E";
    ctx.font = "bold 22px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(tier, 8 + labelW / 2, y + rowH / 2 + 8);
    ctx.textAlign = "left";

    const items = (placed[tier] || []).join(" · ");
    ctx.fillStyle = "rgba(255,255,255,.9)";
    ctx.font = "14px Inter, sans-serif";
    const text = items || "—";
    ctx.fillText(text.length > 70 ? `${text.slice(0, 67)}…` : text, labelW + 20, y + rowH / 2 + 6);
  });

  return canvas.toDataURL("image/png");
}

export function downloadDataUrl(dataUrl, filename) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  a.click();
}
