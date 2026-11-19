/**
 * FEATURE-PROFILE-04 — page Carnet (Menu → Profil).
 */
import { APP_LOGO } from "../../data/branding.js";
import { PACK_SIGNATURE_LABEL } from "../config/premiumPacks.js";
import { CARNET_LABEL, CARNET_SCREEN_ID } from "../config/signatureCarnet.js";
import { SETTINGS_TAB } from "../config/settingsTabs.js";
import { canPlay, isLoggedIn } from "../core/auth.js";
import { isProfilePack } from "../core/entitlements.js";
import { getCachedGameSession, suppressSessionRoute } from "../core/gameSync.js";
import {
  catalogEmojiForSessionGameId,
  catalogLogoForSessionGameId,
  catalogTitleForSessionGameId,
} from "../core/gameCatalogTitle.js";
import {
  competitionRankLabel,
  formatNameList,
  medalForCompetitionRank,
} from "../core/competitionRank.js";
import { withClickLock } from "../core/actionLock.js";
import { hasActiveLobby } from "../core/lobby.js";
import { createMountGuard } from "../core/mountLifecycle.js";
import { getLocalPlayer } from "../core/players.js";
import { navigate } from "../core/router.js";
import { fetchSignatureCarnet } from "../core/signatureCarnet.js";
import {
  closeCarnetSharePreview,
  openCarnetSharePreview,
} from "../core/signatureCarnetCard.js";
import {
  buildCarnetCardModel,
  canShareCarnetCard,
} from "../core/signatureCarnetCardLogic.js";
import {
  aggregateCarnetRankSplit,
  carnetSparklineLayout,
  carnetWinrateRing,
  chronologicalCarnetEvenings,
  formatCarnetEveningDate,
  formatCarnetWinrate,
} from "../core/signatureCarnetLogic.js";
import { escapeHtml, pageShell } from "../core/ui.js";
import { bindNav, goToEveningSettings } from "./nav.js";

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
  const layout = carnetSparklineLayout(scores, { width: 240, height: 120 });
  const last = layout.dots[layout.dots.length - 1];
  const hasRange = layout.yMin != null && layout.yMax != null;
  const rangeLabel = hasRange ? `${layout.yMin} – ${layout.yMax}` : "";
  const aria = scores.length
    ? `${CARNET_LABEL.chartScores}${rangeLabel ? ` ${rangeLabel}` : ""}`
    : CARNET_LABEL.chartScores;
  const line =
    layout.dots.length === 1 && last
      ? `<circle class="carnet-spark__dot" cx="${last.x}" cy="${last.y}" r="4"></circle>`
      : `<path class="carnet-spark__area" d="${layout.area}"></path>
        <polyline class="carnet-spark__line" fill="none" points="${layout.points}"></polyline>
        ${last ? `<circle class="carnet-spark__dot" cx="${last.x}" cy="${last.y}" r="3.5"></circle>` : ""}`;
  const ends = !hasRange
    ? ""
    : `<span class="carnet-spark__y carnet-spark__y--min">${escapeHtml(String(layout.yMin))}</span>
      <span class="carnet-spark__y carnet-spark__y--max">${escapeHtml(String(layout.yMax))}</span>`;
  return `
    <figure class="carnet-viz-card carnet-viz-card--spark">
      <figcaption class="carnet-viz__label">${escapeHtml(CARNET_LABEL.chartScores)}</figcaption>
      <div class="carnet-spark-wrap">
        ${ends}
        <svg class="carnet-spark" viewBox="0 0 ${layout.width} ${layout.height}" preserveAspectRatio="none" role="img" aria-label="${escapeHtml(aria)}">
          ${line}
        </svg>
      </div>
    </figure>`;
}

