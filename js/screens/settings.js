import {
  canPlay,
  isEmailAccount,
  getUser,
  updateProfileName,
  updateProfileEmoji,
  changeEmailPassword,
} from "../core/auth.js";
import { getLocalDisplayName, getLocalEmoji } from "../core/state.js";
import { PROFILE_EMOJI_CHOICES } from "../../data/profileEmojis.js";
import {
  hasActiveLobby,
  getLobby,
  getLobbyParticipants,
  confirmAndLeaveLobby,
  notifyVoluntaryLeaveFailure,
  transferLobbyHost,
  canManageLobbyRoster,
  kickLobbyMember,
  isVoluntaryLeaveInFlight,
} from "../core/lobby.js";
import { isLobbyHost } from "../core/gameSync.js";
import { isSupabaseConfigured } from "../core/supabaseClient.js";
import { onLobbyBundleUpdated } from "../core/supabaseLobby.js";
import { showLobbyPlayersManageDialog } from "../core/dialog.js";
import { MAX_PLAYERS } from "../config/lobbyLifecycle.js";
import { lobbySettingsActionsForRole } from "../core/partySettingsMenu.js";
import { navigate, getCurrentScreen } from "../core/router.js";
import { escapeHtml, pageShell } from "../core/ui.js";
import { INSTAGRAM_HANDLE, INSTAGRAM_PROFILE_URL, ACCOUNT_DELETION_PUBLIC_URL } from "../../data/appConfig.js";
import { openExternalUrl } from "../core/openExternal.js";
import { openInstagramProfile } from "../core/feedbackUi.js";
import { createMountGuard } from "../core/mountLifecycle.js";
import { bindNav, returnFromEveningProfile } from "./nav.js";

const TAB_PERSONNALISATION = "personnalisation";
const TAB_SOIREE = "soiree";
const TAB_SUPPORT = "support";

function localLobbyRole() {
  if (!hasActiveLobby()) return null;
  return isLobbyHost() ? "host" : "member";
}

function partySectionSnapshot() {
  if (!hasActiveLobby()) return "none";
  const others = getLobbyParticipants().filter((p) => !p.isLocal && p.userId);
  return JSON.stringify({
    code: getLobby()?.code || "",
    role: localLobbyRole(),
    n: getLobbyParticipants().length,
    canTransfer: others.length > 0,
    canRoster: canManageLobbyRoster(),
    sync: isSupabaseConfigured() && Boolean(getLobby()?.id),
  });
}

function settingsTabIndex(activeTab) {
  if (activeTab === TAB_SOIREE) return 0;
  if (activeTab === TAB_PERSONNALISATION) return 1;
  return 2;
}

function settingsTabsHtml(activeTab, inLobby) {
  const soireeDisabled = !inLobby;
  const tabIndex = settingsTabIndex(activeTab);
  return `
    <div class="settings-tabs" role="tablist" aria-label="Sections des paramètres" style="--settings-tab-index:${tabIndex}">
      <span class="settings-tabs__cursor" aria-hidden="true"></span>
      <button type="button" class="settings-tabs__btn${
        activeTab === TAB_SOIREE ? " settings-tabs__btn--active" : ""
      }${soireeDisabled ? " settings-tabs__btn--disabled" : ""}" role="tab" data-settings-tab="${TAB_SOIREE}" aria-selected="${
        activeTab === TAB_SOIREE ? "true" : "false"
      }"${soireeDisabled ? ' aria-disabled="true" disabled title="Rejoins un lobby pour gérer la soirée"' : ""}>
        <span class="settings-tabs__icon" aria-hidden="true">🎉</span>
        <span class="settings-tabs__label">Soirée</span>
      </button>
      <button type="button" class="settings-tabs__btn${
        activeTab === TAB_PERSONNALISATION ? " settings-tabs__btn--active" : ""
      }" role="tab" data-settings-tab="${TAB_PERSONNALISATION}" aria-selected="${
        activeTab === TAB_PERSONNALISATION ? "true" : "false"
      }">
        <span class="settings-tabs__icon" aria-hidden="true">✨</span>
        <span class="settings-tabs__label">Profil</span>
      </button>
      <button type="button" class="settings-tabs__btn${
        activeTab === TAB_SUPPORT ? " settings-tabs__btn--active" : ""
      }" role="tab" data-settings-tab="${TAB_SUPPORT}" aria-selected="${
        activeTab === TAB_SUPPORT ? "true" : "false"
      }">
        <span class="settings-tabs__icon" aria-hidden="true">💬</span>
        <span class="settings-tabs__label">Support</span>
      </button>
    </div>`;
}

