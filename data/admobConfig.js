/** Configuration AdMob - IDs fournis par la console Google AdMob. */

export const ADMOB_APP_IDS = {
  android: "ca-app-pub-6332424645114129~4800114696",
  ios: "ca-app-pub-6332424645114129~1825936767",
};

export const ADMOB_BANNER_IDS = {
  android: "ca-app-pub-6332424645114129/3487033021",
  ios: "ca-app-pub-6332424645114129/9860869685",
};

/** IDs de test Google - à utiliser en dev (évite la suspension de compte). */
export const ADMOB_TEST_BANNER_IDS = {
  android: "ca-app-pub-3940256099942544/6300978111",
  ios: "ca-app-pub-3940256099942544/2934735716",
};

/**
 * true = bannières de test Google + initializeForTesting.
 * Passer à false pour les builds store (Play / App Store).
 */
export const ADMOB_USE_TEST_ADS = false;

/** Hauteur par défaut (px CSS) avant que le SDK signale la taille réelle (bannière adaptive). */
export const ADMOB_DEFAULT_BANNER_HEIGHT = 72;

/** Marge de sécurité sous la bannière native (px CSS) — évite que le contenu soit rogné. */
export const ADMOB_BANNER_BUFFER = 8;
