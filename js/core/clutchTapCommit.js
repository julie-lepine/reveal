/** Snapshot taps avant/après apply local (rollback si sync échoue). */
export function computeClutchTapApply(session, localName, tap) {
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
  const nextTaps = { ...previousTaps, [localName]: tap };
  return { alreadyTapped: false, previousTaps, nextTaps, tap };
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

  // Premier tap
  if (!canTap()) {
    return { ok: false, reason: "blocked-before-first", canTapAfter: canTap(), sent };
  }
  tapCommitInFlight = true;
  const first = computeClutchTapApply({ taps }, localName, firstTap);
  taps = first.nextTaps;
  // Simule grace pendant l’attente réseau
  localWindowClosed = true;

  if (commitFails) {
    taps = first.previousTaps;
    const ui = resolveClutchTapCommitFailureUi();
    tapCommitInFlight = ui.tapCommitInFlight;
    localWindowClosed = ui.localWindowClosed;
  } else {
    sent.push(firstTap);
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

  // Second tap autorisé et « envoyé »
  tapCommitInFlight = true;
  const second = computeClutchTapApply({ taps }, localName, secondTap);
  taps = second.nextTaps;
  sent.push(secondTap);
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
