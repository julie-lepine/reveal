import { markWelcomeSeen } from "../core/welcomeGate.js";
import { navigate } from "../core/router.js";
import { escapeHtml, logoHtml, pageShell } from "../core/ui.js";

const FEATURES = [
  { icon: "🎉", text: "Crée un lobby et invite tes amis (code ou QR)." },
  { icon: "🎮", text: "Jeux de soirée synchronisés entre tous les joueurs." },
  { icon: "👤", text: "Compte hôte ou invité sans inscription pour rejoindre." },
];

export function mountWelcome(app) {
  app.innerHTML = pageShell({
    back: false,
    scroll: true,
    content: `
      <div class="welcome">
        <div class="logo logo--with-img logo--landing welcome__hero">
          ${logoHtml({ className: "app-logo app-logo--landing" })}
          <p class="subtitle">L'app de soirée entre amis</p>
        </div>

        <ul class="welcome__features" aria-label="Fonctionnalités">
          ${FEATURES.map(
            (item) => `
            <li class="welcome__feature">
              <span class="welcome__feature-icon" aria-hidden="true">${item.icon}</span>
              <span class="welcome__feature-text">${escapeHtml(item.text)}</span>
            </li>`
          ).join("")}
        </ul>

        <div class="welcome__actions">
          <button type="button" class="btn btn-primary btn--spaced" id="btn-welcome-auth">
            Connexion / Inscription
          </button>
          <button type="button" class="btn-link welcome__privacy" id="btn-welcome-privacy">
            Confidentialité
          </button>
        </div>
      </div>
    `,
  });

  app.querySelector("#btn-welcome-auth")?.addEventListener("click", () => {
    markWelcomeSeen();
    navigate("home", {
      navStack: ["welcome", "home"],
      params: { authTab: "login" },
    });
  });

  app.querySelector("#btn-welcome-privacy")?.addEventListener("click", () => {
    navigate("privacy", { navStack: ["welcome", "privacy"] });
  });

  return null;
}
