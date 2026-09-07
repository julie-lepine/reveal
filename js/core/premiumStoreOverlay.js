/**
 * RC-RESTORE — helpers purs overlay session vs flags serveur.
 * N’écrit jamais `profiles.host_pack`.
 */
import { PACK_HOST_LABEL, PACK_SIGNATURE_LABEL } from "../config/premiumPacks.js";

/** Aligné achat / restore existants : 8 × 1 s. */
export const PREMIUM_STORE_POLL_TRIES = 8;
export const PREMIUM_STORE_POLL_DELAY_MS = 1000;

export function emptyPremiumFlags() {
  return { adFree: false, profilePack: false, hostPack: false };
}

export function normalizePremiumFlags(input = {}) {
  return {
    adFree: input.adFree === true,
    profilePack: input.profilePack === true,
    hostPack: input.hostPack === true,
  };
}

/**
 * Serveur = SoT persistante. Overlay store comble un webhook pas encore arrivé.
 * Un flag serveur true n’est jamais retiré par un overlay false.
 */
export function mergePremiumSessionFlags(server, overlay) {
  const s = normalizePremiumFlags(server);
  const o = normalizePremiumFlags(overlay);
  const hostPack = s.hostPack || o.hostPack;
  const profilePack = s.profilePack || o.profilePack || hostPack;
  const adFree = s.adFree || o.adFree || profilePack;
  return { adFree, profilePack, hostPack };
}

export function hasAnyStoreEntitlement(fromStore) {
  const f = normalizePremiumFlags(fromStore);
  return f.adFree || f.profilePack || f.hostPack;
}

/**
 * Si le store confirme `host`, le poll ne s’arrête pas sur Signature déjà en base.
 * Sans entitlement host : comportement historique (profile / ad-free).
 */
export function shouldContinuePremiumStorePoll({
  fromStore,
  server,
  attemptIndex = 0,
} = {}) {
  const store = normalizePremiumFlags(fromStore);
  const srv = normalizePremiumFlags(server);
  if (store.hostPack) return !srv.hostPack;
  if (srv.hostPack || srv.profilePack) return false;
  if (srv.adFree && attemptIndex >= 2) return false;
  return true;
}

export function hostPackPendingActivationMessage() {
  return `${PACK_HOST_LABEL} est confirmé par votre achat. L’activation peut prendre jusqu’à une minute.`;
}

export function premiumRestoreUserMessage({
  alreadyOwned = false,
  hostPack = false,
  profilePack = false,
  adFree = false,
  pendingServerHost = false,
} = {}) {
  if (hostPack && pendingServerHost) {
    return hostPackPendingActivationMessage();
  }
  if (alreadyOwned) {
    if (hostPack) {
      return `${PACK_HOST_LABEL} est déjà actif sur ce compte Play — c’est maintenant affiché. Signature et Sans pub inclus.`;
    }
    if (profilePack) {
      return `${PACK_SIGNATURE_LABEL} est déjà actif sur ce compte Play — c’est maintenant affiché. Sans pub inclus.`;
    }
    if (adFree) {
      return "Sans pub est déjà actif sur ce compte Play — c’est maintenant affiché.";
    }
    return "Cet achat est déjà sur ce compte Play. Appuie sur Restaurer les achats si le forfait n’apparaît pas.";
  }
  if (hostPack) {
    return `${PACK_HOST_LABEL} est de nouveau actif sur ce compte. Signature et Sans pub inclus.`;
  }
  if (profilePack) {
    return `${PACK_SIGNATURE_LABEL} est de nouveau actif sur ce compte. Sans pub inclus.`;
  }
  if (adFree) {
    return "Sans pub est de nouveau actif sur ce compte.";
  }
  return "Aucun achat trouvé pour ce compte.";
}
