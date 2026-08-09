/** Fige le tap capturé au clic (aucun recalcul de ms/at). */
import {
  computeOptimisticMapEntryApply,
  rollbackOptimisticMapEntry,
} from "./optimisticMapEntry.js";

export function freezeClutchTap(tap) {
  return {
    ms: tap.ms,
    at: tap.at,
  };
}

/**
 * Union des maps taps : le premier ms valide gagne.
 * Latence / patches tardifs / doubles envois ne doivent jamais remplacer un clic figé.
 */
export function mergeClutchTapsFrozen(base = {}, incoming = {}) {
  const out = { ...base };
  for (const [key, tap] of Object.entries(incoming || {})) {
    if (!tap || typeof tap.ms !== "number" || !Number.isFinite(tap.ms)) continue;
    const prev = out[key];
    if (prev && typeof prev.ms === "number" && Number.isFinite(prev.ms)) continue;
    out[key] = {
      ms: tap.ms,
      at: typeof tap.at === "number" ? tap.at : null,
    };
  }
  return out;
}

/** Snapshot taps avant/après apply local (tests purs / UI helpers). */
export function computeClutchTapApply(session, localName, tap) {
  const frozen = freezeClutchTap(tap);
  const previousTaps = { ...(session.taps || {}) };
  const existing = previousTaps[localName];
  if (existing?.ms != null) {
    return {
      alreadyTapped: true,
      previousTaps,
      nextTaps: previousTaps,
      tap: existing,
      hadPreviousValue: true,
      previousValue: existing,
      optimisticValue: existing,
    };
  }
  const apply = computeOptimisticMapEntryApply({
    map: previousTaps,
    key: localName,
    value: frozen,
  });
  return {
    alreadyTapped: false,
    previousTaps,
    nextTaps: apply.nextMap,
    tap: frozen,
    hadPreviousValue: apply.hadPreviousValue,
    previousValue: apply.previousValue,
    optimisticValue: apply.optimisticValue,
  };
}

/**
 * UI locale après échec de sync du tap : libère le verrou commit et rouvre
 * la fenêtre de tap (le grace timer a pu fermer pendant l’attente réseau).
 */
export function resolveClutchTapCommitFailureUi() {
  return {
    tapCommitInFlight: false,
    localWindowClosed: false,
  };
}

/** Succès ou fin de commit : verrou libéré ; localWindowClosed inchangé. */
export function resolveClutchTapCommitSettledUi(localWindowClosed) {
  return {
    tapCommitInFlight: false,
    localWindowClosed: Boolean(localWindowClosed),
  };
}

/**
 * Pendant commit in-flight : ne jamais laisser une session stale écraser le tap local figé.
 */
export function preferInFlightClutchTap(sessionTaps, localTaps, localName, tapCommitInFlight) {
  const out = { ...(sessionTaps || {}) };
  if (
    tapCommitInFlight &&
    localName &&
    localTaps?.[localName] &&
    typeof localTaps[localName].ms === "number"
  ) {
    out[localName] = freezeClutchTap(localTaps[localName]);
  }
  return out;
}

/**
 * Machine de commit tap : échec → rollback entrée locale seulement → second tap OK.
 * Testable sans DOM / Supabase. AUDIT-003 : ne restaure jamais previousTaps entier.
 */
export function simulateClutchTapCommitCycle({
  session,
  localName,
  firstTap,
  secondTap,
  commitFails = true,
  /** Injecte un concurrent (ex. Bob) pendant l’await avant rollback. */
  mutateBeforeFail = null,
}) {
  let taps = { ...(session.taps || {}) };
  let tapCommitInFlight = false;
  let localWindowClosed = false;
  const sent = [];

  function canTap() {
    return !tapCommitInFlight && !localWindowClosed && taps[localName]?.ms == null;
  }

  if (!canTap()) {
    return { ok: false, reason: "blocked-before-first", canTapAfter: canTap(), sent };
  }
  tapCommitInFlight = true;
  const first = computeClutchTapApply({ taps }, localName, firstTap);
  taps = first.nextTaps;
  localWindowClosed = true;

  if (commitFails) {
    if (typeof mutateBeforeFail === "function") {
      taps = mutateBeforeFail(taps);
    }
    const rolled = rollbackOptimisticMapEntry({
      currentMap: taps,
      key: localName,
      hadPreviousValue: first.hadPreviousValue,
      previousValue: first.previousValue,
      optimisticValue: first.optimisticValue,
    });
    if (rolled.applied) taps = rolled.map;
    const ui = resolveClutchTapCommitFailureUi();
    tapCommitInFlight = ui.tapCommitInFlight;
    localWindowClosed = ui.localWindowClosed;
  } else {
    sent.push(first.tap);
    const ui = resolveClutchTapCommitSettledUi(localWindowClosed);
    tapCommitInFlight = ui.tapCommitInFlight;
    localWindowClosed = ui.localWindowClosed;
  }

  const canSecond = canTap();
  if (!commitFails || !canSecond) {
    return {
      ok: !commitFails,
      canTapAfterFailure: canSecond,
      tapCommitInFlight,
      localWindowClosed,
      taps,
      sent,
    };
  }

  tapCommitInFlight = true;
  const second = computeClutchTapApply({ taps }, localName, secondTap);
  taps = second.nextTaps;
  sent.push(second.tap);
  const settled = resolveClutchTapCommitSettledUi(false);
  tapCommitInFlight = settled.tapCommitInFlight;
  localWindowClosed = settled.localWindowClosed;

  return {
    ok: true,
    canTapAfterFailure: true,
    secondTapSent: true,
    tapCommitInFlight,
    localWindowClosed,
    taps,
    sent,
  };
}
