/**
 * FEATURE-CHAT-03 — TTL hybride, horloges, stale IDs, contrats.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CHAT_ROULETTE_DURATION_MS,
  CHAT_ROULETTE_MAX_REROLLS,
  CHAT_ROULETTE_TTL_MS,
  CHAT_ROULETTE_MAX_LOCAL_LIFETIME_MS,
  CHAT_ROULETTE_SERVER_AGE_SKEW_MS,
  CHAT_ROULETTE_WINK_AT_DRAW,
  CHAT_ROULETTE_BRIDGE_AT_DRAW,
  buildChatRoulettePromptPayload,
  buildChatRouletteSpinPayload,
  buildEligibleCatalogGames,
  buildSlotReel,
  canRerollChatRoulette,
  catalogTileMinPlayers,
  chatRouletteActivityKey,
  chatRouletteBridgeCopy,
  chatRouletteShouldShowResult,
  chatRouletteSpinProgress,
  chatRouletteWinkLine,
  computeChatRouletteExpiresAt,
  isCatalogTileEligibleForCount,
  isChatRouletteActionCurrent,
  isChatRouletteBlockingLaunch,
  isChatRouletteActive,
  localScreenAllowsChatRoulette,
  normalizeChatRouletteEvent,
  observeChatRouletteActivity,
  pickChatRouletteNextGame,
  pickRandomEligibleGame,
  remotePhaseAllowsChatRoulette,
  resetChatRouletteObservationsForTests,
  resolveChatRouletteResultAct,
  resolveEligibleCatalogGames,
  resolveExcludedTileIds,
} from "../js/core/chatRandomGameLogic.js";
import { TILE_ID_TO_SESSION_GAME_ID } from "../js/core/gameCatalogTitle.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const TEN_MIN = 10 * 60 * 1000;

const sampleGames = [
  { id: "hottake-prep", title: "HotTake", emoji: "🔥", enabled: true },
  { id: "consensus-prep", title: "Consensus", emoji: "🤝", enabled: true },
  { id: "traitre-prep", title: "Spot the fake", emoji: "🎭", enabled: true },
  { id: "truthmeter-prep", title: "TruthMeter", emoji: "📏", enabled: true },
  { id: "ghost-prep", title: "Ghost", emoji: "👻", enabled: true },
];

function baseEvent(over = {}) {
  const now = 1_000_000;
  return {
    rouletteId: "r-A",
    attemptId: "a-1",
    phase: "prompt",
    selectedTileId: null,
    eligibleTileIds: ["hottake-prep", "consensus-prep", "traitre-prep"],
    drawCount: 0,
    createdAt: now,
    animationStartTimestamp: null,
    animationDurationMs: CHAT_ROULETTE_DURATION_MS,
    expiresAt: computeChatRouletteExpiresAt(now),
    rerollCount: 0,
    maxRerolls: CHAT_ROULETTE_MAX_REROLLS,
    ...over,
  };
}

beforeEach(() => {
  resetChatRouletteObservationsForTests();
});

describe("FEATURE-CHAT-03 — éligibilité", () => {
  it("catalogue tile min players (miroir launchers)", () => {
    assert.equal(catalogTileMinPlayers("traitre-prep"), 3);
    assert.equal(catalogTileMinPlayers("truthmeter-prep"), 2);
    assert.equal(catalogTileMinPlayers("hottake-prep"), 1);
  });

  it("exclut jeux sans mapping / sous le min joueurs", () => {
    const eligible = buildEligibleCatalogGames({
      games: sampleGames,
      playerCount: 2,
    });
    const ids = eligible.map((g) => g.id);
    assert.ok(ids.includes("hottake-prep"));
    assert.ok(!ids.includes("traitre-prep"));
    assert.ok(!ids.includes("ghost-prep"));
  });

  it("fallback si exclusion vide le pool", () => {
    const eligible = resolveEligibleCatalogGames({
      games: [{ id: "hottake-prep", title: "HotTake", emoji: "🔥", enabled: true }],
      playerCount: 4,
      sessionGameId: "menu",
      sessionScreen: "game-select",
      lastGameId: "hottake",
    });
    assert.equal(eligible[0].id, "hottake-prep");
  });

  it("revalidation traitre après départ joueur", () => {
    assert.equal(isCatalogTileEligibleForCount("traitre-prep", 4), true);
    assert.equal(isCatalogTileEligibleForCount("traitre-prep", 2), false);
  });

  it("pick déterministe", () => {
    const pool = buildEligibleCatalogGames({ games: sampleGames, playerCount: 4 });
    assert.equal(pickRandomEligibleGame(pool, () => 0.99).id, pool.at(-1).id);
  });

  it("exclut dernier jeu entre parties", () => {
    assert.deepEqual(
      resolveExcludedTileIds({
        sessionGameId: "menu",
        sessionScreen: "results",
        lastGameId: "hottake",
      }),
      ["hottake-prep"]
    );
  });
});

describe("FEATURE-CHAT-03 — TTL hybride / horloges", () => {
  it("constantes : MAX_LOCAL = TTL indicatif hôte", () => {
    assert.equal(CHAT_ROULETTE_MAX_LOCAL_LIFETIME_MS, CHAT_ROULETTE_TTL_MS);
    assert.ok(CHAT_ROULETTE_SERVER_AGE_SKEW_MS > 0);
  });

  it("1. horloge hôte avancée 10 min : expiresAt futur ne prolonge pas au-delà MAX_LOCAL mono", () => {
    const guestWall = 5_000_000;
    const hostAheadCreated = guestWall + TEN_MIN;
    const ev = baseEvent({
      createdAt: hostAheadCreated,
      expiresAt: hostAheadCreated + CHAT_ROULETTE_TTL_MS + TEN_MIN,
    });
    const serverTs = guestWall; // Postgres updated_at ≈ vrai maintenant
    const obs = observeChatRouletteActivity(ev, {
      nowMonotonic: 100,
      sessionUpdatedAtMs: serverTs,
    });
    assert.equal(
      isChatRouletteBlockingLaunch({
        chatRoulette: ev,
        localObservation: obs,
        nowWallClock: guestWall,
        nowMonotonic: 100,
        sessionUpdatedAtMs: serverTs,
      }),
      true
    );
    assert.equal(
      isChatRouletteBlockingLaunch({
        chatRoulette: ev,
        localObservation: obs,
        nowWallClock: guestWall,
        nowMonotonic: 100 + CHAT_ROULETTE_MAX_LOCAL_LIFETIME_MS + 1,
        sessionUpdatedAtMs: serverTs,
      }),
      false
    );
  });

  it("2. horloge hôte retardée 10 min : expiresAt passé n’expire pas immédiatement", () => {
    const guestWall = 5_000_000;
    const hostBehindCreated = guestWall - TEN_MIN;
    const ev = baseEvent({
      createdAt: hostBehindCreated,
      expiresAt: hostBehindCreated + 1000, // déjà « expiré » selon hôte
    });
    const serverTs = guestWall;
    const obs = observeChatRouletteActivity(ev, {
      nowMonotonic: 50,
      sessionUpdatedAtMs: serverTs,
    });
    assert.equal(
      isChatRouletteBlockingLaunch({
        chatRoulette: ev,
        localObservation: obs,
        nowWallClock: guestWall,
        nowMonotonic: 50,
        sessionUpdatedAtMs: serverTs,
      }),
      true
    );
  });

  it("3. horloge invitée avancée : âge serveur trop grand → inactive", () => {
    const serverTs = 1_000_000;
    const guestWallAhead = serverTs + TEN_MIN;
    const ev = baseEvent({ createdAt: serverTs, expiresAt: serverTs + CHAT_ROULETTE_TTL_MS });
    assert.equal(
      isChatRouletteBlockingLaunch({
        chatRoulette: ev,
        nowWallClock: guestWallAhead,
        sessionUpdatedAtMs: serverTs,
        nowMonotonic: 0,
        localObservation: {
          activityKey: chatRouletteActivityKey(ev),
          firstSeenMono: 0,
          serverUpdatedAtMs: serverTs,
        },
      }),
      false
    );
  });

  it("4. horloge invitée retardée : serverAge négatif → actif, mono borne toujours", () => {
    const serverTs = 5_000_000;
    const guestWallBehind = serverTs - TEN_MIN;
    const ev = baseEvent({
      createdAt: serverTs,
      expiresAt: serverTs + CHAT_ROULETTE_TTL_MS,
    });
    const obs = observeChatRouletteActivity(ev, {
      nowMonotonic: 10,
      sessionUpdatedAtMs: serverTs,
    });
    assert.equal(
      isChatRouletteBlockingLaunch({
        chatRoulette: ev,
        localObservation: obs,
        nowWallClock: guestWallBehind,
        nowMonotonic: 10,
        sessionUpdatedAtMs: serverTs,
      }),
      true
    );
    assert.equal(
      isChatRouletteBlockingLaunch({
        chatRoulette: ev,
        localObservation: obs,
        nowWallClock: guestWallBehind,
        nowMonotonic: 10 + CHAT_ROULETTE_MAX_LOCAL_LIFETIME_MS + 1,
        sessionUpdatedAtMs: serverTs,
      }),
      false
    );
  });

  it("5. même événement reçu plusieurs fois : TTL local non rafraîchi", () => {
    const ev = baseEvent();
    const a = observeChatRouletteActivity(ev, {
      nowMonotonic: 1000,
      sessionUpdatedAtMs: 1_000_000,
    });
    const b = observeChatRouletteActivity(ev, {
      nowMonotonic: 5000,
      sessionUpdatedAtMs: 1_000_000,
    });
    assert.equal(a.firstSeenMono, 1000);
    assert.equal(b.firstSeenMono, 1000);
  });

  it("6. rerender / observe répété : firstSeenMono stable", () => {
    const ev = baseEvent();
    observeChatRouletteActivity(ev, { nowMonotonic: 42, sessionUpdatedAtMs: 9 });
    for (let i = 0; i < 5; i++) {
      const o = observeChatRouletteActivity(ev, {
        nowMonotonic: 42 + i * 1000,
        sessionUpdatedAtMs: 9,
      });
      assert.equal(o.firstSeenMono, 42);
    }
  });

  it("7. nouvel attemptId : nouvelle fenêtre", () => {
    const a1 = baseEvent({ attemptId: "a-1" });
    const a2 = baseEvent({ attemptId: "a-2" });
    const o1 = observeChatRouletteActivity(a1, {
      nowMonotonic: 100,
      sessionUpdatedAtMs: 1_000_000,
    });
    const o2 = observeChatRouletteActivity(a2, {
      nowMonotonic: 500,
      sessionUpdatedAtMs: 1_000_000,
    });
    assert.notEqual(o1.activityKey, o2.activityKey);
    assert.equal(o2.firstSeenMono, 500);
  });

  it("8. nouvelle rouletteId : nouvelle fenêtre", () => {
    const r1 = baseEvent({ rouletteId: "R1" });
    const r2 = baseEvent({ rouletteId: "R2" });
    observeChatRouletteActivity(r1, { nowMonotonic: 1, sessionUpdatedAtMs: 1 });
    const o2 = observeChatRouletteActivity(r2, {
      nowMonotonic: 99,
      sessionUpdatedAtMs: 1,
    });
    assert.equal(o2.firstSeenMono, 99);
  });

  it("9. expiration distante excessivement future : clamp via mono MAX_LOCAL", () => {
    const ev = baseEvent({
      expiresAt: Date.now() + 365 * 24 * 3600 * 1000,
    });
    const serverTs = 2_000_000;
    const obs = observeChatRouletteActivity(ev, {
      nowMonotonic: 0,
      sessionUpdatedAtMs: serverTs,
    });
    assert.equal(
      isChatRouletteBlockingLaunch({
        chatRoulette: ev,
        localObservation: obs,
        nowWallClock: serverTs,
        nowMonotonic: CHAT_ROULETTE_MAX_LOCAL_LIFETIME_MS + 1,
        sessionUpdatedAtMs: serverTs,
      }),
      false
    );
  });

  it("10. expiration distante excessivement passée + serveur frais : toujours actif via mono", () => {
    const serverTs = 3_000_000;
    const ev = baseEvent({
      createdAt: 1,
      expiresAt: 2,
    });
    const obs = observeChatRouletteActivity(ev, {
      nowMonotonic: 0,
      sessionUpdatedAtMs: serverTs,
    });
    assert.equal(
      isChatRouletteBlockingLaunch({
        chatRoulette: ev,
        localObservation: obs,
        nowWallClock: serverTs,
        nowMonotonic: 10,
        sessionUpdatedAtMs: serverTs,
      }),
      true
    );
  });

  it("11. reconnexion après longue absence : updated_at ancien → inactive", () => {
    const serverTs = 1_000_000;
    const nowWall = serverTs + TEN_MIN;
    const ev = baseEvent({
      createdAt: serverTs,
      expiresAt: serverTs + CHAT_ROULETTE_TTL_MS + TEN_MIN,
    });
    assert.equal(
      isChatRouletteBlockingLaunch({
        chatRoulette: ev,
        nowWallClock: nowWall,
        sessionUpdatedAtMs: serverTs,
        nowMonotonic: 0,
        localObservation: null,
      }),
      false
    );
  });

  it("12. reprise d’hôte après expiration : plus de blocage", () => {
    const ev = baseEvent({ phase: "cancelled" });
    assert.equal(
      isChatRouletteBlockingLaunch({
        chatRoulette: ev,
        nowWallClock: Date.now(),
        sessionUpdatedAtMs: Date.now(),
        nowMonotonic: 0,
        localObservation: {
          activityKey: chatRouletteActivityKey(ev),
          firstSeenMono: 0,
        },
      }),
      false
    );
  });

  it("13. ancien événement ne bloque plus (mono dépassé)", () => {
    const ev = baseEvent();
    const serverTs = 1_000_000;
    const obs = observeChatRouletteActivity(ev, {
      nowMonotonic: 0,
      sessionUpdatedAtMs: serverTs,
    });
    assert.equal(
      isChatRouletteBlockingLaunch({
        chatRoulette: ev,
        localObservation: obs,
        nowWallClock: serverTs,
        nowMonotonic: CHAT_ROULETTE_MAX_LOCAL_LIFETIME_MS + 5,
        sessionUpdatedAtMs: serverTs,
      }),
      false
    );
  });

  it("14. événement réellement actif bloque toujours", () => {
    const ev = baseEvent();
    const serverTs = 4_000_000;
    const obs = observeChatRouletteActivity(ev, {
      nowMonotonic: 0,
      sessionUpdatedAtMs: serverTs,
    });
    assert.equal(
      isChatRouletteBlockingLaunch({
        chatRoulette: ev,
        localObservation: obs,
        nowWallClock: serverTs,
        nowMonotonic: 100,
        sessionUpdatedAtMs: serverTs,
      }),
      true
    );
  });

  it("15. seek cosmétique indépendant du TTL métier", () => {
    const ev = baseEvent({
      phase: "spinning",
      selectedTileId: "hottake-prep",
      animationStartTimestamp: 1000,
      animationDurationMs: 2000,
      expiresAt: 0, // métier « mort » côté expiresAt
    });
    assert.equal(chatRouletteSpinProgress(ev, 1000), 0);
    assert.equal(chatRouletteSpinProgress(ev, 2000), 0.5);
    assert.equal(chatRouletteSpinProgress(ev, 3000), 1);
    assert.equal(chatRouletteShouldShowResult(ev, 3000), true);
    // Métier peut être inactif sans casser le seek
    assert.equal(
      isChatRouletteBlockingLaunch({
        chatRoulette: ev,
        nowWallClock: 9_000_000,
        sessionUpdatedAtMs: 1_000_000,
      }),
      false
    );
  });
});

describe("FEATURE-CHAT-03 — IDs stale / payloads", () => {
  it("annulation A ≠ B", () => {
    assert.equal(
      isChatRouletteActionCurrent({ rouletteId: "A" }, { rouletteId: "B" }),
      false
    );
  });

  it("attempt mismatch", () => {
    assert.equal(
      isChatRouletteActionCurrent(
        { rouletteId: "R", attemptId: "A" },
        { rouletteId: "R", attemptId: "B" },
        { matchAttempt: true }
      ),
      false
    );
  });

  it("spin conserve rouletteId, change attemptId", () => {
    const prompt = buildChatRoulettePromptPayload(
      [{ id: "hottake-prep" }, { id: "consensus-prep" }],
      5000
    );
    const spin = buildChatRouletteSpinPayload(
      normalizeChatRouletteEvent(prompt),
      { id: "hottake-prep" },
      [{ id: "hottake-prep" }, { id: "consensus-prep" }],
      { now: 5500 }
    );
    assert.equal(spin.rouletteId, prompt.rouletteId);
    assert.notEqual(spin.attemptId, prompt.attemptId);
  });
});

describe("FEATURE-CHAT-03 — sync / reel / hub", () => {
  it("normalise spinning", () => {
    const ev = normalizeChatRouletteEvent(
      baseEvent({
        phase: "spinning",
        selectedTileId: "hottake-prep",
        animationStartTimestamp: 1000,
      })
    );
    assert.equal(ev.phase, "spinning");
  });

  it("reel atterrit sur gagnant", () => {
    const games = [
      { id: "a", title: "A", emoji: "1" },
      { id: "b", title: "B", emoji: "2" },
    ];
    const { reel, landingIndex } = buildSlotReel(games, "b", { loops: 2 });
    assert.equal(reel[landingIndex].id, "b");
  });

  it("écrans hub", () => {
    assert.equal(localScreenAllowsChatRoulette("game-select"), true);
    assert.equal(
      remotePhaseAllowsChatRoulette(
        { game_id: "menu", screen: "results" },
        "menu"
      ),
      true
    );
  });

  it("canReroll disponible même après 3+ tirages (pas de hard cap)", () => {
    const ev = baseEvent({
      phase: "result",
      selectedTileId: "hottake-prep",
      animationStartTimestamp: 1,
      drawCount: 5,
      rerollCount: 4,
      eligibleTileIds: ["hottake-prep", "consensus-prep", "traitre-prep"],
    });
    assert.equal(
      canRerollChatRoulette(ev, {
        nowWallClock: 1_000_000,
        sessionUpdatedAtMs: 1_000_000,
        nowMonotonic: 0,
        localObservation: {
          activityKey: chatRouletteActivityKey(ev),
          firstSeenMono: 0,
          serverUpdatedAtMs: 1_000_000,
        },
      }),
      true
    );
  });

  it("isChatRouletteActive délègue au blocking launch", () => {
    assert.equal(isChatRouletteActive(null), false);
    assert.equal(isChatRouletteActive(baseEvent({ phase: "cancelled" })), false);
  });
});

describe("FEATURE-CHAT-03 — soft voice / tirage libre + anti-répétition", () => {
  it("seuils internes wink/bridge", () => {
    assert.equal(resolveChatRouletteResultAct(1), "plain");
    assert.equal(resolveChatRouletteResultAct(2), "plain");
    assert.equal(resolveChatRouletteResultAct(CHAT_ROULETTE_WINK_AT_DRAW), "wink");
    assert.equal(resolveChatRouletteResultAct(CHAT_ROULETTE_BRIDGE_AT_DRAW), "bridge");
    assert.equal(resolveChatRouletteResultAct(9), "bridge");
  });

  it("micro-copy bridge + wink non vides", () => {
    assert.ok(chatRouletteWinkLine(0).length > 0);
    const b = chatRouletteBridgeCopy();
    assert.match(b.title, /hésitez/i);
    assert.match(b.subtitle, /groupe/i);
  });

  it("premier tirage : pool entier (pas d'exclusion sans courant)", () => {
    const ids = ["hottake-prep", "consensus-prep", "traitre-prep"];
    const pick = pickChatRouletteNextGame({
      eligibleTileIds: ids,
      currentSelectedTileId: null,
      random: () => 0,
    });
    assert.equal(pick.id, "hottake-prep");
  });

  it("relance : jeu courant exclu ; pas de doublon immédiat", () => {
    const ids = ["hottake-prep", "consensus-prep", "traitre-prep"];
    const pick = pickChatRouletteNextGame({
      eligibleTileIds: ids,
      currentSelectedTileId: "hottake-prep",
      random: () => 0,
    });
    assert.ok(pick);
    assert.notEqual(pick.id, "hottake-prep");
    assert.ok(ids.includes(pick.id));
  });

  it("un ancien jeu peut ressortir après un autre", () => {
    const ids = ["a", "b", "c"];
    const first = pickChatRouletteNextGame({
      eligibleTileIds: ids,
      currentSelectedTileId: "a",
      random: () => 0,
    });
    assert.equal(first.id, "b");
    const second = pickChatRouletteNextGame({
      eligibleTileIds: ids,
      currentSelectedTileId: first.id,
      random: () => 0,
    });
    assert.equal(second.id, "a");
  });

  it("11 jeux : plus de 11 tirages possibles (pas de mémoire longue)", () => {
    const ids = Array.from({ length: 11 }, (_, i) => `g${i}`);
    let current = null;
    const seen = [];
    for (let i = 0; i < 15; i++) {
      const pick = pickChatRouletteNextGame({
        eligibleTileIds: ids,
        currentSelectedTileId: current,
        random: () => 0.99,
      });
      assert.ok(pick);
      if (current) assert.notEqual(pick.id, current);
      seen.push(pick.id);
      current = pick.id;
    }
    assert.equal(seen.length, 15);
  });

  it("deux jeux : alternance stricte", () => {
    let current = "a";
    for (let i = 0; i < 6; i++) {
      const pick = pickChatRouletteNextGame({
        eligibleTileIds: ["a", "b"],
        currentSelectedTileId: current,
        random: () => 0,
      });
      assert.notEqual(pick.id, current);
      current = pick.id;
    }
  });

  it("un seul jeu : résultat stable (pas d'exclusion)", () => {
    const pick = pickChatRouletteNextGame({
      eligibleTileIds: ["only"],
      currentSelectedTileId: "only",
      random: () => 0,
    });
    assert.equal(pick.id, "only");
  });

  it("normalize n'exige plus rejectedTileIds / cycleCount", () => {
    const n = normalizeChatRouletteEvent(
      baseEvent({
        phase: "result",
        selectedTileId: "hottake-prep",
        drawCount: 2,
        animationStartTimestamp: 1,
        rejectedTileIds: ["x"],
        cycleCount: 9,
      })
    );
    assert.equal(n.drawCount, 2);
    assert.equal(n.rejectedTileIds, undefined);
    assert.equal(n.cycleCount, undefined);
  });

  it("spin payload : drawCount sans rejected/cycle", () => {
    const prev = normalizeChatRouletteEvent(
      baseEvent({
        phase: "result",
        selectedTileId: "hottake-prep",
        drawCount: 2,
        animationStartTimestamp: 1,
      })
    );
    const payload = buildChatRouletteSpinPayload(
      prev,
      { id: "consensus-prep" },
      sampleGames.slice(0, 3),
      { reroll: true }
    );
    assert.equal(payload.drawCount, 3);
    assert.equal(payload.rejectedTileIds, undefined);
    assert.equal(payload.cycleCount, undefined);
  });

  it("UI / orch : bridge inchangé ; pas de pioche sans remise", () => {
    const ui = readFileSync(
      join(__dirname, "../js/core/chatRandomGameUi.js"),
      "utf8"
    );
    const orch = readFileSync(
      join(__dirname, "../js/core/chatRandomGame.js"),
      "utf8"
    );
    assert.match(ui, /data-roulette-bridge/);
    assert.match(orch, /pickChatRouletteNextGame/);
    assert.doesNotMatch(orch, /rejectedTileIds/);
    assert.doesNotMatch(ui, /cycleCount/);
  });

  it("prompt payload simple", () => {
    const p = buildChatRoulettePromptPayload([{ id: "hottake-prep" }], 1000);
    assert.equal(p.drawCount, 0);
    assert.equal(p.rejectedTileIds, undefined);
  });
});

describe("FEATURE-CHAT-03 — contrats source TTL", () => {
  it("restartGame utilise isChatRouletteBlockingLaunch + observe", () => {
    const src = readFileSync(join(__dirname, "../js/core/restartGame.js"), "utf8");
    assert.match(src, /isChatRouletteBlockingLaunch/);
    assert.match(src, /observeChatRouletteActivity/);
    assert.match(src, /parseSessionUpdatedAtMs/);
    assert.match(src, /runWithChatRouletteLaunchPermit/);
    assert.doesNotMatch(src, /isChatRouletteActive\(ev\)/);
  });

  it("orch + UI partagent la même fonction centrale", () => {
    const orch = readFileSync(
      join(__dirname, "../js/core/chatRandomGame.js"),
      "utf8"
    );
    const ui = readFileSync(
      join(__dirname, "../js/core/chatRandomGameUi.js"),
      "utf8"
    );
    assert.match(orch, /isChatRouletteBlockingLaunch/);
    assert.match(orch, /observeChatRouletteActivity/);
    assert.match(ui, /isChatRouletteBlockingLaunch/);
    assert.match(orch, /updated_at/);
  });

  it("TILE mapping + launchCatalogGame", () => {
    assert.equal(TILE_ID_TO_SESSION_GAME_ID["hottake-prep"], "hottake");
    const src = readFileSync(join(__dirname, "../js/core/restartGame.js"), "utf8");
    assert.match(src, /export async function launchCatalogGame/);
  });
});

describe("FEATURE-CHAT-03 — fermeture chat à l'entrée prep (tous clients)", () => {
  it("fermeture sheet n'est pas seulement dans le handler hôte Commencer", () => {
    const orch = readFileSync(
      join(__dirname, "../js/core/chatRandomGame.js"),
      "utf8"
    );
    const fab = readFileSync(
      join(__dirname, "../js/core/feedbackUi.js"),
      "utf8"
    );
    assert.match(fab, /shouldDismissChatSheetOnScreenTransition/);
    assert.match(fab, /onScreenChange\(\(\) => updateFeedbackFabVisibility\(\)\)/);
    assert.match(
      orch,
      /!localScreenAllowsChatRoulette\(getCurrentScreen\(\)\)/
    );
    assert.match(orch, /closeChatRouletteModal\(\{ silent: true \}\)/);
  });

  it("prompt/spinning/result restent sur hub → pas d'auto-close sheet", () => {
    assert.equal(localScreenAllowsChatRoulette("game-select"), true);
    assert.equal(localScreenAllowsChatRoulette("traitre-prep"), false);
  });

  it("idempotence closeChatSheet (early return)", () => {
    const fab = readFileSync(
      join(__dirname, "../js/core/feedbackUi.js"),
      "utf8"
    );
    assert.match(
      fab,
      /export function closeChatSheet\(\) \{\s*if \(!sheetOpen && !sheetRoot\) return;/
    );
  });
});

