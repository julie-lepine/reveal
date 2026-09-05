/**
 * UI recadrage cercle (picker déjà résolu en Image). Local only.
 */
import { CARNET_LABEL } from "../config/signatureCarnet.js";
import { withClickLock } from "./actionLock.js";
import {
  CARNET_CROP_OUT,
  clampCropTransform,
  cropMaxScale,
  cropMinScale,
  cropSourceRect,
} from "./signatureCarnetCropLogic.js";
import { escapeHtml } from "./ui.js";

let cropFinish = null;

export function closeCarnetPhotoCrop() {
  cropFinish?.(null);
}

function rasterize(img, transform, circleD) {
  const { sx, sy, sw, sh } = cropSourceRect({
    imgW: img.naturalWidth,
    imgH: img.naturalHeight,
    circleD,
    ...transform,
  });
  const canvas = document.createElement("canvas");
  canvas.width = CARNET_CROP_OUT;
  canvas.height = CARNET_CROP_OUT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, CARNET_CROP_OUT, CARNET_CROP_OUT);
  return canvas;
}

/**
 * @returns {Promise<HTMLCanvasElement|null>}
 */
export function openCarnetPhotoCrop(img) {
  return new Promise((resolve) => {
    const root = document.createElement("div");
    root.className = "app-dialog carnet-crop-dialog";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-labelledby", "carnet-crop-title");
    root.innerHTML = `
      <div class="app-dialog__backdrop" data-crop-cancel aria-hidden="true"></div>
      <div class="app-dialog__panel carnet-crop-dialog__panel">
        <p class="app-dialog__title" id="carnet-crop-title">${escapeHtml(CARNET_LABEL.shareCropTitle)}</p>
        <div class="carnet-crop__stage" data-crop-stage>
          <img class="carnet-crop__img" data-crop-img alt="" draggable="false" />
          <div class="carnet-crop__hole" data-crop-hole aria-hidden="true"></div>
        </div>
        <p class="hint carnet-crop__hint">${escapeHtml(CARNET_LABEL.shareCropHint)}</p>
        <div class="carnet-crop__actions">
          <button type="button" class="btn btn-secondary" data-crop-cancel>${escapeHtml(
            CARNET_LABEL.shareCropCancel
          )}</button>
          <button type="button" class="btn btn-primary" data-crop-ok>${escapeHtml(
            CARNET_LABEL.shareCropOk
          )}</button>
        </div>
      </div>
    `;

    const stage = root.querySelector("[data-crop-stage]");
    const hole = root.querySelector("[data-crop-hole]");
    const imgEl = root.querySelector("[data-crop-img]");
    imgEl.src = img.src;
    imgEl.style.width = `${img.naturalWidth}px`;
    imgEl.style.height = `${img.naturalHeight}px`;
    imgEl.style.marginLeft = `${-img.naturalWidth / 2}px`;
    imgEl.style.marginTop = `${-img.naturalHeight / 2}px`;

    let transform = { scale: 1, tx: 0, ty: 0 };
    let minScale = 1;
    let maxScale = 4;
    let circleD = 220;
    const pointers = new Map();
    let pinch0 = null;

    function metrics() {
      const rect = stage.getBoundingClientRect();
      const holeRect = hole.getBoundingClientRect();
      circleD = Math.min(holeRect.width, holeRect.height) || Math.min(rect.width, rect.height) * 0.72;
      minScale = cropMinScale(img.naturalWidth, img.naturalHeight, circleD);
      maxScale = cropMaxScale(minScale);
    }

    function apply() {
      transform = clampCropTransform({
        ...transform,
        imgW: img.naturalWidth,
        imgH: img.naturalHeight,
        circleD,
        minScale,
        maxScale,
      });
      imgEl.style.transform = `translate(${transform.tx}px, ${transform.ty}px) scale(${transform.scale})`;
    }

    function finish(value) {
      if (cropFinish !== finish) return;
      cropFinish = null;
      root.classList.remove("app-dialog--in");
      root.classList.add("app-dialog--out");
      const done = () => {
        root.remove();
        resolve(value);
      };
      root.addEventListener("transitionend", done, { once: true });
      setTimeout(done, 280);
    }
    cropFinish = finish;

    function clientXY(e) {
      return { x: e.clientX, y: e.clientY };
    }

    function pointerDist() {
      const pts = [...pointers.values()];
      if (pts.length < 2) return 0;
      const dx = pts[1].x - pts[0].x;
      const dy = pts[1].y - pts[0].y;
      return Math.hypot(dx, dy);
    }

    stage.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      stage.setPointerCapture?.(e.pointerId);
      pointers.set(e.pointerId, clientXY(e));
      if (pointers.size === 2) pinch0 = { dist: pointerDist(), scale: transform.scale };
    });
    stage.addEventListener("pointermove", (e) => {
      if (!pointers.has(e.pointerId)) return;
      const prev = pointers.get(e.pointerId);
      const next = clientXY(e);
      pointers.set(e.pointerId, next);
      if (pointers.size === 1) {
        transform = {
          ...transform,
          tx: transform.tx + (next.x - prev.x),
          ty: transform.ty + (next.y - prev.y),
        };
        apply();
      } else if (pointers.size >= 2 && pinch0?.dist) {
        const dist = pointerDist();
        if (dist > 0) {
          transform = { ...transform, scale: pinch0.scale * (dist / pinch0.dist) };
          apply();
        }
      }
    });
    const endPointer = (e) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch0 = null;
    };
    stage.addEventListener("pointerup", endPointer);
    stage.addEventListener("pointercancel", endPointer);
    stage.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.08 : 1 / 1.08;
        transform = { ...transform, scale: transform.scale * factor };
        apply();
      },
      { passive: false }
    );

    root.querySelectorAll("[data-crop-cancel]").forEach((el) => {
      el.addEventListener("click", () => finish(null));
    });
    root.addEventListener("keydown", (e) => {
      if (e.key === "Escape") finish(null);
    });
    root.querySelector("[data-crop-ok]")?.addEventListener(
      "click",
      withClickLock(() => {
        apply();
        try {
          finish(rasterize(img, transform, circleD));
        } catch {
          finish(null);
        }
      })
    );

    document.body.appendChild(root);
    requestAnimationFrame(() => {
      root.classList.add("app-dialog--in");
      metrics();
      transform = { scale: minScale, tx: 0, ty: 0 };
      apply();
    });
  });
}

export function canvasToJpegBlob(canvas, quality = 0.86) {
  return new Promise((resolve, reject) => {
    if (!canvas || typeof canvas.toBlob !== "function") {
      reject(new Error("canvas"));
      return;
    }
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("jpeg"));
      },
      "image/jpeg",
      quality
    );
  });
}

export function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    if (!file) {
      reject(new Error("type"));
      return;
    }
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      if (!image.naturalWidth) {
        URL.revokeObjectURL(url);
        reject(new Error("empty"));
        return;
      }
      image._objectUrl = url;
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("decode"));
    };
    image.src = url;
  });
}

export function revokeCropImage(image) {
  if (image?._objectUrl) URL.revokeObjectURL(image._objectUrl);
}
