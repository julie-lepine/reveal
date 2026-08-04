/**
 * Diagnostic restart Guess Lie - identité fantôme (submissions / merge / rounds).
 *
 * Activation (au choix) :
 *   localStorage.setItem('reveal-guesslie-identity-debug', '1')
 *   window.__DEBUG_GUESS_LIE_IDENTITY = true
 *
 * Filtrer la console : [GUESSLIE-ID]
 *
 * Ne modifie aucun comportement jeu.
 */
import { getLocalPlayer } from "./players.js";
import { getLocalDisplayName, getState } from "./state.js";
import { isValidGuessLieSubmission } from "./sessionMerge.js";
import { classifyGuessLieIdentityCase } from "./guessLieIdentityCase.js";
import {
  analyzeGuessLieGhostLayers,
  shouldLogGuessLieGhostDiagnostic,
} from "./guessLieGhostDiagnostic.js";
import {
  getCachedGameSession,
  getLocalParticipantUid,
  guessLieFromRemote,
  userIdForName,
} from "./gameSync.js";
import { getLobbyMemberNames } from "./guessLieSession.js";

export const GUESS_LIE_IDENTITY_DEBUG_KEY = "reveal-guesslie-identity-debug";

export function guessLieIdentityDebugEnabled() {
  try {
    if (typeof window !== "undefined" && window.__DEBUG_GUESS_LIE_IDENTITY === true) {
      return true;
    }
    return (
      typeof localStorage !== "undefined" &&
      localStorage.getItem(GUESS_LIE_IDENTITY_DEBUG_KEY) === "1"
    );
  } catch {
    return false;
  }
}

function hashShort(text) {
  let h = 0;
  const s = String(text || "");
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, "0").slice(0, 8);
}

/** Entrées submissions → { key, uid, valid, stmtHash } sans texte brut. */
export function describeGuessLieSubmissionKeys(submissions = {}) {
  return Object.keys(submissions || {}).map((key) => {
    const entry = submissions[key];
    return {
      key,
      uid: userIdForName(key) || null,
      valid: isValidGuessLieSubmission(entry),
      stmtHash: isValidGuessLieSubmission(entry)
        ? hashShort((entry.statements || []).join("\n"))
        : null,
    };
  });
}

let lastLogSig = "";

function getRemoteGuessLieSubmissionsByName() {
  const raw = getCachedGameSession()?.state?.guessLie;
  if (!raw) return {};
  const fromRemote = guessLieFromRemote(raw);
  return fromRemote?.submissions || {};
}

/**
 * Diagnostic élargi - toutes les couches d'identité Guess Lie.
 * @param {object} params
 * @param {object} [params.round] - manche courante
 * @param {string} params.localNameClosure - getLocalDisplayName() figé au mount
 * @param {boolean} params.isSubject
 * @param {number} params.roundIdx
 * @param {object} params.submissions - guessLie.submissions local
 * @param {string|null} params.sessionId
 * @param {string|null} params.phase
 */
export function maybeLogGuessLieGhostDiagnostic({
  round,
  localNameClosure,
  isSubject,
  roundIdx,
  submissions,
  sessionId,
  phase,
}) {
  if (!guessLieIdentityDebugEnabled()) return;

  const lobbyMemberNames = getLobbyMemberNames();
  const localUid = getLocalParticipantUid() || null;
  const localParticipant =
    getState().lobby?.participants?.find((p) => p.isLocal) || null;
  const remoteSubmissionsByName = getRemoteGuessLieSubmissionsByName();

  const analysis = analyzeGuessLieGhostLayers({
    lobbyMemberNames,
    localSubmissions: submissions || {},
    remoteSubmissionsByName,
    localUid,
    localDisplayName: getLocalDisplayName(),
    localLobbyParticipantName: localParticipant?.name || null,
    userIdForName,
  });

  if (
    !shouldLogGuessLieGhostDiagnostic(analysis, {
      isSubject,
      roundPlayer: round?.player,
      localUid,
    })
  ) {
    return;
  }

  const submissionKeys = describeGuessLieSubmissionKeys(submissions);
  const keysForLocalUid = submissionKeys
    .filter((e) => e.uid === localUid && e.valid)
    .map((e) => e.key);
  const caseType = classifyGuessLieIdentityCase(submissionKeys, localUid);

  const sig = [
    sessionId || "",
    phase || "",
    roundIdx,
    round?.player || "",
    localNameClosure,
    analysis.keysNotInLobbyRoster.join("|"),
    analysis.roundPlayers.join("|"),
    keysForLocalUid.join("|"),
  ].join("::");
  if (sig === lastLogSig) return;
  lastLogSig = sig;

  console.warn("[GUESSLIE-ID] ghost identity - multi-layer diagnostic", {
    triggers: analysis.triggers,
    firstGhostLayerHint: analysis.firstGhostLayer,
    caseType,
    sessionId: sessionId || null,
    phase: phase || null,
    roundIdx,
    roundPlayer: round?.player || null,
    isSubject,
    isSubjectFormula: round?.player
      ? `round.player (${JSON.stringify(round.player)}) === localNameClosure (${JSON.stringify(localNameClosure)})`
      : null,
    lobbyMemberNames,
    lobbyParticipants: (getState().lobby?.participants || []).map((p) => ({
      name: p.name,
      userId: p.userId || null,
      isLocal: Boolean(p.isLocal),
      lastSeenAt: p.lastSeenAt || null,
    })),
    localParticipant: localParticipant
      ? {
          name: localParticipant.name,
          userId: localParticipant.userId || null,
          isLocal: true,
        }
      : null,
    getLocalDisplayName: getLocalDisplayName(),
    getLocalPlayerName: (() => {
      const p = getLocalPlayer();
      return p?.name ?? null;
    })(),
    localNameClosure,
    localParticipantUid: localUid,
    roundPlayerUid: round?.player ? userIdForName(round.player) || null : null,
    remoteSubmissionKeys: analysis.remoteKeys,
    localSubmissionKeys: analysis.localKeys,
    keysNotInLobbyRoster: analysis.keysNotInLobbyRoster,
    keysForLocalIdentity: analysis.keysForLocalIdentity,
    localOnlyValidKeys: analysis.localOnlyValidKeys,
    remoteOnlyValidKeys: analysis.remoteOnlyValidKeys,
    roundPlayers: analysis.roundPlayers,
    roundPlayersNotInRoster: analysis.roundPlayersNotInRoster,
    rounds: analysis.rounds,
    rosterSubmittedCount: analysis.rosterSubmittedCount,
    gameSessionRowId: getCachedGameSession()?.id || null,
    roundStmtHash: round?.statements
      ? hashShort((round.statements || []).join("\n"))
      : null,
  });
}

/** @deprecated Alias - appelle le diagnostic élargi. */
export function maybeLogGuessLieOwnRoundVoteBug(params) {
  maybeLogGuessLieGhostDiagnostic(params);
}

/** Remise à zéro entre deux montages (tests / navigation). */
export function resetGuessLieIdentityDebugDedupe() {
  lastLogSig = "";
}
