/**
 * Draw it ! T7 — transport live best-effort du trait courant.
 * Aucun stroke n'est écrit dans game_sessions : le durable reste hors scope (T8).
 */
import { isSupabaseConfigured, supabase } from "./supabaseClient.js";
import {
  onLobbyRealtimeStatus,
  whenLobbyRealtimeReady,
} from "./supabaseLobby.js";
import { onScreenChange } from "./router.js";
import { canDrawOnDrawItCanvas } from "./drawItStrokes.js";

export const DRAW_IT_LIVE_EVENT = "drawit";
export const DRAW_IT_LIVE_CHUNK_MS = 100;
export const DRAW_IT_LIVE_SEND_RELEASE_MS = 250;
const ALLOWED_TYPES = new Set(["start", "chunk", "end", "clear", "undo"]);
const FORBIDDEN_KEYS = [
  "lobbyId",
  "game",
  "pseudo",
  "wordLabel",
  "wordId",
  "acceptedAnswers",
  "foundOrder",
  "guesses",
  "score",
];
const COMMON_KEYS = ["type", "runId", "roundIdx", "canvasEpoch", "drawerUid"];
const TYPE_KEYS = {
  start: [...COMMON_KEYS, "strokeId", "seq", "color", "width", "points"],
  chunk: [...COMMON_KEYS, "strokeId", "seq", "color", "width", "points"],
  end: [...COMMON_KEYS, "strokeId", "seq", "color", "width"],
  clear: COMMON_KEYS,
  undo: [...COMMON_KEYS, "strokeId"],
};

let activeChannel = null;
let activeLobbyId = null;
let activeStatus = "idle";
let channelGen = 0;
let desired = null;
let renderCallback = null;
let openAttempt = 0;
let reconnectTimer = null;
let chunkTimer = null;
let localSender = null;
let liveState = createDrawItLiveState();
let hooksInstalled = false;
let localStrokeNonce = 0;

function finiteInt(value, min = 0) {
  const n = Number(value);
  return Number.isInteger(n) && n >= min ? n : null;
}

