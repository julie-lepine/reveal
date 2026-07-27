/** Classification Cas A / B — pure, testable sans gameSync. */
export function classifyGuessLieIdentityCase(submissionKeys, localUid) {
  if (!localUid) return "unknown";
  const forLocal = submissionKeys.filter((e) => e.uid === localUid && e.valid);
  if (forLocal.length >= 2) return "B";
  if (forLocal.length === 1) return "A";
  return "unknown";
}
