# Icônes & splash Capacitor

Sources graphiques **versionnées dans le repo** pour l’app native et les stores.

---

## Fichiers actuels

| Fichier | Dimensions | Rôle |
|---------|------------|------|
| `icon.png` | **1024×1024** | Icône app (Play / App Store + natif) |
| `splash.png` | **2732×2732** | Source **`@capacitor/assets`** (carré, logo centré) |
| `splash_android_1080x1920.png` | **1080×1920** | Splash portrait Android (logo + tagline) — **référence design** |
| `splash_ios_828x1792.png` | **828×1792** | iPhone compact |
| `splash_ios_1125x2436.png` | **1125×2436** | iPhone standard |
| `splash_ios_1242x2688.png` | **1242×2688** | iPhone grand écran |

Les exports portrait (`splash_*`) incluent le slogan **« l'app de soirée entre amis »** — c’est la version la plus aboutie visuellement.

`../reveal.png` reste le logo source web (barre nav, etc.) ; **ne pas** l’utiliser directement comme icône store.

---

## Ce que lit Capacitor automatiquement

`npx @capacitor/assets generate` n’utilise que :

- `resources/icon.png`
- `resources/splash.png`

Les fichiers `splash_android_*` et `splash_ios_*` **ne sont pas injectés seuls** par l’outil — ils servent de :

- référence visuelle / archivage ;
- source si tu copies à la main dans Android Studio ou Xcode ;
- base pour refaire un `splash.png` 2732² avec tagline si tu veux que Capacitor propage le slogan partout.

---

## Workflow recommandé (assets custom déjà prêts)

### Prérequis

- **Node.js ≥ 22** (Capacitor 8 CLI) — vérifier : `node -v`
- Dossiers `android/` et `ios/` générés localement (`npx cap add android` si besoin)

### 1. Injecter dans les projets natifs

```bash
npm run assets:native    # npx @capacitor/assets generate
npm run cap:sync
```

Ou :

```bash
npm run assets:sync      # native + cap:sync (sans écraser tes PNG)
```

### 2. Tester sur device

```bash
npm run cap:open:android   # Windows / Mac
npm run cap:open:ios       # Mac + Xcode
```

🧪 Vérifier **icône** sur l’écran d’accueil et **splash** au lancement.

---

## ⚠️ Ne pas lancer `assets:prepare` par défaut

```bash
npm run assets:prepare   # scripts/prepareStoreAssets.ps1
```

Ce script **écrase** `icon.png` et `splash.png` à partir de `reveal.png` (logo seul, **sans tagline**).  
À réserver uniquement si tu perds les fichiers ou tu veux une base minimaliste depuis `reveal.png`.

---

## Dépannage Windows

| Problème | Cause | Piste |
|----------|--------|--------|
| `Capacitor CLI requires NodeJS >=22` | Node 20 | Installer [Node 22 LTS](https://nodejs.org) |
| `@capacitor/assets` / `sharp` échoue | TLS ou EPERM | Autre réseau, Mac, ou upload manuel de `icon.png` sur App Store Connect |
| Splash sans tagline au lancement | `splash.png` carré utilisé par Capacitor | Exporter un 2732² avec tagline depuis tes maquettes portrait, remplacer `splash.png`, relancer `assets:native` |

`resources/icon.png` reste valide pour l’**upload direct** icône 1024 sur App Store Connect même si `assets:native` échoue.

---

## Captures fiche store

Les screenshots Play / App Store → dossier [`store-assets/`](../store-assets/README.md) (archivage optionnel) + upload manuel dans les consoles.

Checklist complète : [STORE_CHECKLIST.md](../docs/STORE_CHECKLIST.md) section G.