function partySectionHtml() {
  const code = getLobby()?.code || "";
  const role = localLobbyRole();
  const actions = lobbySettingsActionsForRole(role || "member");
  const others = getLobbyParticipants().filter((p) => !p.isLocal && p.userId);
  const canTransfer = others.length > 0;
  const mpReady = isSupabaseConfigured() && Boolean(getLobby()?.id);

  const hostActions = actions.includes("transfer")
    ? `
        <button type="button" class="btn btn-secondary btn--spaced settings-party__btn" data-settings-party="transfer"${
          !mpReady || !canTransfer ? " disabled" : ""
        } title="${canTransfer ? "" : "Ajoute un autre joueur"}">
          👑 Transférer l'hôte
        </button>
        <button type="button" class="btn btn-secondary btn--spaced settings-party__btn" data-settings-party="players"${
          !mpReady ? " disabled" : ""
        }>
          👥 Gestion des joueurs
        </button>
        <div class="settings-party__danger">
          <button type="button" class="btn btn-secondary btn--spaced settings-party__btn settings-party__btn--danger" data-settings-party="close"${
            !mpReady ? " disabled" : ""
          }>
            🚪 Fermer le lobby
          </button>
        </div>`
    : `
        <div class="settings-party__danger">
          <button type="button" class="btn btn-secondary btn--spaced settings-party__btn settings-party__btn--danger" data-settings-party="leave"${
            !mpReady || isVoluntaryLeaveInFlight() ? " disabled" : ""
          }>
            🚪 Quitter le lobby
          </button>
        </div>`;

  return `
    <div class="card settings-section settings-party" id="settings-party-section">
      <h2 class="settings-section__title">Partie en cours</h2>
      <p class="hint settings-section__hint">
        Lobby <strong>${escapeHtml(code || "—")}</strong>
        ${role === "host" ? " · tu es l'hôte" : " · tu es membre"}
      </p>
      ${
        !mpReady
          ? `<p class="hint">Actions lobby disponibles en multijoueur en ligne.</p>`
          : ""
      }
      <div class="settings-party__actions">
        ${hostActions}
      </div>
    </div>`;
}

function soireePanelHtml(inLobby) {
  if (!inLobby) {
    return `
      <div class="settings-panel settings-panel--soiree-disabled" id="settings-panel-soiree">
        <div class="card settings-section">
          <h2 class="settings-section__title">Soirée en cours</h2>
          <p class="hint settings-section__hint">
            Aucune soirée active. Rejoins ou crée un lobby pour gérer la partie ici.
          </p>
        </div>
      </div>`;
  }

  const lobbyCode = getLobby()?.code || "";
  return `
    <div class="settings-panel" id="settings-panel-soiree">
      <div class="card card--highlight settings-lobby-banner">
        <p class="hint settings-lobby-banner__text">
          Soirée en cours - lobby <strong>${escapeHtml(lobbyCode || "")}</strong>.
          Pseudo et emoji s’appliquent pour tout le monde.
        </p>
        <button type="button" class="btn btn-accent btn--spaced" data-nav="evening-return">Retour aux jeux</button>
      </div>
      ${partySectionHtml()}
    </div>`;
}

