import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  competitionRanksFromSortedScores,
  withCompetitionRanks,
  podiumPointsForRank,
  formatNameList,
  formatWinnersLabel,
  formatCoLeadersHint,
  medalForCompetitionRank,
  sortAndRankByScore,
} from "../js/core/competitionRank.js";
import { TRIVIA_LOBBY_PODIUM_POINTS } from "../data/trivia.js";
import { CLUTCH_PODIUM_POINTS } from "../data/clutch.js";
import { WRONG_ANSWER_PODIUM_POINTS } from "../data/wrongAnswer.js";
import { computeWrongAnswerRoundAward } from "../js/core/wrongAnswerScoring.js";

/** Miroir du tri Clutch (gap puis at) - sans importer clutchSession (Supabase). */
function rankClutchLike(taps, targetMs, names) {
  return names
    .map((name) => {
      const t = taps[name];
      const tapped = t && typeof t.ms === "number";
      const ms = tapped ? t.ms : null;
      const gap = tapped ? Math.abs(ms - targetMs) : Infinity;
      const at = t && typeof t.at === "number" ? t.at : Infinity;
      return { name, ms, gap, tapped, at };
    })
    .sort((a, b) => (a.gap !== b.gap ? a.gap - b.gap : a.at - b.at));
}

/** Miroir score-box / leaderboard soirée (même contrat que rankPlayersByScoreMap). */
function rankPlayersByScoreMap(players, scores) {
  return sortAndRankByScore(players, (p) => scores[p.name] || 0);
}

describe("competitionRanksFromSortedScores", () => {
  it("aucun ex æquo : 1, 2, 3", () => {
    assert.deepEqual(competitionRanksFromSortedScores([10, 9, 8]), [1, 2, 3]);
  });

  it("deux premiers ex æquo : 1, 1, 3", () => {
    assert.deepEqual(competitionRanksFromSortedScores([10, 10, 8]), [1, 1, 3]);
  });

  it("égalité en deuxième place : 1, 2, 2, 4", () => {
    assert.deepEqual(competitionRanksFromSortedScores([10, 9, 9, 7]), [1, 2, 2, 4]);
  });

  it("trois premiers ex æquo : 1, 1, 1, 4", () => {
    assert.deepEqual(competitionRanksFromSortedScores([10, 10, 10, 7]), [1, 1, 1, 4]);
  });

  it("quatre premiers ex æquo : tous rang 1", () => {
    assert.deepEqual(competitionRanksFromSortedScores([5, 5, 5, 5]), [1, 1, 1, 1]);
  });

  it("un 1er puis trois 2e : 1, 2, 2, 2", () => {
    assert.deepEqual(competitionRanksFromSortedScores([10, 8, 8, 8]), [1, 2, 2, 2]);
  });

  it("deux 1ers puis deux 3e : 1, 1, 3, 3", () => {
    assert.deepEqual(competitionRanksFromSortedScores([10, 10, 7, 7]), [1, 1, 3, 3]);
  });
});

describe("Trivia bonus + médailles par rang", () => {
  it("deux premiers +15 et 🥇 chacun ; suivant rang 3 → +5 🥉 ; noms inversés identiques", () => {
    const award = (order) =>
      withCompetitionRanks(
        order.map((name) => ({ name, score: name === "Carol" ? 8 : 10 })),
        (p) => p.score
      ).map((p) => ({
        rank: p.rank,
        lobbyBonus: podiumPointsForRank(p.rank, TRIVIA_LOBBY_PODIUM_POINTS),
        medal: medalForCompetitionRank(p.rank),
      }));

    const expected = [
      { rank: 1, lobbyBonus: 15, medal: "🥇" },
      { rank: 1, lobbyBonus: 15, medal: "🥇" },
      { rank: 3, lobbyBonus: 5, medal: "🥉" },
    ];
    assert.deepEqual(award(["Alice", "Bob", "Carol"]), expected);
    assert.deepEqual(award(["Bob", "Alice", "Carol"]), expected);
  });

  it("égalité 2e place : rangs 1,2,2,4 et bonus 15/10/10/0", () => {
    const ranked = withCompetitionRanks(
      [
        { name: "A", score: 30 },
        { name: "B", score: 20 },
        { name: "C", score: 20 },
        { name: "D", score: 5 },
      ],
      (p) => p.score
    );
    assert.deepEqual(
      ranked.map((p) => [
        p.rank,
        podiumPointsForRank(p.rank, TRIVIA_LOBBY_PODIUM_POINTS),
        medalForCompetitionRank(p.rank),
      ]),
      [
        [1, 15, "🥇"],
        [2, 10, "🥈"],
        [2, 10, "🥈"],
        [4, 0, "•"],
      ]
    );
  });
});