function cleanPoint(point) {
  if (!Array.isArray(point) || point.length !== 2) return null;
  const x = Number(point[0]);
  const y = Number(point[1]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (x < 0 || x > 1 || y < 0 || y > 1) return null;
  return [x, y];
}

function cleanPoints(points, max = 64) {
  if (!Array.isArray(points)) return [];
  return points.map(cleanPoint).filter(Boolean).slice(-max);
}

function samePoint(a, b) {
  return Boolean(a && b && a[0] === b[0] && a[1] === b[1]);
}

function identityFrom(session = {}) {
  return {
    runId: session.runId || null,
    roundIdx: Number(session.roundIdx) || 0,
    canvasEpoch: Number(session.canvasEpoch) || 0,
    drawerUid: session.drawerUid || null,
  };
}

function sameIdentity(a, b) {
  return (
    String(a?.runId || "") === String(b?.runId || "") &&
    Number(a?.roundIdx) === Number(b?.roundIdx) &&
    Number(a?.canvasEpoch) === Number(b?.canvasEpoch) &&
    String(a?.drawerUid || "") === String(b?.drawerUid || "")
  );
}

export function createDrawItLiveState(session = {}) {
  return {
    identity: identityFrom(session),
    remoteInProgress: {},
    remoteCompleted: {},
  };
}

export function syncDrawItLiveIdentity(state, session = {}) {
  const current = state || createDrawItLiveState();
  if (!session?.runId && !session?.lobbyStarted) return current;
  const nextIdentity = identityFrom(session);
  if (sameIdentity(current.identity, nextIdentity)) return current;
  return createDrawItLiveState(session);
}

function validCommonPayload(payload, session) {
  if (!payload || typeof payload !== "object") return false;
  if (String(payload.runId || "") !== String(session?.runId || "")) return false;
  if (finiteInt(payload.roundIdx) !== finiteInt(session?.roundIdx)) return false;
  if (finiteInt(payload.canvasEpoch) !== finiteInt(session?.canvasEpoch)) return false;
  if (String(payload.drawerUid || "") !== String(session?.drawerUid || "")) return false;
  if (!ALLOWED_TYPES.has(payload.type)) return false;
  if (FORBIDDEN_KEYS.some((key) => Object.hasOwn(payload, key))) return false;
  const allowedKeys = TYPE_KEYS[payload.type];
  if (Object.keys(payload).some((key) => !allowedKeys.includes(key))) return false;
  if (payload.type === "clear") return true;
  if (typeof payload.strokeId !== "string" || !payload.strokeId.trim()) return false;
  if (payload.strokeId.length > 128) return false;
  if (payload.type === "undo") return true;
  if (finiteInt(payload.seq, 1) == null) return false;
  if (typeof payload.color !== "string" || !payload.color || payload.color.length > 32) {
    return false;
  }
  const width = Number(payload.width);
  if (!Number.isFinite(width) || width <= 0 || width > 64) return false;
  if (
    (payload.type === "start" || payload.type === "chunk") &&
    cleanPoints(payload.points).length < 1
  ) {
    return false;
  }
  return true;
}

export function applyDrawItLiveEvent(state, payload, session = {}) {
  let next = syncDrawItLiveIdentity(state, session);
  if (!validCommonPayload(payload, session)) {
    return { applied: false, reason: "identity_or_format", state: next, delta: null };
  }

  if (payload.type === "clear") {
    next = createDrawItLiveState(session);
    return { applied: true, reason: null, state: next, delta: { type: "replay" } };
  }

  const strokeId = String(payload.strokeId || "").trim();
  if (!strokeId) {
    return { applied: false, reason: "invalid_stroke", state: next, delta: null };
  }

  if (payload.type === "undo") {
    const inProgress = { ...next.remoteInProgress };
    const completed = { ...next.remoteCompleted };
    delete inProgress[strokeId];
    delete completed[strokeId];
    next = { ...next, remoteInProgress: inProgress, remoteCompleted: completed };
    return { applied: true, reason: null, state: next, delta: { type: "replay" } };
  }

  const seq = finiteInt(payload.seq, 1);
  if (seq == null) {
    return { applied: false, reason: "invalid_seq", state: next, delta: null };
  }
  const existing =
    next.remoteInProgress[strokeId] || next.remoteCompleted[strokeId] || null;
  if (existing && seq <= Number(existing.lastSeq || 0)) {
    return { applied: false, reason: "stale_seq", state: next, delta: null };
  }

  if (payload.type === "end") {
    const stroke = {
      strokeId,
      points: [...(existing?.points || [])],
      color: payload.color || existing?.color || "#f4f4f5",
      width: Number(payload.width) || existing?.width || 4,
      lastSeq: seq,
    };
    const inProgress = { ...next.remoteInProgress };
    delete inProgress[strokeId];
    next = {
      ...next,
      remoteInProgress: inProgress,
      remoteCompleted: { ...next.remoteCompleted, [strokeId]: stroke },
    };
    return {
      applied: true,
      reason: null,
      state: next,
      delta: { type: "end", stroke },
    };
  }

  const incoming = cleanPoints(payload.points);
  if (!incoming.length) {
    return { applied: false, reason: "invalid_points", state: next, delta: null };
  }
  const priorPoints = [...(existing?.points || [])];
  const appended = [];
  for (const point of incoming) {
    const previous = appended[appended.length - 1] || priorPoints[priorPoints.length - 1];
    if (!samePoint(previous, point)) appended.push(point);
  }
  const stroke = {
    strokeId,
    points: [...priorPoints, ...appended],
    color: payload.color || existing?.color || "#f4f4f5",
    width: Number(payload.width) || existing?.width || 4,
    lastSeq: seq,
  };
  next = {
    ...next,
    remoteInProgress: { ...next.remoteInProgress, [strokeId]: stroke },
  };
  return {
    applied: true,
    reason: null,
    state: next,
    delta: {
      type: "segment",
      stroke,
      previousPoint: priorPoints[priorPoints.length - 1] || null,
      points: appended,
    },
  };
}

function payloadBase(type, session, uid) {
  return {
    type,
    runId: session.runId,
    roundIdx: Number(session.roundIdx) || 0,
    canvasEpoch: Number(session.canvasEpoch) || 0,
    drawerUid: uid,
  };
}

export function buildDrawItLivePayload(type, {
  session = {},
  uid,
  stroke,
  strokeId,
  seq,
  points,
} = {}) {
  const base = payloadBase(type, session, uid);
  if (type === "clear") return base;
  const id = String(strokeId || stroke?.strokeId || "");
  if (type === "undo") return { ...base, strokeId: id };
  const payload = {
    ...base,
    strokeId: id,
    seq: Number(seq) || 1,
    color: stroke?.color || "#f4f4f5",
    width: Number(stroke?.width) || 4,
  };
  if (type !== "end") payload.points = cleanPoints(points ?? stroke?.points);
  return payload;
}

export function canEmitDrawItLive(session, uid, nowMs = Date.now()) {
  return canDrawOnDrawItCanvas(session, { uid, nowMs }).ok;
}

export function createDrawItLiveStrokeId(uid = "drawer") {
  localStrokeNonce += 1;
  const random =
    globalThis.crypto?.randomUUID?.() ||
    `${Date.now().toString(36)}-${localStrokeNonce.toString(36)}`;
  return `${String(uid || "drawer")}:${random}`.slice(0, 128);
}

function notifyRender(delta) {
  renderCallback?.({ state: liveState, delta });
}

function receivePayload(payload) {
  const session = desired?.getSession?.() || {};
  const applied = applyDrawItLiveEvent(liveState, payload, session);
  liveState = applied.state;
  if (applied.applied) notifyRender(applied.delta);
  return applied;
}

function clearReconnectTimer() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
}

