# REVEAL — Capacitor (app native iOS / Android)

Capacitor est **initialisé**. Checklist complète store : **[STORE_CHECKLIST.md](./STORE_CHECKLIST.md)**.

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
| Test sur device réel | Android ✅ · iPhone → [IPHONE_TEST_CHECKLIST.md](./IPHONE_TEST_CHECKLIST.md) |
| Build release signé | ☐ |

---

## Workflow dev → native

```bash
# Après modification du code web
npm run cap:sync

npm run cap:open:android   # Windows / Mac
npm run cap:open:ios       # Mac + Xcode uniquement
```

`cap:sync` copie les assets vers `www/`, synchronise les projets natifs, et applique `scripts/patchNative.mjs` (AdMob, deep links, ATT iOS, ProGuard `proguard-android-optimize.txt` pour AGP 9+).

## Assets natifs (icône / splash)

Sources dans [`resources/`](../resources/README.md) — **ne pas** lancer `assets:prepare` si tes PNG custom sont déjà en place.

```bash
npm run assets:sync    # @capacitor/assets + cap:sync
```

Prérequis : **Node.js ≥ 22**.

### Splash invisible ou logo Capacitor bleu

1. **Régénérer les PNG natifs** (obligatoire après changement de `resources/splash.png`) :
   ```bash
   npm run assets:native
   ```
2. **Rebuild** dans Android Studio : *Build → Clean Project*, puis *Run* (ou désinstaller l’app sur le téléphone puis réinstaller).
3. **Tester depuis l’icône** sur l’écran d’accueil du téléphone, pas seulement le bouton ▶ d’Android Studio : sur certaines versions Android 12, le splash système ne s’affiche pas au lancement depuis l’IDE (comportement Google, corrigé sur Android 13+).
4. Le splash **carré** (`resources/splash.png`) est propagé en portrait ; la **tagline** des maquettes `splash_android_1080x1920.png` n’est pas injectée automatiquement — pour l’avoir partout, refaire un `splash.png` 2732² avec tagline puis relancer `assets:native`.

### Logo splash trop petit (Android 12+)

Android 12 affichait l’image comme **icône centrée** (`Theme.SplashScreen` + `windowSplashScreenAnimatedIcon`). Corrigé par :

- `android/.../drawable/splash_screen.xml` — image **plein écran** (`gravity="fill"`)
- `AppTheme.NoActionBarLaunch` → fond `@drawable/splash_screen` (plus `Theme.SplashScreen`)
- `npm run assets:native` avec `--logoSplashScale 0.62` et fond `#0A0F1C`

Si le logo reste petit dans **resources/splash.png** lui-même, agrandir le logo dans le PNG source ou utiliser `splash_android_1080x1920.png` comme base.

Plugin `@capacitor/splash-screen` : durée ~2 s au lancement (`capacitor.config.ts`).

---

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

## Turnstile en WebView

`capacitor.config.ts` : `androidScheme` et **`iosScheme`** = `'https'` → WebView en `https://localhost` (requis pour Turnstile sur iPhone ; sans `iosScheme`, iOS utilise `capacitor://localhost` et le captcha échoue).

Ajouter dans le widget Cloudflare les hostnames :

- `localhost`
- `127.0.0.1`
- `julie-lepine.github.io` (version web)

Puis `npm run cap:sync` et tester login / signup sur téléphone réel.

---

## Web vs native

| | Web (GitHub Pages) | App store (Capacitor) |
|--|-------------------|----------------------|
| Pub AdMob | Non | Oui (bannière native) |
| Deep links | URL web | `com.reveal.partygames://` |
| Déploiement | `git push` Pages | AAB/IPA + review store |

La version web peut coexister ; le code détecte la plateforme via `js/core/platform.js`.

---

## Docs associées

- [STORE_CHECKLIST.md](./STORE_CHECKLIST.md) — checklist publication
- [ADMOB.md](./ADMOB.md) — configuration publicitaire
- [LAUNCH_CHECKLIST.md](./LAUNCH_CHECKLIST.md) — prod web / Supabase
