/**
 * Diagnostic pur - identité fantôme Guess Lie (submissions / rounds / roster).
 * Testable sans Supabase ; le logger vit dans guessLieIdentityDebug.js.
 */
import { isValidGuessLieSubmission } from "./sessionMerge.js";

/** @typedef {{ key: string, uid: string|null, valid: boolean, stmtHash: string|null, inRoster: boolean }} SubmissionKeyInfo */

/**
 * Liste des manches comme getGuessLieRounds() - sans lire state global.
 */
export function buildGuessLieRoundsFromSources(submissions = {}, lobbyMemberNames = []) {
  const subKeys = Object.keys(submissions || {});
  const playerNames = lobbyMemberNames.length
    ? [...new Set([...lobbyMemberNames, ...subKeys])]
    : subKeys;
  return playerNames
    .filter((n) => isValidGuessLieSubmission(submissions[n]))
    .map((n, idx) => ({
      roundIdx: idx,
      player: n,
      lie: submissions[n].lie,
      stmtHash: hashShort((submissions[n].statements || []).join("\n")),
    }));
}

function hashShort(text) {
  let h = 0;
  const s = String(text || "");
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, "0").slice(0, 8);
}

/**
 * @param {object} params
 * @param {string[]} params.lobbyMemberNames - getLobbyMemberNames()
 * @param {object} params.localSubmissions - getGuessLieSession().submissions
 * @param {object} [params.remoteSubmissionsByName] - guessLieFromRemote(cached).submissions
 * @param {string|null} params.localUid
 * @param {string} params.localDisplayName
 * @param {string|null} params.localLobbyParticipantName
 * @param {(name: string) => string|null} params.userIdForName
 */
export function analyzeGuessLieGhostLayers({
  lobbyMemberNames = [],
  localSubmissions = {},
  remoteSubmissionsByName = {},
  localUid = null,
  localDisplayName = "",
  localLobbyParticipantName = null,
  userIdForName = () => null,
}) {
  const rosterSet = new Set(lobbyMemberNames);
  const describeKeys = (subs, origin) =>
    Object.keys(subs || {}).map((key) => {
      const entry = subs[key];
      const valid = isValidGuessLieSubmission(entry);
      return {
        key,
        origin,
        uid: userIdForName(key) || null,
        valid,
        inRoster: rosterSet.has(key),
        stmtHash: valid ? hashShort((entry.statements || []).join("\n")) : null,
      };
    });

  const localKeys = describeKeys(localSubmissions, "local");
  const remoteKeys = describeKeys(remoteSubmissionsByName, "remote");
  const mergedSubmissions = { ...localSubmissions };
  Object.entries(remoteSubmissionsByName || {}).forEach(([k, v]) => {
    if (isValidGuessLieSubmission(v)) mergedSubmissions[k] = v;
  });

  const allSubmissionKeys = [
    ...new Set([
      ...Object.keys(localSubmissions || {}),
      ...Object.keys(remoteSubmissionsByName || {}),
    ]),
  ];
  const keysNotInLobbyRoster = allSubmissionKeys.filter(
    (k) => isValidGuessLieSubmission(mergedSubmissions[k]) && !rosterSet.has(k)
  );

  const rounds = buildGuessLieRoundsFromSources(mergedSubmissions, lobbyMemberNames);
  const roundPlayersNotInRoster = rounds
    .filter((r) => !rosterSet.has(r.player))
    .map((r) => r.player);

  const validLocalKeys = localKeys.filter((e) => e.valid).map((e) => e.key);
  const validRemoteKeys = remoteKeys.filter((e) => e.valid).map((e) => e.key);

  const localKeysForUid = localUid
    ? validLocalKeys.filter((k) => userIdForName(k) === localUid)
    : [];
  const keysForLocalIdentity = [
    ...new Set(
      [
        localDisplayName,
        localLobbyParticipantName,
        ...localKeysForUid,
      ].filter(Boolean)
    ),
  ].filter((k) => isValidGuessLieSubmission(localSubmissions[k]));

  const localOnlyValidKeys = validLocalKeys.filter((k) => !validRemoteKeys.includes(k));
  const remoteOnlyValidKeys = validRemoteKeys.filter((k) => !validLocalKeys.includes(k));

  const rosterSubmittedCount = lobbyMemberNames.filter((n) =>
    isValidGuessLieSubmission(mergedSubmissions[n])
  ).length;

  const triggers = {
    roundPlayerNotInRoster: roundPlayersNotInRoster.length > 0,
    submissionKeyNotInRoster: keysNotInLobbyRoster.length > 0,
    multipleLocalSubmissionKeys:
      keysForLocalIdentity.length >= 2 ||
      (localUid != null && localKeysForUid.length >= 2),
    localValidAbsentFromRemote:
      localOnlyValidKeys.length > 0 &&
      validRemoteKeys.length > 0 &&
      localOnlyValidKeys.some((k) => !validRemoteKeys.includes(k)),
    roundsExceedRosterSubmitted:
      rounds.length > rosterSubmittedCount && lobbyMemberNames.length > 0,
    ownRoundVoteUiMismatch: false,
  };

  /** Première couche où une identité hors roster apparaît (analyse statique). */
  let firstGhostLayer = null;
  if (remoteOnlyValidKeys.some((k) => !rosterSet.has(k))) {
    firstGhostLayer = "game_sessions.state.guessLie.submissions (remote)";
  } else if (localOnlyValidKeys.some((k) => !rosterSet.has(k))) {
    firstGhostLayer = "state.guessLie.submissions (local)";
  } else if (keysNotInLobbyRoster.length > 0) {
    firstGhostLayer = "merged submissions (local ∪ remote)";
  } else if (roundPlayersNotInRoster.length > 0) {
    firstGhostLayer = "getGuessLieRounds() - clé submissions hors roster";
  }

  return {
    lobbyMemberNames: [...lobbyMemberNames],
    localKeys,
    remoteKeys,
    keysNotInLobbyRoster,
    roundPlayers: rounds.map((r) => r.player),
    roundPlayersNotInRoster,
    rounds,
    rosterSubmittedCount,
    keysForLocalIdentity,
    localOnlyValidKeys,
    remoteOnlyValidKeys,
    triggers,
    firstGhostLayer,
  };
}

/**
 * Déclencheurs de log élargis (symptôme QA + identités hors roster).
 */
export function shouldLogGuessLieGhostDiagnostic(analysis, { isSubject, roundPlayer, localUid }) {
  if (!analysis) return false;
  const t = analysis.triggers;
  if (t.roundPlayerNotInRoster) return true;
  if (t.submissionKeyNotInRoster) return true;
  if (t.multipleLocalSubmissionKeys) return true;
  if (t.localValidAbsentFromRemote) return true;
  if (t.roundsExceedRosterSubmitted) return true;
  if (!isSubject && roundPlayer && localUid) {
    const roundUid = analysis.localKeys.find((e) => e.key === roundPlayer)?.uid;
    if (roundUid && roundUid === localUid) return true;
  }
  return false;
}