function removeActiveChannel({ intentional = true, preserveIntent = true } = {}) {
  clearReconnectTimer();
  const channel = activeChannel;
  if (channel && supabase) {
    if (intentional) channel.__intentionalClose = true;
    channel.__drawItRemoving = true;
    try {
      supabase.removeChannel(channel);
    } catch {
      /* best effort */
    }
  }
  // La ref exacte est retirée avant d'être oubliée.
  activeChannel = null;
  activeLobbyId = null;
  activeStatus = "idle";
  channelGen += 1;
  localSender = null;
  if (!preserveIntent) desired = null;
}

function scheduleReconnect() {
  if (!desired || reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void ensureChannel();
  }, 500);
}

async function ensureChannel() {
  const intent = desired;
  if (!intent || !isSupabaseConfigured() || !supabase) return null;
  if (
    activeChannel &&
    String(activeLobbyId) === String(intent.lobbyId) &&
    (activeStatus === "subscribing" || activeStatus === "subscribed")
  ) {
    return activeChannel;
  }
  if (activeChannel) removeActiveChannel({ intentional: true, preserveIntent: true });

  const attempt = ++openAttempt;
  activeStatus = "waiting_lobby";
  const ready = await whenLobbyRealtimeReady({
    lobbyId: intent.lobbyId,
    timeoutMs: 12000,
  });
  if (!ready.ok || attempt !== openAttempt || desired !== intent) {
    activeStatus = "idle";
    return null;
  }

  const myGen = ++channelGen;
  const topic = `drawit:${intent.lobbyId}`;
  const channel = supabase.channel(topic, {
    config: { broadcast: { self: false, ack: false } },
  });
  channel.on("broadcast", { event: DRAW_IT_LIVE_EVENT }, (message) => {
    if (myGen !== channelGen || channel !== activeChannel) return;
    receivePayload(message?.payload ?? message);
  });
  activeChannel = channel;
  activeLobbyId = intent.lobbyId;
  activeStatus = "subscribing";
  channel.__drawItSubscribeCallCount = 1;
  channel.subscribe((status) => {
    if (myGen !== channelGen || channel !== activeChannel) return;
    if (status === "SUBSCRIBED") {
      activeStatus = "subscribed";
      return;
    }
    if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
      if (channel.__intentionalClose && status === "CLOSED") return;
      if (channel.__drawItRemoving && status === "CLOSED") return;
      removeActiveChannel({ intentional: false, preserveIntent: true });
      scheduleReconnect();
    }
  });
  return channel;
}

