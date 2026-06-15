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