function personnalisationPanelHtml({ emailAccount, user, selectedEmoji }) {
  return `
    <div class="settings-panel" id="settings-panel-personnalisation">
      <div class="card settings-section">
        <h2 class="settings-section__title">Pseudo</h2>
        <p class="hint settings-section__hint">Visible dans le lobby et les scores.</p>
        <label class="field-label" for="settings-name">Ton pseudo</label>
        <input type="text" class="field-input" id="settings-name" maxlength="24" value="${escapeHtml(getLocalDisplayName())}" />
        <p class="auth-error hidden" id="name-error"></p>
        <p class="settings-ok hidden" id="name-ok">Pseudo enregistré.</p>
        <button type="button" class="btn btn-primary btn--spaced" id="btn-save-name">Enregistrer le pseudo</button>
      </div>

      <div class="card settings-section">
        <h2 class="settings-section__title">Emoji</h2>
        <p class="hint settings-section__hint">Affiché dans le lobby et les classements.</p>
        <div class="emoji-picker-preview">
          <span class="emoji-picker-preview__avatar" id="emoji-preview">${selectedEmoji}</span>
          <span class="hint">Aperçu de ton avatar</span>
        </div>
        <div class="emoji-picker" role="listbox" aria-label="Choisir un emoji">
          ${PROFILE_EMOJI_CHOICES.map(
            (e) => `
            <button type="button" class="emoji-picker__btn ${e === selectedEmoji ? "emoji-picker__btn--active" : ""}" data-emoji="${e}" aria-label="${e}">${e}</button>`
          ).join("")}
        </div>
        <p class="auth-error hidden" id="emoji-error"></p>
        <p class="settings-ok hidden" id="emoji-ok">Emoji enregistré.</p>
      </div>

      ${
        emailAccount
          ? `
      <div class="card settings-section">
        <h2 class="settings-section__title">Mot de passe</h2>
        <p class="hint settings-section__hint">Compte ${escapeHtml(user.email)}</p>
        <label class="field-label" for="pwd-current">Mot de passe actuel</label>
        <input type="password" class="field-input" id="pwd-current" autocomplete="current-password" />
        <label class="field-label" for="pwd-new">Nouveau mot de passe</label>
        <input type="password" class="field-input" id="pwd-new" autocomplete="new-password" placeholder="4 caractères min." />
        <label class="field-label" for="pwd-confirm">Confirmer</label>
        <input type="password" class="field-input" id="pwd-confirm" autocomplete="new-password" />
        <p class="auth-error hidden" id="pwd-error"></p>
        <p class="settings-ok hidden" id="pwd-ok">Mot de passe mis à jour.</p>
        <button type="button" class="btn btn-primary btn--spaced" id="btn-save-password">Changer le mot de passe</button>
      </div>`
          : user.loggedIn
            ? `<p class="hint settings-social-hint">Compte ${escapeHtml(user.provider || "social")} - le mot de passe se gère chez le fournisseur.</p>`
            : ""
      }
    </div>`;
}

function supportPanelHtml() {
  return `
    <div class="settings-panel" id="settings-panel-support">
      <div class="card settings-section feedback-prompt">
        <h2 class="settings-section__title">Aide &amp; retours</h2>
        <p class="hint feedback-prompt__hint">
          Un bug, une idée de jeu ou un mot à ajouter ? Écris-nous sur Instagram
          <strong>@${escapeHtml(INSTAGRAM_HANDLE)}</strong>.
        </p>
        <button type="button" class="btn btn-accent feedback-prompt__btn btn--spaced" id="btn-feedback-dm">Envoie un DM</button>
      </div>

      <div class="card settings-section">
        <h2 class="settings-section__title">Légal</h2>
        <p class="hint settings-section__hint">Politique de confidentialité (RGPD, AdMob, Supabase).</p>
        <p class="hint settings-section__hint">
          Contact RGPD :
        <a
          class="settings-instagram-link"
          href="${escapeHtml(INSTAGRAM_PROFILE_URL)}"
          target="_blank"
          rel="noopener noreferrer"
          data-open-instagram
        >@${escapeHtml(INSTAGRAM_HANDLE)}</a>
        </p>
        <button type="button" class="btn btn-secondary btn--spaced" data-nav="privacy">Politique de confidentialité</button>
        <button type="button" class="btn btn-secondary btn--spaced" id="btn-delete-account">Supprimer mon compte</button>
        <p class="hint settings-section__hint">
          Suppression définitive du compte e-mail et des données associées.
        </p>
      </div>
    </div>`;
}

