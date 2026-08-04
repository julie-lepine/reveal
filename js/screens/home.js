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
  leaveLobbyMembershipFromServer,
  notifyVoluntaryLeaveFailure,
  reconcileLobbyMembership,
  resetAppToCleanHome,
  tryRecoverLobbyFromServer,
  getRememberedLobbyCode,
  resumeEveningSession,
  isGuestRecoveryCaptchaPending,
} from "../core/lobby.js";
import { queryActiveLobbyMembership } from "../core/lobbyMembershipFetch.js";
import {
  retryPendingLobbyMembershipCompensation,
  getPendingLobbyMembershipCompensation,
  shouldBlockMembershipQueryForPending,
  buildMembershipReconciliationConflict,
  resolvePendingMembershipByLeave,
  clearPendingLobbyMembershipCompensationIfMatches,
} from "../core/lobbyMembershipCompensation.js";
import { deleteOwnLobbyMembershipById } from "../core/supabaseLobby.js";
import {
  getMembershipSnapshot,
  setMembershipSnapshot,
  invalidateMembershipSnapshot,
  getMembershipAuthGeneration,
} from "../core/lobbyMembershipSnapshot.js";
import { commitMembershipRemoved } from "../core/lobbyMembershipAlign.js";
import {
  isPostLeaveHomeTransitionActive,
  getPostLeaveHomeTransitionGeneration,
  endPostLeaveHomeTransition,
} from "../core/homeMembershipLeaveTransition.js";
import {
  deriveHomeMembershipChrome,
  decideMembershipSnapshotWrite,
} from "../core/homeMembershipChrome.js";
import {
  LOBBY_CREATE_ERROR,
} from "../core/lobbyCreateGuard.js";
import {
  SERVER_LEAVE_CONFIRM,
  LOBBY_SERVER_LEAVE_ERROR,
} from "../core/lobbyServerLeave.js";
import {
  getSupabaseUserId,
  getLiveSupabaseUserId,
  authReady,
  isAuthReadyResolved,
} from "../core/supabaseAuth.js";
import { getEveningRecap } from "../core/eveningRecap.js";
import {
  isGameSyncActive,
  onGameSessionChange,
  routeToActiveGameIfNeeded,
  tryFollowHostGameSession,
} from "../core/gameSync.js";
import { navigate, getCurrentScreen, getScreenParams } from "../core/router.js";
import { escapeHtml, logoHtml, pageShell } from "../core/ui.js";
import { handleNavTarget, goToEveningSettings } from "./nav.js";
import { showAppAlert, showAppConfirm, showAppEmailPrompt, showEmojiPickerDialog } from "../core/dialog.js";
import { getLocalEmoji } from "../core/state.js";
import { DEFAULT_GUEST_EMOJI, normalizeGuestEmoji } from "../../data/profileEmojis.js";
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
import { createMountGuard } from "../core/mountLifecycle.js";
import { createSyncPending } from "../core/syncPending.js";

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

function guestEmojiPickerHtml(emoji, { btnId = "guest-emoji-btn", compact = false } = {}) {
  const chosen = normalizeGuestEmoji(emoji);
  return `
      <label class="field-label" for="${btnId}">Ton emoji</label>
      <div class="emoji-picker-preview${compact ? " emoji-picker-preview--compact" : ""}">
        <button type="button" class="emoji-picker-preview__avatar" id="${btnId}" data-guest-emoji aria-label="Choisir ton emoji" title="Choisir ton emoji">${chosen}</button>
        ${compact ? "" : `<span class="hint">Appuie pour changer</span>`}
      </div>`;
}

function guestJoinFieldsHtml({
  nameId,
  codeId,
  emojiBtnId,
  emoji,
  nameValue = "",
  codeValue = "",
} = {}) {
  return `
      <label class="field-label" for="${nameId}">Ton pseudo</label>
      <input type="text" class="field-input" id="${nameId}" placeholder="Ex : Alex" maxlength="24" value="${escapeHtml(nameValue)}" />
      <div class="guest-join-meta">
        <div class="guest-join-meta__emoji">
          ${guestEmojiPickerHtml(emoji, { btnId: emojiBtnId, compact: true })}
        </div>
        <div class="guest-join-meta__code">
          <label class="field-label" for="${codeId}">Code d'invitation</label>
          <input type="text" class="field-input" id="${codeId}" placeholder="6 caractères" maxlength="8" autocapitalize="characters" value="${escapeHtml(codeValue)}" />
        </div>
      </div>`;
}

