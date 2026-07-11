/** Maps ready avant/après toggle prep (rollback local en cas d'échec sync). */
export function computePrepReadyToggle(session, readyField, readyKey, ready) {
  const previousReady = { ...(session[readyField] || {}) };
  const nextReady = { ...previousReady, [readyKey]: ready };
  return { previousReady, nextReady };
}
