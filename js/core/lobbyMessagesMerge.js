/**
 * Audit chat (2026-11-24) — messages du salon sans tout recharger.
 * La base ne garde que les 50 derniers messages par salon (déclencheur
 * `lobby_messages_keep_latest`) ; l'appli suit la même règle.
 */

export const LOBBY_CHAT_MAX_MESSAGES = 50;

/** Ligne `lobby_messages` → message de l'état local. */
export function lobbyMessageFromRow(row) {
  if (!row || row.id == null) return null;
  return {
    id: row.id,
    from: row.display_name,
    text: row.body,
    at: new Date(row.created_at).getTime(),
    userId: row.user_id || null,
  };
}

/**
 * Ajoute des messages (sans doublon, par id), trie par date, garde les 50 derniers.
 * Renvoie la liste d'origine si rien n'a changé.
 */
export function mergeLobbyMessages(current, incoming) {
  const list = Array.isArray(current) ? current : [];
  const known = new Set(list.map((m) => String(m?.id)));
  const added = (incoming || []).filter((m) => m && m.id != null && !known.has(String(m.id)));
  if (!added.length) return list;
  return [...list, ...added]
    .sort((a, b) => (Number(a.at) || 0) - (Number(b.at) || 0))
    .slice(-LOBBY_CHAT_MAX_MESSAGES);
}
