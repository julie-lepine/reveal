/** Roster de lancement prep — joueurs prêts + hôte toujours inclus. */
export function buildLaunchRoster(participants, readyMap, { readyKey = (p) => p.name } = {}) {
  const host = participants.find((p) => p.isHost);
  const hostKey = host ? readyKey(host) : null;
  const readyKeys = new Set(
    participants.filter((p) => readyMap[readyKey(p)]).map((p) => readyKey(p))
  );
  if (hostKey != null && !readyKeys.has(hostKey)) {
    readyKeys.add(hostKey);
  }
  const roster = participants.filter((p) => readyKeys.has(readyKey(p))).map((p) => p.name);
  const excluded = participants.filter((p) => !readyKeys.has(readyKey(p))).map((p) => p.name);
  return { roster, excluded };
}
