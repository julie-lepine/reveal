/**
 * M-10 - montage prep : refresh session avec catch (testable sans Supabase).
 */
export function runSyncPrepOnMount({
  isActive,
  refresh,
  refreshFromSync,
  reportError,
}) {
  if (!isActive()) return Promise.resolve({ skipped: true });
  return refresh()
    .then(() => {
      refreshFromSync?.();
      return { ok: true };
    })
    .catch(async (err) => {
      await reportError?.(err);
      return { ok: false, error: err };
    });
}
