/**
 * Recadrage cercle (pastille carte share). Pur : pas de DOM.
 * Transform : image centrée, translate(tx, ty) scale(scale), origine = centre.
 */
export const CARNET_CROP_OUT = 256;
export const CARNET_CROP_MAX_FACTOR = 4;

export function cropMinScale(imgW, imgH, circleD) {
  const w = Number(imgW) || 0;
  const h = Number(imgH) || 0;
  const d = Number(circleD) || 0;
  if (w <= 0 || h <= 0 || d <= 0) return 1;
  return d / Math.min(w, h);
}

export function cropMaxScale(minScale) {
  const min = Number(minScale) || 1;
  return Math.max(min, min * CARNET_CROP_MAX_FACTOR);
}

export function clampCropTransform({
  tx = 0,
  ty = 0,
  scale,
  imgW,
  imgH,
  circleD,
  minScale,
  maxScale,
} = {}) {
  const min = Number(minScale) || cropMinScale(imgW, imgH, circleD);
  const max = Number(maxScale) || cropMaxScale(min);
  const s = Math.max(min, Math.min(max, Number(scale) || min));
  const w = Number(imgW) || 0;
  const h = Number(imgH) || 0;
  const d = Number(circleD) || 0;
  const maxTx = Math.max(0, (w * s - d) / 2);
  const maxTy = Math.max(0, (h * s - d) / 2);
  const x = Number(tx) || 0;
  const y = Number(ty) || 0;
  return {
    scale: s,
    tx: Math.max(-maxTx, Math.min(maxTx, x)),
    ty: Math.max(-maxTy, Math.min(maxTy, y)),
  };
}

/** Carré source (px image) qui remplit le cercle. */
export function cropSourceRect({ imgW, imgH, scale, tx, ty, circleD } = {}) {
  const s = Number(scale) || 1;
  const d = Number(circleD) || 0;
  const r = d / 2 / s;
  const cx = (Number(imgW) || 0) / 2 - (Number(tx) || 0) / s;
  const cy = (Number(imgH) || 0) / 2 - (Number(ty) || 0) / s;
  return { sx: cx - r, sy: cy - r, sw: r * 2, sh: r * 2 };
}
