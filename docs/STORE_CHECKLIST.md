# REVEAL — Checklist publication stores (Play Store + App Store)

Utilise cette liste **en plus** de [LAUNCH_CHECKLIST.md](./LAUNCH_CHECKLIST.md) (backend Supabase stable).

Légende : ✅ fait dans le repo · ☐ à faire manuellement · 🧪 à tester sur device

---

## A. Déjà fait dans le code

- [x] Écran d’intro **welcome** (avant connexion) → bouton vers `home` (`js/screens/welcome.js`)
- [x] Capacitor initialisé (`capacitor.config.ts`, scripts `cap:sync`)
- [x] Plateformes `android/` et `ios/` générées
- [x] AdMob : bannière haut, masquée sur `welcome`, `home`, `reset-password` ; visible lobby → jeux (`js/core/ads.js`, `body.has-top-ad`)
- [x] Consentement pub UMP (RGPD) au démarrage AdMob — code `js/core/ads.js` ; message console **publié** → section **B bis**
- [x] Deep links auth : `com.reveal.partygames://auth/callback` (`js/core/deepLinks.js`)
- [x] Redirect Supabase natif (`getAuthRedirectUrl()` dans `supabaseAuth.js`)
- [x] Patch natif auto : AdMob App ID, deep link, ATT iOS (`scripts/patchNative.mjs`)
- [x] Politique de confidentialité : écran in-app + `privacy.html` — URL store `https://revealthepartygame.fr/privacy.html` (`data/appConfig.js`)
- [x] IDs AdMob configurés (`data/admobConfig.js`)
- [x] Sources icône / splash : `resources/` (icon 1024², splash 2732², exports portrait iOS/Android) — voir [resources/README.md](../resources/README.md)
- [x] Scripts assets : `assets:prepare` (secours), `assets:native`, `assets:sync`, `assets:all` (`package.json`)

---

## B. Comptes & consoles (manuel)

- [ ] Compte **Google Play Console** (inscription ~25 €)
- [ ] Compte **Apple Developer Program** (~99 €/an)
- [x] Apps **AdMob** (Android + iOS) — IDs dans `data/admobConfig.js`
- [ ] Lier **Play Console ↔ AdMob** (Android, recommandé — après publication sur le store)

---

## B bis. AdMob — message RGPD / UMP (manuel)

