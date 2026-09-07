/**
 * ID-OVERLAY — intention Signature pendant l’activation différée (webhook pending).
 * Session only, namespacé par userId. Jamais écrit en SQL. Pas de profile_pack client.
 */

export function emptyPendingSignatureCosmetics() {
  return {
    userId: null,
    hasNameColor: false,
    nameColor: null,
    hasAvatar: false,
    avatarPath: null,
    avatarRev: 0,
  };
}

export function overlayUnlocksSignature(overlay) {
  return overlay?.profilePack === true || overlay?.hostPack === true;
}

/** Fenêtre overlay Signature + pack SQL pas encore true. */
export function shouldHoldPendingSignatureCosmetics({
  overlay,
  serverProfilePackColumn,
} = {}) {
  return overlayUnlocksSignature(overlay) && serverProfilePackColumn !== true;
}

export function pendingHasCosmetics(pending) {
  return Boolean(pending?.hasNameColor || pending?.hasAvatar);
}

export function pendingBelongsToUser(pending, userId) {
  return Boolean(pending?.userId && userId && pending.userId === userId);
}

export function rememberPendingNameColor(pending, { userId, nameColor } = {}) {
  if (!userId) return pending || emptyPendingSignatureCosmetics();
  return {
    ...(pending && pending.userId === userId ? pending : emptyPendingSignatureCosmetics()),
    userId,
    hasNameColor: true,
    nameColor: nameColor == null || nameColor === "" ? null : String(nameColor),
  };
}

export function rememberPendingAvatar(pending, { userId, avatarPath = null, avatarRev = 0 } = {}) {
  if (!userId) return pending || emptyPendingSignatureCosmetics();
  return {
    ...(pending && pending.userId === userId ? pending : emptyPendingSignatureCosmetics()),
    userId,
    hasAvatar: true,
    avatarPath: avatarPath || null,
    avatarRev: Number(avatarRev) || 0,
  };
}

export function clearPendingField(pending, { nameColor = false, avatar = false } = {}) {
  const next = { ...(pending || emptyPendingSignatureCosmetics()) };
  if (nameColor) {
    next.hasNameColor = false;
    next.nameColor = null;
  }
  if (avatar) {
    next.hasAvatar = false;
    next.avatarPath = null;
    next.avatarRev = 0;
  }
  if (!next.hasNameColor && !next.hasAvatar) return emptyPendingSignatureCosmetics();
  return next;
}

/**
 * Pendant la fenêtre overlay, un null serveur n’écrase pas l’intention locale.
 * Hors fenêtre : cosmetics serveur tels quels.
 */
export function applyServerCosmeticsWithPending({
  serverNameColor = null,
  serverAvatarPath = null,
  serverAvatarRev = 0,
  pending,
  userId,
} = {}) {
  const hold = pendingBelongsToUser(pending, userId) && pendingHasCosmetics(pending);
  if (!hold) {
    return {
      nameColor: serverNameColor,
      avatarPath: serverAvatarPath,
      avatarRev: serverAvatarRev,
    };
  }
  return {
    nameColor: pending.hasNameColor ? pending.nameColor : serverNameColor,
    avatarPath: pending.hasAvatar ? pending.avatarPath : serverAvatarPath,
    avatarRev: pending.hasAvatar ? pending.avatarRev : serverAvatarRev,
  };
}

/**
 * Fenêtre overlay : un null serveur (pack SQL encore false) n’écrase pas
 * la couleur / photo déjà posée en local, même si le pending session a raté.
 */
export function coalesceLocalCosmeticsDuringHold({
  hold = false,
  fromServer = {},
  local = {},
} = {}) {
  if (!hold) {
    return {
      nameColor: fromServer.nameColor ?? null,
      avatarPath: fromServer.avatarPath ?? null,
      avatarRev: Number(fromServer.avatarRev) || 0,
    };
  }
  const nameColor =
    fromServer.nameColor != null && fromServer.nameColor !== ""
      ? fromServer.nameColor
      : local.nameColor != null && local.nameColor !== ""
        ? local.nameColor
        : null;
  const avatarPath = fromServer.avatarPath || local.avatarPath || null;
  const avatarRev = fromServer.avatarPath
    ? Number(fromServer.avatarRev) || 0
    : avatarPath
      ? Number(local.avatarRev) || 0
      : 0;
  return { nameColor, avatarPath, avatarRev };
}

