/**
 * ARCH-23 - revalidation au retour foreground (Capacitor + visibility web).
 */

import {
  CLIENT_COMPAT_FOREGROUND_MIN_HIDDEN_MS,
} from "../config/appCompatibility.js";
import { isNativeApp } from "./platform.js";
import {
  checkClientCompatibility,
  getClientCompatHiddenAt,
  markClientCompatAppHidden,
} from "./clientCompatibility.js";
import { COMPAT_STATUS } from "./clientCompatibilityContract.js";
import {
  hideClientCompatibilityGate,
  presentCompatibilityGateIfNeeded,
} from "./clientCompatibilityGateUi.js";

let foregroundInit = false;

async function onBecameActive() {
  const hiddenAt = getClientCompatHiddenAt();
  const age = hiddenAt ? Date.now() - hiddenAt : 0;
  if (hiddenAt && age < CLIENT_COMPAT_FOREGROUND_MIN_HIDDEN_MS) {
    return;
  }
  const result = await checkClientCompatibility({
    source: "foreground",
    force: true,
  });
  if (result.status === COMPAT_STATUS.COMPATIBLE) {
    // Lève le gate sans relancer boot / reconcile / Realtime.
    hideClientCompatibilityGate();
    return;
  }
  presentCompatibilityGateIfNeeded(result);
  // Compromis Vague 1 : si incompatible pendant une partie, overlay bloquant ;
  // on ne force pas leaveLobby / teardown - mais create/join/resume et UI gate
  // empêchent nouveaux writes d’entrée. Writes in-game existants : risque résiduel documenté.
  if (result.status === COMPAT_STATUS.INCOMPATIBLE) {
    console.info("[ARCH-23]", {
      status: result.status,
      lastRecheckStatus: result.lastRecheckStatus ?? null,
      source: "foreground",
      foregroundAgeMs: age,
      reason: "hard_gate_overlay_active_session_preserved",
    });
  }
}

/**
 * Une seule initialisation - Cap appStateChange + visibilitychange.
 */
export function initClientCompatibilityForeground() {
  if (foregroundInit || typeof document === "undefined") return;
  foregroundInit = true;

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      markClientCompatAppHidden();
      return;
    }
    void onBecameActive();
  });

  if (!isNativeApp()) return;

  void (async () => {
    try {
      const { loadCapacitorApp } = await import("./capacitorImports.js");
      const mod = await loadCapacitorApp();
      const App = mod?.App;
      if (!App?.addListener) return;
      App.addListener("appStateChange", ({ isActive }) => {
        if (!isActive) {
          markClientCompatAppHidden();
          return;
        }
        void onBecameActive();
      });
    } catch (e) {
      console.warn("[ARCH-23] foreground listener:", e?.message || e);
    }
  })();
}

export function __resetCompatForegroundForTests() {
  foregroundInit = false;
}
