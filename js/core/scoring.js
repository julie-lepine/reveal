import {
  HOT_TAKE_POINTS_MAJORITY,
  HOT_TAKE_POINTS_DISSENT,
} from "../../data/hotTakes.js";
import { addScore, bumpPlayerStat } from "./state.js";
import { getMajorityOption } from "./hotTakeSession.js";

export function awardHotTakeVotes(votes, options) {
  const { majority } = getMajorityOption(votes, options);
  const summary = { majority, dissenters: [], majorityWinners: [] };

  Object.entries(votes).forEach(([name, choice]) => {
    if (choice === majority) {
      addScore(name, HOT_TAKE_POINTS_MAJORITY);
      bumpPlayerStat(name, "hotTakeMajorityWins", 1);
      summary.majorityWinners.push(name);
    } else {
      addScore(name, HOT_TAKE_POINTS_DISSENT);
      bumpPlayerStat(name, "hotTakeDissentWins", 1);
      summary.dissenters.push(name);
    }
  });

  return summary;
}
