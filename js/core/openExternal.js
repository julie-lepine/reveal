import { isNativeApp } from "./platform.js";
import { loadCapacitorBrowser } from "./capacitorImports.js";

/** Ouvre une URL dans le navigateur / app système (WebView Capacitor incluse). */
export async function openExternalUrl(url) {
  if (!url || typeof window === "undefined") return;

  if (isNativeApp()) {
    try {
      const mod = await loadCapacitorBrowser();
      if (mod?.Browser?.open) {
        await mod.Browser.open({ url });
        return;
      }
    } catch (e) {
      console.warn("REVEAL openExternal (Browser):", e?.message || e);
    }
  }

  const popup = window.open(url, "_blank", "noopener,noreferrer");
  if (popup) return;

  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

/** Deep link natif vers la fiche store (ouvre directement l'app Store / Play). */
function nativeStoreDeepLink(httpsUrl, platform) {
  try {
    const u = new URL(httpsUrl);
    if (platform === "ios" && u.hostname === "apps.apple.com") {
      return `itms-apps://${u.host}${u.pathname}`;
    }
    if (platform === "android") {
      const id = u.searchParams.get("id");
      if (id) return `market://details?id=${encodeURIComponent(id)}`;
    }
  } catch {
    /* URL invalide : pas de deep link */
  }
  return "";
}

/**
 * Ouvre la fiche store : deep link natif d'abord, repli sur l'URL https
 * (navigateur) si l'app est toujours au premier plan après ~1,5 s.
 */
export async function openStorePage(httpsUrl, platform) {
  if (!httpsUrl || typeof window === "undefined") return;
  const deep = isNativeApp() ? nativeStoreDeepLink(httpsUrl, platform) : "";
  if (!deep) {
    await openExternalUrl(httpsUrl);
    return;
  }
  try {
    window.location.href = deep;
  } catch (e) {
    console.warn("REVEAL openStorePage (deep link):", e?.message || e);
    await openExternalUrl(httpsUrl);
    return;
  }
  setTimeout(() => {
    if (typeof document !== "undefined" && document.visibilityState === "visible") {
      void openExternalUrl(httpsUrl);
    }
  }, 1500);
}
