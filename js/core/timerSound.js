/** Tick chronomètre pour les décomptes (Web Audio, sans fichier). */

let ctx = null;
let primeListenerAdded = false;

function getAudioContext() {
  if (!ctx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    ctx = new Ctx();
  }
  return ctx;
}

export function primeTimerSound() {
  const ac = getAudioContext();
  if (ac?.state === "suspended") {
    ac.resume().catch(() => {});
  }
}

function ensurePrimeOnInteraction() {
  if (primeListenerAdded) return;
  primeListenerAdded = true;
  const prime = () => primeTimerSound();
  document.addEventListener("pointerdown", prime, { once: true, passive: true });
  document.addEventListener("keydown", prime, { once: true });
}

function beep({ freq = 800, duration = 0.04, volume = 0.1, type = "square" } = {}) {
  const ac = getAudioContext();
  if (!ac) return;
  try {
    const t0 = ac.currentTime;
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

/** Un tick par seconde ; `remaining` = secondes restantes après décrément. */
export function onTimerSecond({ remaining, urgentAt = 5 } = {}) {
  ensurePrimeOnInteraction();
  primeTimerSound();

  if (remaining <= 0) {
    beep({ freq: 520, duration: 0.07, volume: 0.11 });
    window.setTimeout(() => beep({ freq: 380, duration: 0.1, volume: 0.12 }), 90);
    return;
  }

  const urgent = remaining <= urgentAt;
  beep({
    freq: urgent ? 900 : 720,
    duration: urgent ? 0.035 : 0.028,
    volume: urgent ? 0.12 : 0.085,
    type: "square",
  });
}
