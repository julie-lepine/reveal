# REVEAL — Capacitor (app native iOS / Android)

## Es-tu prêt à lancer Capacitor maintenant ?

**Non — pas tout de suite.** Le lancement recommandé est d’abord la **version web** (GitHub Pages), stable avec des amis. Capacitor est une **phase 2** : le projet n’a pas encore de configuration Capacitor (`capacitor.config`, dossiers `ios/` / `android/`).

Ce qui est déjà compatible « navigateur » :

- App **vanilla JS** (pas de build Vite obligatoire)
- Supabase via réseau (`esm.sh`)
- Turnstile, auth, multijoueur Supabase

Ce qui demande du travail **avant** une app store ou un APK :

---

## Prérequis métier

1. **Web validé** — checklist [LAUNCH_CHECKLIST.md](./LAUNCH_CHECKLIST.md) sections 1–5 OK en prod
2. Compte **Apple Developer** (iOS) et/ou **Google Play Console** (Android) si publication store
3. Mac avec **Xcode** pour builds iOS (ou CI cloud)

---

## Travail technique à prévoir

### 1. Initialiser Capacitor

```bash
npm install @capacitor/core @capacitor/cli @capacitor/android @capacitor/ios
npx cap init "REVEAL" "com.reveal.partygames" --web-dir .
npx cap add android
npx cap add ios
```

`webDir` = racine du projet (là où est `index.html`), sauf si tu passes plus tard à un dossier `dist/` après bundler.

### 2. URLs & chemins

- En web, l’app vit sous **`/reveal/`** sur GitHub Pages.
- En Capacitor, les fichiers sont servis en local (`capacitor://` ou `https://localhost`).
- À vérifier : **router**, liens relatifs (`js/main.js`), images (`reveal.png`, `assets/tiers/`).
- Possible besoin d’une **base URL** selon l’environnement (web vs native).

### 3. Auth Supabase

Dans **Authentication → URL Configuration**, ajouter les redirect de l’app native, par exemple :

- `com.reveal.partygames://` (custom URL scheme)
- ou URL fournie par le plugin `@capacitor/app` / `@capacitor/browser`

Sans ça : connexion / reset mot de passe / OAuth ne reviennent pas dans l’app.

### 4. Spotify (VibeCheck)

- Ajouter dans Spotify Developer Dashboard une redirect URI pour l’app (scheme custom ou URL Capacitor).
- Adapter `SPOTIFY_REDIRECT_URI` dans `js/config/spotify.js` selon plateforme (web vs native).

### 5. Turnstile

Fonctionne en général dans une **WebView**, mais à tester sur vrai iPhone/Android (parfois restrictions réseau / IT policy).

### 6. Réseau & stores

- L’app a besoin d’**Internet** (Supabase, Cloudflare, Spotify, polices Google).
- **Politique de confidentialité** + fiche store si publication Play / App Store.
- Icônes splash (`resources/`) — non générées aujourd’hui.

### 7. Dépendances npm

Aujourd’hui `package.json` ne contient que `@supabase/supabase-js` pour les tests. Capacitor ajoutera des paquets et des scripts du type :

```json
"cap:sync": "npx cap sync",
"cap:open:android": "npx cap open android",
"cap:open:ios": "npx cap open ios"
```

Option future : bundler les modules au lieu de `esm.sh` pour offline partiel et perfs WebView.

---

## Ordre recommandé

| Étape | Quoi |
|-------|------|
| 1 | Lancer en **web** avec amis ([LAUNCH_CHECKLIST.md](./LAUNCH_CHECKLIST.md)) |
| 2 | Corriger bugs remontés en soirée réelle |
| 3 | Init Capacitor + test **debug** sur 1 téléphone |
| 4 | Auth redirect + Spotify native |
| 5 | Icônes, splash, privacy policy |
| 6 | TestFlight / APK interne puis store (optionnel) |

---

## Alternative légère (sans Capacitor)

Sur iPhone/Android : **Ajouter à l’écran d’accueil** depuis Safari/Chrome sur  
`https://julie-lepine.github.io/reveal/` — PWA-like, sans store, même codebase.

---

## Résumé

| Question | Réponse |
|----------|---------|
| Prêt pour une **soirée web** ? | Oui, après checklist prod + tests auth/Turnstile |
| Prêt pour **Capacitor tel quel** ? | **Non** — init + redirects + tests WebView à faire |
| Prochaine action Capacitor | Valider le web, puis `cap init` + 1 build debug |

Quand tu voudras initialiser Capacitor dans le repo, passe en **mode Agent** et on pourra ajouter la config minimale + scripts npm.
