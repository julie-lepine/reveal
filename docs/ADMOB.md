# REVEAL — Capacitor + AdMob

## État actuel

Capacitor est **initialisé** avec les plateformes `android/` et `ios/`, le plugin `@capacitor-community/admob`, et la logique JS dans `js/core/ads.js`.

La bannière s’affiche en **haut** à partir du **lobby** (prep, jeux, résultats…). Elle est **masquée** sur l’intro (`welcome`), la page connexion / accueil (`home`) et le reset mot de passe.

---

## Configuration AdMob

Fichier central : [`data/admobConfig.js`](../data/admobConfig.js)

| Clé | Usage |
|-----|--------|
| `ADMOB_APP_IDS` | App IDs (`~`) — injectés dans Android/iOS natif |
| `ADMOB_BANNER_IDS` | Tes unités bannière (`/`) — prod |
| `ADMOB_USE_TEST_ADS` | **`true` en dev** → IDs test Google. **`false` avant store** |

### Avant publication store

1. `data/admobConfig.js` → **`ADMOB_USE_TEST_ADS = false`**
2. `npm run cap:sync`
3. Rebuild AAB/IPA signé (voir [STORE_CHECKLIST.md](./STORE_CHECKLIST.md))

---

## Workflow de build

```bash
# Après chaque modification du code web (js/, data/, style.css, index.html)
npm run cap:sync

# Ouvrir Android Studio
npm run cap:open:android

# Ouvrir Xcode (Mac)
npm run cap:open:ios
```

`cap:sync` enchaîne :
1. Copie des assets vers `www/` (`scripts/syncCapWeb.mjs`)
2. `npx cap sync`
3. Patch AdMob natif (`scripts/patchAdmobNative.mjs`)

---

## IDs configurés

- **Android App ID** : `ca-app-pub-6332424645114129~4800114696`
- **iOS App ID** : `ca-app-pub-6332424645114129~1825936767`
- **Android bannière** : `ca-app-pub-6332424645114129/3487033021`
- **iOS bannière** : `ca-app-pub-6332424645114129/9860869685`

---

## Écrans avec / sans pub

| Affichée | Masquée |
|----------|---------|
| home, game-select, lobby, prep, résultats, classement | hottake, speedvote, playlistguess, truthmeter, dilemma, trivia, consensus, guesslie, tiernight, fil rouge mission |

Logique : `js/core/ads.js` → `GAMEPLAY_SCREENS`.

---

## Web vs native

- **Navigateur** (GitHub Pages, local) : aucune pub, aucun impact.
- **APK/IPA Capacitor** : bannière native AdMob.

---

## Consentement RGPD / iOS (à faire avant store)

- Consentement UMP intégré dans `js/core/ads.js` (RGPD)
- iOS ATT : `NSUserTrackingUsageDescription` injecté par `scripts/patchNative.mjs`

---

## Prérequis restants (stores)

Voir **[STORE_CHECKLIST.md](./STORE_CHECKLIST.md)** pour la liste complète.

Résumé : comptes développeur, test device, icônes/splash, build signé, questionnaires store, URL privacy déployée.

---

## Résumé commandes

```bash
npm run cap:sync          # sync web → native
npm run cap:open:android  # Android Studio
npm run cap:open:ios      # Xcode
```
