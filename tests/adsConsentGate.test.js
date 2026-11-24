/**
 * Audit pubs n°1 et n°3 :
 * - aucune bannière tant que Google n'a pas donné son feu vert (`canRequestAds`),
 *   y compris si la demande de consentement échoue (réessai au plus toutes les 30 s) ;
 * - bouton « Choix publicitaires » quand Google l'exige, qui rouvre le formulaire.
 * Lancer : node --experimental-test-module-mocks --test tests/adsConsentGate.test.js
 */
import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

globalThis.window = { innerWidth: 400, devicePixelRatio: 1 };
const bodyClasses = new Set();
globalThis.document = {
  documentElement: { style: { setProperty() {} } },
  body: {
    classList: {
      add: (c) => bodyClasses.add(c),
      remove: (c) => bodyClasses.delete(c),
    },
  },
};

let currentScreen = "game-select";

mock.module("../js/core/platform.js", {
  namedExports: {
    isNativeApp: () => true,
    getNativePlatform: () => "android",
  },
});
mock.module("../js/core/router.js", {
  namedExports: {
    onScreenChange: () => () => {},
    getCurrentScreen: () => currentScreen,
  },
});
mock.module("../js/core/entitlements.js", {
  namedExports: { isAdFree: () => false },
});

let fakeAdMob;
function makeAdMob({ consent, consentRejects = false, afterForm, afterPrivacy } = {}) {
  return {
    initialize: mock.fn(async () => {}),
    addListener: mock.fn(() => {}),
    requestConsentInfo: mock.fn(async () => {
      if (consentRejects) throw new Error("offline");
      return consent;
    }),
    showConsentForm: mock.fn(async () => afterForm),
    showPrivacyOptionsForm: mock.fn(async () => {
      if (afterPrivacy) fakeAdMob.requestConsentInfo = mock.fn(async () => afterPrivacy);
    }),
    trackingAuthorizationStatus: mock.fn(async () => ({ status: "authorized" })),
    requestTrackingAuthorization: mock.fn(async () => {}),
    showBanner: mock.fn(async () => {}),
    resumeBanner: mock.fn(async () => {}),
    removeBanner: mock.fn(async () => {}),
    hideBanner: mock.fn(async () => {}),
  };
}

mock.module("../js/core/capacitorImports.js", {
  namedExports: {
    loadCapacitorAdMob: async () => ({
      AdMob: fakeAdMob,
      BannerAdSize: { ADAPTIVE_BANNER: "ADAPTIVE_BANNER" },
      BannerAdPosition: { TOP_CENTER: "TOP_CENTER" },
      BannerAdPluginEvents: { SizeChanged: "size", FailedToLoad: "failed" },
      AdmobConsentStatus: { REQUIRED: "REQUIRED", OBTAINED: "OBTAINED" },
    }),
  },
});

let importCount = 0;
async function freshAds() {
  importCount += 1;
  return import(`../js/core/ads.js?case=${importCount}`);
}

/** Attendre la file de synchro de la bannière. */
async function settle() {
  for (let i = 0; i < 20; i += 1) await new Promise((r) => setImmediate(r));
}

beforeEach(() => {
  currentScreen = "game-select";
  bodyClasses.clear();
});