export function nameColorReplayAccepted(data, expected) {
  const got = data?.name_color == null ? null : String(data.name_color);
  const want = expected == null || expected === "" ? null : String(expected);
  return got === want;
}

export function avatarReplayAccepted(data, { avatarPath = null, avatarRev = 0 } = {}) {
  const gotPath = data?.avatar_path || null;
  const wantPath = avatarPath || null;
  if (gotPath !== wantPath) return false;
  if (!wantPath) return true;
  const gotRev = Number(data?.avatar_rev) || 0;
  return gotRev === (Number(avatarRev) || 0);
}

/** Session only — même cycle de vie que l’overlay RC (logout / reset tests). */
let pendingSignatureCosmetics = emptyPendingSignatureCosmetics();
let pendingReplayInFlight = false;

export function getPendingSignatureCosmetics() {
  return { ...pendingSignatureCosmetics };
}

export function clearPendingSignatureCosmetics() {
  pendingSignatureCosmetics = emptyPendingSignatureCosmetics();
  pendingReplayInFlight = false;
}

export function capturePendingNameColor(userId, nameColor) {
  pendingSignatureCosmetics = rememberPendingNameColor(pendingSignatureCosmetics, {
    userId,
    nameColor,
  });
  return getPendingSignatureCosmetics();
}

export function capturePendingAvatar(userId, { avatarPath = null, avatarRev = 0 } = {}) {
  pendingSignatureCosmetics = rememberPendingAvatar(pendingSignatureCosmetics, {
    userId,
    avatarPath,
    avatarRev,
  });
  return getPendingSignatureCosmetics();
}

/**
 * Rejoue l’upsert seulement si `profiles.profile_pack` SQL est true.
 * Ne retire le pending qu’après succès. Idempotent (in-flight + pending vide).
 */
export async function replayPendingSignatureCosmetics({
  upsertProfile,
  userId,
  serverProfilePackColumn,
} = {}) {
  if (serverProfilePackColumn !== true) return { ok: true, skipped: true };
  if (!userId || typeof upsertProfile !== "function") return { ok: false, skipped: true };
  if (pendingReplayInFlight) return { ok: true, skipped: true, inFlight: true };
  const snap = pendingSignatureCosmetics;
  if (!pendingBelongsToUser(snap, userId) || !pendingHasCosmetics(snap)) {
    return { ok: true, skipped: true };
  }

  pendingReplayInFlight = true;
  try {
    if (snap.hasNameColor) {
      const data = await upsertProfile({ userId, nameColor: snap.nameColor });
      if (!nameColorReplayAccepted(data, snap.nameColor)) {
        console.warn("REVEAL ID-OVERLAY: nameColor replay not persisted");
        return { ok: false, field: "nameColor" };
      }
      pendingSignatureCosmetics = clearPendingField(pendingSignatureCosmetics, {
        nameColor: true,
      });
    }
    if (pendingSignatureCosmetics.hasAvatar) {
      const data = await upsertProfile({
        userId,
        avatarPath: pendingSignatureCosmetics.avatarPath,
        avatarRev: pendingSignatureCosmetics.avatarRev,
      });
      if (
        !avatarReplayAccepted(data, {
          avatarPath: pendingSignatureCosmetics.avatarPath,
          avatarRev: pendingSignatureCosmetics.avatarRev,
        })
      ) {
        console.warn("REVEAL ID-OVERLAY: avatar replay not persisted");
        return { ok: false, field: "avatar" };
      }
      pendingSignatureCosmetics = clearPendingField(pendingSignatureCosmetics, {
        avatar: true,
      });
    }
    return { ok: true };
  } catch (e) {
    console.warn("REVEAL ID-OVERLAY: replay failed", e?.message || e);
    return { ok: false, error: e };
  } finally {
    pendingReplayInFlight = false;
  }
}
