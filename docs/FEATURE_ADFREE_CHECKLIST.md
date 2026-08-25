# Sans pub — checkup

## Fait
- [x] Flag serveur `profiles.ad_free` + trigger (client ne peut pas s’auto-attribuer)
- [x] App lit le flag, coupe AdMob
- [x] Plugin `@revenuecat/purchases-capacitor` + permission `BILLING`
- [x] `applicationId` = `com.reveal.partygames`
- [x] versionCode **17** / 1.0.17
- [x] AAB 17 signé + en **test fermé Alpha** (`17` / `1.0.17`)
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
- [x] 02B code : Edge Function `revenuecat-webhook` déployée + webhook RC créé — 25 août 2026
- [x] RC Send test → 200 `ad_free: true` (Authorization **sans** `Bearer`)
- [x] Légal in-app : `data/legalContent.js` (IAP + RevenueCat)

## En cours / à revoir
- [ ] RC : Pub/Sub (optionnel)
- [ ] Clé publique iOS `appl_…` (placeholder)
- [ ] QA testeur Play : achat → pubs off (AAB **18+**, pas le 17)
- [ ] Légal OVH : `privacy.html` + `mentions-legales.html` (2,99 € TTC, Google = paiement)

## Play 02A
- [x] Signer AAB + Alpha **17 (1.0.17)** active

## Plus tard
- [ ] Prod Play (après QA test fermé ; version peut être 1.0.20+)
- [x] iOS — App Store Connect **1.0.0 en review** (build 4, 24 août 2026). **Sans IAP**.
- [ ] iOS — produit IAP + clé RC `appl_…`
- [ ] Palier Profil 6,99 / Hôte 12,99

---

## Manuel — webhook (obligatoire pour que l’achat coupe les pubs)

1. Supabase → **Edge Functions** → secret `REVENUECAT_WEBHOOK_AUTH` = une longue chaîne aléatoire (pas `sk_` RevenueCat).
2. Déployer :

```bash
npx supabase functions deploy revenuecat-webhook --no-verify-jwt
```

3. URL : `https://<projet>.supabase.co/functions/v1/revenuecat-webhook`
4. RevenueCat → **Integrations → Webhooks** → cette URL. Authorization header = **la même** chaîne que le secret, **sans** le mot `Bearer`.
5. Événements : purchases + refunds (lifetime = `NON_RENEWING_PURCHASE` / `INITIAL_PURCHASE`).
6. RC **Offering** : le package doit exposer le produit Play `reveal_adfree` (Current offering).

Puis **nouveau AAB** (versionCode +1) : le JS 02B n’est pas dans le 17 déjà en Alpha tant que tu n’as pas rebuild.
