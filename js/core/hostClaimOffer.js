/**
 * ARCH-03b — offre confirmée de reprise du rôle hôte (lobby).
 * Ne confond pas avec l'acting host technique (120 s, session de jeu).
 */
import { HOST_TRANSFER_STALE_MS } from "../config/lobbyLifecycle.js";
import { getState } from "./state.js";
import { getSupabaseUserId } from "./supabaseAuth.js";
import { isGameSyncActive, isLobbyHost } from "./gameSync.js";
import { resolveActingHostUserId } from "./hostPresence.js";
import { showAppAlert, showClaimHostDialog } from "./dialog.js";
import {
  claimLobbyHostIfStaleSupabase,
  refreshLobbyFromSupabase,
} from "./supabaseLobby.js";

function hostInactiveMinutes(participants, hostId, now = Date.now()) {
  const host =
    (participants || []).find((p) => p.userId === hostId) ||
    (participants || []).find((p) => p.isHost);
  if (!host?.lastSeenAt) return null;
  const t = new Date(host.lastSeenAt).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(1, Math.floor((now - t) / 60_000));
}

/**
 * Préfiltre UX uniquement — la RPC recalcule tout côté serveur.
 * true si l'hôte est stale ≥ 5 min (lastSeenAt non null) et le local est le candidat déterministe.
 */
export function clientMayOfferHostClaim(now = Date.now()) {
  if (!isGameSyncActive() || isLobbyHost()) return false;
  const uid = getSupabaseUserId();
  const lobby = getState().lobby;
  if (!uid || !lobby?.hostId) return false;

  const host =
    (lobby.participants || []).find((p) => p.userId === lobby.hostId) ||
    (lobby.participants || []).find((p) => p.isHost);
  // Legacy null lastSeenAt = présent → pas d'offre (aligné SQL)
  if (!host?.lastSeenAt) return false;

  const elected = resolveActingHostUserId(
    lobby.participants || [],
    lobby.hostId,
    now,
    HOST_TRANSFER_STALE_MS
  );
  return elected === uid;
}

/**
 * Garde unique pour actions réservées à l'hôte (launch, paramètres).
 * Ordre strict : jamais d'UI admin avant autorisation (hôte / claim réussi).
 * @returns {Promise<{ ok: boolean, claimed?: boolean, cancelled?: boolean, error?: string }>}
 */
export async function ensureLobbyHostOrOfferClaim({ reason = "host-action" } = {}) {
  if (!isGameSyncActive()) return { ok: true };
  if (isLobbyHost()) return { ok: true };

  if (!clientMayOfferHostClaim()) {
    await showAppAlert("Seul l'hôte peut effectuer cette action.", {
      title: "Action réservée",
      icon: "👑",
    });
    return { ok: false, error: "not-host" };
  }

  const lobby = getState().lobby;
  const minutes =
    hostInactiveMinutes(lobby?.participants, lobby?.hostId) ??
    Math.floor(HOST_TRANSFER_STALE_MS / 60_000);

  const accept = await showClaimHostDialog({ inactiveMinutes: minutes });
  if (!accept) {
    return { ok: false, cancelled: true };
  }

  const res = await claimLobbyHostIfStaleSupabase();
  if (!res.ok) {
    await refreshLobbyFromSupabase().catch(() => {});
    const msg = String(res.error || "");
    const hostBack = /encore actif/i.test(msg);
    await showAppAlert(
      hostBack
        ? "L'hôte est de nouveau actif. La partie a été mise à jour."
        : msg || "Impossible de reprendre le rôle d'hôte.",
      {
        title: hostBack ? "Hôte de retour" : "Transfert impossible",
        icon: "👑",
      }
    );
    return { ok: false, error: res.error || "claim-failed" };
  }

  // Ne jamais simuler hostId local avant refresh serveur
  await refreshLobbyFromSupabase();
  if (!isLobbyHost()) {
    await showAppAlert("L'hôte est de nouveau actif. La partie a été mise à jour.", {
      title: "Hôte de retour",
      icon: "👑",
    });
    return { ok: false, error: "host-returned" };
  }

  return { ok: true, claimed: true, reason };
}
