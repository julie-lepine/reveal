# REVEAL — Checklist publication stores (Play Store + App Store)

Utilise cette liste **en plus** de [LAUNCH_CHECKLIST.md](./LAUNCH_CHECKLIST.md) (backend Supabase stable).

Légende : ✅ fait dans le repo · ☐ à faire manuellement · 🧪 à tester sur device

---

## A. Déjà fait dans le code

- [x] Capacitor initialisé (`capacitor.config.ts`, scripts `cap:sync`)
- [x] Plateformes `android/` et `ios/` générées
- [x] AdMob : bannière haut, masquée en gameplay (`js/core/ads.js`)
- [x] Consentement pub UMP (RGPD) au démarrage AdMob
- [x] Deep links auth : `com.reveal.partygames://auth/callback` (`js/core/deepLinks.js`)
- [x] Redirect Supabase natif (`getAuthRedirectUrl()` dans `supabaseAuth.js`)
- [x] Patch natif auto : AdMob App ID, deep link, ATT iOS (`scripts/patchNative.mjs`)
- [x] Politique de confidentialité : écran in-app + `privacy.html` (URL store)
- [x] IDs AdMob configurés (`data/admobConfig.js`)
- [x] Sources icône / splash : `resources/` (icon 1024², splash 2732², exports portrait iOS/Android) — voir [resources/README.md](../resources/README.md)
- [x] Scripts assets : `assets:prepare` (secours), `assets:native`, `assets:sync`, `assets:all` (`package.json`)

---

## B. Comptes & consoles (manuel)

- [ ] Compte **Google Play Console** (inscription ~25 €)
- [ ] Compte **Apple Developer Program** (~99 €/an)
- [ ] App créée dans **AdMob** (Android + iOS) — IDs déjà renseignés
- [ ] Lier **Play Console ↔ AdMob** (Android, recommandé)

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

- [x] Domaine ajouté dans **Resend**
- [ ] **En cours** : enregistrements DNS (TXT / DKIM…) dans **OVH → Zone DNS** — Resend vérifie la propagation
- [ ] Statut domaine **Verified** dans Resend
- [ ] Clé API Resend → **Supabase → SMTP Settings** (`smtp.resend.com`, sender `noreply@…`)
- [ ] 🧪 Test **mot de passe oublié** (web + app native deep link)

---

## D. Cloudflare Turnstile (native — manuel)

- [x] Widget Turnstile : ajouter hostnames **`localhost`** et **`127.0.0.1`** (WebView Capacitor Android/iOS)
- [ ] 🧪 Tester connexion / inscription / reset MDP sur **vrai téléphone** (pas seulement émulateur)

---

## E. Build & test device (manuel)

**Prérequis : Node.js ≥ 22** (`node -v`) — Capacitor 8 refuse Node 20.

```bash
npm run assets:sync      # icône/splash → android/ios + sync web (si assets prêts)
# ou npm run cap:sync    # sync web seulement
npm run cap:open:android   # ou cap:open:ios sur Mac
```

- [ ] 🧪 Lancer sur **1 Android** + **1 iPhone**
- [ ] 🧪 Auth email + invité + lobby multijoueur
- [ ] 🧪 Reset mot de passe → mail Resend reçu → retour dans l’app via deep link
- [ ] 🧪 Bannière AdMob visible (menu) / masquée (manche)
- [ ] 🧪 Formulaire consentement pub (UE)
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

- [x] **Icône** : `resources/icon.png` (1024×1024)
- [x] **Splash Capacitor** : `resources/splash.png` (2732×2732) — lu par `@capacitor/assets`
- [x] **Splashes portrait** (logo + tagline, archivage / référence) :
  - `resources/splash_android_1080x1920.png`
  - `resources/splash_ios_828x1792.png`
  - `resources/splash_ios_1125x2436.png`
  - `resources/splash_ios_1242x2688.png`
  - Doc : [resources/README.md](../resources/README.md)
- [ ] **Natif** : injecter dans `android/` + `ios/` :
  ```bash
  npm run assets:sync
  ```
  (équivalent : `npm run assets:native` puis `npm run cap:sync`)
  ===> cap:sync OK, assets:native en attente
  ===> OK vérif sur Android Studio et lancer l’app sur un téléphone.
  - ⚠️ **Node ≥ 22** obligatoire pour `cap sync`
  - ⚠️ `@capacitor/assets` peut échouer sur Windows (TLS / `sharp`) — autre réseau ou Mac
  - ⚠️ **Ne pas** lancer `npm run assets:prepare` : écrase icon/splash sans tagline
- [ ] 🧪 Vérifier icône + splash sur device après sync

### Fiche store (upload consoles — pas d’hébergement web)

- [ ] Captures d’écran (menu, lobby, 1–2 jeux) — archivage optionnel : `store-assets/`
- [ ] Textes fiche store (titre, description, mots-clés, catégorie)
- [ ] **URL politique de confidentialité** (seule URL image/texte obligatoire côté web) :
  `https://julie-lepine.github.io/reveal/privacy.html`
  (déployer `privacy.html` avec le prochain push web)

> **Rappel** : icône et splash **ne sont pas hébergés** sur GitHub Pages — ils sont embarqués dans l’APK/IPA (ou upload PNG 1024 direct sur App Store Connect).

---

## H. Conformité & questionnaires store

- [ ] Politique de confidentialité en ligne (URL ci-dessus)
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
| [privacy.html](../privacy.html) | Page publique pour les stores |
| [RESEND_SETUP.md](./RESEND_SETUP.md) | DNS OVH + SMTP Supabase |
| [ADMOB.md](./ADMOB.md) | Doc technique AdMob |
| [CAPACITOR.md](./CAPACITOR.md) | Vue d’ensemble Capacitor |
| [resources/README.md](../resources/README.md) | Icône / splash Capacitor |
| [store-assets/README.md](../store-assets/README.md) | Archivage captures store (optionnel) |

---

**Prochaine action recommandée** : installer **Node 22 LTS**, puis section **G** — `npm run assets:sync` et test device (section **E**).
