import {
  canPlay,
  isEmailAccount,
  isLoggedIn,
  getUser,
  updateProfileName,
  updateProfileEmoji,
  updateProfileNameColor,
  changeEmailPassword,
  logout,
} from "../core/auth.js";
import { PACK_SIGNATURE_LABEL } from "../config/premiumPacks.js";
import { SETTINGS_TAB } from "../config/settingsTabs.js";
import { refreshAdsForEntitlement } from "../core/ads.js";
import { adFreeSettingsCardHtml } from "../core/adFreeUi.js";
import { profilePackSettingsCardHtml } from "../core/profilePackUi.js";
import { purchaseAdFree, purchaseProfile, restorePremiumPurchases } from "../core/purchases.js";
import { getLocalDisplayName, getLocalEmoji } from "../core/state.js";
import { resolvedNameColorHex } from "../../data/signatureIdentity.js";
import {
  isLockedSignatureEmojiClick,
  isProfilePack,
  nameColorChipsHtml,
  playerAvatarHtml,
  profileEmojiPickerHtml,
  signatureSelfPreviewHtml,
} from "../core/signatureUi.js";
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
import { showAppAlert, showAppConfirm, showLobbyPlayersManageDialog } from "../core/dialog.js";
import { MAX_PLAYERS } from "../config/lobbyLifecycle.js";
import { lobbySettingsActionsForRole } from "../core/partySettingsMenu.js";
import { navigate, getCurrentScreen, getScreenParams } from "../core/router.js";
import { escapeHtml, pageShell } from "../core/ui.js";
import { createMountGuard } from "../core/mountLifecycle.js";
import { bindNav, returnFromEveningProfile } from "./nav.js";
import { FRIEND_LABEL, FRIENDS_ENTRY, FRIENDS_SCREEN_ID } from "../config/friends.js";
import { HELP_LEGAL_LABEL, HELP_LEGAL_SCREEN_ID } from "../config/helpLegal.js";
import { syncFriendsEntryBadges, flushFriendRequestNotice } from "../core/friendRequestNotice.js";
import { friendRosterActionHtml, lobbyFriendsHintHtml } from "../core/friendsRosterUi.js";
import {
  acceptLobbyFriendRequest,
  cancelLobbyFriendRequest,
  sendLobbyFriendRequest,
} from "../core/lobbyFriendActions.js";
import { onFriendsCacheUpdated } from "../core/friendsState.js";
import { fetchLobbyFriendOverlay } from "../core/supabaseFriends.js";
import { createActionLock } from "../core/actionLock.js";

const TAB_PERSONNALISATION = SETTINGS_TAB.PERSONNALISATION;
const TAB_SOIREE = SETTINGS_TAB.SOIREE;
const TAB_FORFAITS = SETTINGS_TAB.FORFAITS;

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

function initialSettingsTab() {
  const requested = getScreenParams()?.tab;
  if (requested === TAB_FORFAITS) return TAB_FORFAITS;
  if (requested === TAB_PERSONNALISATION) return TAB_PERSONNALISATION;
  if (requested === TAB_SOIREE && hasActiveLobby()) return TAB_SOIREE;
  return hasActiveLobby() ? TAB_SOIREE : TAB_PERSONNALISATION;
}

function settingsTabsHtml(activeTab, inLobby) {
  const soireeDisabled = !inLobby;
  const tabIndex = settingsTabIndex(activeTab);
  return `
    <div class="settings-tabs" role="tablist" aria-label="Sections du menu" style="--settings-tab-index:${tabIndex}">
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
        <span class="friends-badge" data-friends-badge hidden aria-hidden="true"></span>
      </button>
      <button type="button" class="settings-tabs__btn${
        activeTab === TAB_FORFAITS ? " settings-tabs__btn--active" : ""
      }" role="tab" data-settings-tab="${TAB_FORFAITS}" aria-selected="${
        activeTab === TAB_FORFAITS ? "true" : "false"
      }">
        <span class="settings-tabs__icon" aria-hidden="true">⭐</span>
        <span class="settings-tabs__label">Forfaits</span>
      </button>
    </div>`;
}

