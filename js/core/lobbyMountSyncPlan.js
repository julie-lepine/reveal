/**
 * SYN-12 / M-05b - contrat mount lobby : un seul startMultiplayerSync par chemin MP.
 * Pur / testable (sans DOM ni gameSync).
 */

/**
 * @param {{
 *   syncActive: boolean,
 *   hasResumeScreen: boolean,
 *   eveningStarted: boolean,
 * }} opts
 * @returns {{
 *   startCount: number,
 *   startPhase: 'pre-refresh' | null,
 *   earlyReturn: 'resume' | 'evening-redirect' | null,
 *   bindWaitingRoomSession: boolean,
 * }}
 */
export function planLobbyMountMultiplayerSync({
  syncActive,
  hasResumeScreen,
  eveningStarted,
}) {
  if (!syncActive) {
    return {
      startCount: 0,
      startPhase: null,
      earlyReturn: eveningStarted ? "evening-redirect" : null,
      bindWaitingRoomSession: false,
    };
  }

  if (hasResumeScreen) {
    return {
      startCount: 1,
      startPhase: "pre-refresh",
      earlyReturn: "resume",
      bindWaitingRoomSession: false,
    };
  }

  if (eveningStarted) {
    return {
      startCount: 1,
      startPhase: "pre-refresh",
      earlyReturn: "evening-redirect",
      bindWaitingRoomSession: false,
    };
  }

  return {
    startCount: 1,
    startPhase: "pre-refresh",
    earlyReturn: null,
    bindWaitingRoomSession: true,
  };
}
