import { isTimerMuted } from "./settings.js";

let ctx = null;
let lastWizzAt = 0;

function getAudioContext() {
  if (!ctx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    ctx = new Ctx();
  }
  return ctx;
}

function buzz({ freq, duration, volume, delay = 0, type = "square" }) {
  const ac = getAudioContext();
  if (!ac) return;
  try {
    const t0 = ac.currentTime + delay;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    gain.gain.setValueAtTime(volume, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
    osc.connect(gain);
    gain.connect(ac.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  } catch {
    /* ignore */
  }
}

/** Son type MSN « wizz » — plusieurs buzz courts. */
export function playLobbyNudge() {
  if (isTimerMuted()) return;
  const ac = getAudioContext();
  if (ac?.state === "suspended") ac.resume().catch(() => {});

  const pattern = [
    { freq: 880, duration: 0.05, volume: 0.14, delay: 0 },
    { freq: 660, duration: 0.05, volume: 0.12, delay: 0.07 },
    { freq: 990, duration: 0.06, volume: 0.15, delay: 0.14 },
    { freq: 740, duration: 0.08, volume: 0.13, delay: 0.22 },
  ];
  pattern.forEach((p) => buzz(p));
}

/** Tremblement de l'écran (style MSN). */
export function runScreenWizz() {
  const now = Date.now();
  if (now - lastWizzAt < 400) return;
  lastWizzAt = now;

  document.body.classList.remove("wizz-shake");
  void document.body.offsetWidth;
  document.body.classList.add("wizz-shake");
  window.setTimeout(() => document.body.classList.remove("wizz-shake"), 520);
}

export function triggerLobbyNudge() {
  playLobbyNudge();
  runScreenWizz();
}
