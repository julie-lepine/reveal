# REVEAL — Stores

Complément de [LAUNCH_CHECKLIST.md](./LAUNCH_CHECKLIST.md). Détails : [CAPACITOR.md](./CAPACITOR.md), [ADMOB.md](./ADMOB.md), [LEGAL_SITE_OVH.md](./LEGAL_SITE_OVH.md), [FEATURE_ADFREE_CHECKLIST.md](./FEATURE_ADFREE_CHECKLIST.md).

| | |
|--|--|
| Package | `com.reveal.partygames` |
| Play | compte **individuel** `contact@revealthepartygame.fr` — test fermé **12 installs × 14 jours** avant prod |
| App Store | **REVEAL - Party Games** — Apple ID [`6785256450`](https://apps.apple.com/app/id6785256450) — compte **Particulier** (EI). Pas de DUNS / conversion Organisation. |
| Privacy | `https://revealthepartygame.fr/privacy.html` |
| Suppression | `https://revealthepartygame.fr/suppression-compte.html` |
| Contact | `contact@revealthepartygame.fr` |

Builds : `npm run cap:sync` (Node ≥ 22) → AAB / Archive. `git push` ne met pas à jour les stores. Ne pas lancer `npm run assets:prepare` (écrase icon/splash).

---

## Ouvert

### Play
- [ ] **12 testeurs** ont installé via **code d’accès** (Play Store → Profil → Paiements → Utiliser un code — pas de lien `…/apps/testing/…`)
- [ ] **14 jours** de test fermé → demande **accès production** → prod
- [ ] Sans pub 02B — [FEATURE_ADFREE_CHECKLIST.md](./FEATURE_ADFREE_CHECKLIST.md)

### App Store
- [ ] Review **1.0.0** (build **4**, soumise 24 août 2026) — **ne pas retirer** de la file, pas de nouveau build
- [x] DSA : **commerçant** + coordonnées fiche UE — 25 août 2026
- [ ] Paid Apps : W-8BEN envoyé + RIB CA Atlantique Vendée — **traitement Apple ~24 h** (25 août 2026). Recocher **Actif** demain.
- [x] Optionnel : catégorie **Casual**, retirer **Famille** (fiche 16+)
- [ ] 🧪 Parcours iPhone — [IPHONE_TEST_CHECKLIST.md](./IPHONE_TEST_CHECKLIST.md)

Hors scope : DUNS, diffusion INSEE, nom de société sur la fiche. IAP iOS : après contrat **Actif** + prochaine version (pas la 1.0.0 en review).

### Site & AdMob (après pubs live)
- [ ] `suppression-compte.html` en HTTPS
- [ ] `https://revealthepartygame.fr/app-ads.txt` (`pub-6332424645114129`)
- [ ] Boutons Play / App Store sur le site légal (ou « Bientôt » tant que pas live)
- [ ] Lier AdMob ↔ Play et ↔ App Store ; logo message UMP

---

## Déjà en place

Comptes Play + Apple, fiches, UMP publié, AdMob IDs, assets (`resources/`, `store-assets/`), AAB test fermé, IPA build 4. App Privacy Apple (e-mail, IDs, AdMob, UGC, gameplay) publiée le 24 août 2026. Âge Apple **16+** (IARC Play **3** : grilles différentes, normal).

Test fermé Play : codes générés, bêta device OK (Z Flip). Keystore `reveal-release.jks` hors repo.

---

## Après acceptation / prod

1. Vérifier fiche live + pubs AdMob (`ADMOB_USE_TEST_ADS = false`).
2. Lier les stores dans AdMob.
3. Coller les URLs store sur `revealthepartygame.fr`.

**Update store :** code → `cap:sync` → test → bump `versionCode` / `versionName` (Play : +1 obligatoire) → AAB ou Archive → upload.
