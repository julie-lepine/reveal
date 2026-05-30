import { isNativeApp } from "./platform.js";
import { loadCapacitorApp } from "./capacitorImports.js";
import { handleAuthRedirectUrl } from "./supabaseAuth.js";
import { navigate } from "./router.js";

let bound = false;

async function routeAfterAuthRedirect(result) {
  if (!result?.handled) return;
  if (result.recovery) {
    navigate("reset-password", { reset: true });
    return;
  }
  navigate("home", { reset: true });
}

async function onDeepLink(url) {
  if (!url) return;
  const result = await handleAuthRedirectUrl(url);
  await routeAfterAuthRedirect(result);
}

export async function initDeepLinks() {
  if (!isNativeApp() || bound) return;
  bound = true;

  try {
    const mod = await loadCapacitorApp();
    if (!mod?.App) return;

    const { App } = mod;

    App.addListener("appUrlOpen", (event) => {
      void onDeepLink(event?.url);
    });

    const launch = await App.getLaunchUrl();
    if (launch?.url) {
      await onDeepLink(launch.url);
    }
  } catch (err) {
    console.warn("Deep links:", err);
  }
}
