/**
 * ARCH-23 — écran bloquant incompatibilité (natif prioritaire).
 *
 * Bouton « Réessayer » = `checkClientCompatibility({ force: true })`.
 * - Boot : onCompatible continue le boot une seule fois (pas de double init).
 * - Foreground : masque le gate si compatible ; sinon garde + feedback réseau.
 * - Create / join / resume : gate présenté avant l’op ; retry compatible masque
 *   le gate — l’utilisateur peut retenter l’action manuellement (pas d’auto-replay).
 */

import {
  ANDROID_PLAY_STORE_URL,
  IOS_APP_STORE_URL,
} from "../config/appCompatibility.js";
import { detectAppPlatform } from "./appBuildIdentity.js";
import {
  checkClientCompatibility,
} from "./clientCompatibility.js";
import { openExternalUrl } from "./openExternal.js";
import { COMPAT_STATUS } from "./clientCompatibilityContract.js";

const RECHECK_UNKNOWN_MSG =
  "Impossible de vérifier la mise à jour. Vérifie ta connexion, puis réessaie.";

let gateRoot = null;
let retryInFlight = false;
/** @type {null | (() => void|Promise<void>)} */
let pendingOnCompatible = null;
let onCompatibleConsumed = false;

export function isClientCompatibilityGateVisible() {
  return Boolean(gateRoot);
}

export function __resetClientCompatibilityGateForTests() {
  hideClientCompatibilityGate();
  retryInFlight = false;
  pendingOnCompatible = null;
  onCompatibleConsumed = false;
}

function storeUrlForPlatform(platform) {
  if (platform === "ios") return String(IOS_APP_STORE_URL || "").trim();
  if (platform === "android") return String(ANDROID_PLAY_STORE_URL || "").trim();
  return "";
}

function setGateMessage(text) {
  const el = gateRoot?.querySelector("#client-compat-msg");
  if (el) el.textContent = text;
}

function setGateFeedback(text) {
  let el = gateRoot?.querySelector("#client-compat-feedback");
  if (!gateRoot) return;
  if (!el) {
    el = document.createElement("p");
    el.id = "client-compat-feedback";
    el.className = "app-dialog__message client-compat-gate__feedback";
    el.setAttribute("role", "status");
    const msg = gateRoot.querySelector("#client-compat-msg");
    msg?.after(el);
  }
  el.textContent = text || "";
  el.hidden = !text;
}

/**
 * @param {{
 *   platform?: string,
 *   onRetry?: () => Promise<void>|void,
 *   onCompatible?: () => void|Promise<void>,
 *   message?: string,
 *   feedback?: string,
 * }} [opts]
 */
