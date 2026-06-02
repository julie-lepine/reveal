# REVEAL — Checklist publication stores (Play Store + App Store)

Utilise cette liste **en plus** de [LAUNCH_CHECKLIST.md](./LAUNCH_CHECKLIST.md) (backend Supabase stable).

Légende : ✅ fait dans le repo · ☐ à faire manuellement · 🧪 à tester sur device

---

## A. Déjà fait dans le code

- [x] Écran d’intro **welcome** (avant connexion) → bouton vers `home` (`js/screens/welcome.js`)
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
- [ ] 🧪 **iPhone** (Mac + Xcode)
- [ ] 🧪 Auth email + invité + **lobby multijoueur** (2e client web ou 2e téléphone)
- [ ] 🧪 Reset mot de passe → **deep link** natif → écran nouveau MDP dans l’app (mail Resend OK ✅)
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
  - [x] `cap:sync` + run Android Studio → app lancée sur téléphone (02 juin 2026)
  - [ ] `assets:native` si besoin de régénérer icône/splash dans `android/` / `ios/`
  - ⚠️ **Node ≥ 22** obligatoire pour `cap sync`
  - ⚠️ `@capacitor/assets` peut échouer sur Windows (TLS / `sharp`) — autre réseau ou Mac
  - ⚠️ **Ne pas** lancer `npm run assets:prepare` : écrase icon/splash sans tagline
- [ ] 🧪 Vérifier icône + splash sur device après `assets:sync` complet

### Fiche store (upload consoles — pas d’hébergement web)

- [ ] Captures d’écran (menu, lobby, 1–2 jeux) — archivage optionnel : `store-assets/`
- [ ] Textes fiche store (titre, description, mots-clés, catégorie)
- [ ] **URL politique de confidentialité** (seule URL image/texte obligatoire côté web) :
  `https://julie-lepine.github.io/reveal/privacy.html`
  (déployer `privacy.html` avec le prochain push web)

> **Rappel** : icône et splash **ne sont pas hébergés** sur GitHub Pages — ils sont embarqués dans l’APK/IPA (ou upload PNG 1024 direct sur App Store Connect).

---

## G bis. Site légal `revealthepartygame.fr` (repo séparé + OVH)

Repo **hors** de ce dossier Party Games (pages statiques créées de ton côté). Guide détaillé OVH (équivalent Hostinger / FTP) : **[LEGAL_SITE_OVH.md](./LEGAL_SITE_OVH.md)**.

### Contenu du site (repo légal)

- [x] Repo Git du site légal créé
- [ ] Compléter les placeholders dans **mentions légales** (éditeur, adresse, SIRET, hébergeur, email)
- [ ] **Liens pour télécharger l’app** sur le site légal :
  - [ ] `index.html` : pilule(s) ou bouton **Google Play** + **App Store** (URLs réelles une fois les apps publiées ; sinon libellé « Bientôt disponible »)
  - [ ] `mentions-legales.html` : courte section « Téléchargement » avec les mêmes liens
  - [ ] Garder le lien **Jouer en ligne** → `https://julie-lepine.github.io/reveal/`
- [ ] Vérifier que `privacy.html` est aligné avec `data/legalContent.js` (ce repo)

### Publication OVH (manuel — pas Hostinger)

- [ ] Avoir un **Hébergement Web OVH** associé au domaine (le nom de domaine seul ne suffit pas pour « coller » des fichiers)
- [ ] **Multisite** : attacher `revealthepartygame.fr` (+ `www`) au dossier `www` de l’hébergement
- [ ] **Zone DNS** : retirer le parking « Site en construction » ; **ne pas toucher** `send.*` (Resend)
- [ ] Upload FTP / **Explorer FTP** (OVH) : `index.html`, `privacy.html`, `mentions-legales.html`, `legal.css`, `reveal.png` → racine du site
- [ ] Activer **SSL** (Let’s Encrypt) sur le domaine
- [ ] 🧪 Tester : `/`, `/privacy.html`, `/mentions-legales.html` en HTTPS
- [ ] Mettre à jour `data/appConfig.js` → `PRIVACY_POLICY_PUBLIC_URL` =  
  `https://www.revealthepartygame.fr/privacy.html` (adapter si tu n’utilises pas `www`)
- [ ] Fiches store : utiliser cette URL (remplacer GitHub Pages ci-dessous)

> **Alternative sans FTP OVH** : déployer le repo légal via **Cloudflare Pages** + CNAME `www` dans OVH — voir [LEGAL_SITE_OVH.md](./LEGAL_SITE_OVH.md).

---

## H. Conformité & questionnaires store

- [ ] Politique de confidentialité en ligne (URL domaine après G bis, ou provisoirement GitHub Pages ci-dessus)
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
| [privacy.html](../privacy.html) | Ancienne page publique (GitHub Pages) ; URL store → domaine après G bis |
| [LEGAL_SITE_OVH.md](./LEGAL_SITE_OVH.md) | Déployer le repo légal sur OVH (FTP / SSL / DNS) |
| [RESEND_SETUP.md](./RESEND_SETUP.md) | DNS OVH + SMTP Supabase |
| [ADMOB.md](./ADMOB.md) | Doc technique AdMob |
| [CAPACITOR.md](./CAPACITOR.md) | Vue d’ensemble Capacitor |
| [resources/README.md](../resources/README.md) | Icône / splash Capacitor |
| [store-assets/README.md](../store-assets/README.md) | Archivage captures store (optionnel) |

---

**Prochaine action recommandée** (après 02 juin 2026) : section **E** — lobby multijoueur (2e client), deep link reset MDP dans l’app, AdMob + consentement ; puis **B** (inscription stores au dernier moment) et **G** (`assets:sync` + captures fiche store).
