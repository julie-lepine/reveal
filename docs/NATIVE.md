# REVEAL — App native (Capacitor, AdMob, test iPhone)

Checklist launch : [LAUNCH.md](./LAUNCH.md) · Backend : [SUPABASE.md](./SUPABASE.md)

---

## État actuel

| Composant | Statut |
|-----------|--------|
| Capacitor 8 + `android/` + `ios/` | ✅ |
| AdMob bannière + consentement UMP | ✅ |
| Deep links auth Supabase | ✅ |
| Politique de confidentialité | ✅ (`privacy.html` + écran in-app) |
| Sources icône / splash (`resources/`) | ✅ custom (icon, splash 2732², portrait iOS/Android) |
| Icônes / splash injectés dans `android/` / `ios/` | ✅ `npm run assets:native` puis rebuild Android Studio |
| Test sur device réel | Android ✅ · iPhone → § Test iPhone ci-dessous |
| Build release signé | ☐ |

---

## Workflow dev → native

```bash
# Après modification du code web (js/, data/, style.css, index.html, captcha.html)
npm run cap:sync

npm run cap:open:android   # Windows / Mac
npm run cap:open:ios       # Mac + Xcode uniquement
```

`cap:sync` enchaîne :
1. Copie des assets vers `www/` (`scripts/syncCapWeb.mjs`)
2. `npx cap sync`
3. Patch natif (`scripts/patchNative.mjs` — AdMob, deep links, ATT iOS, ProGuard)

Prérequis : **Node.js ≥ 22**.

---

## Assets natifs (icône / splash)

Sources dans [`resources/`](../resources/README.md) — **ne pas** lancer `assets:prepare` si tes PNG custom sont déjà en place.

```bash
npm run assets:sync    # @capacitor/assets + cap:sync
```

### Splash Android 12+ (icône système au lieu du logo REVEAL)

Depuis Android 12, le **premier** écran de cold start est toujours le splash **système** (icône centrée + fond) — Google n’autorise plus un PNG plein écran à cette étape.

Config attendue (réappliquée par `scripts/patchNative.mjs` après chaque `cap sync`) :

- `AppTheme.NoActionBarLaunch` → parent **`Theme.SplashScreen`**
- `windowSplashScreenBackground` / `windowSplashScreenIconBackgroundColor` → `#0A0F1C`
- `windowSplashScreenAnimatedIcon` → `@drawable/splash_icon` (logo R, `resources/icon.png`)
- `android:background` → `@drawable/splash_screen` (plein écran + tagline en portrait pour &lt;12 / transition)
- `ic_launcher_background` → `#0A0F1C` (pas de plaque blanche)

