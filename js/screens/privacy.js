import { PRIVACY_POLICY } from "../../data/legalContent.js";
import { PRIVACY_POLICY_PUBLIC_URL } from "../../data/appConfig.js";
import { getScreenParams } from "../core/router.js";
import { escapeHtml, pageShell } from "../core/ui.js";
import { bindNav } from "./nav.js";

function privacyBodyHtml() {
  return PRIVACY_POLICY.sections
    .map(
      (s) => `
    <section class="privacy-section">
      <h3 class="privacy-section__title">${escapeHtml(s.heading)}</h3>
      <p class="privacy-section__body">${escapeHtml(s.body)}</p>
    </section>`
    )
    .join("");
}

export function mountPrivacy(app) {
  const backTarget = getScreenParams()?.backTarget === "welcome" ? "back" : "settings";
  app.innerHTML = pageShell({
    backTarget,
    scroll: true,
    content: `
      <p class="label-upper label-upper--muted">Légal</p>
      <h1 class="page-title">${escapeHtml(PRIVACY_POLICY.title)}</h1>
      <p class="hint">Dernière mise à jour : ${escapeHtml(PRIVACY_POLICY.updated)}</p>
      <div class="card privacy-card">
        ${privacyBodyHtml()}
      </div>
      <p class="hint privacy-external">
        URL publique (stores) :
        <a href="${escapeHtml(PRIVACY_POLICY_PUBLIC_URL)}" target="_blank" rel="noopener noreferrer">${escapeHtml(PRIVACY_POLICY_PUBLIC_URL)}</a>
      </p>
    `,
  });

  bindNav(app);
  return null;
}
