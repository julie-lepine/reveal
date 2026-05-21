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
  returnToEveningGames,
  confirmAndLeaveLobby,
  reconcileLobbyMembership,
  resetAppToCleanHome,
} from "../core/lobby.js";
import { getEveningRecap } from "../core/eveningRecap.js";
import {
  isGameSyncActive,
  onGameSessionChange,
  routeToActiveGameIfNeeded,
  isSessionRouteSuppressed,
} from "../core/gameSync.js";
import { navigate, getCurrentScreen } from "../core/router.js";
import { escapeHtml, logoHtml, pageShell } from "../core/ui.js";
import { handleNavTarget, goToEveningSettings } from "./nav.js";
import { showAppAlert, showAppConfirm } from "../core/dialog.js";

function guestJoinPanelHtml({ leaveHint = false } = {}) {
  return `
    <div class="card auth-form auth-form--guest auth-form--guest-rejoin">
      ${
        leaveHint
          ? `<p class="hint auth-form__guest-intro auth-form__guest-intro--warn">Tu es encore lié à un lobby (${escapeHtml(getLobby()?.code || "?")}). Utilise « Quitter le lobby » ou rejoins avec le code ci-dessous.</p>`
          : `<p class="hint auth-form__guest-intro">Entre le code de la partie et ton pseudo pour rejoindre le lobby.</p>`
      }
      <label class="field-label" for="guest-rejoin-name">Ton pseudo</label>
      <input type="text" class="field-input" id="guest-rejoin-name" placeholder="Ex : Alex" maxlength="24" value="${escapeHtml(getUser()?.name || "")}" />
      <label class="field-label" for="guest-rejoin-code">Code d'invitation</label>
      <input type="text" class="field-input" id="guest-rejoin-code" placeholder="6 caractères" maxlength="8" autocapitalize="characters" />
      <p class="auth-error hidden" id="guest-rejoin-error"></p>
      <button type="button" class="btn btn-primary btn--spaced" id="btn-guest-rejoin">Rejoindre la partie →</button>
    </div>`;
}

function homeStatsHtml() {
  if (!hasActiveLobby()) return "";

  const recap = getEveningRecap();
  const liesDisplay =
    recap.liesTotal > 0 ? `${recap.liesFound}/${recap.liesTotal}` : String(recap.liesFound);

  return `
        <p class="label-upper label-upper--muted">Stats de la soirée</p>
        <div class="stats stats--global">
          <div class="stat stat--banner"><div>👥</div><div class="stat-number">${recap.participantCount}</div><div class="stat-label">Joueurs</div></div>
          <div class="stat"><div>🔥</div><div class="stat-number">${recap.hotTakes}</div><div class="stat-label">Hot takes</div></div>
          <div class="stat"><div>⚡</div><div class="stat-number">${recap.speedVotes}</div><div class="stat-label">SpeedVotes</div></div>
          <div class="stat"><div>📏</div><div class="stat-number">${recap.truthMeters}</div><div class="stat-label">TruthMeter</div></div>
          <div class="stat"><div>⚖️</div><div class="stat-number">${recap.dilemmas}</div><div class="stat-label">Dilemma</div></div>
          <div class="stat"><div>🕵️</div><div class="stat-number">${liesDisplay}</div><div class="stat-label">Mensonges trouvés</div></div>
          <div class="stat"><div>🏆</div><div class="stat-number">${recap.tierNights}</div><div class="stat-label">Tier lists</div></div>
        </div>`;
}

function homeRenderSnapshot(authTab) {
  const user = getUser();
  return JSON.stringify({
    tab: authTab,
    loggedIn: isLoggedIn(),
    guest: isGuest(),
    name: user?.name,
    inLobby: hasActiveLobby(),
    lobbyCode: getLobby()?.code,
    recap: hasActiveLobby() ? getEveningRecap().participantCount : 0,
  });
}

/** Retire une modale bloquante restée dans le DOM. */
function clearStuckDialogs() {
  document.querySelectorAll(".app-dialog").forEach((el) => el.remove());
}