Les maquettes portrait (`resources/splash_android_1080x1920.png`, slogan *« l'app de soirée entre amis »*) sont recopiées dans `drawable-port-*` par le patch.

```bash
npm run cap:sync          # sync web + patchNative (splash brand inclus)
node scripts/patchNative.mjs   # ou seulement le patch
```

Puis **Clean / Rebuild** dans Android Studio, et tester depuis l’**icône** sur l’écran d’accueil (pas seulement ▶ IDE).

### Splash invisible ou logo Capacitor bleu

1. **Régénérer les PNG natifs** (obligatoire après changement de `resources/splash.png` / `icon.png`) :
   ```bash
   npm run assets:native
   npm run cap:sync
   ```
2. **Rebuild** dans Android Studio : *Build → Clean Project*, puis *Run* (ou désinstaller l’app sur le téléphone puis réinstaller).
3. **Tester depuis l’icône** sur l’écran d’accueil du téléphone, pas seulement le bouton ▶ d’Android Studio : sur certaines versions Android 12, le splash système ne s’affiche pas au lancement depuis l’IDE (comportement Google, corrigé sur Android 13+).
4. Le splash **carré** (`resources/splash.png`) est propagé hors-portrait par `@capacitor/assets` ; le **slogan** vient des maquettes `splash_android_1080x1920.png` injectées par `patchNative`.

Plugin `@capacitor/splash-screen` : durée ~2 s au lancement (`capacitor.config.ts`).

---

## Identifiants natifs

- **Bundle ID** : `com.reveal.partygames`
- **Deep link auth** : `com.reveal.partygames://auth/callback`
- **webDir Capacitor** : `www/` (généré par `scripts/syncCapWeb.mjs`)

---

## Auth Supabase en native

Ajouter dans **Supabase → Authentication → URL Configuration** :

```
com.reveal.partygames://auth/callback
```

Le code utilise `getAuthRedirectUrl()` : redirect web en navigateur, deep link en app native.

---

## Captcha (hCaptcha)

| Plateforme | hCaptcha |
|------------|----------|
| **Web** | ✅ widget in-page |
| **Android** | ✅ widget in-page |
| **iOS** | ✅ widget in-page (dans l’app, pas Safari, pas de site) |

Supabase n’accepte **qu’un** provider. Provider actuel : **hCaptcha** (plus Turnstile). Secret uniquement dans **Authentication → Attack Protection**. Sitekey publique : `js/config/turnstile.js`.

Le widget charge `js.hcaptcha.com` dans l’app : Apple le voit comme un captcha in-app, pas comme un login sur un site tiers.

**Supabase → Authentication → Attack Protection** : provider **hCaptcha**, protection **activée**, secret = celui du site **REVEAL Party Games**. Sans ça, le captcha côté app est cosmétique.

Hostname hCaptcha à autoriser : celui de la page (`julie-lepine.github.io` tant que Capacitor / Pages l’utilisent).

**Notes App Review** : *CAPTCHA (hCaptcha) is shown inside the app. The user never leaves REVEAL to a website or Safari. Email and password stay in the app UI.*

---

## AdMob

Capacitor + plugin `@capacitor-community/admob`, logique JS dans `js/core/ads.js`.

La bannière s’affiche en **haut** à partir du **lobby** (prep, jeux, résultats…). Elle est **masquée** sur l’intro (`welcome`), la page connexion / accueil (`home`) et le reset mot de passe.

Si `profiles.ad_free` **ou** `profiles.profile_pack` est vrai pour le compte connecté, **aucune bannière** (voir [`feature-adfree-01-profile-flag.sql`](../supabase/feature-adfree-01-profile-flag.sql), [`feature-profile-01-profile-flag.sql`](../supabase/feature-profile-01-profile-flag.sql) et Menu → Profil).

### Configuration

Fichier central : [`data/admobConfig.js`](../data/admobConfig.js)

| Clé | Usage |
|-----|--------|
| `ADMOB_APP_IDS` | App IDs (`~`) — injectés dans Android/iOS natif |
| `ADMOB_BANNER_IDS` | Tes unités bannière (`/`) — prod |
| `ADMOB_USE_TEST_ADS` | **`true` en dev** → IDs test Google. **`false` avant store** |

### Avant publication store

1. `data/admobConfig.js` → **`ADMOB_USE_TEST_ADS = false`**
2. `npm run cap:sync`
3. Rebuild AAB/IPA signé (voir [LAUNCH.md](./LAUNCH.md))

### IDs configurés

- **Android App ID** : `ca-app-pub-6332424645114129~4800114696`
- **iOS App ID** : `ca-app-pub-6332424645114129~1825936767`
- **Android bannière** : `ca-app-pub-6332424645114129/3487033021`
- **iOS bannière** : `ca-app-pub-6332424645114129/9860869685`

### Écrans avec / sans pub

| Affichée | Masquée |
|----------|---------|
| lobby, game-select, prep, **jeux**, résultats, classement, Menu | welcome, home, reset-password |

Logique : `js/core/ads.js` → `NO_AD_SCREENS` (`welcome`, `home`, `reset-password`). La bannière reste visible **pendant le play**.

### Consentement RGPD / iOS

- Consentement UMP intégré dans `js/core/ads.js` (RGPD)
- iOS ATT : `NSUserTrackingUsageDescription` injecté par `scripts/patchNative.mjs`

---

## Web vs native

| | Web (GitHub Pages) | App store (Capacitor) |
|--|-------------------|----------------------|
| Pub AdMob | Non | Oui (bannière native) |
| Deep links | URL web | `com.reveal.partygames://` |
| Déploiement | `git push` Pages | AAB/IPA + review store |

La version web peut coexister ; le code détecte la plateforme via `js/core/platform.js`.

---

## Test iPhone (Mac + Xcode)

**QA validée** 31 août 2026 (iPhone XR, iOS 15) — parcours [LAUNCH.md](./LAUNCH.md) coché. **v1.1 soumise en review App Store** — 31 août 2026.

À utiliser **le jour où tu as le Mac**. Coche le parcours iPhone dans [LAUNCH.md](./LAUNCH.md) quand tout est vert ici.

Légende : ☐ à faire · 🧪 test sur device · ✅ OK · ❌ bug (noter en bas)

### Avant d’ouvrir Xcode

- [ ] **Node.js ≥ 22** : `node -v`
- [ ] Repo à jour (clone ou clé USB / Git depuis ton PC Windows)
- [ ] `js/config/supabase.js` présent (clés — org prod OK)
- [ ] `js/config/turnstile.js` présent (Site Key Cloudflare)
- [ ] iPhone : câble USB, déverrouillé, **Faire confiance** à l’ordinateur
- [ ] iOS **Mode développeur** activé si Xcode le demande (Réglages → Confidentialité et sécurité)
- [ ] Compte **Apple ID** connecté dans Xcode (Settings → Accounts)

```bash
cd chemin/vers/reveal
npm install
npm run cap:sync
npm run cap:open:ios
```

### B. Premier lancement dans Xcode

- [ ] Projet ouvert (workspace dans `ios/`)
- [ ] Target **App** sélectionnée
- [ ] En haut : **ton iPhone physique** (pas seulement « iPhone 16 Simulator »)
- [ ] **Signing & Capabilities** :
  - [ ] Team = ton compte Apple
  - [ ] Bundle Identifier = `com.reveal.partygames` (sans conflit)
  - [ ] Signing réussi (pas d’erreur rouge)
- [ ] ▶ **Run** → l’app s’installe et démarre sur l’iPhone
- [ ] 🧪 Lancer aussi **depuis l’icône** sur l’écran d’accueil (pas seulement depuis Xcode)

| Problème fréquent | Piste |
|-------------------|--------|
| « Untrusted Developer » sur l’iPhone | Réglages → Général → VPN et gestion de l’appareil → faire confiance |
| Erreur de signature | Changer Team ou créer un profil automatique dans Signing |
| Build échoue Node | Relancer `npm run cap:sync` sur le Mac |

### C. Parcours de base

- [ ] 🧪 **Welcome** → accueil / connexion
- [ ] 🧪 **Écran d’intro** puis navigation normale
- [ ] 🧪 **Icône** correcte sur l’écran d’accueil iOS
- [ ] 🧪 **Splash** au cold start (logo, fond sombre — pas logo Capacitor bleu par défaut)
- [ ] 🧪 Rotation / encoche : UI lisible (pas de boutons sous la barre système)

Après chaque changement de code web : `npm run cap:sync` puis ▶ Run (ou *Product → Clean Build Folder*).

### D. Auth (app native — hCaptcha in-page)

- [ ] 🧪 **Connexion email** : champs saisissables → case hCaptcha dans le formulaire → Se connecter
- [ ] 🧪 **Inscription** email (même flux)
- [ ] 🧪 **Invité** + pseudo + code lobby (même flux)
- [ ] 🧪 **Mot de passe oublié** : saisie email → hCaptcha → mail reçu

> **Supabase** : Attack Protection = **hCaptcha, activé**. Secret = site **REVEAL Party Games**. Pas de page tierce, pas Safari.

### E. Deep link — reset mot de passe (priorité store)

**Deep link** = le lien du mail doit **rouvrir l’app** sur l’écran **nouveau mot de passe**, pas rester bloqué dans Safari.

URL attendue côté Supabase : `com.reveal.partygames://auth/callback`

- [ ] 🧪 Depuis l’**app sur iPhone** : Mot de passe oublié → envoyer le mail
- [ ] 🧪 Ouvrir le mail sur le **même iPhone** (app Mail ou Gmail)
- [ ] 🧪 **Tap sur le lien** → REVEAL s’ouvre (ou revient au premier plan)
- [ ] 🧪 Écran **`reset-password`** (nouveau MDP + confirmation)
- [ ] 🧪 Enregistrer → se reconnecter avec le **nouveau** mot de passe
- [ ] ❌ Si Safari s’ouvre sans repasser par l’app : noter le comportement + URL affichée dans la barre d’adresse

### F. Multijoueur Supabase

Utilise l’**org Supabase prod** (migration egress bouclée — 25 août 2026). En test : 1 onglet, fermer le lobby après.

**2ᵉ joueur** (au choix) : 2ᵉ iPhone, navigateur [julie-lepine.github.io/reveal](https://julie-lepine.github.io/reveal/), ou Android.

- [ ] 🧪 **Créer lobby** (hôte) sur iPhone
- [ ] 🧪 **Rejoindre** avec le 2ᵉ client (code)
- [ ] 🧪 Liste joueurs, prêt
- [ ] 🧪 **Lancer une soirée** → menu jeux
- [ ] 🧪 **1 jeu court** (ex. Hot Take ou Trivia) : sync votes / écran hôte ↔ invité
- [ ] 🧪 **Quitter / fermer lobby** (hôte) → invité bien renvoyé
- [ ] 🧪 **Reprendre** après kill app + réouverture

### G. Publicité AdMob & confidentialité (iOS)

- [ ] 🧪 **Pas** de bannière sur : welcome, home, reset-password
- [ ] 🧪 Bannière **visible** à partir du **lobby** / jeux (haut de l’écran)
- [ ] 🧪 Au premier lancement pub : popup **consentement** (UMP / RGPD) en UE
- [ ] 🧪 Popup **ATT** iOS — accepter / refuser : l’app ne plante pas
- [ ] 🧪 Mode test AdMob OK (`ADMOB_USE_TEST_ADS = true` dans `data/admobConfig.js`)

### H. Stabilité & confort

- [ ] 🧪 Passage **lobby → jeu → résultats → menu jeux** sans écran blanc
- [ ] 🧪 App en **arrière-plan** 30 s pendant une partie → retour, sync OK
- [ ] 🧪 **Paramètres** / politique de confidentialité : liens HTTPS OK
- [ ] 🧪 Pas de crash au retour arrière (geste iOS ou bouton in-app)

### I. Soirée pilote (optionnel)

- [ ] 3–4 personnes, 1 iPhone hôte + autres (web ou Android)
- [ ] 2–3 jeux différents, 30–45 min
- [ ] Noter bugs UX (clavier, safe area, perf)

### J. Notes de bugs

| # | Écran / action | Attendu | Obtenu |
|---|----------------|---------|--------|
| 1 | | | |
| 2 | | | |
| 3 | | | |

### K. Quand tout est vert

- [x] Cocher le parcours iPhone dans [LAUNCH.md](./LAUNCH.md) — 31 août 2026
- [ ] Corriger les bugs sur Windows → `npm run cap:sync` → retest rapide au Mac
- [x] Org Supabase prod prête (egress / migration — 25 août 2026)

---

## Résumé commandes

```bash
npm run cap:sync          # sync web → native
npm run cap:open:android  # Android Studio
npm run cap:open:ios      # Xcode
```
