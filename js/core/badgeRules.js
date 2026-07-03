export const BADGE_RULES = [
  {
    id: "chaotic",
    label: "L'outsider en chef",
    pick: (stats) => (stats.hotTakeDissentWins || 0) + (stats.liesFooled || 0) * 2,
  },
  {
    id: "popular",
    label: "Le plus populaire",
    pick: (stats) => stats.hotTakeMajorityWins || 0,
  },
  {
    id: "controversial",
    label: "Très controversé",
    pick: (stats) => (stats.hotTakeDissentWins || 0) + (stats.hotTakeMajorityWins || 0),
  },
  {
    id: "impostor",
    label: "L'imposteur",
    pick: (stats) => stats.liesFooled || 0,
  },
  {
    id: "detective",
    label: "Le détective",
    pick: (stats) => stats.liesDetected || 0,
  },
  {
    id: "tierist",
    label: "Esprit consensus",
    pick: (stats) => stats.tierConsensusPoints || 0,
  },
];

/** Attribution globale : une règle = un gagnant (score le plus haut). */
export function buildBadgeMap(playerStats = {}, playerNames = []) {
  const badgeByName = {};
  for (const rule of BADGE_RULES) {
    let best = { name: null, score: -1 };
    for (const name of playerNames) {
      const s = rule.pick(playerStats[name] || {});
      if (
        s > best.score ||
        (s === best.score && s > 0 && name.localeCompare(best.name || "\uffff") < 0)
      ) {
        best = { name, score: s };
      }
    }
    if (best.name && best.score > 0) {
      badgeByName[best.name] = rule.label;
    }
  }
  return badgeByName;
}