function startChunkTimer() {
  if (chunkTimer) return;
  chunkTimer = setInterval(() => {
    void flushDrawItLiveChunk();
  }, DRAW_IT_LIVE_CHUNK_MS);
}

function installLifecycleHooks() {
  if (hooksInstalled) return;
  hooksInstalled = true;
  onLobbyRealtimeStatus((status, meta) => {
    if (!desired) return;
    if (meta?.lobbyId && String(meta.lobbyId) !== String(desired.lobbyId)) return;
    if (status === "subscribed") {
      if (!activeChannel) void ensureChannel();
      return;
    }
    if (status === "idle" || status === "error") {
      openAttempt += 1;
      removeActiveChannel({ intentional: true, preserveIntent: true });
    }
  });
  onScreenChange((screen) => {
    if (screen !== "drawit") teardownDrawItLive();
  });
}

export function activateDrawItLive({
  lobbyId,
  getSession,
  getLocalUid,
  onRender,
} = {}) {
  installLifecycleHooks();
  if (!lobbyId) return { ok: false, reason: "missing_lobby" };
  if (desired && String(desired.lobbyId) !== String(lobbyId)) {
    removeActiveChannel({ intentional: true, preserveIntent: false });
    liveState = createDrawItLiveState();
  }
  desired = { lobbyId: String(lobbyId), getSession, getLocalUid };
  renderCallback = typeof onRender === "function" ? onRender : null;
  liveState = syncDrawItLiveIdentity(liveState, getSession?.() || {});
  startChunkTimer();
  void ensureChannel();
  return { ok: true, state: liveState };
}

export function detachDrawItLiveRenderer(onRender) {
  if (!onRender || renderCallback === onRender) renderCallback = null;
}

export function syncActiveDrawItLiveSession(session = {}) {
  const previous = liveState;
  liveState = syncDrawItLiveIdentity(liveState, session);
  const durableIds = new Set(
    (Array.isArray(session.strokes) ? session.strokes : [])
      .map((stroke) => String(stroke?.strokeId || "").trim())
      .filter(Boolean)
  );
  if (durableIds.size) {
    const inProgress = { ...liveState.remoteInProgress };
    const completed = { ...liveState.remoteCompleted };
    let removed = false;
    for (const strokeId of durableIds) {
      if (Object.hasOwn(inProgress, strokeId)) {
        delete inProgress[strokeId];
        removed = true;
      }
      if (Object.hasOwn(completed, strokeId)) {
        delete completed[strokeId];
        removed = true;
      }
    }
    if (removed) {
      liveState = {
        ...liveState,
        remoteInProgress: inProgress,
        remoteCompleted: completed,
      };
    }
  }
  if (liveState !== previous) {
    localSender = null;
    notifyRender({ type: "replay" });
  }
  return liveState;
}

function sendPayload(payload) {
  if (!activeChannel || activeStatus !== "subscribed") return Promise.resolve(false);
  try {
    const send = Promise.resolve(
      activeChannel.send({
        type: "broadcast",
        event: DRAW_IT_LIVE_EVENT,
        payload,
      })
    ).then(() => true, () => false);
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      };
      const timer = setTimeout(
        () => finish(false),
        DRAW_IT_LIVE_SEND_RELEASE_MS
      );
      send.then(finish);
    });
  } catch {
    return Promise.resolve(false);
  }
}