export function mountSettings(app) {
  if (!canPlay()) {
    navigate("home", { reset: true });
    return null;
  }

  const mount = createMountGuard();
  const user = getUser();
  const emailAccount = isEmailAccount();

  let selectedEmoji = getLocalEmoji();
  let activeTab = hasActiveLobby() ? TAB_SOIREE : TAB_PERSONNALISATION;
  let lastPartySnap = "";
  let lastLobbyActive = hasActiveLobby();
  let partyActionInFlight = false;

  function bindPersonnalisationEvents() {
    app.querySelectorAll(".emoji-picker__btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!mount.isMounted()) return;
        const emoji = btn.getAttribute("data-emoji");
        const err = app.querySelector("#emoji-error");
        const ok = app.querySelector("#emoji-ok");
        const res = await updateProfileEmoji(emoji);
        if (!mount.isMounted()) return;
        if (!res.ok) {
          if (err) {
            err.textContent = res.error || "Impossible d'enregistrer l'emoji.";
            err.classList.remove("hidden");
          }
          ok?.classList.add("hidden");
          return;
        }

        err?.classList.add("hidden");
        selectedEmoji = res.emoji;
        app.querySelector("#emoji-preview").textContent = res.emoji;
        app.querySelectorAll(".emoji-picker__btn").forEach((b) => {
          b.classList.toggle("emoji-picker__btn--active", b === btn);
        });
        ok?.classList.remove("hidden");
      });
    });

    app.querySelector("#btn-save-name")?.addEventListener("click", async () => {
      if (!mount.isMounted()) return;
      const err = app.querySelector("#name-error");
      const ok = app.querySelector("#name-ok");
      const res = await updateProfileName(app.querySelector("#settings-name").value);
      if (!mount.isMounted()) return;
      if (!res.ok) {
        err.textContent = res.error;
        err.classList.remove("hidden");
        ok?.classList.add("hidden");
        return;
      }
      err.classList.add("hidden");
      ok?.classList.remove("hidden");
      app.querySelector("#settings-name").value = res.name;
    });

    app.querySelector("#btn-save-password")?.addEventListener("click", async () => {
      if (!mount.isMounted()) return;
      const err = app.querySelector("#pwd-error");
      const ok = app.querySelector("#pwd-ok");
      err.classList.add("hidden");
      ok?.classList.add("hidden");

      const current = app.querySelector("#pwd-current").value;
      const next = app.querySelector("#pwd-new").value;
      const confirm = app.querySelector("#pwd-confirm").value;

      if (next !== confirm) {
        err.textContent = "Les deux mots de passe ne correspondent pas.";
        err.classList.remove("hidden");
        return;
      }

      const res = await changeEmailPassword(current, next);
      if (!mount.isMounted()) return;
      if (!res.ok) {
        err.textContent = res.error;
        err.classList.remove("hidden");
        return;
      }

      app.querySelector("#pwd-current").value = "";
      app.querySelector("#pwd-new").value = "";
      app.querySelector("#pwd-confirm").value = "";
      ok?.classList.remove("hidden");
    });
  }

  function bindSupportEvents() {
    app.querySelector("#btn-feedback-dm")?.addEventListener("click", () => {
      openInstagramProfile();
    });

    const openDeletionPage = (e) => {
      e?.preventDefault();
      openExternalUrl(ACCOUNT_DELETION_PUBLIC_URL);
    };
    app.querySelector("#btn-delete-account")?.addEventListener("click", openDeletionPage);

    app.querySelector("[data-open-instagram]")?.addEventListener("click", (e) => {
      e.preventDefault();
      openInstagramProfile();
    });
  }

  async function onPartyAction(action) {
    if (!mount.isMounted() || partyActionInFlight) return;
    if (getCurrentScreen() !== "settings") return;
    if (!hasActiveLobby()) return;

    partyActionInFlight = true;
    try {
      if (action === "transfer") {
        await transferLobbyHost();
        if (mount.isMounted()) refreshSoireePanel(true);
        return;
      }
      if (action === "players") {
        await showLobbyPlayersManageDialog({
          getParticipants: () => getLobbyParticipants(),
          maxPlayers: MAX_PLAYERS,
          canKick: canManageLobbyRoster(),
          onKick: (userId, name) => kickLobbyMember(userId, { confirmName: name }),
        });
        if (mount.isMounted()) refreshSoireePanel(true);
        return;
      }
      if (action === "close" || action === "leave") {
        const res = await confirmAndLeaveLobby({ navigateAway: true });
        if (!mount.isMounted()) return;
        if (res.cancelled) {
          refreshSoireePanel(true);
          return;
        }
        if (!res.ok) {
          await notifyVoluntaryLeaveFailure(res);
          if (mount.isMounted()) refreshSoireePanel(true);
          return;
        }
        return;
      }
    } finally {
      partyActionInFlight = false;
    }
  }

  function bindSoireeEvents() {
    app.querySelector("#settings-party-section")?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-settings-party]");
      if (!btn || btn.disabled) return;
      void onPartyAction(btn.getAttribute("data-settings-party"));
    });
  }

  function bindTabEvents() {
    app.querySelector(".settings-tabs")?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-settings-tab]");
      if (!btn || btn.disabled) return;
      const tab = btn.getAttribute("data-settings-tab");
      if (tab === TAB_SOIREE && !hasActiveLobby()) return;
      if (tab === activeTab) return;
      activeTab = tab;
      paintTabChrome();
      swapActivePanel();
    });
  }

  function paintTabChrome() {
    const tabs = app.querySelector(".settings-tabs");
    if (!tabs) return;
    tabs.style.setProperty("--settings-tab-index", String(settingsTabIndex(activeTab)));
    tabs.querySelectorAll("[data-settings-tab]").forEach((btn) => {
      const on = btn.getAttribute("data-settings-tab") === activeTab;
      btn.classList.toggle("settings-tabs__btn--active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
  }

  function swapActivePanel() {
    const inLobby = hasActiveLobby();
    selectedEmoji = getLocalEmoji();
    const panel = app.querySelector(".settings-panel");
    if (!panel) {
      render();
      return;
    }
    const html =
      activeTab === TAB_PERSONNALISATION
        ? personnalisationPanelHtml({ emailAccount, user, selectedEmoji })
        : activeTab === TAB_SOIREE
          ? soireePanelHtml(inLobby)
          : supportPanelHtml();
    panel.outerHTML = html;
    bindNav(app, {
      "evening-return": () => returnFromEveningProfile(),
    });
    if (activeTab === TAB_PERSONNALISATION) bindPersonnalisationEvents();
    if (activeTab === TAB_SOIREE) bindSoireeEvents();
    if (activeTab === TAB_SUPPORT) bindSupportEvents();
  }

  function syncTabChrome(inLobby) {
    const tabs = app.querySelector(".settings-tabs");
    if (!tabs) return;
    tabs.outerHTML = settingsTabsHtml(activeTab, inLobby);
    bindTabEvents();
  }

  function refreshSoireePanel(force = false) {
    if (!mount.isMounted()) return;
    const inLobby = hasActiveLobby();
    const snap = partySectionSnapshot();
    const lobbyChanged = inLobby !== lastLobbyActive;

    if (!force && snap === lastPartySnap && !lobbyChanged) return;
    lastPartySnap = snap;
    lastLobbyActive = inLobby;

    if (!inLobby && activeTab === TAB_SOIREE) {
      activeTab = TAB_PERSONNALISATION;
      render();
      return;
    }

    syncTabChrome(inLobby);

    if (activeTab !== TAB_SOIREE) return;

    const panel = app.querySelector("#settings-panel-soiree");
    if (!panel) {
      render();
      return;
    }
    panel.outerHTML = soireePanelHtml(inLobby);
    bindNav(app, {
      "evening-return": () => returnFromEveningProfile(),
    });
    bindSoireeEvents();
  }

  function render() {
    if (!mount.isMounted()) return;
    selectedEmoji = getLocalEmoji();
    const inLobby = hasActiveLobby();
    lastLobbyActive = inLobby;
    lastPartySnap = partySectionSnapshot();

    if (!inLobby && activeTab === TAB_SOIREE) {
      activeTab = TAB_PERSONNALISATION;
    }

    app.innerHTML = pageShell({
      back: true,
      backTarget: inLobby ? "back" : "home",
      content: `
        <p class="label-upper label-upper--gold">⚙️ Paramètres</p>
        <h1 class="page-title">Paramètres</h1>
        ${settingsTabsHtml(activeTab, inLobby)}
        ${
          activeTab === TAB_PERSONNALISATION
            ? personnalisationPanelHtml({ emailAccount, user, selectedEmoji })
            : activeTab === TAB_SOIREE
              ? soireePanelHtml(inLobby)
              : supportPanelHtml()
        }
      `,
    });

    bindTabEvents();
    bindNav(app, {
      "evening-return": () => returnFromEveningProfile(),
    });

    if (activeTab === TAB_PERSONNALISATION) bindPersonnalisationEvents();
    if (activeTab === TAB_SOIREE) bindSoireeEvents();
    if (activeTab === TAB_SUPPORT) bindSupportEvents();
  }

  render();

  const unsubLobby = onLobbyBundleUpdated(() => {
    if (!mount.isMounted()) return;
    if (getCurrentScreen() !== "settings") return;
    refreshSoireePanel(false);
  });

  return () => {
    mount.dispose();
    unsubLobby();
  };
}
