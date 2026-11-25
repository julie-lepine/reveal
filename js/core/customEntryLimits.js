/**
 * Audit contenus perso n°2 — plafonds de nombre (miroir de
 * supabase/fix-custom-entries-caps.sql, qui fait foi pour les invités).
 *
 * L'appli vérifie avant d'envoyer pour afficher tout de suite un message clair,
 * et c'est la seule barrière pour l'hôte de Hot Take / Dilemma (il écrit la partie
 * directement, sans passer par la fonction serveur).
 */

/** Prises Hot Take, dilemmes, mots Draw It, thèmes Tier Night. */
export const CUSTOM_ENTRIES_MAX_PER_PLAYER = 10;
/** Tier lists Rank Live (plus lourdes). */
export const CUSTOM_LIVE_TIER_LISTS_MAX_PER_PLAYER = 3;
/** Total par salon et par jeu. */
export const CUSTOM_ENTRIES_MAX_PER_LOBBY = 50;

export const CUSTOM_LIMIT_PLAYER = "CUSTOM_LIMIT_PLAYER";
export const CUSTOM_LIMIT_LOBBY = "CUSTOM_LIMIT_LOBBY";

/**
 * @param {{
 *   list: unknown[],
 *   isMine: (item: any) => boolean,
 *   maxPerPlayer?: number,
 *   maxPerLobby?: number,
 *   noun?: { one: string, many: string, feminine?: boolean },
 * }} opts
 * @returns {{ ok: true } | { ok: false, code: string, error: string }}
 */
export function checkCustomEntryLimit({
  list,
  isMine,
  maxPerPlayer = CUSTOM_ENTRIES_MAX_PER_PLAYER,
  maxPerLobby = CUSTOM_ENTRIES_MAX_PER_LOBBY,
  noun = { one: "contenu perso", many: "contenus perso" },
}) {
  const items = Array.isArray(list) ? list.filter(Boolean) : [];
  const mine = items.filter((item) => isMine(item)).length;
  if (mine >= maxPerPlayer) {
    const one = noun.feminine ? "une" : "un";
    return {
      ok: false,
      code: CUSTOM_LIMIT_PLAYER,
      error: `Tu as déjà ajouté ${maxPerPlayer} ${noun.many} : supprimes-en ${one} pour en ajouter ${one} autre.`,
    };
  }
  if (items.length >= maxPerLobby) {
    return {
      ok: false,
      code: CUSTOM_LIMIT_LOBBY,
      error: `Le salon a déjà ${maxPerLobby} ${noun.many} : impossible d'en ajouter.`,
    };
  }
  return { ok: true };
}

/**
 * Audit contenus perso n°4 — prise / dilemme à moi : même compte si les deux sont
 * connus, sinon même pseudo (entrées d'anciennes versions ; sans auteur = à moi,
 * comme avant). Même règle que le serveur (fix-custom-entries-caps.sql).
 */
export function isAuthorOwnedEntryMine(item, localAuthor, localAuthorUid = null) {
  if (!item) return false;
  if (localAuthorUid && item.authorUid) {
    return String(item.authorUid) === String(localAuthorUid);
  }
  return (item.author || localAuthor) === localAuthor;
}

/** Refus de plafond renvoyé par le serveur (message déjà lisible). */
export function isCustomLimitServerError(error) {
  const hint = String(error?.hint || "");
  return hint === CUSTOM_LIMIT_PLAYER || hint === CUSTOM_LIMIT_LOBBY;
}