Console : **Confidentialité et messages** → [Règlementations européennes](https://admob.google.com/v2/privacymessaging/gdpr)  
(L’UI peut rester blanche en navigation normale → **fenêtre privée** ou désactiver le bloqueur de pub sur `admob.google.com`.)

### Config message (juin 2026)

- [x] Message **Règlementations européennes** créé, stylé (DA REVEAL, contraste **5:1** TCF) et **publié**
- [x] Apps Android + iOS associées au message
- [x] URL politique de confidentialité dans le message : `https://revealthepartygame.fr/privacy.html`
- [x] Textes boutons conformes TCF (ex. « J’accepte », « Refuser », « Gérer les options » — pas « Continuer »)
- [ ] **En-tête → Logo** : vérifier après **liaison au store** (icône tirée du listing Play / App Store, pas de `resources/icon.png` direct)
- [ ] Après publication store : **Applications** → passer **Non publiée** → **Publiée** et lier chaque app à sa fiche store ([doc AdMob](https://support.google.com/admob/answer/9989980?hl=fr))
- [ ] Si test avec ciblage **Partout** : repasser **Pays soumis au RGPD** avant prod store

### Styles appliqués (éditeur AdMob — rappel)

| Section | Réglage | Valeur |
|---------|---------|--------|
| **Général** | Principale | `#4f46e5` |
| | Arrière-plan | `#0d0f1e` |
| | Titres et boutons / Corps | Inter (ou Open Sans) |
| | Angles | Circulaires |
| **Titre** | Couleur / Taille | `#FFFFFF` / `1.25em` |
| **Corps** | Couleur / Taille | `#CBD5E1` / `1em` |
| **Boutons** | Texte principal | `#FFFFFF` |
| | Secondaire | Rempli — fond `#252840`, texte `#FFFFFF` |

> Logo et **nom affiché** (texte par défaut non modifié) se mettent à jour **sans nouvelle version app** une fois l’app liée au store ; le texte édité à la main dans le message doit être mis à jour dans AdMob. Voir [ADMOB.md](./ADMOB.md).

---

## C. Supabase (dashboard — manuel)

Réf. [SUPABASE_SETUP.md](./SUPABASE_SETUP.md)

- [x] **Authentication → URL Configuration → Redirect URLs** :
  - `com.reveal.partygames://auth/callback`
  - `com.reveal.partygames://**` (wildcard si proposé)
  - Garder l’URL web GitHub Pages si tu maintiens la version web
- [x] Anonymous + Email activés
- [x] Realtime + SQL à jour

---

## C bis. Emails Resend + OVH (manuel)

Guide pas à pas : **[RESEND_SETUP.md](./RESEND_SETUP.md)**

- [x] Domaine ajouté dans **Resend** (`revealthepartygame.fr`)
- [x] Enregistrements DNS dans **OVH → Zone DNS** (TXT / DKIM / SPF + MX `send` — MX ajouté via édition avancée de la zone)
- [x] Statut domaine **Verified** dans Resend
- [x] Clé API Resend → **Supabase → Authentication → Emails** → Custom SMTP (`smtp.resend.com`, user `resend`, sender `noreply@…` sur domaine vérifié — pas de boîte mail OVH requise)
- [x] 🧪 Envoi email OK (reset mot de passe via Resend)

> **Note (02 juin 2026)** : le SMTP se configure dans **Authentication → Emails**, pas dans Project Settings (menu parfois bloquer si quota org dépassé).

---

## D. Cloudflare Turnstile (native — manuel)

- [x] Widget Turnstile : hostnames **`localhost`**, **`127.0.0.1`**, **`julie-lepine.github.io`**
- [x] 🧪 Captcha OK sur **Samsung Z Flip** (app native) — login, inscription, invité (après mise à jour hostnames Cloudflare)

---

## E. Build & test device (manuel)

**Prérequis : Node.js ≥ 22** (`node -v`) — Capacitor 8 refuse Node 20.

```bash
npm run assets:sync      # icône/splash → android/ios + sync web (si assets prêts)
# ou npm run cap:sync    # sync web seulement
npm run cap:open:android   # ou cap:open:ios sur Mac
```

- [x] 🧪 **Android** : Samsung Z Flip via **Android Studio** (projet `android/`, config `app`, débogage USB)
- [ ] 🧪 **iPhone** (Mac + Xcode) — checklist détaillée : **[IPHONE_TEST_CHECKLIST.md](./IPHONE_TEST_CHECKLIST.md)**
- [ ] 🧪 Auth email + invité + **lobby multijoueur** (2e client web ou 2e téléphone)
- [x] 🧪 Reset mot de passe → **deep link** natif → écran nouveau MDP dans l’app (mail Resend OK ✅)
- [x] 🧪 Bannière AdMob absente sur accueil/connexion ; visible à partir du lobby
- [x] 🧪 Formulaire consentement pub (UE) — popup au lobby OK (juin 2026)
- [ ] 🧪 Soirée pilote complète en APK/IPA debug

---

## F. Avant build **production** store

- [ ] `data/admobConfig.js` → **`ADMOB_USE_TEST_ADS = false`**
- [ ] `npm run cap:sync`
- [ ] Incrémenter version :
  - Android : `android/app/build.gradle` → `versionCode`, `versionName`
  - iOS : Xcode → General → Version / Build
- [ ] **Android** : keystore de signature + build **AAB** release
- [ ] **iOS** : certificats + provisioning + Archive Xcode

---

## G. Assets store (manuel)

### In-app (Capacitor) — sources dans le repo

- [x] **Icône store + in-app** : `resources/icon.png` (**1024×1024**, version validée juin 2026)
- [x] **Splash Capacitor** : `resources/splash.png` (2732×2732) — lu par `@capacitor/assets`
- [x] **Splashes portrait** (logo + tagline, archivage / référence) :
  - `resources/splash_android_1080x1920.png`
  - `resources/splash_ios_828x1792.png`
  - `resources/splash_ios_1125x2436.png`
  - `resources/splash_ios_1242x2688.png`
  - Doc : [resources/README.md](../resources/README.md)
- [ ] **Natif** : injecter icône + splash dans `android/` + `ios/` :
  ```bash
  npm run assets:sync
  ```
  (équivalent : `npm run assets:native` puis `npm run cap:sync`)
  - [x] `cap:sync` + run Android Studio → app lancée sur téléphone (02 juin 2026)
  - [x] `assets:native` régénéré (splash plein écran Android 12+, `logoSplashScale 0.62`) — 🧪 logo au démarrage OK sur device (juin 2026)
  - [x] Icône **1024×1024** validée dans `resources/icon.png` — relancer `assets:sync` si tu changes le PNG
  - ⚠️ **Node ≥ 22** obligatoire pour `cap sync`
  - ⚠️ `@capacitor/assets` peut échouer sur Windows (TLS / `sharp`) — autre réseau ou Mac
  - ⚠️ **Ne pas** lancer `npm run assets:prepare` : écrase icon/splash sans tagline
- [x] 🧪 Icône + splash sur device OK (Samsung Z Flip, juin 2026)

### Fiche store (upload consoles — pas d’hébergement web)

- [x] Captures d’écran archivées dans `store-assets/` (5 écrans × 2 OS) :
  - **Android** (`store-assets/android/`) — **1080×~1920** (9:16) : `welcome`, `lobby_setup`, `dilemma`, `consensus`, `classement`
  - **iOS** (`store-assets/ios/`) — **1290×2796** (6,7") : mêmes 5 écrans
  - Doc : [store-assets/README.md](../store-assets/README.md)
- [x] **Feature graphic** Android (1024×500) — `store-assets/android/feature-graphic.png` (fond sombre, logo `resources/icon-white.png`)
- [ ] Upload **icône 1024** + captures dans **Play Console** + **App Store Connect** (au moment de la soumission) — source icône : `resources/icon.png` ✅
- [x] Textes fiche store (titre, description, mots-clés, catégorie)
- [x] **URL politique de confidentialité** (app + fiches store) :  
  `https://revealthepartygame.fr/privacy.html`  
  → définie dans `data/appConfig.js` (`PRIVACY_POLICY_PUBLIC_URL`) ; même URL à coller dans Play Console et App Store Connect
- [x] 🧪 URL privacy répond en HTTPS (`https://revealthepartygame.fr/privacy.html`, juin 2026)

> **Rappel** : icône et splash **ne sont pas hébergés** sur GitHub Pages — ils sont embarqués dans l’APK/IPA (ou upload PNG 1024 direct sur App Store Connect).

---

## G bis. Site légal `revealthepartygame.fr` (repo séparé + OVH)

Repo **hors** de ce dossier Party Games (pages statiques créées de ton côté). Guide détaillé OVH (équivalent Hostinger / FTP) : **[LEGAL_SITE_OVH.md](./LEGAL_SITE_OVH.md)**.

### Contenu du site (repo légal)

- [x] Repo Git du site légal créé
- [x] Compléter les placeholders dans **mentions légales** (éditeur, adresse, SIRET, hébergeur, email)
- [ ] **Liens pour télécharger l’app** sur le site légal :
  - [ ] `index.html` : pilule(s) ou bouton **Google Play** + **App Store** (URLs réelles une fois les apps publiées ; sinon libellé « Bientôt disponible »)
  - [ ] `mentions-legales.html` : courte section « Téléchargement » avec les mêmes liens
  - [x] Lien **Jouer en ligne** → `https://julie-lepine.github.io/reveal/` (présent sur le site)
- [x] Vérifier que `privacy.html` est aligné avec `data/legalContent.js` (ce repo)

### Publication OVH (manuel — pas Hostinger)

- [x] **Hébergement Web OVH** associé au domaine
- [x] **Multisite** : `revealthepartygame.fr` (+ `www`) → dossier `www`
- [x] **Zone DNS** : parking retiré ; `send.*` (Resend) intact
- [x] Fichiers en ligne : `index.html`, `privacy.html`, `mentions-legales.html`, `legal.css`, `reveal.png`
- [x] **SSL** (Let’s Encrypt) actif
- [x] 🧪 HTTPS OK : [accueil](https://revealthepartygame.fr/), [privacy](https://revealthepartygame.fr/privacy.html), [mentions](https://revealthepartygame.fr/mentions-legales.html) (juin 2026)
- [x] `data/appConfig.js` → `PRIVACY_POLICY_PUBLIC_URL` =  
  `https://revealthepartygame.fr/privacy.html`
- [ ] Fiches store : coller la même URL privacy dans Play Console + App Store Connect (au moment de la soumission)

> **Alternative sans FTP OVH** : déployer le repo légal via **Cloudflare Pages** + CNAME `www` dans OVH — voir [LEGAL_SITE_OVH.md](./LEGAL_SITE_OVH.md).

---

## H. Conformité & questionnaires store

- [x] Politique de confidentialité **accessible en ligne** — [revealthepartygame.fr/privacy.html](https://revealthepartygame.fr/privacy.html) ; URL dans l’app ✅
- [x] CMP **Google UMP** (message Règlementations européennes publié dans AdMob — section **B bis**)
- [ ] Compléter **App Privacy** (Apple) : email, identifiants, pub AdMob, Supabase
- [ ] Questionnaire **classification contenu** (Google)
- [ ] Déclarer la **publicité** dans les deux consoles
- [ ] Email de contact éditeur (fiche store + RGPD dans `data/legalContent.js`)

---

## I. Soumission

- [ ] **Play Store** : piste interne/fermée → production
- [ ] **App Store** : TestFlight → soumission review
- [ ] Après approbation : vérifier vraies pubs AdMob (plus les bannières test)

---

## J. Mises à jour futures (rappel)

1. Dev ici (`js/`, `data/`, `style.css`…)
2. `npm run cap:sync`
3. Test device
4. Bump version + build release signé
5. Upload Play Console / App Store Connect

`git push` seul **ne met pas à jour** les stores.

---

## Fichiers clés

| Fichier | Rôle |
|---------|------|
| [data/admobConfig.js](../data/admobConfig.js) | IDs pub + mode test/prod |
| [data/appConfig.js](../data/appConfig.js) | Bundle ID, deep link, URL privacy |
| [data/legalContent.js](../data/legalContent.js) | Texte RGPD in-app |
| [privacy.html](../privacy.html) | Copie locale / GitHub Pages (legacy) ; **URL store** → domaine OVH via `appConfig.js` |
| [LEGAL_SITE_OVH.md](./LEGAL_SITE_OVH.md) | Déployer le repo légal sur OVH (FTP / SSL / DNS) |
| [RESEND_SETUP.md](./RESEND_SETUP.md) | DNS OVH + SMTP Supabase |
| [ADMOB.md](./ADMOB.md) | Doc technique AdMob |
| [CAPACITOR.md](./CAPACITOR.md) | Vue d’ensemble Capacitor |
| [resources/README.md](../resources/README.md) | Icône / splash Capacitor |
| [store-assets/README.md](../store-assets/README.md) | Captures store Android 1080×1920 + iOS 1290×2796 |

---

**Prochaine action recommandée** : section **E** 🧪 — lobby multijoueur + soirée pilote ; puis **B** (comptes Play / Apple) ; **[IPHONE_TEST_CHECKLIST.md](./IPHONE_TEST_CHECKLIST.md)** (jour Mac).
