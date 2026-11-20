/** Message de l'hôte quand l'envoi des résultats de la manche a échoué (relance auto). */
export const CLUTCH_REVEAL_RETRY_LABEL = "Connexion difficile, on réessaie d’envoyer les résultats…";

/** Délai entre deux essais d'envoi des résultats. */
export const CLUTCH_REVEAL_RETRY_MS = 3000;

/**
 * Envoi des résultats de manche avec relance automatique.
 * Sans relance, un échec réseau laissait tout le monde sur « Temps écoulé »
 * (aucun autre événement ne relançait l'envoi).
 *
 * @param {object} opts
 * @param {() => Promise<unknown>} opts.attempt - un essai d'envoi (rejette si échec).
 * @param {() => boolean} opts.shouldRetry - faut-il encore réessayer (manche pas annoncée, hôte, écran ouvert) ?
 * @param {(failing: boolean) => void} [opts.onStateChange] - appelé quand on passe en échec / qu'on en sort.
 */
export function createClutchRevealRetry({
  attempt,
  shouldRetry,
  onStateChange = () => {},
  delayMs = CLUTCH_REVEAL_RETRY_MS,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  let timer = null;
  let failing = false;

  function setFailing(next) {
    if (failing === next) return;
    failing = next;
    onStateChange(failing);
  }

  function cancel() {
    if (timer != null) clearTimer(timer);
    timer = null;
  }

  async function run() {
    cancel();
    try {
      await attempt();
      setFailing(false);
    } catch (err) {
      console.warn("REVEAL clutch reveal:", err);
      if (!shouldRetry()) {
        setFailing(false);
        return;
      }
      setFailing(true);
      timer = setTimer(() => {
        timer = null;
        if (!shouldRetry()) {
          setFailing(false);
          return;
        }
        void run();
      }, delayMs);
    }
  }

  /** Arrêt complet (nouvelle manche, sortie de l'écran). */
  function stop() {
    cancel();
    failing = false;
  }

  return {
    run,
    stop,
    isFailing: () => failing,
  };
}
