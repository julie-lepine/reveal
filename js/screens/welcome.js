import { markWelcomeSeen } from "../core/welcomeGate.js";
import { navigate } from "../core/router.js";
import { escapeHtml, logoHtml, pageShell } from "../core/ui.js";

const STEPS = [
  { variant: "pink", icon: "✨", label: "Étape 1", title: "Connecte-toi" },
  { variant: "indigo", icon: "🎯", label: "Étape 2", title: "Crée ou rejoins un lobby" },
  {
    variant: "sky",
    icon: "🎮",
    label: "Étape 3",
    title: "Invite tes amis et affrontez-vous dans une soirée de mini-jeux",
  },
];

const LOGO_RULE_SVG = `
  <svg class="welcome__logo-rule" viewBox="0 0 200 14" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id="welcome-logo-rule-grad" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="#ff3cac"/>
        <stop offset="45%" stop-color="#ff6b6b"/>
        <stop offset="70%" stop-color="#818cf8"/>
        <stop offset="100%" stop-color="#38bdf8"/>
      </linearGradient>
    </defs>
    <path d="M 10 10 Q 100 3 190 10" stroke="url(#welcome-logo-rule-grad)" stroke-width="2.5" fill="none" stroke-linecap="round"/>
    <circle cx="10" cy="10" r="3.5" fill="#ff3cac"/>
    <circle cx="190" cy="10" r="3.5" fill="#38bdf8"/>
  </svg>`;

function renderStepsHtml() {
  return STEPS.map((step, index) => {
    const pill = `
      <div class="step-pill step-${step.variant}" role="listitem">
        <div class="step-icon" aria-hidden="true">${step.icon}</div>
        <div class="step-content">
          <span class="step-label">${escapeHtml(step.label)}</span>
          <span class="step-title">${escapeHtml(step.title)}</span>
        </div>
        <div class="step-dot" aria-hidden="true"></div>
      </div>`;
    const connector =
      index < STEPS.length - 1 ? '<div class="step-connector" aria-hidden="true"></div>' : "";
    return pill + connector;
  }).join("");
}

export function mountWelcome(app) {
  app.innerHTML = pageShell({
    back: false,
    scroll: true,
    content: `
      <div class="welcome">
        <div class="welcome__hero-area">
          <div class="welcome__hero logo logo--with-img logo--landing">
            ${logoHtml({ className: "app-logo app-logo--landing welcome__logo" })}
            ${LOGO_RULE_SVG}
            <p class="subtitle welcome__baseline">L'app de soirée entre amis</p>
          </div>
        </div>

        <div class="welcome__steps" role="list" aria-label="Comment ça marche">
          ${renderStepsHtml()}
        </div>

        <div class="welcome__footer">
          <div class="welcome__cta-wrap">
            <button type="button" class="cta-btn" id="btn-welcome-auth">
              Connexion / Inscription
            </button>
          </div>
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