/** Carte de collection (version écran de la carte partagée). */
function carnetCardHtml(model, { locked = false } = {}) {
  const ident = model.identity || {};
  const stats = model.stats || {};
  const favId = stats.favoriteGame;
  const favTitle = catalogTitleForSessionGameId(favId) || CARNET_LABEL.favoriteNone;
  const favEmoji = catalogEmojiForSessionGameId(favId) || CARNET_LABEL.statsFavoriteEmoji;
  const value = (v) => (locked ? "00" : escapeHtml(String(v)));
  const avatar = ident.avatarUrl
    ? `<img class="carnet-card__photo" src="${escapeHtml(ident.avatarUrl)}" alt="" onerror="this.remove()">`
    : "";
  const dots = (model.dots || [])
    .map((tone) => `<i class="carnet-card__dot carnet-card__dot--${escapeHtml(tone)}"></i>`)
    .join("");
  return `
    <div class="carnet-card${locked ? " carnet-card--locked" : ""}"${locked ? ' aria-hidden="true"' : ""}>
      <div class="carnet-card__top"><span>${escapeHtml(CARNET_LABEL.pageTitle)}</span><span aria-hidden="true">✦</span></div>
      <div class="carnet-card__ring"><span class="carnet-card__avatar">${avatar}${escapeHtml(ident.emoji || "👤")}</span></div>
      <p class="carnet-card__name"${ident.nameColorHex ? ` style="color:${escapeHtml(ident.nameColorHex)}"` : ""}>${escapeHtml(ident.name || "Joueur")}</p>
      <span class="carnet-card__badge">✨ ${escapeHtml(PACK_SIGNATURE_LABEL)}</span>
      ${model.hook && !locked ? `<p class="carnet-card__hook">${escapeHtml(model.hook)}</p>` : ""}
      <div class="carnet-card__stats">
        <div><b>${value(stats.evenings ?? 0)}</b><span>${CARNET_LABEL.statsEveningsEmoji} ${escapeHtml(CARNET_LABEL.statsEvenings)}</span></div>
        <div><b>${value(stats.mvp ?? 0)}</b><span>${CARNET_LABEL.statsMvpEmoji} ${escapeHtml(CARNET_LABEL.statsMvp)}</span></div>
        <div><b>${locked ? "00" : escapeHtml(formatCarnetWinrate(stats.winrate))}</b><span>${escapeHtml(CARNET_LABEL.statsWinrate)}</span></div>
        <div><b class="carnet-card__fav">${locked ? "00" : `${favEmoji} ${escapeHtml(favTitle)}`}</b><span>${CARNET_LABEL.statsFavoriteEmoji} ${escapeHtml(CARNET_LABEL.statsFavorite)}</span></div>
      </div>
      <div class="carnet-card__dots">${dots}</div>
      <img class="carnet-card__logo" src="${escapeHtml(APP_LOGO)}" alt="REVEAL">
    </div>`;
}

function lockedHtml(registered) {
  const sample = buildCarnetCardModel({ identity: getLocalPlayer(), evenings: [], stats: null });
  return `
    <div class="carnet-locked">
      ${carnetCardHtml(sample, { locked: true })}
      <div class="carnet-locked__over">
        <h2 class="carnet-locked__title">🔒 ${escapeHtml(CARNET_LABEL.lockedTitle)}</h2>
        <p class="carnet-locked__body">${escapeHtml(
          registered ? CARNET_LABEL.lockedBody : CARNET_LABEL.guestBody
        )}</p>
        ${
          registered
            ? `<button type="button" class="btn btn-primary" data-carnet-forfaits>${escapeHtml(
                CARNET_LABEL.seePacks
              )}</button>`
            : ""
        }
      </div>
    </div>`;
}

/** Podium : 2e, 1er, 3e+ (hauteurs proportionnelles). */
function podiumHtml(evenings) {
  const split = aggregateCarnetRankSplit(evenings);
  const max = Math.max(1, split.first, split.second, split.rest);
  const h = (n) => Math.round(28 + (n / max) * 64);
  const aria = `${CARNET_LABEL.chartRanks} : ${split.first} ${CARNET_LABEL.chartRankFirst}, ${split.second} ${CARNET_LABEL.chartRankSecond}, ${split.rest} ${CARNET_LABEL.chartRankRest}`;
  const step = (tone, label, n) => `
        <div class="carnet-podium__step carnet-podium__step--${tone}" style="height:${h(n)}px">
          <span>${label}</span><b>${escapeHtml(String(n))}</b>
        </div>`;
  return `
    <figure class="carnet-viz-card carnet-viz-card--podium" aria-label="${escapeHtml(aria)}">
      <figcaption class="carnet-viz__label">${escapeHtml(CARNET_LABEL.chartPodiums)}</figcaption>
      <div class="carnet-podium">
        ${step("second", "🥈", split.second)}
        ${step("first", "🥇", split.first)}
        ${step("rest", escapeHtml(CARNET_LABEL.chartRankRest), split.rest)}
      </div>
    </figure>`;
}

function bestScoreHtml(evenings) {
  const scores = evenings.map((row) => Number(row.score)).filter(Number.isFinite);
  if (!scores.length) return "";
  return `<span class="carnet-viz__best">${escapeHtml(
    CARNET_LABEL.bestEvening.replace("{n}", String(Math.max(...scores)))
  )}</span>`;
}

function vizHtml(evenings, stats) {
  if (!evenings.length) return "";
  return `
    <h2 class="carnet-section-title">${escapeHtml(CARNET_LABEL.statsTitle)}</h2>
    <div class="carnet-viz">
      <div class="carnet-viz__top">
        ${winrateRingHtml(stats?.winrate)}
        ${podiumHtml(evenings)}
      </div>
      ${scoresSparkHtml(evenings)}
      ${bestScoreHtml(evenings)}
    </div>`;
}

