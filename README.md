# REVEAL — Party Games

App de jeux de soirée multijoueur (vanilla JS + Supabase). Version web sur GitHub Pages ; apps natives iOS/Android via Capacitor.

**Web en prod :** https://julie-lepine.github.io/reveal/

---

## Démarrage rapide

```bash
npm install
npm test
```

Copier `js/config/supabase.example.js` → `js/config/supabase.js` et renseigner URL + clé anon Supabase. Voir [docs/SUPABASE_SETUP.md](./docs/SUPABASE_SETUP.md).

---

## Documentation

| Sujet | Fichier |
|-------|---------|
| Lancement web (soirée pilote, prod) | [docs/LAUNCH_CHECKLIST.md](./docs/LAUNCH_CHECKLIST.md) |
| Supabase (schéma, auth, Realtime) | [docs/SUPABASE_SETUP.md](./docs/SUPABASE_SETUP.md) |
| Emails (Resend + OVH) | [docs/RESEND_SETUP.md](./docs/RESEND_SETUP.md) |
| Capacitor (sync, build native) | [docs/CAPACITOR.md](./docs/CAPACITOR.md) |
| Publication Play Store / App Store | [docs/STORE_CHECKLIST.md](./docs/STORE_CHECKLIST.md) |
| AdMob (pub native) | [docs/ADMOB.md](./docs/ADMOB.md) |
| Icône / splash Capacitor | [resources/README.md](./resources/README.md) |
| Captures fiche store (archivage) | [store-assets/README.md](./store-assets/README.md) |

---

## Commandes utiles

| Commande | Rôle |
|----------|------|
| `npm test` | Tests unitaires |
| `npm run cap:sync` | Sync web → `www/` + projets natifs (Node ≥ 22) |
| `npm run cap:open:android` | Ouvrir Android Studio |
| `npm run assets:sync` | Icône/splash natifs + sync (si `@capacitor/assets` OK) |

---

## Structure (aperçu)

```
index.html, style.css    # Shell web
js/                      # App (screens, games, core, config)
data/                    # Contenu jeux + config app
assets/                  # Images statiques (logos jeux, tier lists)
supabase/                # SQL + templates email
resources/               # Icône / splash sources (Capacitor)
docs/                    # Documentation projet
```
