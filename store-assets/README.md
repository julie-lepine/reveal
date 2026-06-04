# Assets fiche store

Dossier d’**archivage** pour tes PNG sources — **non servis** par l’app ni par GitHub Pages.  
Upload **manuel** dans Play Console et App Store Connect.

---

## Structure actuelle (juin 2026)

| Dossier | Format | Écrans |
|---------|--------|--------|
| [`android/`](./android/) | **1080×1920** (~9:16, phone Play Store) | `welcome`, `lobby_setup`, `dilemma`, `consensus`, `classement` |
| [`android/feature-graphic.png`](./android/feature-graphic.png) | **1024×500** (bannière Play Store) | bannière complète — `node scripts/buildFeatureGraphic.mjs` |
| [`android/feature-graphic-bg.png`](./android/feature-graphic-bg.png) | **1024×500** (fond seul) | dégradé DA pour Figma — `node scripts/buildFeatureGraphic.mjs --bg-only` |
| [`ios/`](./ios/) | **1290×2796** (iPhone 6,7" App Store) | mêmes 5 écrans |

Ordre suggéré sur la fiche : welcome → lobby → jeux → classement.

> Quelques exports iOS peuvent varier de 1–2 px en hauteur ou largeur (`lobby_setup` 1272×2796, etc.) — acceptable ; recadre en **1290×2796** si App Store Connect refuse un fichier.

---

## Encore à faire (optionnel)

- **Icône store + in-app** : **1024×1024** → [`resources/icon.png`](../resources/icon.png) ✅ (validée juin 2026)

Les icône / splash **in-app** : [`resources/`](../resources/README.md) → `npm run assets:sync`.

---

## Checklist

Voir [STORE_CHECKLIST.md](../docs/STORE_CHECKLIST.md) section **G**.
