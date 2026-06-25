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
- [x] **Suppression de compte** : page `suppression-compte.html` + bouton Paramètres — URL store `https://revealthepartygame.fr/suppression-compte.html` (`ACCOUNT_DELETION_PUBLIC_URL`)
- [x] IDs AdMob configurés (`data/admobConfig.js`)
- [x] Sources icône / splash : `resources/` (icon 1024², splash 2732², exports portrait iOS/Android) — voir [resources/README.md](../resources/README.md)
- [x] Scripts assets : `assets:prepare` (secours), `assets:native`, `assets:sync`, `assets:all` (`package.json`)

---

## B. Comptes & consoles (manuel)

- [x] Compte **Google Play Console** (inscription ~25 €) — compte **Individuel** (`contact@revealthepartygame.fr`), juin 2026
- [x] **Play Console** — validation **identité Google** OK (juin 2026)
- [x] Compte **Apple Developer Program** (~99 €/an) — inscription juin 2026
- [x] **Apple Developer** — programme actif (juin 2026)
- [x] Créer l’app **REVEAL** dans Play Console (`com.reveal.partygames`) — juin 2026
- [ ] Créer **Bundle ID** + app dans **App Store Connect** (`com.reveal.partygames`)

### Play Console — progression fiche REVEAL (juin 2026)

Menu : sélectionner l’app **REVEAL** en haut → pas le compte développeur global.

| Étape | Menu Play Console | Statut |
|-------|-------------------|--------|
| Créer l’app (`com.reveal.partygames`, Jeu → Casual) | Tableau de bord | ✅ |
| **Contenu de l’application** (privacy, suppression compte, annonces, sécurité des données…) | **Règles et programmes** → **Contenu de l’application** | ✅ juin 2026 |
| Fiche Play Store (textes, icône, captures) | **Accroître le nombre d’utilisateurs** → **Fiche Play Store principale** | ✅ juin 2026 |
| Site web du développeur | Fiche store → contact | ✅ `https://revealthepartygame.fr` |
| Classification du contenu | **Règles et programmes** → **Classification du contenu** | ✅ juin 2026 |
| Public cible | **Règles et programmes** → **Public cible** | ✅ juin 2026 |
| AAB v1 déployé (test fermé **Bêta amis**) | **Tester et publier** → **Tests fermés** | ✅ v1.0 active (17 juin 2026) |
| Testeurs **codes d'accès** (pas de lien opt-in) | **Tests fermés** → **Testeurs** → Codes d'accès | ✅ codes générés · ☐ partager + **12 testeurs** installés |
| 12 testeurs × 14 jours | Test fermé actif | ☐ en cours après installations |