function guestJoinPanelHtml({
  leaveHint = false,
  error = "",
  emoji = DEFAULT_GUEST_EMOJI,
  joinLabel = "Rejoindre la partie →",
  joinDisabled = false,
} = {}) {
  const defaultCode = guestRejoinDefaultCode();
  const disabledAttr = joinDisabled ? " disabled" : "";
  return `
    <div class="card auth-form auth-form--guest auth-form--guest-rejoin">
      ${
        leaveHint
          ? `<p class="hint auth-form__guest-intro auth-form__guest-intro--warn">Tu es encore lié à un lobby (${escapeHtml(getLobby()?.code || "?")}). Utilise « Quitter le lobby » ou rejoins avec le code ci-dessous.</p>`
          : `<p class="hint auth-form__guest-intro">Rejoins avec un code ou un lien d'invitation de l'hôte. Pas de compte requis - les invités ne peuvent pas créer de lobby.</p>`
      }
      ${guestJoinFieldsHtml({
        nameId: "guest-rejoin-name",
        codeId: "guest-rejoin-code",
        emojiBtnId: "guest-rejoin-emoji-btn",
        emoji,
        nameValue: getUser()?.name || "",
        codeValue: defaultCode,
      })}
      <div id="guest-rejoin-turnstile" class="auth-turnstile-wrap"></div>
      ${guestJoinErrorHtml("guest-rejoin-error", error)}
      <button type="button" class="btn btn-primary btn--spaced" id="btn-guest-rejoin"${disabledAttr}>${escapeHtml(joinLabel)}</button>
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

function homeRenderSnapshot(
  authTab,
  chrome,
  guestJoinError = "",
  joinPendingVisible = false,
  joinPendingActive = false
) {
  const user = getUser();
  return JSON.stringify({
    tab: authTab,
    loggedIn: isLoggedIn(),
    guest: isGuest(),
    name: user?.name,
    inLobby: hasActiveLobby(),
    lobbyCode: getLobby()?.code,
    membershipState: chrome?.state || null,
    membershipCode: chrome?.membershipCode || null,
    createEnabled: Boolean(chrome?.createEnabled),
    showResume: Boolean(chrome?.showResume),
    guestJoinError,
    joinPendingVisible: Boolean(joinPendingVisible),
    joinPendingActive: Boolean(joinPendingActive),
    recap: hasActiveLobby() ? getEveningRecap().participantCount : 0,
  });
}

function homeMembershipActionsHtml(chrome) {
  if (!chrome) return "";

  if (chrome.state === "membership_reconciliation_required") {
    const code = chrome.membershipCode || "?";
    return `
          <div class="card card--highlight home-resume-card" role="status">
            <p class="hint">${escapeHtml(chrome.primaryMessage || `Une tentative de connexion au lobby ${code} n'a pas été finalisée.`)}</p>
            ${
              chrome.errorMessage
                ? `<p class="auth-error" role="alert">${escapeHtml(chrome.errorMessage)}</p>`
                : ""
            }
            <button type="button" class="btn btn-secondary btn--spaced" id="btn-pending-leave-remote">Quitter ${escapeHtml(code)}</button>
            <button type="button" class="btn btn-accent" id="btn-pending-join-remote">Rejoindre ${escapeHtml(code)}</button>
          </div>`;
  }

  if (chrome.state === "cached_active") {
    const code = getLobby()?.code || chrome.membershipCode || "";
    return `
          <button type="button" class="btn btn-accent btn--lobby-return" id="btn-return-lobby">
            ${isLobbyEveningStarted() ? "Reprendre la soirée" : "Retour au lobby"} <span class="muted">(${escapeHtml(code)})</span>
          </button>
          <button type="button" class="btn btn-secondary btn--leave-lobby" id="btn-leave-lobby">Quitter le lobby</button>`;
  }

  if (
    chrome.state === "server_membership_recoverable" ||
    chrome.state === "server_membership_unrecoverable"
  ) {
    const code = chrome.membershipCode || "";
    const roleHint =
      chrome.membershipRole === "host"
        ? " (hôte)"
        : chrome.membershipRole === "member"
          ? ""
          : "";
    const leaveLabel = chrome.leaveServerLabel || "Quitter le lobby";
    const busy = Boolean(chrome.serverLeaveBusy);
    const disabledAttr = busy ? " disabled aria-disabled=\"true\"" : "";
    return `
          <div class="card card--highlight home-resume-card">
            <p class="hint">${escapeHtml(chrome.primaryMessage || `Tu es encore dans le lobby ${code}.`)}${escapeHtml(roleHint)}</p>
            ${
              chrome.errorMessage
                ? `<p class="auth-error" role="alert">${escapeHtml(chrome.errorMessage)}</p>`
                : ""
            }
            <button type="button" class="btn btn-accent btn--spaced" id="btn-resume-evening"${disabledAttr}>
              Reprendre la soirée <span class="muted">(${escapeHtml(code)})</span>
            </button>
            ${
              chrome.showLeaveServer
                ? `<button type="button" class="btn btn-secondary btn--leave-lobby" id="btn-leave-lobby-server"${disabledAttr}>${escapeHtml(leaveLabel)}</button>`
                : ""
            }
          </div>`;
  }

  if (chrome.state === "post_leave_transition") {
    // E3 - soft-hold : pas de panneau checking, pas de Resume.
    return "";
  }

  if (chrome.state === "checking") {
    return `<p class="hint home-membership-checking">${escapeHtml(chrome.primaryMessage || "Vérification de ton lobby…")}</p>`;
  }

  if (
    chrome.state === "check_failed" ||
    chrome.state === "leave_confirmation_pending"
  ) {
    return `
          <div class="card home-membership-check-failed">
            <p class="hint">${escapeHtml(chrome.primaryMessage || "")}</p>
            ${
              chrome.errorMessage
                ? `<p class="auth-error" role="alert">${escapeHtml(chrome.errorMessage)}</p>`
                : ""
            }
            ${
              chrome.showRetry
                ? `<button type="button" class="btn btn-secondary btn--spaced" id="btn-membership-retry">Réessayer</button>`
                : ""
            }
          </div>`;
  }

  return "";
}

/** Retire une modale bloquante restée dans le DOM. */
function clearStuckDialogs() {
  document.querySelectorAll(".app-dialog").forEach((el) => el.remove());
}

export function mountHome(app) {
  const mount = createMountGuard();
  const shouldContinue = () => mount.isMounted() && mount.isCurrentMount();
  /** Loader UI Join Vague A - soft « Connexion… » ; pas de lock métier. */
  const syncPending = createSyncPending({
    softDelayMs: 500,
    onChange: () => {
      if (!shouldContinue()) return;
      scheduleRender(true);
    },
  });

  const tabAfterLeave = sessionStorage.getItem("reveal-auth-tab");
  const routeAuthTab = getScreenParams()?.authTab;
  let authTab =
    tabAfterLeave ||
    (routeAuthTab === "login" || routeAuthTab === "signup" || routeAuthTab === "guest"
      ? routeAuthTab
      : null) ||
    "login";
  if (tabAfterLeave) sessionStorage.removeItem("reveal-auth-tab");

  let unsubSession = () => {};
  let renderTimer = null;
  let renderInFlight = false;
  let lastSnapshot = "";
  let forgotCooldownTimer = null;
  let guestJoinError = "";
  let selectedGuestEmoji = normalizeGuestEmoji(
    isGuest() ? getLocalEmoji() : DEFAULT_GUEST_EMOJI
  );

  /** Résolution membership serveur en cours (chrome `checking` si pas de found). */
  let resolutionInProgress =
    isSupabaseConfigured() && (isLoggedIn() || isGuest());
  /** Échec Resume persistant avec found conservé. */
  let resumeUnrecoverable = false;
  let resumeErrorMessage = null;
  /** unknown transitoire : found conservé (pas d’écriture snapshot unknown). */
  let retainedFoundDespiteUnknown = false;
  /** Anti double-clic Créer (pipeline unique). */
  let createLobbyInFlight = false;
  /** Leave/dissolve server-only en cours. */
  let serverLeaveInFlight = false;
  /** Mutation leave OK mais confirmation query unknown. */
  let leaveConfirmationPending = false;
  /** Conflit local A / remote B non résolu (pending compensation). */
  let membershipReconciliationConflict = null;

  function currentMembershipChrome() {
    return deriveHomeMembershipChrome({
      hasActiveLobby: hasActiveLobby(),
      snapshot: getMembershipSnapshot(),
      resolutionInProgress,
      authReady: !isSupabaseConfigured() || isAuthReadyResolved(),
      supabaseConfigured: isSupabaseConfigured(),
      loggedIn: isLoggedIn(),
      shouldCheckMembership: isLoggedIn() || isGuest(),
      resumeUnrecoverable,
      resumeErrorMessage,
      retainedFoundDespiteUnknown,
      activeLobbyCode: getLobby()?.code || null,
      leaveConfirmationPending,
      postLeaveHomeTransition: isPostLeaveHomeTransitionActive(),
      serverLeaveInFlight,
      membershipReconciliationConflict,
    });
  }

  function applyMembershipQueryResult(result, identity = null) {
    let pending = getPendingLobbyMembershipCompensation();
    if (pending && result?.status === "none") {
      clearPendingLobbyMembershipCompensationIfMatches(pending.lobbyId);
      membershipReconciliationConflict = null;
      pending = null;
    }
    const localLobbyId = getLobby()?.id || null;
    if (shouldBlockMembershipQueryForPending(pending, result, { localLobbyId })) {
      membershipReconciliationConflict = buildMembershipReconciliationConflict(
        pending,
        result,
        localLobbyId
      );
      return;
    }
    membershipReconciliationConflict = null;
    const decision = decideMembershipSnapshotWrite(
      getMembershipSnapshot(),
      result,
      "home-query",
      identity
    );
    if (decision.action === "retain_found_same_identity") {
      retainedFoundDespiteUnknown = true;
      return;
    }
    if (decision.action === "reject_stale_identity") {
      return;
    }
    if (decision.action === "write") {
      const writeUserId = identity?.currentUserId || getSupabaseUserId();
      if (!writeUserId) return;
      setMembershipSnapshot(
        decision.result,
        decision.source || "home-query",
        writeUserId,
        identity?.queryAuthGeneration != null
          ? { authGeneration: identity.queryAuthGeneration }
          : null
      );
      retainedFoundDespiteUnknown = false;
      if (decision.result.status === "none" || decision.result.status === "found") {
        resumeUnrecoverable = false;
        resumeErrorMessage = null;
        leaveConfirmationPending = false;
      }
    }
  }

  async function resolveHomeMembership({ force = false } = {}) {
    if (!isSupabaseConfigured()) {
      resolutionInProgress = false;
      return;
    }
    if (!isLoggedIn() && !isGuest()) {
      resolutionInProgress = false;
      return;
    }

    const queryUserId = getSupabaseUserId();
    if (!queryUserId) {
      resolutionInProgress = false;
      return;
    }
    const queryAuthGeneration = getMembershipAuthGeneration();
    const leaveGen = isPostLeaveHomeTransitionActive()
      ? getPostLeaveHomeTransitionGeneration()
      : null;

    resolutionInProgress = true;
    if (force && shouldContinue()) scheduleRender(true);

    let settledResult = null;
    try {
      if (!isAuthReadyResolved()) {
        await authReady;
        if (!shouldContinue()) return;
      }
      if (getSupabaseUserId() !== queryUserId) return;
      if (isSupabaseConfigured()) {
        await retryPendingLobbyMembershipCompensation({
          deleteOwnLobbyMembershipById,
        });
        if (!shouldContinue()) return;
        if (!getPendingLobbyMembershipCompensation()) {
          membershipReconciliationConflict = null;
        }
      }
      if (getSupabaseUserId() !== queryUserId) return;
      const result = await queryActiveLobbyMembership();
      if (!shouldContinue()) return;
      const currentUserId = getSupabaseUserId();
      const currentAuthGeneration = getMembershipAuthGeneration();
      if (queryUserId !== currentUserId || queryAuthGeneration !== currentAuthGeneration) {
        return;
      }
      if (leaveGen != null && result?.status === "unknown") {
        leaveConfirmationPending = true;
      }
      applyMembershipQueryResult(result, {
        queryUserId,
        currentUserId,
        queryAuthGeneration,
        currentAuthGeneration,
      });
    } catch {
      if (!shouldContinue()) return;
      const currentUserId = getSupabaseUserId();
      const currentAuthGeneration = getMembershipAuthGeneration();
      if (queryUserId !== currentUserId || queryAuthGeneration !== currentAuthGeneration) {
        return;
      }
      if (leaveGen != null) {
        leaveConfirmationPending = true;
      }
      applyMembershipQueryResult(
        { status: "unknown" },
        {
          queryUserId,
          currentUserId,
          queryAuthGeneration,
          currentAuthGeneration,
        }
      );
    } finally {
      if (leaveGen != null) {
        // Après pending éventuel : évite frame checking (pending > postLeave > checking).
        endPostLeaveHomeTransition(leaveGen);
      }
      if (shouldContinue()) {
        resolutionInProgress = false;
        scheduleRender(true);
      } else {
        resolutionInProgress = false;
      }
    }
  }

  function syncGuestEmojiPreview() {
    app.querySelectorAll("[data-guest-emoji]").forEach((btn) => {
      btn.textContent = selectedGuestEmoji;
    });
  }

  async function openGuestEmojiPicker() {
    const res = await showEmojiPickerDialog(selectedGuestEmoji);
    if (!res?.ok) return;
    selectedGuestEmoji = normalizeGuestEmoji(res.emoji);
    syncGuestEmojiPreview();
  }

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
    if (!shouldContinue()) return;
    const chrome = currentMembershipChrome();
    const pendingState = syncPending.getState();
    const snap = homeRenderSnapshot(
      authTab,
      chrome,
      guestJoinError,
      pendingState.visible,
      pendingState.token != null
    );
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
      if (!shouldContinue()) return;
      paint(chrome);
      lastSnapshot = snap;
      restoreInputDrafts({ drafts, focusedId });
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

  function paint(chrome = currentMembershipChrome()) {
    const user = getUser();
    const loggedIn = isLoggedIn();
    const guest = isGuest();
    const membershipActionsHtml = homeMembershipActionsHtml(chrome);
    const activeLobby = chrome.state === "cached_active";
    const canStartNewLobby = Boolean(chrome.createEnabled) && canCreateLobby();
    const createLobbyDisabledReason =
      chrome.createDisabledReason ||
      "Quitte le lobby actuel avant d'en créer un nouveau.";
    const createLobbyLabel =
      chrome.state === "post_leave_transition" ? "Finalisation…" : "Créer un lobby";
    const joinPendingVisible = syncPending.getState().visible;
    const joinPendingActive = syncPending.getState().token != null;
    const joinLobbyLabel = joinPendingVisible ? "Connexion…" : "Rejoindre";
    const guestJoinLabel = joinPendingVisible
      ? "Connexion…"
      : "Rejoindre la partie →";
    const joinDisabledAttr = joinPendingActive ? " disabled" : "";

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
            <p class="auth-welcome__hi">Invité : <strong>${escapeHtml(user.name)}</strong> ${escapeHtml(getLocalEmoji())}</p>
            <div class="auth-welcome__actions">
              <button type="button" class="btn btn-secondary btn--compact" data-nav="settings">Paramètres</button>
              <button type="button" class="btn-link" id="btn-logout">Quitter la session</button>
            </div>
          </div>
          ${guestJoinPanelHtml({
            leaveHint: activeLobby,
            error: guestJoinError,
            emoji: selectedGuestEmoji,
            joinLabel: guestJoinLabel,
            joinDisabled: joinPendingActive,
          })}`
              : `
          <div class="auth-tabs">
            <button type="button" class="auth-tab ${authTab === "login" ? "auth-tab--active" : ""}" data-tab="login">Connexion</button>
            <button type="button" class="auth-tab ${authTab === "signup" ? "auth-tab--active" : ""}" data-tab="signup">Inscription</button>
            <button type="button" class="auth-tab auth-tab--guest ${authTab === "guest" ? "auth-tab--active" : ""}" data-tab="guest">Invité</button>
          </div>

          <div class="card auth-form ${authTab === "guest" ? "auth-form--guest" : ""}">
            <div id="auth-panel-login" class="${authTab === "login" ? "" : "hidden"}">
              <p class="hint auth-form__guest-intro">Connecte-toi pour créer ou rejoindre un lobby. Pas encore de compte ? Passe par Inscription, ou rejoins en Invité avec un code.</p>
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
              ${guestJoinFieldsHtml({
                nameId: "guest-name",
                codeId: "guest-code",
                emojiBtnId: "guest-emoji-btn",
                emoji: selectedGuestEmoji,
              })}
              <div id="guest-turnstile" class="auth-turnstile-wrap"></div>
              ${guestJoinErrorHtml("guest-error", guestJoinError)}
              <button type="button" class="btn btn-primary btn--spaced" id="btn-guest-join"${joinDisabledAttr}>${escapeHtml(guestJoinLabel)}</button>
            </div>
          </div>
          `
        }

        ${
          loggedIn && !membershipActionsHtml
            ? `<p class="hint auth-form__guest-intro lobby-actions__intro">Prêt·e pour la soirée ? Crée un lobby pour inviter tes amis, ou entre un code pour rejoindre une partie.</p>`
            : ""
        }

        <div class="lobby-actions">
          ${membershipActionsHtml}
          ${
            loggedIn
              ? canStartNewLobby
                ? `<button type="button" class="btn btn-primary" id="btn-create-lobby">${escapeHtml(createLobbyLabel)}</button>`
                : `<button type="button" class="btn btn-primary" id="btn-create-lobby" disabled aria-disabled="true" title="${escapeHtml(createLobbyDisabledReason)}">${escapeHtml(createLobbyLabel)}</button>`
              : ""
          }
          ${
            loggedIn
              ? `
          <div class="join-row">
            <input type="text" class="field-input join-input" id="join-code" placeholder="Code d'invitation" maxlength="8" />
            <button type="button" class="btn btn-secondary join-btn" id="btn-join-lobby"${joinDisabledAttr}>${escapeHtml(joinLobbyLabel)}</button>
          </div>`
              : ""
          }
        </div>

        ${homeStatsHtml()}

        <div class="app-reset-bar">
          <button type="button" class="btn-link app-reset-bar__link" id="btn-reset-app">Problème d'affichage ? Réinitialiser l'app</button>
        </div>
      `,
    });
  }

  async function onHomeClick(e) {
    if (!shouldContinue()) return;
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

    if (e.target.closest("[data-guest-emoji]")) {
      void openGuestEmojiPicker();
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
      void resolveHomeMembership({ force: true });
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
      if (res.loggedIn) void resolveHomeMembership({ force: true });
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
      if (serverLeaveInFlight) return;
      const btn = e.target.closest("#btn-resume-evening");
      btn.disabled = true;
      try {
        const recovered = await tryRecoverLobbyFromServer();
        if (!shouldContinue()) return;
        if (!recovered.ok) {
          const failMsg =
            "Impossible de retrouver ta soirée. Demande le code à l'hôte.";
          if (recovered.staleMembership) {
            // Membership peut avoir disparu : re-query canonique ; none seulement si confirmé.
            const requery = await queryActiveLobbyMembership();
            if (!shouldContinue()) return;
            applyMembershipQueryResult(requery);
            if (getMembershipSnapshot()?.status === "none") {
              resumeUnrecoverable = false;
              resumeErrorMessage = null;
            } else {
              resumeUnrecoverable = true;
              resumeErrorMessage = failMsg;
            }
          } else {
            // Conserver found ; ne pas passer à none.
            resumeUnrecoverable = true;
            resumeErrorMessage = failMsg;
          }
          await showAppAlert(failMsg, {
            title: "Reprise",
            icon: "⚠️",
          });
          if (!shouldContinue()) return;
          scheduleRender(true);
          return;
        }
        resumeUnrecoverable = false;
        resumeErrorMessage = null;
        // Rafraîchir le snapshot found après hydrate (best-effort).
        try {
          const refreshed = await queryActiveLobbyMembership();
          if (shouldContinue()) applyMembershipQueryResult(refreshed);
        } catch {
          /* ignore - found local snapshot suffit */
        }
        if (!shouldContinue()) return;
        await resumeEveningSession({ force: true });
        if (!shouldContinue()) return;
        scheduleRender(true);
      } catch (err) {
        if (!shouldContinue()) return;
        resumeUnrecoverable = true;
        resumeErrorMessage = err?.message || "Impossible de reprendre la soirée.";
        await showAppAlert(resumeErrorMessage, {
          title: "Reprise",
          icon: "⚠️",
        });
        if (!shouldContinue()) return;
        scheduleRender(true);
      } finally {
        if (btn?.isConnected) btn.disabled = false;
      }
      return;
    }

    if (e.target.closest("#btn-pending-leave-remote")) {
      const btn = e.target.closest("#btn-pending-leave-remote");
      btn.disabled = true;
      try {
        const res = await resolvePendingMembershipByLeave({
          deleteOwnLobbyMembershipById,
        });
        if (!shouldContinue()) return;
        if (!res.ok) {
          await showAppAlert(res.error || "Impossible de quitter ce lobby.", {
            title: "Connexion inachevée",
            icon: "⚠️",
          });
          if (!shouldContinue()) return;
          scheduleRender(true);
          return;
        }
        membershipReconciliationConflict = null;
        await resolveHomeMembership({ force: true });
      } finally {
        if (btn?.isConnected) btn.disabled = false;
      }
      return;
    }

    if (e.target.closest("#btn-pending-join-remote")) {
      const btn = e.target.closest("#btn-pending-join-remote");
      btn.disabled = true;
      try {
        const code =
          membershipReconciliationConflict?.remoteCode ||
          currentMembershipChrome().membershipCode ||
          "";
        if (!code) {
          await showAppAlert("Code lobby introuvable.", {
            title: "Connexion inachevée",
            icon: "⚠️",
          });
          return;
        }
        const joinRes = await joinLobby(code);
        if (!shouldContinue()) return;
        if (!joinRes?.ok) {
          await showAppAlert(joinRes.error || "Impossible de rejoindre ce lobby.", {
            title: "Connexion inachevée",
            icon: "⚠️",
          });
          if (!shouldContinue()) return;
          scheduleRender(true);
          return;
        }
        clearPendingLobbyMembershipCompensationIfMatches(
          membershipReconciliationConflict?.remoteLobbyId
        );
        membershipReconciliationConflict = null;
        await navigateAfterLobbyJoin(joinRes.code);
      } finally {
        if (btn?.isConnected) btn.disabled = false;
      }
      return;
    }

    if (e.target.closest("#btn-membership-retry")) {
      const btn = e.target.closest("#btn-membership-retry");
      btn.disabled = true;
      try {
        leaveConfirmationPending = false;
        await resolveHomeMembership({ force: true });
      } finally {
        if (btn?.isConnected) btn.disabled = false;
      }
      return;
    }

    if (e.target.closest("#btn-leave-lobby-server")) {
      if (serverLeaveInFlight) return;
      if (hasActiveLobby()) return;

      const snap = getMembershipSnapshot();
      const membership = snap?.status === "found" ? snap.membership : null;
      if (!membership?.lobbyId || !membership?.role) return;

      const confirmCfg =
        membership.role === "host"
          ? SERVER_LEAVE_CONFIRM.host
          : SERVER_LEAVE_CONFIRM.member;
      const confirmed = await showAppConfirm(confirmCfg.message, {
        title: confirmCfg.title,
        confirmLabel: confirmCfg.confirmLabel,
        cancelLabel: confirmCfg.cancelLabel,
        icon: confirmCfg.icon,
      });
      if (!confirmed) return;
      if (!shouldContinue()) return;

      serverLeaveInFlight = true;
      scheduleRender(true);

      try {
        await leaveLobbyMembershipFromServer({
          lobbyId: membership.lobbyId,
          code: membership.code,
          role: membership.role,
        });
        if (!shouldContinue()) return;

        // Retirer le found B avant confirmation - évite retain_found trompeur (Vague D).
        // beginPostLeave déjà fait dans leaveLobbyMembershipFromServer.
        const leaveGen = getPostLeaveHomeTransitionGeneration();
        commitMembershipRemoved({
          userId: getSupabaseUserId(),
          lobbyId: membership.lobbyId,
        });
        retainedFoundDespiteUnknown = false;

        const confirmResult = await queryActiveLobbyMembership();
        if (!shouldContinue()) return;

        if (confirmResult.status === "unknown") {
          // Pas de faux none ; pas de found ressuscité. Pending avant fin soft-hold.
          leaveConfirmationPending = true;
          endPostLeaveHomeTransition(leaveGen);
          applyMembershipQueryResult(confirmResult);
          await showAppAlert(
            "La sortie a probablement réussi, mais la vérification est impossible. Réessaie avant de créer un lobby.",
            { title: "Vérification", icon: "⚠️" }
          );
          if (!shouldContinue()) return;
          scheduleRender(true);
          return;
        }

        leaveConfirmationPending = false;
        applyMembershipQueryResult(confirmResult);
        endPostLeaveHomeTransition(leaveGen);

        if (confirmResult.status === "found") {
          await showAppAlert(
            `Tu es encore rattaché au lobby ${confirmResult.membership?.code || "?"}. Créer reste indisponible.`,
            { title: "Membership restante", icon: "ℹ️" }
          );
        }
        if (!shouldContinue()) return;
        scheduleRender(true);
      } catch (err) {
        if (!shouldContinue()) return;
        endPostLeaveHomeTransition();

        if (err?.code === LOBBY_SERVER_LEAVE_ERROR.ROLE_MISMATCH) {
          try {
            const requery = await queryActiveLobbyMembership();
            if (shouldContinue()) applyMembershipQueryResult(requery);
          } catch {
            /* ignore */
          }
          await showAppAlert(
            err.message || "Ton rôle a changé. Actualisation effectuée.",
            { title: "Rôle obsolète", icon: "⚠️" }
          );
          if (!shouldContinue()) return;
          scheduleRender(true);
          return;
        }

        // Échec mutation : conserver found, Créer off, retry possible.
        await showAppAlert(
          err?.message || "Impossible de quitter ou fermer le lobby.",
          {
            title:
              membership.role === "host" ? "Fermer le lobby" : "Quitter le lobby",
            icon: "⚠️",
          }
        );
        if (!shouldContinue()) return;
        scheduleRender(true);
      } finally {
        serverLeaveInFlight = false;
        if (shouldContinue()) scheduleRender(true);
      }
      return;
    }

    if (e.target.closest("#btn-leave-lobby")) {
      const btn = e.target.closest("#btn-leave-lobby");
      btn.disabled = true;
      const res = await confirmAndLeaveLobby();
      if (!shouldContinue()) return;
      btn.disabled = false;
      if (res.cancelled) return;
      if (!res.ok) {
        await notifyVoluntaryLeaveFailure(res);
        return;
      }
      // Après leave local : rafraîchir membership serveur (Vague C/D gèrent la sortie serveur).
      void resolveHomeMembership({ force: true });
      scheduleRender(true);
      return;
    }

    if (e.target.closest("#btn-create-lobby")) {
      const btn = e.target.closest("#btn-create-lobby");
      // DOM disabled / chrome / canCreateLobby : triple garde synchrone.
      if (btn?.disabled || btn?.getAttribute("aria-disabled") === "true") return;
      if (!currentMembershipChrome().createEnabled || !canCreateLobby()) return;
      if (createLobbyInFlight) return;
      createLobbyInFlight = true;
      btn.disabled = true;
      try {
        await createLobby();
        if (!shouldContinue()) return;
        navigate("lobby");
      } catch (err) {
        if (!shouldContinue()) return;
        if (err?.code === LOBBY_CREATE_ERROR.ALREADY_EXISTS) {
          await showAppAlert(
            err.message || "Une soirée est déjà active. Reconnexion…",
            {
              title: "Lobby existant",
              icon: "⚠️",
            }
          );
          if (!shouldContinue()) return;
          scheduleRender(true);
          return;
        }
        if (err?.code === LOBBY_CREATE_ERROR.CHECK_FAILED) {
          await showAppAlert(
            err.message || "Impossible de vérifier votre situation. Réessayez.",
            {
              title: "Vérification impossible",
              icon: "⚠️",
            }
          );
          if (!shouldContinue()) return;
          scheduleRender(true);
          return;
        }
        await showAppAlert(err.message || "Impossible de créer le lobby.", {
          title: "Erreur",
          icon: "⚠️",
        });
        if (!shouldContinue()) return;
        scheduleRender(true);
      } finally {
        createLobbyInFlight = false;
        if (btn?.isConnected) btn.disabled = false;
      }
      return;
    }

    if (e.target.closest("#btn-join-lobby")) {
      if (!isLoggedIn()) return;
      const btn = e.target.closest("#btn-join-lobby");
      btn.disabled = true;
      const pendingToken = syncPending.start();
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
        syncPending.end(pendingToken);
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
      const pendingToken = syncPending.start();

      try {
        const captchaToken =
          isTurnstileRequired() && isTurnstileSolved("guest") ? getTurnstileToken("guest") : null;
        const res = await joinLobbyAsGuest(
          codeEl?.value,
          nameEl?.value,
          captchaToken,
          selectedGuestEmoji
        );

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
      } finally {
        syncPending.end(pendingToken);
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
    if (!shouldContinue()) return;
    if (cleared) scheduleRender(true);
    // Query canonique : snapshot écrit selon politique found/unknown ; paint si mount courant.
    await resolveHomeMembership({ force: false });
  })();

  if (isGameSyncActive() && hasActiveLobby()) {
    unsubSession = onGameSessionChange(async (row) => {
      if (!shouldContinue()) return;
      if (getCurrentScreen() !== "home") return;
      tryFollowHostGameSession(row);
      // Ne pas court-circuiter sur isSessionRouteSuppressed : shouldApply/mustFollow décide.
      if (await routeToActiveGameIfNeeded(row)) return;
      if (!shouldContinue()) return;
      scheduleRender(false);
    });
  }

  return () => {
    syncPending.dispose();
    mount.dispose();
    app.removeEventListener("click", onHomeClick);
    unsubSession();
    if (renderTimer) clearTimeout(renderTimer);
    if (forgotCooldownTimer) clearInterval(forgotCooldownTimer);
    removeAllTurnstile();
    // Snapshot membership volontairement non invalidé : survit au remount Home (même onglet).
  };
}
