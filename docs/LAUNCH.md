# REVEAL — Lancement (web, stores, sans pub)

Prod web : **https://julie-lepine.github.io/reveal/**  
Backend : [SUPABASE.md](./SUPABASE.md) · Native : [NATIVE.md](./NATIVE.md) · Site légal : [LEGAL_SITE_OVH.md](./LEGAL_SITE_OVH.md)

| | |
|--|--|
| Package | `com.reveal.partygames` |
| Play | compte **individuel** `contact@revealthepartygame.fr` — test fermé OK, **prod disponible** |
| App Store | **REVEAL - Party Games** — Apple ID [`6785256450`](https://apps.apple.com/app/id6785256450) — compte **Particulier** (EI) |
| Privacy | `https://revealthepartygame.fr/privacy.html` |
| Suppression | `https://revealthepartygame.fr/suppression-compte.html` |
| Contact | `contact@revealthepartygame.fr` |

Builds natifs : `npm run cap:sync` (Node ≥ 22) → AAB / Archive. 

---

**Draw It** : seul QA jeu Android restant (25 août 2026).

---

## Stores — ouvert

### Play
- [x] **12 testeurs** installés via **code d’accès** — 25 août 2026
- [x] **14 jours** de test fermé — **accès production disponible** (lancement au choix)
- [ ] **Publication production** (Play Console → accès production → rollout)
- [x] 🧪 QA app Android : **11 jeux** + parcours app validés — 25 août 2026 · **Draw It** reste
- [ ] Sans pub 02B (voir § Sans pub ci-dessous)

### App Store
- [ ] Review **1.0.0** (build **4**, soumise 24 août 2026) — **ne pas retirer** de la file, pas de nouveau build
- [ ] Vérif **infos app + compte développeur** (modifs soumises) — en attente Apple — 25 août 2026
- [x] DSA : **commerçant** + coordonnées fiche UE — 25 août 2026
- [ ] Paid Apps : W-8BEN envoyé + RIB CA Atlantique Vendée — recocher **Actif** quand validé
- [x] Optionnel : catégorie **Casual**, retirer **Famille** (fiche 16+)
- [ ] 🧪 Parcours iPhone — [NATIVE.md](./NATIVE.md) § Test iPhone

Hors scope : DUNS, diffusion INSEE, nom de société sur la fiche. IAP iOS : après contrat **Actif** + prochaine version (pas la 1.0.0 en review).

### Site & AdMob (après pubs live)
- [ ] `suppression-compte.html` en HTTPS
- [ ] `https://revealthepartygame.fr/app-ads.txt` (`pub-6332424645114129`)
- [ ] Boutons Play / App Store sur le site légal (ou « Bientôt » tant que pas live)
- [ ] Lier AdMob ↔ Play et ↔ App Store ; logo message UMP

---

## Sans pub (RevenueCat + Play)

### Fait
- [x] Flag serveur `profiles.ad_free` + trigger (client ne peut pas s’auto-attribuer)
- [x] App lit le flag, coupe AdMob
- [x] Plugin `@revenuecat/purchases-capacitor` + permission `BILLING`
- [x] `applicationId` = `com.reveal.partygames`
- [x] versionCode **17** / 1.0.17 · AAB 17 en **test fermé Alpha**
- [x] Produit Play `reveal_adfree` (ponctuel)
- [x] Cloud : API Play activée, compte `revenuecat`, JSON
- [x] Play : user `revenuecat@…` invité + droits financiers / commandes
- [x] RC : JSON uploadé, catalogue lu (2 checks verts)
- [x] RC : entitlement `ad_free` + produit Play `reveal_adfree`
- [x] Play : licence testers (Gmails, achats sandbox 0 €)
- [x] RC : credentials Play valides — 25 août 2026
- [x] Clé publique Android `goog_…` dans `data/revenueCatConfig.js`
- [x] 02B code : `Purchases.configure` + `logIn` (compte, pas invité)
- [x] 02B code : Acheter / Restaurer ; plus d’**Actualiser**
- [x] 02B code : Edge Function `revenuecat-webhook` déployée + webhook RC — 25 août 2026
- [x] RC Send test → 200 `ad_free: true` (Authorization **sans** `Bearer`)
- [x] Légal in-app : `data/legalContent.js` (IAP + RevenueCat)

### En cours / à revoir
- [ ] RC : Pub/Sub (optionnel)
- [ ] Clé publique iOS `appl_…` (placeholder)
- [ ] QA testeur Play : achat → pubs off (AAB **18+**, pas le 17)
- [ ] Légal OVH : `privacy.html` + `mentions-legales.html` (2,99 € TTC, Google = paiement)

### Plus tard
- [ ] Prod Play (critères test fermé OK — lancement au choix ; version peut être 1.0.20+)
- [x] iOS — App Store Connect **1.0.0 en review** (build 4). **Sans IAP**.
- [ ] iOS — produit IAP + clé RC `appl_…`
- [ ] Palier Profil 6,99 / Hôte 12,99

### Webhook (obligatoire pour que l’achat coupe les pubs)

1. Supabase → **Edge Functions** → secret `REVENUECAT_WEBHOOK_AUTH` = une longue chaîne aléatoire (pas `sk_` RevenueCat).
2. Déployer : `npx supabase functions deploy revenuecat-webhook --no-verify-jwt`
3. URL : `https://<projet>.supabase.co/functions/v1/revenuecat-webhook`
4. RevenueCat → **Integrations → Webhooks** → cette URL. Authorization header = **la même** chaîne que le secret, **sans** le mot `Bearer`.
5. Événements : purchases + refunds (lifetime = `NON_RENEWING_PURCHASE` / `INITIAL_PURCHASE`).
6. RC **Offering** : le package doit exposer le produit Play `reveal_adfree` (Current offering).

Puis **nouveau AAB** (versionCode +1) : le JS 02B n’est pas dans le 17 déjà en Alpha tant que tu n’as pas rebuild.

---

## Déjà en place

Auth e-mail + invité, Turnstile (web), Resend + SMTP, Realtime, schema lobby / game_sessions. Détail : [SUPABASE.md](./SUPABASE.md).

Comptes Play + Apple, fiches, UMP publié, AdMob IDs, assets (`resources/`, `store-assets/`), AAB test fermé, IPA build 4. App Privacy Apple (e-mail, IDs, AdMob, UGC, gameplay) publiée le 24 août 2026. Âge Apple **16+** (IARC Play **3** : grilles différentes, normal).

Test fermé Play : codes générés, bêta device OK (Z Flip), critères prod remplis — 25 août 2026. Keystore `reveal-release.jks` hors repo.

**Reset MDP** (Resend) validé et testé — 25 août 2026.  
**Egress Supabase** : optimisations + migration faite — 25 août 2026.  
**App Store** : 1.0.0 (build 4) en review + vérif infos dev en attente — 25 août 2026.  
**Play** : test fermé OK, **prod disponible** ; QA 11 jeux + app validés — 25 août 2026.

---

## Après acceptation / prod

1. Vérifier fiche live + pubs AdMob (`ADMOB_USE_TEST_ADS = false` — voir [NATIVE.md](./NATIVE.md)).
2. Lier les stores dans AdMob.
3. Coller les URLs store sur `revealthepartygame.fr`.

**Update store :** code → `cap:sync` → test → bump `versionCode` / `versionName` (Play : +1 obligatoire) → AAB ou Archive → upload.

---

## Si ça casse

| Symptôme | Piste |
|----------|--------|
| Modifs invisibles | Save → push → `?v=` dans `index.html` |
| `no captcha_token` | Turnstile pas validé, ou app native (pas de widget) |
| Turnstile 600010 | Hostname Cloudflare, bloqueur, onglet caché |
| Invité impossible | Anonymous sign-ins Supabase |
| Sync cassée | Realtime + RLS — [SUPABASE.md](./SUPABASE.md) |
| Pas de mail reset | [SUPABASE.md](./SUPABASE.md) § Emails Resend |
