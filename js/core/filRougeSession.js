import {
  FIL_ROUGE_MIN_WORD_LENGTH,
  FIL_ROUGE_MIN_PLAYERS,
  FIL_ROUGE_POINTS_MISSION,
  FIL_ROUGE_STATUS,
  FIL_ROUGE_VALIDATION,
} from "../../data/filRouge.js";
import { checkHotTakeModeration } from "./hotTakeSession.js";
import { getLobbyParticipants } from "./lobby.js";
import { getLocalDisplayName, getState, saveStatePatch } from "./state.js";
import {
  isGameSyncActive,
  isLobbyHost,
  syncFilRougeSession,
  userIdForName,
  nameForUserId,
} from "./gameSync.js";
import { awardFilRougeMission } from "./scoring.js";
import {
  fetchAllFilRougePrivateForLobby,
  fetchMyFilRougePrivate,
  hostDistributeFilRougeMissions,
  upsertMyFilRougeSetupWord,
  clearFilRougePrivateForLobby,
} from "./filRougePrivate.js";
import { getSupabaseUserId } from "./supabaseAuth.js";

function defaultSession() {
  return {
    status: FIL_ROUGE_STATUS.IDLE,
    submissions: {},
    missionAcks: {},
    validations: {},
    resultsModalOpen: false,
    resultsSnapshot: null,
    closedAt: null,
    closedByUid: null,
  };
}

export function getFilRougeSession() {
  return getState().filRougeGame || defaultSession();
}

export function isEveningGameplayPaused() {
  return Boolean(getFilRougeSession().resultsModalOpen);
}