describe("Copies gagnant", () => {
  it("singulière", () => {
    assert.equal(formatWinnersLabel([{ name: "Alice", rank: 1 }]), "gagnant : Alice");
    assert.equal(formatNameList(["Alice"]), "Alice");
    assert.equal(formatCoLeadersHint([{ name: "Alice" }]), "");
  });

  it("plurielle à deux", () => {
    assert.equal(
      formatWinnersLabel([
        { name: "Alice", rank: 1 },
        { name: "Bob", rank: 1 },
      ]),
      "gagnants : Alice et Bob"
    );
    assert.equal(
      formatCoLeadersHint([{ name: "Alice" }, { name: "Bob" }]),
      "Alice et Bob sont premiers ex æquo"
    );
  });

  it("plurielle à trois ou plus", () => {
    assert.equal(formatNameList(["Alice", "Bob", "Carol"]), "Alice, Bob et Carol");
    assert.equal(
      formatWinnersLabel([
        { name: "Alice", rank: 1 },
        { name: "Bob", rank: 1 },
        { name: "Carol", rank: 1 },
      ]),
      "gagnants : Alice, Bob et Carol"
    );
    assert.match(
      formatCoLeadersHint([{ name: "A" }, { name: "B" }, { name: "C" }, { name: "D" }]),
      /sont premiers ex æquo/
    );
  });
});

describe("Score boxes / leaderboards soirée (contrat)", () => {
  it("égalité → mêmes rangs ; ordre noms inversé sans changer rangs ni ordre final", () => {
    const players = [
      { name: "Zoé" },
      { name: "Alice" },
      { name: "Bob" },
    ];
    const scores = { Zoé: 10, Alice: 10, Bob: 4 };
    const a = rankPlayersByScoreMap(players, scores);
    const b = rankPlayersByScoreMap([...players].reverse(), scores);
    assert.deepEqual(
      a.map((p) => [p.name, p.rank]),
      [
        ["Alice", 1],
        ["Zoé", 1],
        ["Bob", 3],
      ]
    );
    assert.deepEqual(
      b.map((p) => [p.name, p.rank]),
      a.map((p) => [p.name, p.rank])
    );
  });
});

describe("Wrong Answer ex æquo", () => {
  it("trois ex æquo en tête : podium +15 + votes ; rang 4 → votes seuls", () => {
    const answers = {
      Alice: { text: "a", at: 300 },
      Bob: { text: "b", at: 100 },
      Carol: { text: "c", at: 200 },
      Dave: { text: "d", at: 50 },
    };
    const votes = {
      A: "Alice",
      B: "Bob",
      C: "Carol",
      D: "Alice",
      E: "Bob",
      F: "Carol",
      G: "Dave",
    };
    const { deltas, ranking } = computeWrongAnswerRoundAward(answers, votes);
    assert.deepEqual(
      ranking.map((r) => [r.name, r.votes, r.rank]),
      [
        ["Alice", 2, 1],
        ["Bob", 2, 1],
        ["Carol", 2, 1],
        ["Dave", 1, 4],
      ]
    );
    // GAME-WAO-01 : podium + 5/vote - Dave hors podium marque quand même ses votes.
    assert.deepEqual(deltas, {
      Alice: WRONG_ANSWER_PODIUM_POINTS[0] + 2 * 5,
      Bob: WRONG_ANSWER_PODIUM_POINTS[0] + 2 * 5,
      Carol: WRONG_ANSWER_PODIUM_POINTS[0] + 2 * 5,
      Dave: 5,
    });
  });

  it("timestamp n'influence ni rang ni points (ordre at inversé)", () => {
    const votes = { x: "Alice", y: "Bob", z: "Alice", w: "Bob" };
    const r1 = computeWrongAnswerRoundAward(
      { Alice: { text: "a", at: 999 }, Bob: { text: "b", at: 1 } },
      votes
    );
    const r2 = computeWrongAnswerRoundAward(
      { Alice: { text: "a", at: 1 }, Bob: { text: "b", at: 999 } },
      votes
    );
    assert.deepEqual(r1.deltas, r2.deltas);
    assert.deepEqual(
      r1.ranking.map((x) => [x.name, x.rank]),
      r2.ranking.map((x) => [x.name, x.rank])
    );
    assert.equal(r1.deltas.Alice, WRONG_ANSWER_PODIUM_POINTS[0] + 2 * 5);
    assert.equal(r1.deltas.Bob, WRONG_ANSWER_PODIUM_POINTS[0] + 2 * 5);
  });
});

describe("Clutch départage temporel inchangé (contrat produit)", () => {
  it("même écart : tap plus tôt devant ; points podium exclusifs 15/10", () => {
    const ranking = rankClutchLike(
      {
        Alice: { ms: 10000, at: 200 },
        Bob: { ms: 10000, at: 100 },
      },
      10000,
      ["Alice", "Bob"]
    );
    assert.deepEqual(
      ranking.map((e) => e.name),
      ["Bob", "Alice"]
    );
    assert.equal(ranking[0].gap, ranking[1].gap);

    const deltas = {};
    let podiumIdx = 0;
    ranking.forEach((entry) => {
      if (!entry.tapped) return;
      const pts = CLUTCH_PODIUM_POINTS[podiumIdx];
      podiumIdx += 1;
      if (pts == null) return;
      deltas[entry.name] = pts;
    });
    assert.deepEqual(deltas, { Bob: 15, Alice: 10 });
  });
});

describe("sortAndRankByScore", () => {
  it("stabilise l'affichage sans changer les rangs", () => {
    const ranked = sortAndRankByScore([
      { name: "Bob", score: 10 },
      { name: "Alice", score: 10 },
    ]);
    assert.deepEqual(
      ranked.map((r) => [r.name, r.rank]),
      [
        ["Alice", 1],
        ["Bob", 1],
      ]
    );
  });
});
