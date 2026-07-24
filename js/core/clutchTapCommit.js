/** Fige le tap capturé au clic (aucun recalcul de ms/at). */
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

/** Snapshot taps avant/après apply local (rollback si sync échoue). */
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
    };
  }
  const nextTaps = { ...previousTaps, [localName]: frozen };
  return { alreadyTapped: false, previousTaps, nextTaps, tap: frozen };
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
 * Machine de commit tap : échec → rollback taps + UI retentable → second tap OK.
 * Testable sans DOM / Supabase.
 */
export function simulateClutchTapCommitCycle({
  session,
  localName,
  firstTap,
  secondTap,
  commitFails = true,
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
    taps = first.previousTaps;
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
