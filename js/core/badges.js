import { getState } from "./state.js";
import { getSortedActivePlayers } from "./players.js";

const BADGE_RULES = [
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

export function getPlayerBadges() {
  const { playerStats } = getState();
  const sorted = getSortedActivePlayers();
  const used = new Set();

  return sorted.map((p, index) => {
    const stats = playerStats[p.name] || {};
    let badge = "";

    for (const rule of BADGE_RULES) {
      if (used.has(rule.id)) continue;
      const score = rule.pick(stats);
      const best = sorted.reduce(
        (b, x) => {
          const s = rule.pick(playerStats[x.name] || {});
          return s > b.score ? { name: x.name, score: s } : b;
        },
        { name: null, score: -1 }
      );
      if (best.name === p.name && best.score > 0) {
        badge = rule.label;
        used.add(rule.id);
        break;
      }
    }

    if (!badge && index === 0) badge = "MVP de la soirée";
    else if (!badge && index === sorted.length - 1) badge = "En progression";

    return { ...p, badge, score: getState().scores[p.name] || 0 };
  });
}