export function mountHome(app) {
  const pendingJoin = sessionStorage.getItem("reveal-pending-join");
  const tabAfterLeave = sessionStorage.getItem("reveal-auth-tab");
  let authTab = tabAfterLeave || (pendingJoin ? "guest" : "login");
  if (tabAfterLeave) sessionStorage.removeItem("reveal-auth-tab");

  let unsubSession = () => {};
  let renderTimer = null;
  let renderInFlight = false;
  let lastSnapshot = "";

  const navHandlers = {
    settings: () => goToEveningSettings(),
  };

  function readGuestJoinFields() {
    const nameEl =
      app.querySelector("#guest-rejoin-name") || app.querySelector("#guest-name");
    const codeEl =
      app.querySelector("#guest-rejoin-code") || app.querySelector("#guest-code");
    const errEl =
      app.querySelector("#guest-rejoin-error") || app.querySelector("#guest-error");
    return { nameEl, codeEl, errEl };
  }

  function preserveInputDrafts() {
    const drafts = {};
    app.querySelectorAll("input.field-input, input.join-input").forEach((el) => {
      if (el.id) drafts[el.id] = el.value;
    });
    const focusedId = document.activeElement?.id;
    return { drafts, focusedId };
  }

  function restoreInputDrafts({ drafts, focusedId }) {
    Object.entries(drafts).forEach(([id, value]) => {
      const el = app.querySelector(`[id="${id}"]`);
      if (el && value != null) el.value = value;
    });
    if (focusedId) {
      const el = app.querySelector(`[id="${focusedId}"]`);
      if (el) {
        el.focus();
        const len = el.value.length;
        if (el.setSelectionRange) el.setSelectionRange(len, len);
      }
    }
  }

  function scheduleRender(force = false) {
    if (renderTimer) clearTimeout(renderTimer);
    renderTimer = setTimeout(() => {
      renderTimer = null;
      void renderIfNeeded(force);
    }, force ? 0 : 300);
  }

  async function renderIfNeeded(force = false) {
    const snap = homeRenderSnapshot(authTab);
    const { drafts, focusedId } = preserveInputDrafts();
    const typing = focusedId && drafts[focusedId] !== undefined;

    if (!force && typing) return;
    if (!force && snap === lastSnapshot) return;

    if (renderInFlight) {
      scheduleRender(false);
      return;
    }

    renderInFlight = true;
    try {
      paint();
      lastSnapshot = snap;
      restoreInputDrafts({ drafts, focusedId });
      if (pendingJoin && !sessionStorage.getItem("reveal-pending-join")) {
        const { codeEl } = readGuestJoinFields();
        if (codeEl) codeEl.value = pendingJoin;
      }
    } finally {
      renderInFlight = false;
    }
  }

  function paint() {
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
          </div>
          ${guestJoinPanelHtml({ leaveHint: hasActiveLobby() })}`
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
              ? `<button type="button" class="btn btn-accent btn--lobby-return" id="btn-return-lobby">
            Retour aux jeux <span class="muted">(${escapeHtml(getLobby().code)})</span>
          </button>
          <button type="button" class="btn btn-secondary btn--leave-lobby" id="btn-leave-lobby">Quitter le lobby</button>`
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

        ${homeStatsHtml()}

        <p class="home-reset-wrap">
          <button type="button" class="btn-link home-reset-link" id="btn-reset-app">Problème d'affichage ? Réinitialiser l'app</button>
        </p>
      `,
    });
  }

  async function onHomeClick(e) {
    if (getCurrentScreen() !== "home") return;

    const navEl = e.target.closest("[data-nav]");
    if (navEl) {
      void handleNavTarget(navEl.getAttribute("data-nav"), navHandlers);
      return;
    }

    const tabBtn = e.target.closest("[data-tab]");
    if (tabBtn) {
      authTab = tabBtn.getAttribute("data-tab");
      scheduleRender(true);
      return;
    }

    const socialBtn = e.target.closest("[data-social]");
    if (socialBtn) {
      const err = app.querySelector("#login-error") || app.querySelector("#signup-error");
      socialBtn.disabled = true;
      const res = await loginWithSocial(socialBtn.getAttribute("data-social"));
      socialBtn.disabled = false;
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
      scheduleRender(true);
      return;
    }

    if (e.target.closest("#btn-login")) {
      const err = app.querySelector("#login-error");
      const btn = e.target.closest("#btn-login");
      btn.disabled = true;
      const res = await loginWithEmail(
        app.querySelector("#login-email")?.value,
        app.querySelector("#login-password")?.value
      );
      btn.disabled = false;
      if (!res.ok) {
        err.textContent = res.error;
        err.classList.remove("hidden");
        return;
      }
      err?.classList.add("hidden");
      scheduleRender(true);
      return;
    }

    if (e.target.closest("#btn-signup")) {
      const err = app.querySelector("#signup-error");
      const btn = e.target.closest("#btn-signup");
      btn.disabled = true;
      const res = await signupWithEmail(
        app.querySelector("#signup-email")?.value,
        app.querySelector("#signup-password")?.value,
        app.querySelector("#signup-name")?.value
      );
      btn.disabled = false;
      if (!res.ok) {
        err.textContent = res.error;
        err.classList.remove("hidden");
        return;
      }
      err?.classList.add("hidden");
      scheduleRender(true);
      return;
    }

    if (e.target.closest("#btn-logout")) {
      await logout();
      scheduleRender(true);
      return;
    }

    if (e.target.closest("#btn-return-lobby")) {
      void returnToEveningGames();
      return;
    }

    if (e.target.closest("#btn-leave-lobby")) {
      const btn = e.target.closest("#btn-leave-lobby");
      btn.disabled = true;
      const res = await confirmAndLeaveLobby();
      btn.disabled = false;
      if (res.cancelled) return;
      if (!res.ok) {
        await showAppAlert(res.error || "Impossible de quitter le lobby.", {
          title: "Quitter le lobby",
          icon: "⚠️",
        });
        return;
      }
      scheduleRender(true);
      return;
    }

    if (e.target.closest("#btn-create-lobby")) {
      if (!canCreateLobby()) return;
      const btn = e.target.closest("#btn-create-lobby");
      btn.disabled = true;
      try {
        await createLobby();
        navigate("lobby");
      } catch (err) {
        await showAppAlert(err.message || "Impossible de créer le lobby.", {
          title: "Erreur",
          icon: "⚠️",
        });
      } finally {
        btn.disabled = false;
      }
      return;
    }

    if (e.target.closest("#btn-join-lobby")) {
      if (!isLoggedIn()) return;
      const btn = e.target.closest("#btn-join-lobby");
      btn.disabled = true;
      const res = await joinLobby(app.querySelector("#join-code")?.value);
      btn.disabled = false;
      if (!res.ok) {
        await showAppAlert(res.error, { title: "Rejoindre le lobby", icon: "⚠️" });
        return;
      }
      navigate("lobby");
      return;
    }

    if (e.target.closest("#btn-guest-join") || e.target.closest("#btn-guest-rejoin")) {
      const { nameEl, codeEl, errEl } = readGuestJoinFields();
      const btn = e.target.closest("#btn-guest-join, #btn-guest-rejoin");
      btn.disabled = true;
      errEl?.classList.add("hidden");
      const res = await joinLobbyAsGuest(codeEl?.value, nameEl?.value);
      btn.disabled = false;
      if (!res.ok) {
        if (errEl) {
          errEl.textContent = res.error;
          errEl.classList.remove("hidden");
        } else {
          await showAppAlert(res.error, { title: "Rejoindre", icon: "⚠️" });
        }
        scheduleRender(true);
        return;
      }
      navigate("lobby");
      return;
    }

    if (e.target.closest("#btn-reset-app")) {
      const ok = await showAppConfirm(
        "Ta session et les données locales seront effacées. Tu pourras rejoindre une partie à nouveau.",
        {
          title: "Réinitialiser REVEAL",
          confirmLabel: "Réinitialiser",
          cancelLabel: "Annuler",
          icon: "🔄",
        }
      );
      if (!ok) return;
      await resetAppToCleanHome();
    }
  }

  clearStuckDialogs();
  app.addEventListener("click", onHomeClick);

  scheduleRender(true);

  void (async () => {
    const { cleared } = await reconcileLobbyMembership();
    if (cleared) scheduleRender(true);
  })();

  if (isGameSyncActive() && hasActiveLobby()) {
    unsubSession = onGameSessionChange(async () => {
      if (getCurrentScreen() !== "home") return;
      if (!isSessionRouteSuppressed()) {
        if (await routeToActiveGameIfNeeded()) return;
      }
      scheduleRender(false);
    });
  }

  if (pendingJoin) {
    sessionStorage.removeItem("reveal-pending-join");
    requestAnimationFrame(() => {
      const { codeEl } = readGuestJoinFields();
      if (codeEl) codeEl.value = pendingJoin;
    });
  }

  return () => {
    app.removeEventListener("click", onHomeClick);
    unsubSession();
    if (renderTimer) clearTimeout(renderTimer);
  };
}
