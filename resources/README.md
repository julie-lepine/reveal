# Icônes & splash Capacitor

Place ici :

- `icon.png` — 1024×1024 minimum (source : `reveal.png` agrandi si besoin)
- `splash.png` — 2732×2732 recommandé (fond + logo centré)

Puis générer les assets natifs :

```bash
npm install -D @capacitor/assets
npx capacitor-assets generate
npm run cap:sync
```

Voir [STORE_CHECKLIST.md](../STORE_CHECKLIST.md) section G.
