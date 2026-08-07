/**
 * ARCH-01A — état terminal : configuration Supabase absente/invalide.
 * Pas de login, pas de lobby, pas de « démo locale », pas de confusion réseau.
 */

import {
  BACKEND_MISSING_MESSAGE,
  BACKEND_MISSING_TITLE,
} from "../core/backendConfigGate.js";
import { pageShell, escapeHtml } from "../core/ui.js";

export function mountBackendMissing(app) {
  app.innerHTML = pageShell({
    back: false,
    orb: true,
    content: `
      <p class="label-upper label-upper--gold">REVEAL</p>
      <h2 class="screen-title">${escapeHtml(BACKEND_MISSING_TITLE)}</h2>
      <div class="card">
        <p class="app-dialog__message">${escapeHtml(BACKEND_MISSING_MESSAGE)}</p>
        <p class="hint">Une fois la configuration corrigée, recharge l’application.</p>
      </div>
    `,
  });

  return () => {};
}