export function startDrawItLiveStroke(stroke) {
  const session = desired?.getSession?.() || {};
  const uid = desired?.getLocalUid?.() || null;
  if (!stroke?.strokeId || !canEmitDrawItLive(session, uid)) return false;
  const sender = {
    strokeId: stroke.strokeId,
    stroke,
    seq: 1,
    pending: [],
    inFlight: null,
  };
  localSender = sender;
  sender.inFlight = sendPayload(
    buildDrawItLivePayload("start", {
      session,
      uid,
      stroke,
      seq: sender.seq,
      points: stroke.points,
    })
  ).finally(() => {
    sender.inFlight = null;
  });
  return true;
}

export function bufferDrawItLivePoints(strokeId, points = []) {
  if (!localSender || localSender.strokeId !== strokeId) return false;
  const clean = cleanPoints(points);
  if (!clean.length) return false;
  localSender.pending = [...localSender.pending, ...clean].slice(-32);
  return true;
}

export async function flushDrawItLiveChunk(sender = localSender) {
  if (!sender || sender.inFlight || !sender.pending.length) return false;
  // Un envoi bloqué ne doit pas figer le trait : sendPayload libère inFlight.
  const session = desired?.getSession?.() || {};
  const uid = desired?.getLocalUid?.() || null;
  if (!canEmitDrawItLive(session, uid)) {
    sender.pending = [];
    return false;
  }
  const points = sender.pending.splice(0);
  sender.seq += 1;
  sender.inFlight = sendPayload(
    buildDrawItLivePayload("chunk", {
      session,
      uid,
      stroke: sender.stroke,
      strokeId: sender.strokeId,
      seq: sender.seq,
      points,
    })
  ).finally(() => {
    sender.inFlight = null;
  });
  await sender.inFlight;
  return true;
}

export async function endDrawItLiveStroke(stroke, finalPoints = []) {
  const sender = localSender;
  if (!sender || sender.strokeId !== stroke?.strokeId) return false;
  bufferDrawItLivePoints(sender.strokeId, finalPoints);
  if (sender.inFlight) await sender.inFlight;
  await flushDrawItLiveChunk(sender);
  if (sender.inFlight) await sender.inFlight;
  const session = desired?.getSession?.() || {};
  const uid = desired?.getLocalUid?.() || null;
  if (!canEmitDrawItLive(session, uid)) {
    if (localSender === sender) localSender = null;
    return false;
  }
  sender.seq += 1;
  await sendPayload(
    buildDrawItLivePayload("end", {
      session,
      uid,
      stroke,
      seq: sender.seq,
    })
  );
  if (localSender === sender) localSender = null;
  return true;
}

export function broadcastDrawItLiveClear(session, uid) {
  if (!canEmitDrawItLive(session, uid)) return false;
  void sendPayload(buildDrawItLivePayload("clear", { session, uid }));
  return true;
}

export function broadcastDrawItLiveUndo(session, uid, strokeId) {
  if (!canEmitDrawItLive(session, uid)) return false;
  void sendPayload(
    buildDrawItLivePayload("undo", { session, uid, strokeId })
  );
  return true;
}

export function getDrawItLiveState() {
  return liveState;
}

export function teardownDrawItLive() {
  openAttempt += 1;
  removeActiveChannel({ intentional: true, preserveIntent: false });
  renderCallback = null;
  localSender = null;
  liveState = createDrawItLiveState();
  if (chunkTimer) clearInterval(chunkTimer);
  chunkTimer = null;
}

export function __getDrawItLiveDebugState() {
  return {
    channel: activeChannel,
    lobbyId: activeLobbyId,
    status: activeStatus,
    gen: channelGen,
    desiredLobbyId: desired?.lobbyId || null,
  };
}

export function __resetDrawItLiveForTests() {
  teardownDrawItLive();
  channelGen = 0;
  openAttempt = 0;
  localStrokeNonce = 0;
}