export function normalizeFilRougeWord(word) {
  return String(word || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

function participantUids() {
  return getLobbyParticipants()
    .map((p) => p.userId || userIdForName(p.name) || p.name)
    .filter(Boolean);
}

function participantByUid(uid) {
  return getLobbyParticipants().find(
    (p) => (p.userId || userIdForName(p.name) || p.name) === uid
  );
}

export function getFilRougeStatusLabel(status = getFilRougeSession().status) {
  const labels = {
    idle: "Non configuré",
    setup: "Configuration en cours",
    active: "En cours",
    completed: "Terminé",
  };
  return labels[status] || labels.idle;
}

export async function startFilRougeSetup() {
  const next = {
    ...defaultSession(),
    status: FIL_ROUGE_STATUS.SETUP,
    submissions: {},
    missionAcks: {},
    validations: {},
  };
  await syncFilRougeSession(next);
  return next;
}

export function allFilRougeWordsSubmitted() {
  const uids = participantUids();
  const subs = getFilRougeSession().submissions || {};
  return uids.length > 0 && uids.every((uid) => subs[uid]);
}

export async function submitFilRougeWord(word) {
  const trimmed = String(word || "").trim();
  if (trimmed.length < FIL_ROUGE_MIN_WORD_LENGTH) {
    return { ok: false, error: `Minimum ${FIL_ROUGE_MIN_WORD_LENGTH} lettres.` };
  }

  const mod = checkHotTakeModeration(trimmed);
  if (mod.blocked) return { ok: false, error: mod.message };

  const uid = getSupabaseUserId() || userIdForName(getLocalDisplayName());
  if (!uid) return { ok: false, error: "Joueur non identifié." };

  const rows = await fetchAllFilRougePrivateForLobby();
  const normalized = normalizeFilRougeWord(trimmed);
  const duplicate = rows.some(
    (r) => r.user_id !== uid && normalizeFilRougeWord(r.setup_word) === normalized
  );
  if (duplicate) return { ok: false, error: "Ce mot est déjà pris." };

  await upsertMyFilRougeSetupWord(trimmed);

  const session = getFilRougeSession();
  const submissions = { ...(session.submissions || {}), [uid]: true };
  const validations = { ...(session.validations || {}) };
  validations[uid] = { status: FIL_ROUGE_VALIDATION.IN_PROGRESS };

  try {
    await syncFilRougeSession({
      ...session,
      status: FIL_ROUGE_STATUS.SETUP,
      submissions,
      validations,
    });
  } catch (e) {
    console.warn("REVEAL submitFilRougeWord:", e);
    return {
      ok: false,
      error: e.message || "Impossible d'enregistrer le mot (sync).",
    };
  }

  return { ok: true };
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Assigne chaque mot à une cible aléatoire (≠ auteur), puis une mission par agent. */
function buildMissionAssignments(rows, uids) {
  const entries = rows
    .filter((r) => r.setup_word && r.user_id)
    .map((r) => ({
      authorUid: r.user_id,
      word: String(r.setup_word).trim(),
    }));

  if (entries.length !== uids.length) {
    throw new Error("Tous les joueurs doivent avoir soumis un mot.");
  }

  const targets = shuffle(uids);
  let valid = false;
  let wordTargets = [];

  for (let attempt = 0; attempt < 80 && !valid; attempt++) {
    const t = shuffle([...uids]);
    valid = entries.every((e, i) => t[i] !== e.authorUid);
    if (valid) {
      wordTargets = entries.map((e, i) => ({
        authorUid: e.authorUid,
        word: e.word,
        targetUid: t[i],
      }));
    }
  }

  if (!valid) {
    wordTargets = entries.map((e, i) => ({
      authorUid: e.authorUid,
      word: e.word,
      targetUid: targets.find((t) => t !== e.authorUid) || targets[i],
    }));
  }

  const agents = shuffle([...uids]);
  const used = new Set();
  const assignments = [];

  for (const agentUid of agents) {
    const pool = wordTargets.filter(
      (wt) =>
        !used.has(`${wt.authorUid}:${wt.word}`) &&
        wt.authorUid !== agentUid &&
        wt.targetUid !== agentUid
    );
    const pick = pool[0] || wordTargets.find((wt) => wt.authorUid !== agentUid);
    if (!pick) throw new Error("Impossible de distribuer les missions.");
    used.add(`${pick.authorUid}:${pick.word}`);
    assignments.push({
      agentUid,
      missionWord: pick.word,
      missionTargetUid: pick.targetUid,
    });
  }

  return assignments;
}

export async function launchFilRougeMissions() {
  if (!isLobbyHost()) return { ok: false, error: "Réservé à l'hôte." };
  if (participantUids().length < FIL_ROUGE_MIN_PLAYERS) {
    return {
      ok: false,
      error: `Le Fil Rouge nécessite au moins ${FIL_ROUGE_MIN_PLAYERS} joueurs.`,
    };
  }
  if (!allFilRougeWordsSubmitted()) {
    return { ok: false, error: "Tous les joueurs doivent avoir soumis un mot." };
  }

  const rows = await fetchAllFilRougePrivateForLobby();
  const uids = participantUids();
  const assignments = buildMissionAssignments(rows, uids);

  await hostDistributeFilRougeMissions(assignments);

  const validations = {};
  uids.forEach((uid) => {
    validations[uid] = { status: FIL_ROUGE_VALIDATION.IN_PROGRESS };
  });

  await syncFilRougeSession({
    ...getFilRougeSession(),
    status: FIL_ROUGE_STATUS.ACTIVE,
    missionAcks: {},
    validations,
    resultsModalOpen: false,
    resultsSnapshot: null,
  });

  return { ok: true };
}

export async function getLocalFilRougeMission() {
  const row = await fetchMyFilRougePrivate();
  if (!row?.mission_word || !row?.mission_target_uid) return null;
  const target = participantByUid(row.mission_target_uid);
  return {
    word: row.mission_word,
    targetUid: row.mission_target_uid,
    targetName: target?.name || nameForUserId(row.mission_target_uid) || "?",
  };
}

export async function requestFilRougeValidation() {
  const uid = getSupabaseUserId() || userIdForName(getLocalDisplayName());
  const session = getFilRougeSession();
  const cur = session.validations?.[uid];
  if (cur?.status === FIL_ROUGE_VALIDATION.VALIDATED) {
    return { ok: false, error: "Mission déjà validée." };
  }
  if (cur?.status === FIL_ROUGE_VALIDATION.PENDING) {
    return { ok: false, error: "Validation déjà en attente." };
  }

  const validations = {
    ...(session.validations || {}),
    [uid]: {
      status: FIL_ROUGE_VALIDATION.PENDING,
      requestedAt: new Date().toISOString(),
    },
  };

  await syncFilRougeSession({ ...session, validations });
  return { ok: true };
}

export async function hostApproveFilRougeMission(agentUid) {
  if (!isLobbyHost()) return { ok: false, error: "Réservé à l'hôte." };
  const session = getFilRougeSession();
  const cur = session.validations?.[agentUid];
  if (cur?.status === FIL_ROUGE_VALIDATION.VALIDATED) {
    return { ok: false, error: "Déjà validée." };
  }

  const agentName =
    participantByUid(agentUid)?.name || nameForUserId(agentUid) || agentUid;
  awardFilRougeMission(agentName);

  const validations = {
    ...(session.validations || {}),
    [agentUid]: {
      status: FIL_ROUGE_VALIDATION.VALIDATED,
      validatedAt: new Date().toISOString(),
    },
  };

  await syncFilRougeSession({ ...session, validations });
  if (isGameSyncActive()) {
    const { syncLobbyScores } = await import("./gameSync.js");
    await syncLobbyScores();
  }

  return { ok: true };
}

export async function hostRejectFilRougeMission(agentUid) {
  if (!isLobbyHost()) return { ok: false, error: "Réservé à l'hôte." };
  const session = getFilRougeSession();
  const validations = {
    ...(session.validations || {}),
    [agentUid]: { status: FIL_ROUGE_VALIDATION.IN_PROGRESS, rejectedAt: new Date().toISOString() },
  };
  await syncFilRougeSession({ ...session, validations });
  return { ok: true };
}

export function buildFilRougeResultsSnapshot() {
  const session = getFilRougeSession();
  const participants = getLobbyParticipants();
  const validations = session.validations || {};

  const validated = [];
  const inProgress = [];
  const pending = [];

  participants.forEach((p) => {
    const uid = p.userId || userIdForName(p.name) || p.name;
    const v = validations[uid];
    const entry = { name: p.name, uid, emoji: p.emoji, color: p.color };
    if (v?.status === FIL_ROUGE_VALIDATION.VALIDATED) validated.push(entry);
    else if (v?.status === FIL_ROUGE_VALIDATION.PENDING) pending.push(entry);
    else inProgress.push(entry);
  });

  const validatedTimes = Object.entries(validations)
    .filter(([, v]) => v?.status === FIL_ROUGE_VALIDATION.VALIDATED && v.validatedAt)
    .map(([uid, v]) => ({
      uid,
      name: nameForUserId(uid) || uid,
      sec: v.requestedAt
        ? (new Date(v.validatedAt) - new Date(v.requestedAt)) / 1000
        : null,
    }));

  const fastest = validatedTimes
    .filter((x) => x.sec != null)
    .sort((a, b) => a.sec - b.sec)[0];

  const { playerStats } = getState();
  let bestManipulator = "—";
  let bestScore = -1;
  validated.forEach((p) => {
    const n = playerStats[p.name]?.filRougeMissionsValidated || 0;
    if (n > bestScore) {
      bestScore = n;
      bestManipulator = p.name;
    }
  });
  if (bestScore <= 0 && validated[0]) bestManipulator = validated[0].name;

  return {
    validated,
    inProgress,
    pending,
    analytics: {
      bestManipulator: bestManipulator || "—",
      fastestValidationSec: fastest?.sec != null ? Math.round(fastest.sec) : null,
      fastestPlayer: fastest?.name || "—",
      totalValidated: validated.length,
      totalPlayers: participants.length,
    },
    closedAt: new Date().toISOString(),
  };
}

async function clearFilRougeWordsForNewRound() {
  const lobbyId = getState().lobby?.id;
  await clearFilRougePrivateForLobby(lobbyId);
  const session = getFilRougeSession();
  saveStatePatch({
    filRougeGame: {
      ...session,
      submissions: {},
      missionAcks: {},
    },
  });
}

export async function hostCloseFilRougeGame() {
  if (!isLobbyHost()) return { ok: false, error: "Réservé à l'hôte." };
  const snapshot = buildFilRougeResultsSnapshot();
  const uid = getSupabaseUserId();

  await clearFilRougeWordsForNewRound();

  await syncFilRougeSession({
    ...getFilRougeSession(),
    status: FIL_ROUGE_STATUS.COMPLETED,
    submissions: {},
    resultsModalOpen: true,
    resultsSnapshot: snapshot,
    closedAt: snapshot.closedAt,
    closedByUid: uid || null,
  });

  return { ok: true };
}

export async function hostResumeAfterFilRougeResults() {
  if (!isLobbyHost()) return { ok: false, error: "Réservé à l'hôte." };
  await syncFilRougeSession({
    ...getFilRougeSession(),
    resultsModalOpen: false,
  });
  return { ok: true };
}

/** Hôte : nouvelle partie après clôture (mots + missions réinitialisés). */
export async function hostRestartFilRougeGame() {
  if (!isLobbyHost()) return { ok: false, error: "Réservé à l'hôte." };

  const uids = participantUids();
  const validations = {};
  uids.forEach((uid) => {
    validations[uid] = { status: FIL_ROUGE_VALIDATION.IN_PROGRESS };
  });

  await clearFilRougeWordsForNewRound();

  saveStatePatch({
    filRougeGame: {
      ...getFilRougeSession(),
      status: FIL_ROUGE_STATUS.SETUP,
      submissions: {},
      missionAcks: {},
      validations,
      resultsModalOpen: false,
      resultsSnapshot: null,
      closedAt: null,
      closedByUid: null,
    },
  });

  await syncFilRougeSession({
    status: FIL_ROUGE_STATUS.SETUP,
    submissions: {},
    validations,
    resultsModalOpen: false,
    resultsSnapshot: null,
    closedAt: null,
    closedByUid: null,
  });

  return { ok: true };
}

/** Accusé « mission reçue » — local uniquement (ne pas impacter l'écran des autres joueurs). */
export function setFilRougeMissionAck(uid) {
  const session = getFilRougeSession();
  const missionAcks = { ...(session.missionAcks || {}), [uid]: true };
  saveStatePatch({ filRougeGame: { ...session, missionAcks } });
}

export function resetFilRougeSessionLocal() {
  saveStatePatch({ filRougeGame: defaultSession() });
}
