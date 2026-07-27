/**
 * Diagnostic restart Guess Lie — vote sur sa propre manche (Cas A vs Cas B).
 *
 * Activation (au choix) :
 *   localStorage.setItem('reveal-guesslie-identity-debug', '1')
 *   window.__DEBUG_GUESS_LIE_IDENTITY = true
 *
 * Filtrer la console : [GUESSLIE-ID]
 *
 * Ne modifie aucun comportement jeu ; log uniquement quand l'UI détective
 * s'affiche alors que round.player résout vers l'UID local (symptôme QA).
 */
import { getLocalPlayer } from "./players.js";
import { getLocalDisplayName, getState } from "./state.js";
import { isValidGuessLieSubmission } from "./sessionMerge.js";
import { classifyGuessLieIdentityCase } from "./guessLieIdentityCase.js";
import {
  getLocalParticipantUid,
  userIdForName,
} from "./gameSync.js";

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

/**
 * @param {object} params
 * @param {object} params.round — manche courante { player, statements, lie }
 * @param {string} params.localNameClosure — getLocalDisplayName() figé au mount
 * @param {boolean} params.isSubject — calcul actuel round.player === localNameClosure
 * @param {number} params.roundIdx
 * @param {object} params.submissions — guessLie.submissions
 * @param {string|null} params.sessionId
 */
export function maybeLogGuessLieOwnRoundVoteBug({
  round,
  localNameClosure,
  isSubject,
  roundIdx,
  submissions,
  sessionId,
}) {
  if (!guessLieIdentityDebugEnabled()) return;
  if (!round?.player) return;
  // Symptôme QA : UI détective (!isSubject) alors que la manche est la nôtre par UID.
  if (isSubject) return;

  const localUid = getLocalParticipantUid() || null;
  const roundPlayerUid = userIdForName(round.player) || null;
  if (!localUid || !roundPlayerUid || roundPlayerUid !== localUid) return;

  const submissionKeys = describeGuessLieSubmissionKeys(submissions);
  const keysForLocalUid = submissionKeys
    .filter((e) => e.uid === localUid && e.valid)
    .map((e) => e.key);
  const caseType = classifyGuessLieIdentityCase(submissionKeys, localUid);

  const sig = [
    sessionId || "",
    roundIdx,
    round.player,
    localNameClosure,
    keysForLocalUid.join("|"),
    caseType,
  ].join("::");
  if (sig === lastLogSig) return;
  lastLogSig = sig;

  const localParticipant = getState().lobby?.participants?.find((p) => p.isLocal) || null;

  console.warn("[GUESSLIE-ID] own-round vote UI bug — diagnostic", {
    caseType,
    caseLabel:
      caseType === "A"
        ? "single submission key — local pseudo mismatch (frozen localName?)"
        : caseType === "B"
          ? "duplicate submission keys for same UID — merge/rebuild issue"
          : "could not classify from submission keys",
    submissionKeys,
    keysForLocalUid,
    localParticipant: localParticipant
      ? {
          name: localParticipant.name,
          userId: localParticipant.userId || null,
          isLocal: true,
        }
      : null,
    getLocalPlayer: (() => {
      const p = getLocalPlayer();
      return { name: p.name, isLocal: p.isLocal };
    })(),
    getLocalDisplayName: getLocalDisplayName(),
    localNameClosure,
    roundIdx,
    roundPlayer: round.player,
    roundPlayerUid,
    localParticipantUid: localUid,
    isSubject,
    isSubjectFormula: `round.player (${JSON.stringify(round.player)}) === localNameClosure (${JSON.stringify(localNameClosure)})`,
    sessionId: sessionId || null,
    roundStmtHash: hashShort((round.statements || []).join("\n")),
  });
}

/** Remise à zéro entre deux montages (tests / navigation). */
export function resetGuessLieIdentityDebugDedupe() {
  lastLogSig = "";
}
