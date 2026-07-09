import {
  isLoggedIn,
  isGuest,
  canPlay,
  canCreateLobby,
  loginWithEmail,
  // loginWithSocial, /* réactiver avec connexion Facebook / Instagram */
  signupWithEmail,
  requestPasswordReset,
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
  isLobbyEveningStarted,
  returnToEveningGames,
  navigateAfterLobbyJoin,
  confirmAndLeaveLobby,
  reconcileLobbyMembership,
  resetAppToCleanHome,
  tryRecoverLobbyFromServer,
  peekServerLobbyForUser,
  getRememberedLobbyCode,
  resumeEveningSession,
  isGuestRecoveryCaptchaPending,
} from "../core/lobby.js";
import { getLiveSupabaseUserId } from "../core/supabaseAuth.js";
import { getEveningRecap } from "../core/eveningRecap.js";
import {
  isGameSyncActive,
  onGameSessionChange,
  routeToActiveGameIfNeeded,
  isSessionRouteSuppressed,
  tryFollowHostGameSession,
} from "../core/gameSync.js";
import { navigate, getCurrentScreen, getScreenParams } from "../core/router.js";
import { escapeHtml, logoHtml, pageShell } from "../core/ui.js";
import { handleNavTarget, goToEveningSettings } from "./nav.js";
import { showAppAlert, showAppConfirm, showAppEmailPrompt } from "../core/dialog.js";
import {
  getPasswordResetCooldownRemainingMs,
  passwordResetCooldownMessage,
} from "../core/passwordResetCooldown.js";
import {
  isTurnstileRequired,
  mountTurnstile,
  removeTurnstile,
  removeAllTurnstile,
  getTurnstileToken,
  isTurnstileSolved,
  resetTurnstile,
  isTurnstileMounted,
  setTurnstileOnChange,
} from "../core/turnstile.js";

function syncForgotPasswordButton(root) {
  const btn = root.querySelector("#btn-forgot-password");
  if (!btn) return;
  const rem = getPasswordResetCooldownRemainingMs();
  if (rem > 0) {
    const sec = Math.ceil(rem / 1000);
    btn.disabled = true;
    btn.setAttribute("aria-disabled", "true");
    btn.textContent =
      sec >= 120
        ? `Réessaie dans ${Math.ceil(sec / 60)} min`
        : `Réessaie dans ${sec} s`;
    btn.classList.add("auth-forgot--cooldown");
    return;
  }
  btn.disabled = false;
  btn.removeAttribute("aria-disabled");
  btn.textContent = "Mot de passe oublié ?";
  btn.classList.remove("auth-forgot--cooldown");
}

async function runPasswordResetEmailFlow(defaultEmail = "", { title, message, icon } = {}) {
  const cooldownRem = getPasswordResetCooldownRemainingMs();
  if (cooldownRem > 0) {
    await showAppAlert(passwordResetCooldownMessage(cooldownRem), {
      title: "Réinitialisation",
      icon: "⏳",
    });
    return { ok: false, cancelled: false, cooldown: true };
  }

  const prompt = await showAppEmailPrompt(
    message ||
      "Entre ton email pour recevoir un lien de réinitialisation de mot de passe.",
    {
      title: title || "Mot de passe oublié",
      defaultValue: defaultEmail,
      icon: icon || "🔐",
      confirmLabel: "Valider",
      cancelLabel: "Annuler",
    }
  );
  if (!prompt.ok) return { ok: false, cancelled: true };

  const res = await requestPasswordReset(prompt.value, prompt.captchaToken ?? null);
  if (!res.ok) {
    await showAppAlert(res.error, {
      title: "Réinitialisation",
      icon: res.rateLimited ? "⏳" : "⚠️",
    });
    return {
      ok: false,
      cancelled: false,
      error: res.error,
      cooldown: Boolean(res.cooldown || res.rateLimited),
      rateLimited: Boolean(res.rateLimited),
      captcha: Boolean(res.captcha),
    };
  }

  await showAppAlert("C’est envoyé. Vérifie tes emails (pense aux spams).", {
    title: "Email envoyé",
    icon: "📧",
  });
  return { ok: true, cancelled: false, cooldownStarted: true };
}