export function showClientCompatibilityGate(opts = {}) {
  const platform = opts.platform || detectAppPlatform();
  const storeUrl = storeUrlForPlatform(platform);
  const isWeb = platform === "web";

  if (typeof opts.onCompatible === "function") {
    pendingOnCompatible = opts.onCompatible;
    onCompatibleConsumed = false;
  }

  if (gateRoot) {
    gateRoot.remove();
    gateRoot = null;
  }

  const root = document.createElement("div");
  root.className = "app-dialog app-dialog--in client-compat-gate";
  root.setAttribute("role", "alertdialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-labelledby", "client-compat-title");
  root.setAttribute("aria-describedby", "client-compat-msg");

  const storeBtn =
    !isWeb && storeUrl
      ? `<button type="button" class="btn btn-primary app-dialog__btn" data-compat-update>Mettre à jour</button>`
      : "";

  const webReload = isWeb
    ? `<button type="button" class="btn btn-primary app-dialog__btn" data-compat-reload>Recharger</button>`
    : "";

  const body =
    opts.message ||
    (isWeb
      ? "Cette version de test n'est plus compatible avec les soirées en ligne. Recharge une version à jour ou mets à jour le floor de test."
      : "Cette version de REVEAL n'est plus compatible avec les soirées en ligne. Mets l'application à jour pour continuer.");

  root.innerHTML = `
    <div class="app-dialog__backdrop" aria-hidden="true"></div>
    <div class="app-dialog__panel">
      <div class="app-dialog__glow" aria-hidden="true"></div>
      <p class="app-dialog__icon" aria-hidden="true">⬆️</p>
      <p class="app-dialog__title" id="client-compat-title">Mise à jour nécessaire</p>
      <p class="app-dialog__message" id="client-compat-msg">${body}</p>
      <p class="app-dialog__message client-compat-gate__feedback" id="client-compat-feedback" role="status"${
        opts.feedback ? "" : " hidden"
      }>${opts.feedback || ""}</p>
      <div class="client-compat-gate__actions" style="display:flex;flex-direction:column;gap:0.5rem;width:100%">
        ${storeBtn}
        ${webReload}
        <button type="button" class="btn btn-secondary app-dialog__btn" data-compat-retry>Réessayer</button>
      </div>
    </div>
  `;

  root.querySelector("[data-compat-update]")?.addEventListener("click", async () => {
    try {
      await openExternalUrl(storeUrl);
    } catch (e) {
      console.warn("[ARCH-23] store open failed", e?.message || e, {
        platform,
        reason: "store_open_failed",
      });
    }
  });

  root.querySelector("[data-compat-reload]")?.addEventListener("click", () => {
    if (typeof location !== "undefined") location.reload();
  });

  root.querySelector("[data-compat-retry]")?.addEventListener("click", async () => {
    if (retryInFlight) return;
    retryInFlight = true;
    setGateFeedback("");
    try {
      if (opts.onRetry) {
        await opts.onRetry();
        return;
      }
      const result = await checkClientCompatibility({
        source: "manual",
        force: true,
      });
      await applyForcedRecheckResult(result);
    } finally {
      retryInFlight = false;
    }
  });

  document.body.appendChild(root);
  gateRoot = root;
  return root;
}

/**
 * Applique le résultat d’un retry forcé (gate déjà visible).
 * @param {object} result
 */
export async function applyForcedRecheckResult(result) {
  if (result?.status === COMPAT_STATUS.COMPATIBLE) {
    hideClientCompatibilityGate();
    if (pendingOnCompatible && !onCompatibleConsumed) {
      onCompatibleConsumed = true;
      const fn = pendingOnCompatible;
      pendingOnCompatible = null;
      await fn();
    }
    return;
  }

  // Incompatible autoritaire (y compris recheck unknown) : garder le gate.
  if (result?.status === COMPAT_STATUS.INCOMPATIBLE) {
    if (result.lastRecheckStatus === COMPAT_STATUS.UNKNOWN) {
      setGateFeedback(RECHECK_UNKNOWN_MSG);
    } else {
      setGateFeedback("");
      setGateMessage(
        result.client?.platform === "web"
          ? "Cette version de test n'est plus compatible avec les soirées en ligne. Recharge une version à jour ou mets à jour le floor de test."
          : "Cette version de REVEAL n'est plus compatible avec les soirées en ligne. Mets l'application à jour pour continuer."
      );
    }
    return;
  }

  // Unknown pur sans autorité incompatible (ne devrait pas masquer un gate).
  setGateFeedback(RECHECK_UNKNOWN_MSG);
}

export function hideClientCompatibilityGate() {
  if (!gateRoot) return;
  gateRoot.remove();
  gateRoot = null;
}

/**
 * Affiche le hard gate si incompatible ; retourne true si bloqué.
 * @param {{ status?: string, client?: { platform?: string }, lastRecheckStatus?: string }} result
 * @param {{ onCompatible?: () => void|Promise<void> }} [opts]
 */
export function presentCompatibilityGateIfNeeded(result, opts = {}) {
  if (result?.status !== COMPAT_STATUS.INCOMPATIBLE) return false;
  const feedback =
    result.lastRecheckStatus === COMPAT_STATUS.UNKNOWN
      ? RECHECK_UNKNOWN_MSG
      : undefined;
  showClientCompatibilityGate({
    platform: result.client?.platform,
    onCompatible: opts.onCompatible,
    feedback,
  });
  return true;
}
