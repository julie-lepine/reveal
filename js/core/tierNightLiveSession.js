import { TIER_LEVELS } from "../../data/tierTopics.js";
import { getActivePlayerNames } from "./players.js";
import { getLocalDisplayName, getState, saveStatePatch } from "./state.js";
import {
  isGameSyncActive,
  requireLocalParticipantUid,
  normalizePlayerVotesMap,
  tierNightLiveToRemote,
  tierNightToRemote,
  patchGameState,
} from "./gameSync.js";
import { patchGameStateWithFeedback } from "./patchGameStateFeedback.js";
import { launchGameWithSync, commitHostGamePlay } from "./mpLaunch.js";
import { buildRecapsFromPlacements } from "./tierNightSession.js";
import { medianTierFromRanks } from "./tierNightScoring.js";
import { setLobbyPlaying } from "./lobby.js";

const TIER_RANK = { S: 0, A: 1, B: 2, C: 3, D: 4 };

function defaultLive() {
  return {
    lobbyStarted: false,
    topicId: null,
    listName: "",
    deck: null,
    roundIdx: 0,
    phase: null,
    votes: {},
    placements: {},
    finished: false,
  };
}

function shuffle(arr) {
  const a = [...(arr || [])];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function emptyPlaced() {
  const placed = {};
  TIER_LEVELS.forEach((t) => {
    placed[t] = [];
  });
  return placed;
}

export function getTierNightLiveSession() {
  return getState().tierNightLiveGame || defaultLive();
}

/** Tier médian d'un item à partir des votes (valeur = tier par votant). */
export function consensusTierForVotes(votesByName) {
  const ranks = Object.values(votesByName || {})
    .filter(Boolean)
    .map((t) => TIER_RANK[t] ?? 4);
  if (!ranks.length) return null;
  return medianTierFromRanks(ranks);
}

function votingPayload(roundIdx) {
  return { roundIdx, phase: "voting", votes: {} };
}

function tierNightLiveResetRemote() {
  return tierNightLiveToRemote({
    lobbyStarted: false,
    finished: true,
    phase: "done",
    votes: {},
    roundIdx: 0,
    topicId: null,
    listName: "",
    deck: null,
    placements: {},
  });
}

function tierNightClassicResetRemote() {
  return tierNightToRemote({
    topicId: null,
    mode: "consensus",
    modifier: "normal",
    lobbyStarted: false,
    placements: {},
    finished: {},
    game: null,
  });
}

/** Lancement MP (hôte) : construit le deck partagé et démarre la 1re manche. */
export async function markTierNightLiveLobbyStarted({ topicId, listName, items }) {
  const deck = shuffle(items);
  const next = {
    ...defaultLive(),
    lobbyStarted: true,
    topicId,
    listName,
    deck,
    placements: {},
    finished: false,
    ...votingPayload(0),
  };
  return launchGameWithSync({
    screen: "tiernight-live",
    gameId: "tiernight",
    mode: "push",
    beforeCommit: () => setLobbyPlaying("tiernight"),
    applyLocal: () =>
      saveStatePatch({
        tierNightLiveGame: next,
        tierNightGame: { recaps: [], topicId: null, listName: "", controversialItem: null },
      }),
    getRemoteState: () => ({
      tierNightLive: tierNightLiveToRemote(next),
      tierNight: tierNightClassicResetRemote(),
    }),
  });
}

/** MP : envoie uniquement le vote local (merge additif côté serveur). */
export async function commitTierNightLiveVote(tier) {
  const localName = getLocalDisplayName();
  const session = getTierNightLiveSession();
  if (session.phase !== "voting") return session.votes?.[localName] ?? null;
  const votes = { ...(session.votes || {}), [localName]: tier };
  saveStatePatch({ tierNightLiveGame: { ...session, votes } });
  if (!isGameSyncActive()) return tier;
  const uid = requireLocalParticipantUid();
  await patchGameStateWithFeedback(
    { tierNightLive: { votes: { [uid]: tier } } },
    { gameId: "tiernight", screen: "tiernight-live" }
  );
  return tier;
}

export function allTierNightLiveVotesIn(session = getTierNightLiveSession()) {
  const names = getActivePlayerNames();
  const votes = normalizePlayerVotesMap(session.votes || {}, names);
  return names.length > 0 && names.every((n) => votes[n] != null && votes[n] !== "");
}

/** Accumule les votes de la manche courante dans les placements (par pseudo). */
export function accumulatePlacements(session = getTierNightLiveSession()) {
  const names = getActivePlayerNames();
  const votes = normalizePlayerVotesMap(session.votes || {}, names);
  const item = session.deck?.[session.roundIdx];
  const placements = { ...(session.placements || {}) };
  if (item == null) return placements;
  Object.entries(votes).forEach(([name, tier]) => {
    if (!tier) return;
    const placed = placements[name] ? { ...placements[name] } : emptyPlaced();
    TIER_LEVELS.forEach((t) => {
      placed[t] = [...(placed[t] || [])];
    });
    if (!placed[tier].includes(item)) placed[tier].push(item);
    placements[name] = placed;
  });
  return placements;
}

/** Commit hôte (phase/round/placements). */
export async function commitTierNightLivePlay(patch, patchOpts = {}) {
  return commitHostGamePlay({
    patch,
    gameId: "tiernight",
    screen: "tiernight-live",
    stateKey: "tierNightLive",
    getSession: getTierNightLiveSession,
    saveLocal: (s) => saveStatePatch({ tierNightLiveGame: s }),
    toRemote: tierNightLiveToRemote,
    patchOpts,
  });
}

/** Construit les recaps finaux à partir des placements accumulés (hôte). */
export function buildTierNightLiveRecaps(session = getTierNightLiveSession()) {
  return buildRecapsFromPlacements(
    session.topicId,
    session.listName,
    session.deck || [],
    session.placements || {}
  );
}

/** Marque la partie live terminée côté serveur (sort tout le monde de l'écran live). */
export async function markTierNightLiveFinished() {
  await commitTierNightLivePlay({ phase: "done", finished: true, votes: {} });
}

export function resetTierNightLive() {
  saveStatePatch({ tierNightLiveGame: defaultLive() });
}

/** Lancement MP Rank it / Classe le groupe (hôte). */
export async function markTierNightClassicStarted({ topicId, mode, modifier }) {
  saveStatePatch({
    tierNightTopicId: topicId,
    tierNightMode: mode,
    tierNightModifier: modifier,
    tierNightGame: { recaps: [], topicId: null, listName: "", controversialItem: null },
    tierNightLiveGame: defaultLive(),
  });
  const remoteTierNight = tierNightToRemote({
    topicId,
    mode,
    modifier,
    lobbyStarted: true,
    placements: {},
    finished: {},
    game: true,
  });
  return launchGameWithSync({
    screen: "tiernight",
    gameId: "tiernight",
    mode: "push",
    beforeCommit: () => setLobbyPlaying("tiernight"),
    applyLocal: () => {},
    getRemoteState: () => ({
      tierNight: remoteTierNight,
      tierNightLive: tierNightLiveResetRemote(),
    }),
  });
}

export { votingPayload as tierNightLiveVotingPayload };
