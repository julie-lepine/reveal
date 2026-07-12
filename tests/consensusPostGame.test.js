import { describe, it } from "node:test";
import assert from "node:assert/strict";

/** Miroir de completeGameSession (gameSync.js) — vérifie le contrat post-partie Consensus. */
const POST_GAME_SCREENS = new Set(["results", "leaderboard"]);

function completeGameSessionGameId(screen, gameId) {
  return POST_GAME_SCREENS.has(screen) ? "menu" : gameId;
}

/** Extrait minimal de getEffectiveSessionScreen pour le cas Consensus (sans charger gameSync). */
function effectiveScreenAfterConsensusClose({ screen, game_id, state }) {
  const declared = screen;
  const st = state || {};
  const gid = game_id;

  if (declared && POST_GAME_SCREENS.has(declared)) {
    return declared;
  }
  if (st.consensus) {
    if (gid === "consensus" || declared === "consensus-prep") return "consensus-prep";
  }
  return declared;
}

describe("Consensus post-game session contract", () => {
  it("completeGameSession avec screen results produit game_id menu", () => {
    assert.equal(completeGameSessionGameId("results", "consensus"), "menu");
  });

  it("une session clôturée en results ne résout pas consensus-prep", () => {
    assert.equal(
      effectiveScreenAfterConsensusClose({
        screen: "results",
        game_id: "menu",
        state: {
          consensus: { lobbyStarted: false, phase: "final", podiumApplied: true },
        },
      }),
      "results"
    );
  });

  it("régression : screen consensus + game_id consensus infère consensus-prep", () => {
    assert.equal(
      effectiveScreenAfterConsensusClose({
        screen: "consensus",
        game_id: "consensus",
        state: { consensus: { lobbyStarted: false, phase: "final" } },
      }),
      "consensus-prep"
    );
  });
});
