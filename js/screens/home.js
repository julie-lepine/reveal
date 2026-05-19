import {
  isLoggedIn,
  isGuest,
  canPlay,
  canCreateLobby,
  loginWithEmail,
  loginWithSocial,
  signupWithEmail,
  getUser,
  logout,
} from "../core/auth.js";
import { isSupabaseConfigured } from "../core/supabaseClient.js";
import {
  createLobby,
  joinLobby,
  joinLobbyAsGuest,
  hasActiveLobby,
  getLobby,
  goToGameSelect,
} from "../core/lobby.js";
import { getGlobalStats } from "../core/state.js";
import { navigate } from "../core/router.js";
import { escapeHtml, logoHtml, pageShell } from "../core/ui.js";
import { bindNav, goToEveningSettings } from "./nav.js";
import { showAppAlert } from "../core/dialog.js";

export function mountHome(app) {
  const pendingJoin = sessionStorage.getItem("reveal-pending-join");
  let authTab = pendingJoin ? "guest" : "login";

  function render() {
    const global = getGlobalStats();
    const user = getUser();
    const loggedIn = isLoggedIn();
    const guest = isGuest();

    app.innerHTML = pageShell({
      back: false,
      content: `
        <div class="logo logo--with-img logo--landing">
          ${logoHtml({ className: "app-logo app-logo--landing" })}
          <p class="subtitle">L'app de soirée entre amis</p>
        </div>

        ${
          loggedIn
            ? `
          <div class="auth-welcome card">
            <p class="auth-welcome__hi">Salut, <strong>${escapeHtml(user.name)}</strong> 👋</p>
            <div class="auth-welcome__actions">
              <button type="button" class="btn btn-secondary btn--compact" data-nav="settings">Paramètres</button>
              <button type="button" class="btn-link" id="btn-logout">Se déconnecter</button>
            </div>
          </div>`
            : guest
              ? `
          <div class="auth-welcome card auth-welcome--guest">
            <p class="auth-welcome__hi">Invité : <strong>${escapeHtml(user.name)}</strong> 🎭</p>
            <div class="auth-welcome__actions">
              <button type="button" class="btn btn-secondary btn--compact" data-nav="settings">Paramètres</button>
              <button type="button" class="btn-link" id="btn-logout">Quitter la session</button>
            </div>
          </div>`
              : `
          <div class="auth-tabs">
            <button type="button" class="auth-tab ${authTab === "login" ? "auth-tab--active" : ""}" data-tab="login">Connexion</button>
            <button type="button" class="auth-tab ${authTab === "signup" ? "auth-tab--active" : ""}" data-tab="signup">Inscription</button>
            <button type="button" class="auth-tab auth-tab--guest ${authTab === "guest" ? "auth-tab--active" : ""}" data-tab="guest">Invité</button>
          </div>

          <div class="card auth-form ${authTab === "guest" ? "auth-form--guest" : ""}">
            <div id="auth-panel-login" class="${authTab === "login" ? "" : "hidden"}">
              <label class="field-label" for="login-email">Email</label>
              <input type="email" class="field-input" id="login-email" placeholder="toi@email.com" />
              <label class="field-label" for="login-password">Mot de passe</label>
              <input type="password" class="field-input" id="login-password" placeholder="••••••••" />
              <p class="auth-error hidden" id="login-error"></p>
              <button type="button" class="btn btn-primary btn--spaced" id="btn-login">Se connecter</button>
            </div>
            <div id="auth-panel-signup" class="${authTab === "signup" ? "" : "hidden"}">
              <label class="field-label" for="signup-name">Pseudo</label>
              <input type="text" class="field-input" id="signup-name" placeholder="Ton pseudo" />
              <label class="field-label" for="signup-email">Email</label>
              <input type="email" class="field-input" id="signup-email" placeholder="toi@email.com" />
              <label class="field-label" for="signup-password">Mot de passe</label>
              <input type="password" class="field-input" id="signup-password" placeholder="4 caractères min." />
              <p class="auth-error hidden" id="signup-error"></p>
              <button type="button" class="btn btn-primary btn--spaced" id="btn-signup">Créer mon compte</button>
            </div>
            <div id="auth-panel-guest" class="${authTab === "guest" ? "" : "hidden"}">
              <p class="hint auth-form__guest-intro">Rejoins avec un code, un lien d'invitation ou en scannant le QR de l'hôte. Pas de compte requis — les invités ne peuvent pas créer de lobby.</p>
              <label class="field-label" for="guest-name">Ton pseudo</label>
              <input type="text" class="field-input" id="guest-name" placeholder="Ex : Alex" maxlength="24" />
              <label class="field-label" for="guest-code">Code d'invitation</label>
              <input type="text" class="field-input" id="guest-code" placeholder="6 caractères" maxlength="8" autocapitalize="characters" />
              <p class="auth-error hidden" id="guest-error"></p>
              <button type="button" class="btn btn-primary btn--spaced" id="btn-guest-join">Rejoindre la partie →</button>
            </div>
          </div>

          ${authTab !== "guest" ? `
          <p class="auth-divider"><span>ou continuer avec</span></p>
          <div class="social-row">
            <button type="button" class="social-btn social-btn--facebook" data-social="facebook" title="Facebook">f</button>
            <button type="button" class="social-btn social-btn--instagram" data-social="instagram" title="Instagram">📷</button>
          </div>
          ${!isSupabaseConfigured() ? '<p class="hint auth-social-hint">Mode démo locale — configure Supabase pour la connexion réelle.</p>' : '<p class="hint auth-social-hint">Instagram passe par Meta (même compte que Facebook).</p>'}` : ""}`
        }

        <div class="lobby-actions">
          ${
            hasActiveLobby()
              ? `<button type="button" class="btn btn-primary btn--lobby-return" id="btn-return-lobby">
            Retour aux jeux <span class="muted">(${escapeHtml(getLobby().code)})</span>
          </button>`
              : ""
          }
          ${
            canCreateLobby()
              ? `<button type="button" class="btn btn-primary" id="btn-create-lobby">Créer un lobby</button>`
              : ""
          }
          ${
            loggedIn
              ? `
          <div class="join-row">
            <input type="text" class="field-input join-input" id="join-code" placeholder="Code d'invitation" maxlength="8" />
            <button type="button" class="btn btn-secondary join-btn" id="btn-join-lobby">Rejoindre</button>
          </div>`
              : ""
          }
          ${!loggedIn && !guest ? '<p class="hint">Seuls les comptes connectés peuvent créer un lobby.</p>' : ""}
        </div>

        <p class="label-upper label-upper--muted">Stats globales (tous les lobbys)</p>
        <div class="stats stats--global">
          <div class="stat"><div>🎉</div><div class="stat-number">${global.lobbiesCreated || 0}</div><div class="stat-label">Lobbys créés</div></div>
          <div class="stat"><div>🔥</div><div class="stat-number">${global.hotTakesPlayed || 0}</div><div class="stat-label">Hot takes</div></div>
          <div class="stat"><div>🕵️</div><div class="stat-number">${global.liesFound || 0}</div><div class="stat-label">Mensonges trouvés</div></div>
          <div class="stat"><div>👥</div><div class="stat-number">${global.playersJoined || 0}</div><div class="stat-label">Joueurs accueillis</div></div>
        </div>
      `,
    });

    bindEvents();
  }

  function bindEvents() {
    bindNav(app, {
      settings: () => goToEveningSettings(),
    });

    app.querySelectorAll("[data-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        authTab = btn.getAttribute("data-tab");
        render();
      });
    });

    app.querySelector("#btn-login")?.addEventListener("click", async () => {
      const err = app.querySelector("#login-error");
      const btn = app.querySelector("#btn-login");
      btn.disabled = true;
      const res = await loginWithEmail(
        app.querySelector("#login-email").value,
        app.querySelector("#login-password").value
      );
      btn.disabled = false;
      if (!res.ok) {
        err.textContent = res.error;
        err.classList.remove("hidden");
        return;
      }
      err.classList.add("hidden");
      render();
    });

    app.querySelector("#btn-signup")?.addEventListener("click", async () => {
      const err = app.querySelector("#signup-error");
      const btn = app.querySelector("#btn-signup");
      btn.disabled = true;
      const res = await signupWithEmail(
        app.querySelector("#signup-email").value,
        app.querySelector("#signup-password").value,
        app.querySelector("#signup-name").value
      );
      btn.disabled = false;
      if (!res.ok) {
        err.textContent = res.error;
        err.classList.remove("hidden");
        return;
      }
      err.classList.add("hidden");
      render();
    });

    app.querySelectorAll("[data-social]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const err = app.querySelector("#login-error") || app.querySelector("#signup-error");
        btn.disabled = true;
        const res = await loginWithSocial(btn.getAttribute("data-social"));
        btn.disabled = false;
        if (!res.ok) {
          if (err) {
            err.textContent = res.error;
            err.classList.remove("hidden");
          } else {
            await showAppAlert(res.error, { title: "Connexion", icon: "⚠️" });
          }
          return;
        }
        if (res.redirecting) return;
        render();
      });
    });

    app.querySelector("#btn-logout")?.addEventListener("click", async () => {
      await logout();
      render();
    });

    app.querySelector("#btn-return-lobby")?.addEventListener("click", () => {
      goToGameSelect();
    });

    app.querySelector("#btn-create-lobby")?.addEventListener("click", async () => {
      if (!canCreateLobby()) return;
      const btn = app.querySelector("#btn-create-lobby");
      btn.disabled = true;
      try {
        await createLobby();
        navigate("lobby");
      } catch (e) {
        await showAppAlert(e.message || "Impossible de créer le lobby.", {
          title: "Erreur",
          icon: "⚠️",
        });
      } finally {
        btn.disabled = false;
      }
    });

    app.querySelector("#btn-join-lobby")?.addEventListener("click", async () => {
      if (!isLoggedIn()) return;
      const btn = app.querySelector("#btn-join-lobby");
      btn.disabled = true;
      const res = await joinLobby(app.querySelector("#join-code").value);
      btn.disabled = false;
      if (!res.ok) {
        await showAppAlert(res.error, { title: "Rejoindre le lobby", icon: "⚠️" });
        return;
      }
      navigate("lobby");
    });

    app.querySelector("#btn-guest-join")?.addEventListener("click", async () => {
      const err = app.querySelector("#guest-error");
      const btn = app.querySelector("#btn-guest-join");
      btn.disabled = true;
      const res = await joinLobbyAsGuest(
        app.querySelector("#guest-code").value,
        app.querySelector("#guest-name").value
      );
      btn.disabled = false;
      if (!res.ok) {
        err.textContent = res.error;
        err.classList.remove("hidden");
        return;
      }
      err.classList.add("hidden");
      navigate("lobby");
    });
  }

  render();

  if (pendingJoin) {
    const codeEl = app.querySelector("#guest-code");
    if (codeEl) codeEl.value = pendingJoin;
    sessionStorage.removeItem("reveal-pending-join");
  }

  return null;
}

