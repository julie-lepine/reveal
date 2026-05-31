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
| Icônes / splash injectés dans `android/` / `ios/` | ☐ `npm run assets:sync` (Node ≥ 22) |
| Test sur device réel | ☐ |
| Build release signé | ☐ |

---

## Workflow dev → native

```bash
# Après modification du code web
npm run cap:sync

npm run cap:open:android   # Windows / Mac
npm run cap:open:ios       # Mac + Xcode uniquement
```

`cap:sync` copie les assets vers `www/`, synchronise les projets natifs, et applique `scripts/patchNative.mjs` (AdMob, deep links, ATT iOS).

## Assets natifs (icône / splash)

Sources dans [`resources/`](../resources/README.md) — **ne pas** lancer `assets:prepare` si tes PNG custom sont déjà en place.

```bash
npm run assets:sync    # @capacitor/assets + cap:sync
```

Prérequis : **Node.js ≥ 22**.

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

Ajouter dans le widget Cloudflare les hostnames :

- `localhost`
- `127.0.0.1`

Puis tester login / signup sur téléphone réel.

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
