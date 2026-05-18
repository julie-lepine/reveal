import { getState, saveStatePatch } from "./state.js";

const defaultSettings = () => ({
  timerMuted: false,
});

export function getSettings() {
  return { ...defaultSettings(), ...getState().settings };
}

export function isTimerMuted() {
  return Boolean(getSettings().timerMuted);
}

export function setTimerMuted(muted) {
  saveStatePatch({
    settings: { ...getSettings(), timerMuted: Boolean(muted) },
  });
}