describe("Audit pubs n°3 — pas de pub sans feu vert Google", () => {
  it("demande de consentement ratée : aucune bannière, pas de nouvel essai avant 30 s", async () => {
    fakeAdMob = makeAdMob({ consentRejects: true });
    const ads = await freshAds();
    ads.initAds();
    await settle();
    assert.equal(fakeAdMob.showBanner.mock.callCount(), 0);
    assert.equal(fakeAdMob.requestConsentInfo.mock.callCount(), 1);
    assert.equal(bodyClasses.has("has-top-ad"), false);

    ads.refreshAdsForEntitlement();
    await settle();
    assert.equal(fakeAdMob.requestConsentInfo.mock.callCount(), 1);
    assert.equal(fakeAdMob.showBanner.mock.callCount(), 0);
  });

  // canRequestAds n'est faux que si le formulaire n'a pas encore reçu de réponse :
  // un joueur qui refuse la personnalisation a le statut OBTAINED, donc des pubs non personnalisées.
  it("formulaire pas encore rempli (canRequestAds faux) : aucune bannière", async () => {
    fakeAdMob = makeAdMob({
      consent: { status: "OBTAINED", canRequestAds: false, privacyOptionsRequirementStatus: "REQUIRED" },
    });
    const ads = await freshAds();
    ads.initAds();
    await settle();
    assert.equal(fakeAdMob.showBanner.mock.callCount(), 0);
    assert.equal(ads.adConsentAllowsAds(), false);
  });

  it("formulaire requis : la réponse du formulaire décide", async () => {
    fakeAdMob = makeAdMob({
      consent: {
        status: "REQUIRED",
        isConsentFormAvailable: true,
        canRequestAds: false,
        privacyOptionsRequirementStatus: "UNKNOWN",
      },
      afterForm: { status: "OBTAINED", canRequestAds: true, privacyOptionsRequirementStatus: "REQUIRED" },
    });
    const ads = await freshAds();
    ads.initAds();
    await settle();
    assert.equal(fakeAdMob.showConsentForm.mock.callCount(), 1);
    assert.equal(fakeAdMob.showBanner.mock.callCount(), 1);
    assert.equal(ads.adPrivacyOptionsRequired(), true);
  });

  it("le plugin est démarré avant le formulaire (iOS l'exige), une seule fois", async () => {
    fakeAdMob = makeAdMob({
      consent: { status: "OBTAINED", canRequestAds: true, privacyOptionsRequirementStatus: "NOT_REQUIRED" },
    });
    const ads = await freshAds();
    ads.initAds();
    await settle();
    ads.refreshAdsForEntitlement();
    await settle();
    assert.equal(fakeAdMob.initialize.mock.callCount(), 1);
    assert.equal(fakeAdMob.addListener.mock.callCount(), 2);
    assert.equal(ads.adPrivacyOptionsRequired(), false);
  });
});

describe("Audit pubs n°1 — Choix publicitaires", () => {
  it("rouvre le formulaire Google et retire la bannière si l'accord ne permet plus de pub", async () => {
    fakeAdMob = makeAdMob({
      consent: { status: "OBTAINED", canRequestAds: true, privacyOptionsRequirementStatus: "REQUIRED" },
      afterPrivacy: { status: "OBTAINED", canRequestAds: false, privacyOptionsRequirementStatus: "REQUIRED" },
    });
    const ads = await freshAds();
    const seen = [];
    ads.onAdConsentChange((s) => seen.push(s));
    ads.initAds();
    await settle();
    assert.equal(fakeAdMob.showBanner.mock.callCount(), 1);
    assert.equal(seen.at(-1)?.privacyOptionsRequired, true);

    const res = await ads.openAdPrivacyOptions();
    await settle();
    assert.equal(res.ok, true);
    assert.equal(fakeAdMob.showPrivacyOptionsForm.mock.callCount(), 1);
    assert.equal(ads.adConsentAllowsAds(), false);
    assert.ok(fakeAdMob.removeBanner.mock.callCount() >= 1);
    assert.equal(bodyClasses.has("has-top-ad"), false);
  });

  it("Aide & légal affiche le bouton seulement si Google l'exige", () => {
    const help = readFileSync(join(ROOT, "js/screens/helpLegal.js"), "utf8");
    assert.match(help, /id="ad-privacy-slot"/);
    assert.match(help, /adPrivacyOptionsHtml\(adPrivacyOptionsRequired\(\)\)/);
    assert.match(help, /openAdPrivacyOptions\(\)/);
    assert.match(help, /onAdConsentChange\(/);
    assert.match(help, /if \(!required\) return "";/);
  });
});
