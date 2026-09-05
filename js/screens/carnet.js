/**
 * FEATURE-PROFILE-04 — page Carnet (Menu → Profil).
 */
import { CARNET_LABEL, CARNET_SCREEN_ID } from "../config/signatureCarnet.js";
import { SETTINGS_TAB } from "../config/settingsTabs.js";
import { canPlay, isLoggedIn } from "../core/auth.js";
import { isProfilePack } from "../core/entitlements.js";
import { getCachedGameSession, suppressSessionRoute } from "../core/gameSync.js";
import {
  catalogEmojiForSessionGameId,
  catalogTitleForSessionGameId,
} from "../core/gameCatalogTitle.js";
import {
  competitionRankLabel,
  formatNameList,
  medalForCompetitionRank,
} from "../core/competitionRank.js";
import { hasActiveLobby } from "../core/lobby.js";
import { createMountGuard } from "../core/mountLifecycle.js";
import { navigate } from "../core/router.js";
import { fetchSignatureCarnet } from "../core/signatureCarnet.js";
import {
  SIGNATURE_CARNET_MAX_EVENINGS,
  aggregateCarnetRankSplit,
  carnetRankBarPercents,
  carnetSparklineLayout,
  carnetWinrateRing,
  chronologicalCarnetEvenings,
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

function statCell({ label, value, emoji, tone }) {
  return `
    <div class="carnet-stat carnet-stat--${tone}">
      <p class="carnet-stat__value">
        <span class="carnet-stat__emoji" aria-hidden="true">${emoji}</span>
        ${escapeHtml(String(value))}
      </p>
      <p class="carnet-stat__label">${escapeHtml(label)}</p>
    </div>`;
}

function statsHtml(stats) {
  const favoriteId = stats?.favoriteGame;
  const favoriteTitle =
    catalogTitleForSessionGameId(favoriteId) || CARNET_LABEL.favoriteNone;
  const favoriteEmoji =
    catalogEmojiForSessionGameId(favoriteId) || CARNET_LABEL.statsFavoriteEmoji;
  return `
    <div class="carnet-stats">
      ${statCell({
        label: CARNET_LABEL.statsEvenings,
        value: stats?.evenings ?? 0,
        emoji: CARNET_LABEL.statsEveningsEmoji,
        tone: "evenings",
      })}
      ${statCell({
        label: CARNET_LABEL.statsGames,
        value: stats?.games ?? 0,
        emoji: CARNET_LABEL.statsGamesEmoji,
        tone: "games",
      })}
      ${statCell({
        label: CARNET_LABEL.statsMvp,
        value: stats?.mvp ?? 0,
        emoji: CARNET_LABEL.statsMvpEmoji,
        tone: "mvp",
      })}
      ${statCell({
        label: CARNET_LABEL.statsFavorite,
        value: favoriteTitle,
        emoji: favoriteEmoji,
        tone: "favorite",
      })}
    </div>`;
}

function winrateRingHtml(winrate) {
  const ring = carnetWinrateRing(winrate);
  const cx = ring.size / 2;
  const label = formatCarnetWinrate(winrate);
  const dashRest = Math.max(0, Math.round((ring.circumference - ring.dash) * 100) / 100);
  const valueArc =
    ring.dash > 0
      ? `<circle class="carnet-ring__value" cx="${cx}" cy="${cx}" r="${ring.radius}" fill="none" stroke-width="${ring.stroke}" stroke-dasharray="${ring.dash} ${dashRest}" transform="rotate(-90 ${cx} ${cx})"></circle>`
      : "";
  return `
    <figure class="carnet-viz-card carnet-viz-card--ring">
      <svg class="carnet-ring" viewBox="0 0 ${ring.size} ${ring.size}" width="${ring.size}" height="${ring.size}" role="img" aria-label="${escapeHtml(`${CARNET_LABEL.statsWinrate} ${label}`)}">
        <circle class="carnet-ring__track" cx="${cx}" cy="${cx}" r="${ring.radius}" fill="none" stroke-width="${ring.stroke}"></circle>
        ${valueArc}
        <text class="carnet-ring__pct" x="${cx}" y="${cx}" dy="0.35em" text-anchor="middle">${escapeHtml(label)}</text>
      </svg>
      <figcaption class="carnet-viz__label">${escapeHtml(CARNET_LABEL.statsWinrate)}</figcaption>
    </figure>`;
}

function scoresSparkHtml(evenings) {
  const chrono = chronologicalCarnetEvenings(evenings);
  const scores = chrono.map((row) => row.score);
  const layout = carnetSparklineLayout(scores);
  const last = layout.dots[layout.dots.length - 1];
  const aria = scores.length
    ? `${CARNET_LABEL.chartScores} : ${scores.join(", ")}`
    : CARNET_LABEL.chartScores;
  const line =
    layout.dots.length === 1 && last
      ? `<circle class="carnet-spark__dot" cx="${last.x}" cy="${last.y}" r="4"></circle>`
      : `<path class="carnet-spark__area" d="${layout.area}"></path>
        <polyline class="carnet-spark__line" fill="none" points="${layout.points}"></polyline>
        ${last ? `<circle class="carnet-spark__dot" cx="${last.x}" cy="${last.y}" r="3.5"></circle>` : ""}`;
  return `
    <figure class="carnet-viz-card carnet-viz-card--spark">
      <figcaption class="carnet-viz__label">${escapeHtml(CARNET_LABEL.chartScores)}</figcaption>
      <svg class="carnet-spark" viewBox="0 0 ${layout.width} ${layout.height}" role="img" aria-label="${escapeHtml(aria)}">
        ${line}
      </svg>
    </figure>`;
}

function rankBarRow(tone, label, count, pct) {
  return `
    <div class="carnet-rank-row">
      <span class="carnet-rank-row__label">${escapeHtml(label)}</span>
      <span class="carnet-rank-row__track">
        <span class="carnet-rank-row__fill carnet-rank-row__fill--${tone}" style="width:${pct}%"></span>
      </span>
      <span class="carnet-rank-row__n">${escapeHtml(String(count))}</span>
    </div>`;
}

function rankSplitHtml(evenings) {
  const split = aggregateCarnetRankSplit(evenings);
  const pct = carnetRankBarPercents(split);
  const aria = `${CARNET_LABEL.chartRanks} : ${split.first} ${CARNET_LABEL.chartRankFirst}, ${split.second} ${CARNET_LABEL.chartRankSecond}, ${split.rest} ${CARNET_LABEL.chartRankRest}`;
  return `
    <figure class="carnet-viz-card carnet-viz-card--ranks" aria-label="${escapeHtml(aria)}">
      <figcaption class="carnet-viz__label">${escapeHtml(CARNET_LABEL.chartRanks)}</figcaption>
      ${rankBarRow("gold", CARNET_LABEL.chartRankFirst, split.first, pct.first)}
      ${rankBarRow("silver", CARNET_LABEL.chartRankSecond, split.second, pct.second)}
      ${rankBarRow("rest", CARNET_LABEL.chartRankRest, split.rest, pct.rest)}
    </figure>`;
}

function vizHtml(evenings, stats) {
  if (!evenings.length) return "";
  return `
    <div class="carnet-viz">
      <div class="carnet-viz__top">
        ${winrateRingHtml(stats?.winrate)}
        ${scoresSparkHtml(evenings)}
      </div>
      ${rankSplitHtml(evenings)}
    </div>`;
}

function eveningRankTone(rank) {
  if (rank === 1 || rank === 2 || rank === 3) return String(rank);
  return "rest";
}

function eveningGameChipsHtml(gameIds) {
  const chips = (Array.isArray(gameIds) ? gameIds : [])
    .map((id) => {
      const title = catalogTitleForSessionGameId(id);
      if (!title) return "";
      const emoji = catalogEmojiForSessionGameId(id) || "🎲";
      return `<span class="carnet-chip">${emoji} ${escapeHtml(title)}</span>`;
    })
    .filter(Boolean);
  if (!chips.length) return "";
  return `<div class="carnet-evening__games">${chips.join("")}</div>`;
}

function eveningCardHtml(row) {
  const date = formatCarnetEveningDate(row.endedAt);
  const rank = competitionRankLabel(row.rank);
  const medal = medalForCompetitionRank(row.rank);
  const friends = formatNameList(row.friendNames);
  const tone = eveningRankTone(row.rank);
  return `
    <article class="card settings-section carnet-evening carnet-evening--${tone}">
      <div class="carnet-evening__top">
        <p class="carnet-evening__date">${date ? escapeHtml(date) : ""}</p>
        ${
          row.rank
            ? `<p class="carnet-evening__rank"><span aria-hidden="true">${medal}</span> ${escapeHtml(rank)}</p>`
            : ""
        }
      </div>
      ${
        row.rank
          ? `<p class="carnet-evening__score">${escapeHtml(String(row.score))} pts</p>`
          : ""
      }
      ${eveningGameChipsHtml(row.games)}
      ${
        friends
          ? `<p class="carnet-evening__friends"><span aria-hidden="true">🥳</span> Avec ${escapeHtml(friends)}</p>`
          : ""
      }
    </article>`;
}

function eveningsListHtml(evenings) {
  const n = evenings.length;
  return `
    <section class="carnet-list">
      <div class="carnet-list__head">
        <h2 class="carnet-list__title">${escapeHtml(CARNET_LABEL.listTitle)}</h2>
        <p class="carnet-list__count">${escapeHtml(`${n}/${SIGNATURE_CARNET_MAX_EVENINGS}`)}</p>
      </div>
      ${evenings.map(eveningCardHtml).join("")}
    </section>`;
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
    ${vizHtml(evenings, payload.stats)}
    ${statsHtml(payload.stats)}
    ${eveningsListHtml(evenings)}`;
}

export function mountCarnet(app) {
  if (!canPlay()) {
    navigate("home", { reset: true });
    return null;
  }

  const mount = createMountGuard();
  const registered = isLoggedIn();
  const unlocked = registered && isProfilePack();

  if (hasActiveLobby()) {
    suppressSessionRoute(120000, getCachedGameSession()?.screen || "game-select");
  }

  function paint({ loading = false, error = false, errorCode = null, payload = null } = {}) {
    if (!mount.isMounted()) return;
    app.innerHTML = pageShell({
      back: true,
      backTarget: "back",
      scroll: true,
      content: `
        <p class="label-upper label-upper--gold">Menu</p>
        <h1 class="page-title page-title--carnet">${escapeHtml(CARNET_LABEL.pageTitle)}</h1>
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