- [x] Apps **AdMob** (Android + iOS) — IDs dans `data/admobConfig.js` ; apps REVEAL visibles dans AdMob
- [ ] Lier **Play Console ↔ AdMob** (Android) — **après** 1ère release Play publique ; magasin d’apps AdMob = « — » tant que non lié ([doc](https://support.google.com/admob/answer/10037806?hl=fr))
- [ ] Lier **App Store Connect ↔ AdMob** (iOS) — après 1ère release App Store

> **DUNS / Organisation** : compte Play **Individuel** retenu (micro-entreprise EI récente, pas de DUNS Altares/Verif encore). Organisation + DUNS possible plus tard si besoin.

> **Test fermé — codes d'accès** : pas de lien `play.google.com/apps/testing/…`. Testeurs → Play Store → Profil → **Paiements et abonnements** → **Utiliser un code** → code Play Console → installer REVEAL. (Liste d'emails = lien opt-in à la place.)

> **Build AAB (juin 2026)** : keystore `reveal-release.jks` (hors repo) · `app-release.aab` · `versionCode` 1 / `versionName` 1.0 · `ADMOB_USE_TEST_ADS = false` · déclaration **ID publicitaire = Oui** (Publicité ou marketing). Build Gradle : désactiver scan HTTPS **Avast** si erreur PKIX.

> **Play Console — compte personnel** : test **fermé** **12 testeurs × 14 jours** avant demande d’accès production ([doc](https://support.google.com/googleplay/android-developer/answer/14151465)).

> **Fiche store** : catégorie **Jeu → Casual (Décontracté)**.

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
- [ ] Après publication store : **Applications** → **Paramètres** → **Magasins d’applications** → **Ajouter un magasin** (Google Play / App Store) — package `com.reveal.partygames` apparaît alors dans AdMob
- [ ] **app-ads.txt** sur le site développeur ([doc](https://support.google.com/admob/answer/14538460?hl=fr)) :
  - [ ] Publier `https://revealthepartygame.fr/app-ads.txt` (publisher `pub-6332424645114129`)
  - [ ] Play Console → fiche app → **Site web du développeur** = `https://revealthepartygame.fr`
  - [ ] AdMob → statut app-ads.txt **Validé** + **Vérifier l’application** (statut actuel AdMob Android : **Examen requis** — normal avant lien store + app-ads.txt)
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

### Android — debug USB (dev)

- [x] 🧪 **Android** : Samsung Z Flip via **Android Studio** (projet `android/`, config `app`, débogage USB)
- [x] 🧪 Reset mot de passe → **deep link** natif → écran nouveau MDP dans l’app (mail Resend OK ✅)
- [x] 🧪 Bannière AdMob absente sur accueil/connexion ; visible à partir du lobby
- [x] 🧪 Formulaire consentement pub (UE) — popup au lobby OK (juin 2026)

### Android — bêta Play Store (build signé v1.0) ← **prochaine session debug**

- [ ] 🧪 Installer via **code d'accès** Play Store (pas APK Android Studio)
- [ ] 🧪 Auth email + invité + **lobby multijoueur** (2e client web ou 2e téléphone)
- [ ] 🧪 **Soirée pilote** complète (build test fermé, conditions réelles)
- [ ] 🧪 Pubs AdMob **prod** (`ADMOB_USE_TEST_ADS = false`) sur device bêta
- [ ] Noter bugs / retours → correctifs → **AAB v2** (`versionCode` 2) si besoin

### iOS ← **prochaine session build**

- [ ] 🧪 **iPhone** (Mac + Xcode) — **[IPHONE_TEST_CHECKLIST.md](./IPHONE_TEST_CHECKLIST.md)**
- [ ] Archive + TestFlight / App Store Connect

---

## F. Build **production** store

- [x] `data/admobConfig.js` → **`ADMOB_USE_TEST_ADS = false`** (juin 2026)
- [x] `npm run cap:sync` avant build AAB
- [x] Version initiale : `android/app/build.gradle` → `versionCode` **1**, `versionName` **"1.0"**
- [x] **Android** : keystore `reveal-release.jks` + **AAB** release (`app-release.aab`) — juin 2026
- [ ] **iOS** : certificats + provisioning + Archive Xcode

> **Mises à jour futures** : incrémenter `versionCode` (+1 obligatoire) et `versionName` à chaque nouvel upload Play.

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
- [x] **Natif** : icône + splash dans `android/` + `ios/` (juin 2026) :
  ```bash
  npm run assets:sync   # seulement si tu changes resources/icon.png ou splash.png
  # ou npm run cap:sync seul après modif js/data uniquement
  ```
  - [x] `cap:sync` + run Android Studio → app lancée sur téléphone (02 juin 2026)
  - [x] `assets:native` régénéré (splash plein écran Android 12+, `logoSplashScale 0.62`) — 🧪 logo au démarrage OK sur device (juin 2026)
  - [x] Icône **1024×1024** validée dans `resources/icon.png`
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
- [x] Upload **icône 1024** + captures dans **Play Console** — juin 2026
- [ ] Upload captures dans **App Store Connect** — `store-assets/ios/` (après création app iOS)
- [x] Textes fiche store (titre, description, mots-clés, catégorie)
- [x] **URL politique de confidentialité** : `https://revealthepartygame.fr/privacy.html` (`PRIVACY_POLICY_PUBLIC_URL`)
- [x] **URL suppression de compte** : `https://revealthepartygame.fr/suppression-compte.html` (`ACCOUNT_DELETION_PUBLIC_URL`) — page à déployer OVH (**G bis**)
- [x] 🧪 URL privacy répond en HTTPS (juin 2026)
- [ ] 🧪 URL suppression-compte répond en HTTPS (après upload OVH)

> **Rappel** : icône et splash **ne sont pas hébergés** sur GitHub Pages — ils sont embarqués dans l’APK/IPA (ou upload PNG 1024 direct sur App Store Connect).

---

## G bis. Site légal `revealthepartygame.fr` (repo séparé + OVH)

Repo **hors** de ce dossier Party Games (pages statiques créées de ton côté). Guide détaillé OVH (équivalent Hostinger / FTP) : **[LEGAL_SITE_OVH.md](./LEGAL_SITE_OVH.md)**.

### Contenu du site (repo légal)

- [x] Repo Git du site légal créé
- [x] Compléter les placeholders dans **mentions légales** (éditeur, adresse, SIRET, hébergeur, email)
- [ ] **`suppression-compte.html` en ligne** — vérifier `https://revealthepartygame.fr/suppression-compte.html`
- [ ] **Liens pour télécharger l’app** sur le site légal :
  - [ ] `index.html` : pilule(s) ou bouton **Google Play** + **App Store** (URLs réelles une fois les apps publiées ; sinon libellé « Bientôt disponible »)
  - [ ] `mentions-legales.html` : courte section « Téléchargement » avec les mêmes liens
  - [x] Lien **Jouer en ligne** → `https://julie-lepine.github.io/reveal/` (présent sur le site)
- [x] Vérifier que `privacy.html` est aligné avec `data/legalContent.js` (ce repo) — contact `contact@revealthepartygame.fr`, Instagram en complément
- [x] **`privacy.html` en ligne** à jour sur [revealthepartygame.fr](https://revealthepartygame.fr/privacy.html) (juin 2026)

### Publication OVH (manuel — pas Hostinger)

- [x] **Hébergement Web OVH** associé au domaine
- [x] **Multisite** : `revealthepartygame.fr` (+ `www`) → dossier `www`
- [x] **Zone DNS** : parking retiré ; `send.*` (Resend) intact
- [x] Fichiers en ligne : `index.html`, `privacy.html`, `mentions-legales.html`, `legal.css`, `reveal.png`
- [x] **SSL** (Let’s Encrypt) actif
- [x] 🧪 HTTPS OK : [accueil](https://revealthepartygame.fr/), [privacy](https://revealthepartygame.fr/privacy.html), [mentions](https://revealthepartygame.fr/mentions-legales.html) (juin 2026)
- [x] `data/appConfig.js` → `PRIVACY_POLICY_PUBLIC_URL` = `https://revealthepartygame.fr/privacy.html`
- [x] `data/appConfig.js` → `ACCOUNT_DELETION_PUBLIC_URL` = `https://revealthepartygame.fr/suppression-compte.html`
- [x] Play Console : **Contenu de l’application** complété (juin 2026)
- [ ] Publier **`app-ads.txt`** sur le repo légal OVH (voir **B bis**)

> **Alternative sans FTP OVH** : déployer le repo légal via **Cloudflare Pages** + CNAME `www` dans OVH — voir [LEGAL_SITE_OVH.md](./LEGAL_SITE_OVH.md).

---

## H. Conformité & questionnaires store

- [x] Politique de confidentialité **accessible en ligne** — [revealthepartygame.fr/privacy.html](https://revealthepartygame.fr/privacy.html) ; URL dans l’app ✅
- [x] Page **suppression de compte** — URL dans Play Console ✅ (vérifier HTTPS en ligne)
- [x] CMP **Google UMP** (message Règlementations européennes publié dans AdMob — section **B bis**)
- [x] Play Console — **Contenu de l’application** (privacy, suppression compte, annonces, sécurité des données…) — juin 2026
- [x] Play Console — **Classification du contenu** — juin 2026
- [x] Play Console — **Public cible** — juin 2026
- [x] Play Console — déclaration **identifiant publicitaire** (Oui → Publicité ou marketing) — juin 2026
- [ ] Compléter **App Privacy** (Apple) : email, identifiants, pub AdMob, Supabase
- [ ] Déclarer la **publicité** App Store Connect
- [x] Email de contact éditeur — `contact@revealthepartygame.fr`
- [ ] **app-ads.txt** sur `revealthepartygame.fr` + site développeur dans fiche Play (AdMob prod)

---

## I. Soumission

- [x] App **REVEAL** créée dans Play Console (`com.reveal.partygames`)
- [x] Play Console — **Contenu de l’application** entièrement complété (juin 2026)
- [x] Play Store — **fiche store** complète (captures, icône, feature graphic) — juin 2026
- [x] Play Store — **AAB v1** déployé en **test fermé** (« Bêta amis », codes d'accès) — 17 juin 2026
- [ ] Play Store — **12 testeurs** (codes) installés + **14 jours** → demande **accès production** → production
- [ ] **App Store** : Bundle ID → app Connect → build iOS → TestFlight → soumission review
- [ ] Après publication prod : vérifier vraies pubs AdMob + lien store AdMob + app-ads.txt (`ADMOB_USE_TEST_ADS = false` ✅)

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
| [data/appConfig.js](../data/appConfig.js) | Bundle ID, deep link, URL privacy, URL suppression compte, `CONTACT_EMAIL` |
| [legal-site-export/suppression-compte.html](../legal-site-export/suppression-compte.html) | Page à uploader sur OVH (Play Console) |
| [data/legalContent.js](../data/legalContent.js) | Texte RGPD in-app |
| [privacy.html](../privacy.html) | Copie locale / GitHub Pages (legacy) ; **URL store** → domaine OVH via `appConfig.js` |
| [LEGAL_SITE_OVH.md](./LEGAL_SITE_OVH.md) | Déployer le repo légal sur OVH (FTP / SSL / DNS) |
| [RESEND_SETUP.md](./RESEND_SETUP.md) | DNS OVH + SMTP Supabase |
| [ADMOB.md](./ADMOB.md) | Doc technique AdMob |
| [CAPACITOR.md](./CAPACITOR.md) | Vue d’ensemble Capacitor |
| [resources/README.md](../resources/README.md) | Icône / splash Capacitor |
| [store-assets/README.md](../store-assets/README.md) | Captures store Android 1080×1920 + iOS 1290×2796 |

---

**Prochaine session** (juin 2026) :

### 1. Android — debug bêta Play Store

1. Toi d'abord : Play Store → **Utiliser un code** → installer **REVEAL** v1.0
2. Parcours complet : welcome, auth, lobby **multijoueur**, jeux, AdMob prod, UMP
3. Partager **codes d'accès** (WhatsApp) — viser **12 testeurs** installés
4. Noter les bugs → correctifs → si besoin **AAB v2** (`versionCode` 2, nouveau `cap:sync`, rebuild signé)

### 2. iOS — build & test (Mac)

1. **[IPHONE_TEST_CHECKLIST.md](./IPHONE_TEST_CHECKLIST.md)** : `cap:sync` → Xcode → Run iPhone
2. Créer app **App Store Connect** + Bundle ID `com.reveal.partygames` (si pas fait)
3. Archive → TestFlight

### 3. En parallèle (non bloquant)

- Publier **`app-ads.txt`** sur OVH (section **B bis**)
- Vérifier `https://revealthepartygame.fr/suppression-compte.html`

### Après 14 jours + 12 testeurs Play

- Demande **accès production** → publication → lien AdMob + site légal