function guestRejoinDefaultCode() {
  return getLobby()?.code || getRememberedLobbyCode() || "";
}

function guestJoinErrorHtml(id, message) {
  return `<p class="auth-error${message ? "" : " hidden"}" id="${id}" role="alert">${escapeHtml(message || "")}</p>`;
}

function guestJoinPanelHtml({ leaveHint = false, error = "" } = {}) {
  const defaultCode = guestRejoinDefaultCode();
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
      <input type="text" class="field-input" id="guest-rejoin-code" placeholder="6 caractères" maxlength="8" autocapitalize="characters" value="${escapeHtml(defaultCode)}" />
      <div id="guest-rejoin-turnstile" class="auth-turnstile-wrap"></div>
      ${guestJoinErrorHtml("guest-rejoin-error", error)}
      <button type="button" class="btn btn-primary btn--spaced" id="btn-guest-rejoin">Rejoindre la partie →</button>
    </div>`;
}

function normalizeGuestJoinError(res) {
  const message = String(res?.error || "");
  if (res?.code === "display_name_taken") {
    return "Ce pseudo est déjà utilisé dans ce lobby. Choisis-en un autre.";
  }
  if (/code (introuvable|invalide)|lobby introuvable/i.test(message)) {
    return "Code incorrect ou lobby introuvable. Vérifie le code auprès de l'hôte.";
  }
  return message || "Impossible de rejoindre la partie.";
}

function homeStatsHtml() {
  /*
   * Stats de la soirée dans le lobby masquées temporairement.
   * On garde le code ci-dessous commenté pour pouvoir le réutiliser plus tard.
   *
   * if (!hasActiveLobby()) return "";
   *
   * const recap = getEveningRecap();
   * const liesDisplay =
   *   recap.liesTotal > 0 ? `${recap.liesFound}/${recap.liesTotal}` : String(recap.liesFound);
   *
   * return `
   *       <p class="label-upper label-upper--muted">Stats de la soirée</p>
   *       <div class="stats stats--global">
   *         <div class="stat stat--banner"><div>👥</div><div class="stat-number">${recap.participantCount}</div><div class="stat-label">Joueurs</div></div>
   *         <div class="stat"><div>🔥</div><div class="stat-number">${recap.hotTakes}</div><div class="stat-label">Hot takes</div></div>
   *         <div class="stat"><div>⚡</div><div class="stat-number">${recap.speedVotes}</div><div class="stat-label">SpeedVotes</div></div>
   *         <div class="stat"><div>📏</div><div class="stat-number">${recap.truthMeters}</div><div class="stat-label">TruthMeter</div></div>
   *         <div class="stat"><div>⚖️</div><div class="stat-number">${recap.dilemmas}</div><div class="stat-label">Dilemma</div></div>
   *         <div class="stat"><div>🕵️</div><div class="stat-number">${liesDisplay}</div><div class="stat-label">Mensonges trouvés</div></div>
   *         <div class="stat"><div>🏆</div><div class="stat-number">${recap.tierNights}</div><div class="stat-label">Tier lists</div></div>
   *       </div>`;
   */
  return "";
}

function homeRenderSnapshot(authTab, serverLobby = null, guestJoinError = "") {
  const user = getUser();
  return JSON.stringify({
    tab: authTab,
    loggedIn: isLoggedIn(),
    guest: isGuest(),
    name: user?.name,
    inLobby: hasActiveLobby(),
    lobbyCode: getLobby()?.code,
    serverLobbyCode: serverLobby?.code || null,
    guestJoinError,
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
  const routeAuthTab = getScreenParams()?.authTab;
  let authTab =
    tabAfterLeave ||
    (routeAuthTab === "login" || routeAuthTab === "signup" || routeAuthTab === "guest"
      ? routeAuthTab
      : null) ||
    (pendingJoin ? "guest" : "login");
  if (tabAfterLeave) sessionStorage.removeItem("reveal-auth-tab");

  let unsubSession = () => {};
  let renderTimer = null;
  let renderInFlight = false;
  let lastSnapshot = "";
  let forgotCooldownTimer = null;
  let pendingServerLobby = null;
  let guestJoinError = "";

  function startForgotCooldownTicker() {
    if (forgotCooldownTimer) return;
    forgotCooldownTimer = setInterval(() => {
      if (getCurrentScreen() !== "home") return;
      syncForgotPasswordButton(app);
      if (getPasswordResetCooldownRemainingMs() <= 0) {
        clearInterval(forgotCooldownTimer);
        forgotCooldownTimer = null;
      }
    }, 1000);
  }

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
    const snap = homeRenderSnapshot(authTab, pendingServerLobby, guestJoinError);
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
      syncForgotPasswordButton(app);
      if (getPasswordResetCooldownRemainingMs() > 0) startForgotCooldownTicker();
      await setupAuthTurnstile();
    } finally {
      renderInFlight = false;
    }
  }

  async function setupAuthTurnstile() {
    removeTurnstile("login");
    removeTurnstile("signup");

    if (isLoggedIn()) {
      removeTurnstile("guest");
      return;
    }

    if (isGuest()) {
      await setupGuestRejoinTurnstile({
        requireSolved: isGuestRecoveryCaptchaPending(),
        forceRemount: isGuestRecoveryCaptchaPending(),
      });
      return;
    }

    removeTurnstile("guest");

    if (authTab === "login") {
      const container = app.querySelector("#login-turnstile");
      const btn = app.querySelector("#btn-login");
      const mountRes = await mountTurnstile("login", container, {
        onChange: (solved) => {
          if (btn) btn.disabled = !solved;
        },
      });
      if (!mountRes.ok) {
        const err = app.querySelector("#login-error");
        if (err) {
          err.textContent = mountRes.error;
          err.classList.remove("hidden");
        }
        if (btn) btn.disabled = true;
      }
      return;
    }

    if (authTab === "signup") {
      const container = app.querySelector("#signup-turnstile");
      const btn = app.querySelector("#btn-signup");
      const mountRes = await mountTurnstile("signup", container, {
        onChange: (solved) => {
          if (btn) btn.disabled = !solved;
        },
      });
      if (!mountRes.ok) {
        const err = app.querySelector("#signup-error");
        if (err) {
          err.textContent = mountRes.error;
          err.classList.remove("hidden");
        }
        if (btn) btn.disabled = true;
      }
      return;
    }

    if (authTab === "guest") {
      const container = app.querySelector("#guest-turnstile");
      const btn = app.querySelector("#btn-guest-join");
      const mountRes = await mountTurnstile("guest", container, {
        onChange: (solved) => {
          if (btn) btn.disabled = !solved;
        },
      });
      if (!mountRes.ok) {
        const err = app.querySelector("#guest-error");
        if (err) {
          err.textContent = mountRes.error;
          err.classList.remove("hidden");
        }
        if (btn) btn.disabled = true;
      }
    }
  }

  async function setupGuestRejoinTurnstile({ requireSolved = false, forceRemount = false } = {}) {
    if (!isGuest() || !isTurnstileRequired()) return;

    const container = app.querySelector("#guest-rejoin-turnstile");
    const btn = app.querySelector("#btn-guest-rejoin");

    const liveUserId = await getLiveSupabaseUserId();
    if (liveUserId) {
      container?.classList.add("hidden");
      removeTurnstile("guest");
      if (btn) btn.disabled = false;
      return;
    }

    container?.classList.remove("hidden");

    if (!forceRemount && isTurnstileMounted("guest") && container?.childElementCount > 0) {
      setTurnstileOnChange("guest", (solved) => {
        if (btn && requireSolved) btn.disabled = !solved;
      });
      if (btn && requireSolved) btn.disabled = !isTurnstileSolved("guest");
      return;
    }

    const mountRes = await mountTurnstile("guest", container, {
      onChange: (solved) => {
        if (btn && requireSolved) btn.disabled = !solved;
      },
    });
    if (!mountRes.ok) {
      const err = app.querySelector("#guest-rejoin-error");
      if (err) {
        err.textContent = mountRes.error;
        err.classList.remove("hidden");
      }
      if (btn && requireSolved) btn.disabled = true;
    }
  }

  /* Connexion Facebook / Instagram (home.js paint) - réactiver plus tard :
   *  HTML : auth-divider « ou continuer avec », social-row data-social facebook|instagram, hint Meta.
   *  JS : import loginWithSocial + handler data-social dans onHomeClick.
   */

  function paint() {
    const user = getUser();
    const loggedIn = isLoggedIn();
    const guest = isGuest();
    const activeLobby = hasActiveLobby();
    const pendingServerLobbyCode = pendingServerLobby?.code || "";
    const canStartNewLobby = canCreateLobby() && !pendingServerLobbyCode;
    const createLobbyDisabledReason = pendingServerLobbyCode
      ? `Reprends ou quitte le lobby ${pendingServerLobbyCode} avant d'en créer un nouveau.`
      : "Quitte le lobby actuel avant d'en créer un nouveau.";

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
          ${guestJoinPanelHtml({ leaveHint: activeLobby, error: guestJoinError })}`
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
              <div class="password-field">
                <input type="password" class="field-input password-field__input" id="login-password" placeholder="••••••••" />
                <button type="button" class="password-field__toggle" data-toggle-password="login-password" aria-label="Afficher le mot de passe" aria-pressed="false">👁️</button>
              </div>
              <div id="login-turnstile" class="auth-turnstile-wrap"></div>
              <p class="auth-error hidden" id="login-error"></p>
              <button type="button" class="btn btn-primary btn--spaced" id="btn-login"${isTurnstileRequired() ? " disabled" : ""}>Se connecter</button>
              <button type="button" class="btn-link auth-forgot" id="btn-forgot-password">Mot de passe oublié ?</button>
            </div>
            <div id="auth-panel-signup" class="${authTab === "signup" ? "" : "hidden"}">
              <label class="field-label" for="signup-name">Pseudo</label>
              <input type="text" class="field-input" id="signup-name" placeholder="Ton pseudo" />
              <label class="field-label" for="signup-email">Email</label>
              <input type="email" class="field-input" id="signup-email" placeholder="toi@email.com" />
              <label class="field-label" for="signup-password">Mot de passe</label>
              <div class="password-field">
                <input type="password" class="field-input password-field__input" id="signup-password" placeholder="4 caractères min." />
                <button type="button" class="password-field__toggle" data-toggle-password="signup-password" aria-label="Afficher le mot de passe" aria-pressed="false">👁️</button>
              </div>
              <div id="signup-turnstile" class="auth-turnstile-wrap"></div>
              <p class="auth-error hidden" id="signup-error"></p>
              <button type="button" class="btn btn-primary btn--spaced" id="btn-signup"${isTurnstileRequired() ? " disabled" : ""}>Créer mon compte</button>
            </div>
            <div id="auth-panel-guest" class="${authTab === "guest" ? "" : "hidden"}">
              <p class="hint auth-form__guest-intro">Rejoins avec un code ou un lien d'invitation de l'hôte. Pas de compte requis - les invités ne peuvent pas créer de lobby.</p>
              <label class="field-label" for="guest-name">Ton pseudo</label>
              <input type="text" class="field-input" id="guest-name" placeholder="Ex : Alex" maxlength="24" />
              <label class="field-label" for="guest-code">Code d'invitation</label>
              <input type="text" class="field-input" id="guest-code" placeholder="6 caractères" maxlength="8" autocapitalize="characters" />
              <div id="guest-turnstile" class="auth-turnstile-wrap"></div>
              ${guestJoinErrorHtml("guest-error", guestJoinError)}
              <button type="button" class="btn btn-primary btn--spaced" id="btn-guest-join">Rejoindre la partie →</button>
            </div>
          </div>
          `
        }

        <div class="lobby-actions">
          ${
            activeLobby
              ? `<button type="button" class="btn btn-accent btn--lobby-return" id="btn-return-lobby">
            ${isLobbyEveningStarted() ? "Reprendre la soirée" : "Retour au lobby"} <span class="muted">(${escapeHtml(getLobby().code)})</span>
          </button>
          <button type="button" class="btn btn-secondary btn--leave-lobby" id="btn-leave-lobby">Quitter le lobby</button>`
              : pendingServerLobbyCode
                ? `<div class="card card--highlight home-resume-card">
            <p class="hint">Tu es encore dans le lobby <strong>${escapeHtml(pendingServerLobbyCode)}</strong>${pendingServerLobby.status === "playing" ? " (partie en cours)" : ""}.</p>
            <button type="button" class="btn btn-accent btn--spaced" id="btn-resume-evening">
              Reprendre la soirée <span class="muted">(${escapeHtml(pendingServerLobbyCode)})</span>
            </button>
          </div>`
                : ""
          }
          ${
            loggedIn
              ? canStartNewLobby
                ? `<button type="button" class="btn btn-primary" id="btn-create-lobby">Créer un lobby</button>`
                : `<button type="button" class="btn btn-primary" id="btn-create-lobby" disabled aria-disabled="true" title="${escapeHtml(createLobbyDisabledReason)}">Créer un lobby</button>`
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
      guestJoinError = "";
      scheduleRender(true);
      return;
    }

    /* Connexion sociale - réactiver avec le bloc HTML ci-dessus.
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
    */

    if (e.target.closest("#btn-login")) {
      const err = app.querySelector("#login-error");
      const btn = e.target.closest("#btn-login");
      if (!isTurnstileSolved("login")) {
        if (err) {
          err.textContent = "Valide la vérification anti-robot.";
          err.classList.remove("hidden");
        }
        return;
      }
      btn.disabled = true;
      const res = await loginWithEmail(
        app.querySelector("#login-email")?.value,
        app.querySelector("#login-password")?.value,
        getTurnstileToken("login")
      );
      if (isTurnstileRequired()) {
        btn.disabled = !isTurnstileSolved("login");
      } else {
        btn.disabled = false;
      }
      if (!res.ok) {
        if (res.captcha) resetTurnstile("login");
        err.textContent = res.error;
        err.classList.remove("hidden");
        return;
      }
      err?.classList.add("hidden");
      scheduleRender(true);
      return;
    }

    if (e.target.closest("#btn-forgot-password")) {
      const btn = e.target.closest("#btn-forgot-password");
      if (btn.disabled) return;
      app.querySelector("#login-error")?.classList.add("hidden");
      const res = await runPasswordResetEmailFlow(app.querySelector("#login-email")?.value || "");
      if (res?.cooldownStarted || res?.cooldown || getPasswordResetCooldownRemainingMs() > 0) {
        syncForgotPasswordButton(app);
        startForgotCooldownTicker();
      }
      return;
    }

    if (e.target.closest("#btn-signup")) {
      const err = app.querySelector("#signup-error");
      const btn = e.target.closest("#btn-signup");
      if (!isTurnstileSolved("signup")) {
        if (err) {
          err.textContent = "Valide la vérification anti-robot.";
          err.classList.remove("hidden");
        }
        return;
      }
      btn.disabled = true;
      const res = await signupWithEmail(
        app.querySelector("#signup-email")?.value,
        app.querySelector("#signup-password")?.value,
        app.querySelector("#signup-name")?.value,
        getTurnstileToken("signup")
      );
      if (isTurnstileRequired()) {
        btn.disabled = !isTurnstileSolved("signup");
      } else {
        btn.disabled = false;
      }
      if (!res.ok) {
        if (res.captcha) resetTurnstile("signup");
        const msg = String(res.error || "");
        if (/already.*registered|already registered|user.*exists|email.*already|déjà.*utilisé|existe déjà/i.test(msg)) {
          err?.classList.add("hidden");
          const resetRes = await runPasswordResetEmailFlow(
            app.querySelector("#signup-email")?.value || "",
            {
              title: "Email déjà utilisé",
              message:
                "Cet email est déjà enregistré. Entre-le pour recevoir un lien de réinitialisation de mot de passe.",
              icon: "🔐",
            }
          );
          if (resetRes?.cooldownStarted || resetRes?.cooldown || getPasswordResetCooldownRemainingMs() > 0) {
            syncForgotPasswordButton(app);
            startForgotCooldownTicker();
          }
          return;
        }

        err.textContent = res.error;
        err.classList.remove("hidden");
        return;
      }
      err?.classList.add("hidden");
      if (res.loggedIn) {
        await showAppAlert("Compte créé, bienvenue ! Tu peux créer ou rejoindre un lobby.", {
          title: "Bienvenue",
          icon: "🎉",
        });
      } else {
        await showAppAlert(
          "Compte créé. Connecte-toi avec ton email et ton mot de passe.",
          { title: "Compte créé", icon: "✅" }
        );
      }
      scheduleRender(true);
      return;
    }

    const toggleBtn = e.target.closest("[data-toggle-password]");
    if (toggleBtn) {
      const inputId = toggleBtn.getAttribute("data-toggle-password");
      const input = inputId ? app.querySelector(`#${CSS.escape(inputId)}`) : null;
      if (input) {
        const next = input.type === "password" ? "text" : "password";
        input.type = next;
        const shown = next === "text";
        toggleBtn.setAttribute("aria-pressed", shown ? "true" : "false");
        toggleBtn.setAttribute("aria-label", shown ? "Masquer le mot de passe" : "Afficher le mot de passe");
        toggleBtn.textContent = shown ? "🙈" : "👁️";
      }
      return;
    }

    if (e.target.closest("#btn-logout")) {
      const res = await logout();
      if (res?.cancelled) return;
      if (res?.ok === false && res.error) {
        await showAppAlert(res.error, { title: "Déconnexion", icon: "⚠️" });
        return;
      }
      scheduleRender(true);
      return;
    }

    if (e.target.closest("#btn-return-lobby")) {
      const btn = e.target.closest("#btn-return-lobby");
      btn.disabled = true;
      try {
        await returnToEveningGames({ rejoinActiveGame: true });
      } catch (err) {
        await showAppAlert(err?.message || "Impossible de reprendre la soirée.", {
          title: "Reprise",
          icon: "⚠️",
        });
      } finally {
        if (btn?.isConnected) btn.disabled = false;
      }
      return;
    }

    if (e.target.closest("#btn-resume-evening")) {
      const btn = e.target.closest("#btn-resume-evening");
      btn.disabled = true;
      try {
        const recovered = await tryRecoverLobbyFromServer();
        if (!recovered.ok) {
          await showAppAlert("Impossible de retrouver ta soirée. Demande le code à l'hôte.", {
            title: "Reprise",
            icon: "⚠️",
          });
          pendingServerLobby = null;
          scheduleRender(true);
          return;
        }
        pendingServerLobby = null;
        await resumeEveningSession({ force: true });
      } catch (err) {
        await showAppAlert(err?.message || "Impossible de reprendre la soirée.", {
          title: "Reprise",
          icon: "⚠️",
        });
      } finally {
        if (btn?.isConnected) btn.disabled = false;
      }
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
      try {
        const res = await joinLobby(app.querySelector("#join-code")?.value);
        if (!res.ok) {
          const joinErrorMessage =
            res.code === "display_name_taken"
              ? "Ce pseudo est déjà utilisé dans ce lobby. Choisis-en un autre."
              : res.error;
          await showAppAlert(joinErrorMessage, { title: "Rejoindre le lobby", icon: "⚠️" });
          return;
        }
        await navigateAfterLobbyJoin();
      } catch (err) {
        await showAppAlert(err?.message || "Impossible de rejoindre le lobby.", {
          title: "Rejoindre le lobby",
          icon: "⚠️",
        });
      } finally {
        btn.disabled = false;
      }
      return;
    }

    if (e.target.closest("#btn-guest-join") || e.target.closest("#btn-guest-rejoin")) {
      const { nameEl, codeEl, errEl } = readGuestJoinFields();
      const btn = e.target.closest("#btn-guest-join, #btn-guest-rejoin");

      const liveUserId = await getLiveSupabaseUserId();
      if (isTurnstileRequired() && !liveUserId && !isTurnstileSolved("guest")) {
        guestJoinError = "Valide la vérification anti-robot.";
        if (errEl) {
          errEl.textContent = guestJoinError;
          errEl.classList.remove("hidden");
        }
        return;
      }

      btn.disabled = true;
      guestJoinError = "";
      errEl?.classList.add("hidden");

      try {
        const captchaToken =
          isTurnstileRequired() && isTurnstileSolved("guest") ? getTurnstileToken("guest") : null;
        const res = await joinLobbyAsGuest(codeEl?.value, nameEl?.value, captchaToken);

        if (!res.ok) {
          const isDisplayNameTaken = res.code === "display_name_taken";
          const joinErrorMessage = normalizeGuestJoinError(res);
          guestJoinError = joinErrorMessage;

          if (res.captcha && isGuest()) {
            await setupGuestRejoinTurnstile({ requireSolved: true, forceRemount: true });
            if (btn) btn.disabled = true;
          } else if (res.captcha) {
            resetTurnstile("guest");
            if (btn) btn.disabled = true;
          } else {
            btn.disabled = false;
          }

          if (errEl) {
            errEl.textContent = joinErrorMessage;
            errEl.classList.remove("hidden");
          }

          if (isDisplayNameTaken && (res.sessionCleared || res.captcha || !errEl)) {
            await showAppAlert(joinErrorMessage, { title: "Rejoindre", icon: "⚠️" });
          } else if (!errEl) {
            await showAppAlert(joinErrorMessage, { title: "Rejoindre", icon: "⚠️" });
          }

          if (res.sessionCleared || res.captcha) {
            if (isDisplayNameTaken) {
              authTab = "guest";
            }
            scheduleRender(true);
          }
          return;
        }
        guestJoinError = "";
        await navigateAfterLobbyJoin();
      } catch (err) {
        btn.disabled = false;
        const msg = err?.message || "Impossible de rejoindre le lobby.";
        guestJoinError = msg;
        if (errEl) {
          errEl.textContent = msg;
          errEl.classList.remove("hidden");
        } else {
          await showAppAlert(msg, { title: "Rejoindre", icon: "⚠️" });
        }
      }
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
    if (!hasActiveLobby() && isSupabaseConfigured()) {
      pendingServerLobby = await peekServerLobbyForUser();
      if (pendingServerLobby) scheduleRender(true);
    }
  })();

  if (isGameSyncActive() && hasActiveLobby()) {
    unsubSession = onGameSessionChange(async (row) => {
      if (getCurrentScreen() !== "home") return;
      tryFollowHostGameSession(row);
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
    if (forgotCooldownTimer) clearInterval(forgotCooldownTimer);
    removeAllTurnstile();
  };
}