function eveningRankTone(rank) {
  if (rank === 1 || rank === 2 || rank === 3) return String(rank);
  return "rest";
}

const CARNET_EVENING_MAX_LOGOS = 4;

function eveningGameLogosHtml(gameIds) {
  const ids = (Array.isArray(gameIds) ? gameIds : []).filter((id) =>
    catalogTitleForSessionGameId(id)
  );
  const shown = ids.slice(0, CARNET_EVENING_MAX_LOGOS).map((id) => {
    const title = catalogTitleForSessionGameId(id);
    const logo = catalogLogoForSessionGameId(id);
    return logo
      ? `<img class="carnet-ev__logo" src="${escapeHtml(logo)}" alt="${escapeHtml(title)}">`
      : `<span class="carnet-ev__logo carnet-ev__logo--emoji" title="${escapeHtml(title)}">${
          catalogEmojiForSessionGameId(id) || "🎲"
        }</span>`;
  });
  const more = ids.length - shown.length;
  if (!shown.length) return "";
  return `<div class="carnet-ev__logos">${shown.join("")}${
    more > 0 ? `<span class="carnet-ev__more">+${more}</span>` : ""
  }</div>`;
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

function eveningDateParts(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const month = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" }).format(d);
  return {
    day: String(d.getDate()),
    shortMonth: new Intl.DateTimeFormat("fr-FR", { month: "short" }).format(d),
    month: month.charAt(0).toUpperCase() + month.slice(1),
  };
}

function eveningRowHtml(row) {
  const parts = eveningDateParts(row.endedAt);
  const date = formatCarnetEveningDate(row.endedAt);
  const rank = competitionRankLabel(row.rank);
  const medal = medalForCompetitionRank(row.rank);
  const friends = formatNameList(row.friendNames);
  const tone = eveningRankTone(row.rank);
  return `
    <details class="carnet-ev carnet-ev--${tone}">
      <summary class="carnet-ev__row" aria-label="${escapeHtml(date)}">
        <span class="carnet-ev__date"><b>${escapeHtml(parts?.day || "")}</b><small>${escapeHtml(parts?.shortMonth || "")}</small></span>
        <span class="carnet-ev__mid">
          ${eveningGameLogosHtml(row.games)}
          ${
            friends
              ? `<span class="carnet-ev__with"><span aria-hidden="true">🥳</span> Avec ${escapeHtml(friends)}</span>`
              : ""
          }
        </span>
        ${
          row.rank
            ? `<span class="carnet-ev__rank"><b><span aria-hidden="true">${medal}</span> ${escapeHtml(rank)}</b><span class="carnet-ev__pts">${escapeHtml(String(row.score))} pts</span></span>`
            : ""
        }
      </summary>
      <div class="carnet-ev__detail">
        ${eveningGameChipsHtml(row.games)}
      </div>
    </details>`;
}

function eveningsListTitle(n) {
  return n === 1 ? CARNET_LABEL.listTitleOne : CARNET_LABEL.listTitle.replace("{n}", String(n));
}

function eveningsListHtml(evenings) {
  let month = "";
  const rows = evenings
    .map((row) => {
      const m = eveningDateParts(row.endedAt)?.month || "";
      const head = m && m !== month ? `<p class="carnet-month">${escapeHtml(m)}</p>` : "";
      if (m) month = m;
      return `${head}${eveningRowHtml(row)}`;
    })
    .join("");
  return `
    <section class="carnet-list">
      <h2 class="carnet-section-title carnet-list__title">${escapeHtml(eveningsListTitle(evenings.length))}</h2>
      ${rows}
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
  const model = buildCarnetCardModel({
    identity: getLocalPlayer(),
    evenings,
    stats: payload?.stats,
  });
  const share = canShareCarnetCard(evenings)
    ? `<button type="button" class="btn btn-primary carnet-share-btn" data-carnet-share>${escapeHtml(
        CARNET_LABEL.shareCard
      )}</button>`
    : "";
  if (!evenings.length) {
    return `
      ${carnetCardHtml(model)}
      <p class="hint settings-section__hint">${escapeHtml(CARNET_LABEL.empty)}</p>`;
  }
  return `
    ${carnetCardHtml(model)}
    ${share}
    ${vizHtml(evenings, payload.stats)}
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
    app.querySelector("[data-carnet-share]")?.addEventListener(
      "click",
      withClickLock(async () => {
        const model = buildCarnetCardModel({
          identity: getLocalPlayer(),
          evenings: payload?.evenings || [],
          stats: payload?.stats,
        });
        openCarnetSharePreview(model);
      })
    );
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

  return () => {
    closeCarnetSharePreview();
    mount.dispose();
  };
}

export { CARNET_SCREEN_ID };
