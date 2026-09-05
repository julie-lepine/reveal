/**
 * FEATURE-PROFILE-04 — page Carnet (Menu → Profil).
 */
import { CARNET_LABEL, CARNET_SCREEN_ID } from "../config/signatureCarnet.js";
import { SETTINGS_TAB } from "../config/settingsTabs.js";
import { canPlay, isLoggedIn } from "../core/auth.js";
import { isProfilePack } from "../core/entitlements.js";
import { catalogTitleForSessionGameId } from "../core/gameCatalogTitle.js";
import { competitionRankLabel, formatNameList } from "../core/competitionRank.js";
import { createMountGuard } from "../core/mountLifecycle.js";
import { navigate } from "../core/router.js";
import { fetchSignatureCarnet } from "../core/signatureCarnet.js";
import {
  formatCarnetEveningDate,
  formatCarnetWinrate,
} from "../core/signatureCarnetLogic.js";
import { escapeHtml, pageShell } from "../core/ui.js";
import { bindNav, goToEveningSettings } from "./nav.js";

function lockedHtml(registered) {
  return `
    <div class="card settings-section carnet-locked">
      <h2 class="settings-section__title">${escapeHtml(CARNET_LABEL.lockedTitle)}</h2>
      <p class="hint settings-section__hint">${escapeHtml(
        registered ? CARNET_LABEL.lockedBody : CARNET_LABEL.guestBody
      )}</p>
      ${
        registered
          ? `<button type="button" class="btn btn-primary btn--spaced" data-carnet-forfaits>${escapeHtml(
              CARNET_LABEL.seePacks
            )}</button>`
          : ""
      }
    </div>`;
}

function statCell(label, value) {
  return `
    <div class="carnet-stat">
      <p class="carnet-stat__value">${escapeHtml(String(value))}</p>
      <p class="carnet-stat__label">${escapeHtml(label)}</p>
    </div>`;
}

function statsHtml(stats) {
  const favorite =
    catalogTitleForSessionGameId(stats?.favoriteGame) || CARNET_LABEL.favoriteNone;
  return `
    <div class="carnet-stats">
      ${statCell(CARNET_LABEL.statsEvenings, stats?.evenings ?? 0)}
      ${statCell(CARNET_LABEL.statsGames, stats?.games ?? 0)}
      ${statCell(CARNET_LABEL.statsWinrate, formatCarnetWinrate(stats?.winrate))}
      ${statCell(CARNET_LABEL.statsMvp, stats?.mvp ?? 0)}
      ${statCell(CARNET_LABEL.statsFavorite, favorite)}
    </div>`;
}

function eveningCardHtml(row) {
  const date = formatCarnetEveningDate(row.endedAt);
  const rank = competitionRankLabel(row.rank);
  const titles = row.games
    .map((id) => catalogTitleForSessionGameId(id))
    .filter(Boolean)
    .join(" · ");
  const friends = formatNameList(row.friendNames);
  return `
    <article class="card settings-section carnet-evening">
      <p class="carnet-evening__meta">${escapeHtml(date)}${
        row.rank ? ` · ${escapeHtml(rank)} · ${escapeHtml(String(row.score))} pts` : ""
      }</p>
      ${
        titles
          ? `<p class="carnet-evening__games">${escapeHtml(titles)}</p>`
          : ""
      }
      ${
        friends
          ? `<p class="hint carnet-evening__friends">Avec ${escapeHtml(friends)}</p>`
          : ""
      }
    </article>`;
}

function carnetBodyHtml({ registered, unlocked, loading, error, errorCode, payload }) {
  if (!registered || !unlocked) return lockedHtml(registered);
  if (loading) {
    return `<p class="hint settings-section__hint">Chargement…</p>`;
  }
  if (error) {
    const msg =
      errorCode === "PGRST202" || errorCode === "42883"
        ? CARNET_LABEL.missingRpc
        : CARNET_LABEL.loadError;
    return `<p class="auth-error">${escapeHtml(msg)}</p>`;
  }
  const evenings = payload?.evenings || [];
  if (!evenings.length) {
    return `
      ${statsHtml(payload?.stats)}
      <p class="hint settings-section__hint">${escapeHtml(CARNET_LABEL.empty)}</p>`;
  }
  return `
    ${statsHtml(payload.stats)}
    <div class="carnet-list">
      ${evenings.map(eveningCardHtml).join("")}
    </div>`;
}

export function mountCarnet(app) {
  if (!canPlay()) {
    navigate("home", { reset: true });
    return null;
  }

  const mount = createMountGuard();
  const registered = isLoggedIn();
  const unlocked = registered && isProfilePack();

  function paint({ loading = false, error = false, errorCode = null, payload = null } = {}) {
    if (!mount.isMounted()) return;
    app.innerHTML = pageShell({
      back: true,
      backTarget: "back",
      scroll: true,
      content: `
        <p class="label-upper label-upper--muted">Menu</p>
        <h1 class="page-title">${escapeHtml(CARNET_LABEL.pageTitle)}</h1>
        ${carnetBodyHtml({ registered, unlocked, loading, error, errorCode, payload })}
      `,
    });
    bindNav(app);
    app.querySelector("[data-carnet-forfaits]")?.addEventListener("click", () => {
      goToEveningSettings({ tab: SETTINGS_TAB.FORFAITS });
    });
  }

  paint({ loading: unlocked });
  if (unlocked) {
    void fetchSignatureCarnet()
      .then((res) => {
        if (res.skipped) {
          paint({ loading: false, error: false, payload: { evenings: [], stats: null } });
          return;
        }
        paint({
          loading: false,
          error: !res.ok,
          errorCode: res.code || null,
          payload: res.ok ? res : { evenings: [], stats: null },
        });
      })
      .catch((e) => {
        console.warn("REVEAL signature carnet list:", e?.message || e);
        paint({ loading: false, error: true });
      });
  }

  return () => mount.dispose();
}

export { CARNET_SCREEN_ID };