function partySectionHtml() {
  const code = getLobby()?.code || "";
  const role = localLobbyRole();
  const registered = isLoggedIn();
  const actions = lobbySettingsActionsForRole(role || "member", {
    localIsRegistered: registered,
  });
  const others = getLobbyParticipants().filter((p) => !p.isLocal && p.userId);
  const canTransfer = others.length > 0;
  const mpReady = isSupabaseConfigured() && Boolean(getLobby()?.id);

  const playersBtn = actions.includes("players")
    ? `<button type="button" class="btn btn-secondary btn--spaced settings-party__btn" data-settings-party="players"${
        !mpReady ? " disabled" : ""
      }>
          👥 ${role === "host" ? "Gestion des joueurs" : "Joueurs"}
        </button>`
    : "";
  const transferBtn = actions.includes("transfer")
    ? `<button type="button" class="btn btn-secondary btn--spaced settings-party__btn" data-settings-party="transfer"${
        !mpReady || !canTransfer ? " disabled" : ""
      } title="${canTransfer ? "" : "Ajoute un autre joueur"}">
          👑 Transférer l'hôte
        </button>`
    : "";
  const closeBtn = actions.includes("close")
    ? `<button type="button" class="btn btn-secondary btn--spaced settings-party__btn settings-party__btn--danger" data-settings-party="close"${
        !mpReady ? " disabled" : ""
      }>
            🚪 Fermer le lobby
          </button>`
    : "";
  const leaveBtn = actions.includes("leave")
    ? `<button type="button" class="btn btn-secondary btn--spaced settings-party__btn settings-party__btn--danger" data-settings-party="leave"${
        !mpReady || isVoluntaryLeaveInFlight() ? " disabled" : ""
      }>
            🚪 Quitter le lobby
          </button>`
    : "";
  const danger = closeBtn || leaveBtn
    ? `<div class="settings-party__danger">${closeBtn}${leaveBtn}</div>`
    : "";

  return `
    <div class="card settings-section settings-party" id="settings-party-section">
      <h2 class="settings-section__title">Partie en cours</h2>
      <p class="hint settings-section__hint">
        Lobby <strong>${escapeHtml(code || "-")}</strong>
        ${role === "host" ? " · tu es l'hôte" : " · tu es membre"}
      </p>
      ${
        !mpReady
          ? `<p class="hint">Actions lobby disponibles en multijoueur en ligne.</p>`
          : ""
      }
      <div class="settings-party__actions">
        ${transferBtn}
        ${playersBtn}
        ${danger}
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

function profileLogoutSectionHtml(user) {
  const label = user.isGuest ? "Quitter la session" : "Se déconnecter";
  return `
      <button type="button" class="btn btn-secondary settings-party__btn settings-party__btn--danger" id="btn-settings-logout">
        ${escapeHtml(label)}
      </button>`;
}

function premiumRestoreButtonHtml(user) {
  if (!user?.loggedIn || user.isGuest) return "";
  return `
      <button type="button" class="btn btn-secondary btn--spaced" id="btn-premium-restore">Restaurer les achats</button>`;
}

function personnalisationPanelHtml({ emailAccount, user, selectedEmoji }) {
  const unlocked = isProfilePack();
  const selectedColor = user?.nameColor || null;
  const previewPlayer = {
    name: getLocalDisplayName(),
    emoji: selectedEmoji,
    color: "#60A5FA",
    nameColor: selectedColor,
    signature: unlocked,
  };
  return `
    <div class="settings-panel" id="settings-panel-personnalisation">
      <div class="card settings-section">
        <button type="button" class="btn btn-secondary friends-entry" data-nav="${FRIENDS_SCREEN_ID}" data-friends-entry="${FRIENDS_ENTRY.settingsProfile}">
          ${escapeHtml(FRIEND_LABEL.entrySettings)}
          <span class="friends-badge" data-friends-badge hidden aria-hidden="true"></span>
        </button>
      </div>
      <div class="card settings-section">
        <h2 class="settings-section__title">Pseudo</h2>
        <p class="hint settings-section__hint">Visible dans le lobby et les scores.</p>
        ${signatureSelfPreviewHtml(previewPlayer)}
        <label class="field-label" for="settings-name">Ton pseudo</label>
        <input type="text" class="field-input" id="settings-name" maxlength="24" value="${escapeHtml(getLocalDisplayName())}" ${
          resolvedNameColorHex(previewPlayer)
            ? `style="color:${resolvedNameColorHex(previewPlayer)}"`
            : ""
        } />
        ${nameColorChipsHtml(selectedColor, { unlocked })}
        <p class="auth-error hidden" id="name-error"></p>
        <p class="settings-ok hidden" id="name-ok">Pseudo enregistré.</p>
        <p class="settings-ok hidden" id="color-ok">Couleur enregistrée.</p>
        <button type="button" class="btn btn-primary btn--spaced" id="btn-save-name">Enregistrer le pseudo</button>
      </div>

      <div class="card settings-section">
        <h2 class="settings-section__title">Emoji</h2>
        <p class="hint settings-section__hint">Affiché dans le lobby et les classements.</p>
        <div class="emoji-picker-preview">
          ${playerAvatarHtml(previewPlayer, "emoji-picker-preview__avatar")}
          <span class="hint">Aperçu de ton avatar</span>
        </div>
        ${profileEmojiPickerHtml(selectedEmoji, { includeSignatureExtras: !user?.isGuest, unlocked })}
        <p class="auth-error hidden" id="emoji-error"></p>
        <p class="settings-ok hidden" id="emoji-ok">Emoji enregistré.</p>
        ${
          unlocked
            ? ""
            : `<button type="button" class="btn btn-secondary btn--spaced" data-settings-goto="${TAB_FORFAITS}">Voir les forfaits</button>`
        }
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
      <button type="button" class="btn btn-secondary settings-party__btn" data-nav="${HELP_LEGAL_SCREEN_ID}">
        ${escapeHtml(HELP_LEGAL_LABEL)}
      </button>
      ${profileLogoutSectionHtml(user)}
    </div>`;
}

function forfaitsPanelHtml(user) {
  const unlocked = isProfilePack();
  return `
    <div class="settings-panel" id="settings-panel-forfaits">
      ${adFreeSettingsCardHtml()}
      ${profilePackSettingsCardHtml()}
      ${premiumRestoreButtonHtml(user)}
      ${
        unlocked
          ? `<button type="button" class="btn btn-secondary btn--spaced" data-settings-goto="${TAB_PERSONNALISATION}">Personnaliser le profil</button>`
          : ""
      }
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
  let activeTab = initialSettingsTab();
  let lastPartySnap = "";
  let lastLobbyActive = hasActiveLobby();
  let partyActionInFlight = false;
  const friendLock = createActionLock();

  function goToSettingsTab(tab) {
    if (!tab || tab === activeTab) return;
    if (tab === TAB_SOIREE && !hasActiveLobby()) return;
    activeTab = tab;
    paintTabChrome();
    swapActivePanel();
  }

  function bindSettingsGoto() {
    app.querySelectorAll("[data-settings-goto]").forEach((btn) => {
      btn.addEventListener("click", () => {
        goToSettingsTab(btn.getAttribute("data-settings-goto"));
      });
    });
  }

  function settingsPanelHtml(inLobby) {
    if (activeTab === TAB_PERSONNALISATION) {
      return personnalisationPanelHtml({ emailAccount, user, selectedEmoji });
    }
    if (activeTab === TAB_FORFAITS) return forfaitsPanelHtml(user);
    if (activeTab === TAB_SOIREE) return soireePanelHtml(inLobby);
    return personnalisationPanelHtml({ emailAccount, user, selectedEmoji });
  }

  function bindActivePanelEvents() {
    if (activeTab === TAB_PERSONNALISATION) bindPersonnalisationEvents();
    if (activeTab === TAB_FORFAITS) bindForfaitsEvents();
    if (activeTab === TAB_SOIREE) bindSoireeEvents();
  }

  function bindPersonnalisationEvents() {
    function goToForfaitsTab() {
      goToSettingsTab(TAB_FORFAITS);
    }

    function currentPreviewPlayer() {
      return {
        name: app.querySelector("#settings-name")?.value?.trim() || getLocalDisplayName(),
        emoji: selectedEmoji,
        color: "#60A5FA",
        nameColor: getUser()?.nameColor || null,
        signature: isProfilePack(),
      };
    }

    function refreshSignaturePreview() {
      const p = currentPreviewPlayer();
      const box = app.querySelector("#settings-signature-preview");
      if (box) {
        const fresh = document.createElement("div");
        fresh.innerHTML = signatureSelfPreviewHtml(p).trim();
        const next = fresh.firstElementChild;
        if (next) box.replaceWith(next);
      }
      const emojiPreview = app.querySelector(".emoji-picker-preview__avatar");
      if (emojiPreview) {
        const wrap = document.createElement("div");
        wrap.innerHTML = playerAvatarHtml(p, "emoji-picker-preview__avatar");
        const nextAv = wrap.firstElementChild;
        if (nextAv) emojiPreview.replaceWith(nextAv);
      }
      const input = app.querySelector("#settings-name");
      if (input) {
        const hex = resolvedNameColorHex(p);
        input.style.color = hex || "";
      }
    }

    app.querySelector("#settings-name")?.addEventListener("input", () => {
      refreshSignaturePreview();
    });

    app.querySelectorAll(".name-color-chip").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!mount.isMounted()) return;
        if (btn.getAttribute("data-signature-lock")) {
          goToForfaitsTab();
          return;
        }
        const colorId = btn.getAttribute("data-name-color");
        const err = app.querySelector("#name-error");
        const ok = app.querySelector("#color-ok");
        const res = await updateProfileNameColor(colorId);
        if (!mount.isMounted()) return;
        if (!res.ok) {
          if (err) {
            err.textContent = res.error || "Impossible d'enregistrer la couleur.";
            err.classList.remove("hidden");
          }
          ok?.classList.add("hidden");
          return;
        }
        err?.classList.add("hidden");
        ok?.classList.remove("hidden");
        app.querySelectorAll(".name-color-chip").forEach((b) => {
          b.classList.toggle("name-color-chip--active", b === btn);
        });
        refreshSignaturePreview();
      });
    });

    app.querySelectorAll(".emoji-picker__btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!mount.isMounted()) return;
        const emoji = btn.getAttribute("data-emoji");
        const err = app.querySelector("#emoji-error");
        const ok = app.querySelector("#emoji-ok");
        if (isLockedSignatureEmojiClick(emoji, getUser())) {
          goToForfaitsTab();
          return;
        }
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
        app.querySelectorAll(".emoji-picker__btn").forEach((b) => {
          b.classList.toggle("emoji-picker__btn--active", b === btn);
        });
        refreshSignaturePreview();
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
      refreshSignaturePreview();
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

    app.querySelector("#btn-settings-logout")?.addEventListener("click", async () => {
      if (!mount.isMounted()) return;
      const res = await logout();
      if (!mount.isMounted()) return;
      if (res?.cancelled) return;
      if (res?.ok === false && res.error) {
        await showAppAlert(res.error, { title: "Déconnexion", icon: "⚠️" });
        return;
      }
      navigate("home", { reset: true });
    });

    bindSettingsGoto();
  }

  function bindForfaitsEvents() {
    bindAdFreeEvents();
    bindProfilePackEvents();
    bindPremiumRestoreEvents();
    bindSettingsGoto();
  }

  async function runAdFreeAction(action) {
    try {
      const res = await action();
      refreshAdsForEntitlement();
      if (!mount.isMounted()) return;
      swapActivePanel();
      if (res?.cancelled) return;
      await showAppAlert(res?.message || "Action terminée.", {
        title: "Sans pub",
        icon: res?.ok && res?.adFree ? "✨" : "📢",
      });
    } catch (e) {
      if (!mount.isMounted()) return;
      await showAppAlert(e?.message || "Impossible de finaliser l’achat.", {
        title: "Sans pub",
        icon: "⚠️",
      });
    }
  }

  function bindAdFreeEvents() {
    app.querySelector("#btn-adfree-buy")?.addEventListener("click", () => {
      void runAdFreeAction(purchaseAdFree);
    });
  }

  async function runPremiumRestoreAction() {
    try {
      const res = await restorePremiumPurchases();
      refreshAdsForEntitlement();
      if (!mount.isMounted()) return;
      swapActivePanel();
      if (res?.cancelled) return;
      await showAppAlert(res?.message || "Action terminée.", {
        title: "Achats",
        icon: res?.ok && (res?.profilePack || res?.adFree) ? "✨" : "📢",
      });
    } catch (e) {
      if (!mount.isMounted()) return;
      await showAppAlert(e?.message || "Impossible de restaurer les achats.", {
        title: "Achats",
        icon: "⚠️",
      });
    }
  }

  function bindPremiumRestoreEvents() {
    app.querySelector("#btn-premium-restore")?.addEventListener("click", () => {
      void runPremiumRestoreAction();
    });
  }

  async function runProfilePackAction(action) {
    try {
      const res = await action();
      refreshAdsForEntitlement();
      if (!mount.isMounted()) return;
      swapActivePanel();
      if (res?.cancelled) return;
      await showAppAlert(res?.message || "Action terminée.", {
        title: PACK_SIGNATURE_LABEL,
        icon: res?.ok && res?.profilePack ? "✨" : "📢",
      });
    } catch (e) {
      if (!mount.isMounted()) return;
      await showAppAlert(e?.message || "Impossible de finaliser l’achat.", {
        title: PACK_SIGNATURE_LABEL,
        icon: "⚠️",
      });
    }
  }

  function bindProfilePackEvents() {
    app.querySelector("#btn-profile-buy")?.addEventListener("click", () => {
      void runProfilePackAction(purchaseProfile);
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
        const lobbyId = getLobby()?.id || null;
        if (lobbyId && isLoggedIn()) {
          void fetchLobbyFriendOverlay(lobbyId).catch(() => {});
        }
        await showLobbyPlayersManageDialog({
          getParticipants: () => getLobbyParticipants(),
          maxPlayers: MAX_PLAYERS,
          canKick: Boolean(isLobbyHost() && canManageLobbyRoster()),
          onKick: (userId, name) => kickLobbyMember(userId, { confirmName: name }),
          friendActionHtml: (p) =>
            friendRosterActionHtml(p, {
              localIsRegistered: isLoggedIn(),
              lobbyId: getLobby()?.id || null,
            }),
          guestHintHtml: lobbyFriendsHintHtml(isLoggedIn(), getLobbyParticipants()),
          subscribeUpdates: (cb) => onFriendsCacheUpdated(cb),
          onFriendAdd: async (userId) => {
            const run = await friendLock.run(() =>
              sendLobbyFriendRequest(userId, getLobby()?.id)
            );
            if (run.skipped) return;
            const res = run.value;
            if (res?.ok || res?.silent || res?.skipped) return;
          },
          onFriendAccept: async (userId) => {
            const run = await friendLock.run(() =>
              acceptLobbyFriendRequest(userId, getLobby()?.id)
            );
            if (run.skipped) return;
            const res = run.value;
            if (res?.ok || res?.skipped) return;
          },
          onFriendCancel: async (userId) => {
            const run = await friendLock.run(() =>
              cancelLobbyFriendRequest(userId, getLobby()?.id)
            );
            if (run.skipped) return;
            const res = run.value;
            if (res?.ok || res?.skipped) return;
          },
        });
        void flushFriendRequestNotice();
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
      goToSettingsTab(btn.getAttribute("data-settings-tab"));
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
    panel.outerHTML = settingsPanelHtml(inLobby);
    bindNav(app, {
      "evening-return": () => returnFromEveningProfile(),
    });
    bindActivePanelEvents();
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
        <p class="label-upper label-upper--gold">Menu</p>
        <h1 class="page-title">Menu</h1>
        ${settingsTabsHtml(activeTab, inLobby)}
        ${settingsPanelHtml(inLobby)}
      `,
    });

    bindTabEvents();
    bindNav(app, {
      "evening-return": () => returnFromEveningProfile(),
    });
    syncFriendsEntryBadges(app);

    bindActivePanelEvents();
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
