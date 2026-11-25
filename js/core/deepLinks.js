import { isNativeApp } from "./platform.js";
import { loadCapacitorApp } from "./capacitorImports.js";
import { handleAuthRedirectUrl } from "./supabaseAuth.js";
import { navigate } from "./router.js";

let bound = false;

export const EXPIRED_AUTH_LINK_MESSAGE =
  "Ce lien n'est plus valable. Redemande un e-mail depuis l'appli si besoin.";

/**
 * Audit liens n°2 : on ne quitte l'écran courant (partie comprise) que si le
 * lien a vraiment ouvert une session. Lien périmé ou refusé : on reste sur place.
 * @param {{ handled?: boolean, recovery?: boolean, sessionApplied?: boolean, linkError?: boolean }} result
 * @param {{ navigateTo?: typeof navigate, alert?: (msg: string) => unknown }} [deps]
 */
export function routeAfterAuthRedirect(result, deps = {}) {
  const go = deps.navigateTo || navigate;
  if (!result?.handled) return "ignored";
  if (result.sessionApplied) {
    if (result.recovery) {
      go("reset-password", { reset: true });
      return "reset-password";
    }
    go("home", { reset: true });
    return "home";
  }
  // Pas d'attente : au démarrage, le lien est traité avant l'affichage de l'appli.
  const alert =
    deps.alert ||
    ((msg) =>
      import("./dialog.js")
        .then(({ showAppAlert }) => showAppAlert(msg, { title: "Lien expiré", icon: "🔗" }))
        .catch(() => {}));
  void alert(EXPIRED_AUTH_LINK_MESSAGE);
  return "stay";
}

async function onDeepLink(url) {
  if (!url) return;
  const { handleNativeCaptchaUrl } = await import("./turnstile.js");
  if (handleNativeCaptchaUrl(url)) return;
  const result = await handleAuthRedirectUrl(url);
  routeAfterAuthRedirect(result);
}

export async function initDeepLinks() {
  if (!isNativeApp() || bound) return;
  bound = true;

  try {
    const mod = await Promise.race([
      loadCapacitorApp(),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error("deeplink_timeout")), 3000);
      }),
    ]);
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
