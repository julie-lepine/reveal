let saveTimer = null;
let pendingSave = null;

export function scheduleSave(fn) {
  pendingSave = fn;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    pendingSave?.();
    pendingSave = null;
  }, 280);
}

export function flushSave() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  pendingSave?.();
  pendingSave = null;
}
