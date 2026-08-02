/**
 * ARCH-23 — identité du binaire installé (diagnostic + gate).
 */

import {
  APP_COMPATIBILITY_BUILD,
  APP_VERSION,
} from "../config/appCompatibility.js";
import { getNativePlatform, isNativeApp } from "./platform.js";

/** @typedef {"ios"|"android"|"web"} AppPlatform */

/**
 * @returns {AppPlatform}
 */
export function detectAppPlatform() {
  if (!isNativeApp()) return "web";
  const p = String(getNativePlatform() || "").toLowerCase();
  if (p === "ios") return "ios";
  if (p === "android") return "android";
  return "web";
}

/**
 * @param {{
 *   appVersion?: string,
 *   nativeBuild?: string|number|null,
 *   platform?: AppPlatform,
 *   compatibilityBuild?: number,
 * }} [overrides]
 */
export function buildInstalledClientIdentity(overrides = {}) {
  const platform = overrides.platform || detectAppPlatform();
  const appVersion = String(overrides.appVersion || APP_VERSION);
  const nativeBuild =
    overrides.nativeBuild != null && String(overrides.nativeBuild).trim() !== ""
      ? String(overrides.nativeBuild)
      : "unknown";
  const compatibilityBuild = Number.isInteger(overrides.compatibilityBuild)
    ? overrides.compatibilityBuild
    : APP_COMPATIBILITY_BUILD;

  return {
    appVersion,
    nativeBuildNumber: nativeBuild,
    buildId: `${appVersion}-${platform}-${nativeBuild}`,
    compatibilityBuild,
    platform,
  };
}

/**
 * Capacitor App.getInfo() quand disponible.
 * @returns {Promise<ReturnType<typeof buildInstalledClientIdentity>>}
 */
export async function getInstalledClientBuild() {
  let appVersion = APP_VERSION;
  let nativeBuild = null;

  if (isNativeApp()) {
    try {
      const { loadCapacitorApp } = await import("./capacitorImports.js");
      const mod = await loadCapacitorApp();
      const info = await mod?.App?.getInfo?.();
      if (info?.version) appVersion = String(info.version);
      if (info?.build != null) nativeBuild = String(info.build);
    } catch (e) {
      console.warn("REVEAL App.getInfo:", e?.message || e);
    }
  }

  return buildInstalledClientIdentity({
    appVersion,
    nativeBuild,
    platform: detectAppPlatform(),
  });
}
