# REVEAL — Lancement

Prod web : **https://julie-lepine.github.io/reveal/**  
Backend : [SUPABASE.md](./SUPABASE.md) · Native : [NATIVE.md](./NATIVE.md) · Site légal : [LEGAL_SITE_OVH.md](./LEGAL_SITE_OVH.md)

| | |
|--|--|
| Package | `com.reveal.partygames` |
| Play | **live** ([fiche](https://play.google.com/store/apps/details?id=com.reveal.partygames)) — 3 sept 2026 — compte `contact@revealthepartygame.fr` |
| App Store | **REVEAL - Party Games** — Apple ID [`6785256450`](https://apps.apple.com/app/id6785256450) — **live 1.1.2** (hCaptcha acceptée 5 sept 2026) — AdMob iOS : coller **URL marketing** à la prochaine version |
| Privacy | `https://revealthepartygame.fr/privacy.html` |
| Suppression | `https://revealthepartygame.fr/suppression-compte.html` |
| Contact | `contact@revealthepartygame.fr` |

Builds : `npm run cap:sync` (Node ≥ 22) → AAB / Archive.

---

## À faire

1. **Apple** — **1.1.2** acceptée, **Prête pour la distribution** (hCaptcha). AdMob iOS encore bloqué : pas d’**URL marketing** sur la fiche (AdMob cherche « site Web version développeur », pas la politique de confidentialité).
2. **AdMob iOS** — sur la **prochaine** version ASC : URL marketing = `https://revealthepartygame.fr` (racine, pas `/privacy.html`). Puis AdMob → Verify. `app-ads.txt` est déjà live.
3. **Signature iOS** — IAP « Prêt pour la vérification » sur cette même prochaine version. RC catalogue déjà clos.

- [ ] Release maj hCaptcha + AdMob iOS `app-ads.txt` (Site Web du développeur = `revealthepartygame.fr`)
- [ ] Palier Signature 6,99 (Maître de soirée 12,99 plus tard)

---

## Fait

**Play** live 3 sept 2026. AdMob Android lié 4 sept 2026 (recherche URL + `&gl=FR`) ; **appli approuvée 5 sept 2026** (`com.reveal.partygames`, limites d’examen levées, pubs autorisées). Test fermé, QA 11 jeux, Sans pub (0 € + 2ᵉ téléphone). Data safety + catégorie Jeu / Décontracté.

**iOS** — v1.1 refusée 2 sept 2026 (5.1.1 + 2.1) ; suppression **in-app** puis **maj acceptée**. **1.1.2** (hCaptcha) **Prête pour la distribution** (5 sept 2026). AdMob iOS associé, **pas encore** « peut diffuser » : la fiche live n’a pas d’URL marketing (seulement confidentialité `…/privacy.html`). IAP `reveal_adfree`, Paid Apps Actif, RevenueCat, ATT. QA iPhone XR 31 août 2026.

**Ads / légal** — `app-ads.txt` live (`pub-6332424645114129`). `ADMOB_USE_TEST_ADS = false`. Logo REVEAL déjà sur le message UMP. Privacy + suppression OVH. Amis / invitations / croisés 24 h (FEATURE-FRIENDS-04) sur web + fiches. AdMob **Onboarding / Revenus** (barre du mail) = paiements éditeur, pas un blocage des pubs Android.

**Hors scope** — DUNS, diffusion INSEE, nom de société sur la fiche.

---

## Après acceptation de la maj hCaptcha

1. Release (manuel ou auto).
2. Fiche App Store : lien **Site Web du développeur** = `revealthepartygame.fr`.
3. AdMob → app iOS → **Rechercher des mises à jour**.
4. URLs store sur `revealthepartygame.fr` si pas déjà.

**Update store :** code → `cap:sync` → test → bump `versionCode` / `versionName` (Play : +1) → AAB ou Archive → upload.

---

## Palier Profil 6,99

Socle IAP déjà là (RevenueCat, webhook, flag `ad_free`, achat lié au compte). **Maître de soirée** 12,99 € hors scope (pas de SKU, pas de colonne). Noms affichés : Sans pub → Signature → Maître de soirée. Nouvel IAP Apple = **nouvelle version** après la maj hCaptcha en review — ne pas coller ça sur le build en file.

Ordre : **0** (contrat, ci-dessous) → **1** (code + SQL) → **2** (admin stores, en parallèle du 1) → **3 → 4 → 5 → 6**.

### 0. Contrat produit — figé 4 sept 2026

- [x] **Empilement** : **Signature** (6,99 €, SKU `reveal_profile`) **inclut** Sans pub. Un seul chemin pubs : `isAdFree()` vrai aussi si `profile_pack`.
- [x] **Upgrade** : un acheteur 2,99 € paie **4,00 €** (`reveal_profile_upgrade`). Les autres paient **6,99 €** (`reveal_profile`). Les stores ne proratisent pas un achat ponctuel.
- [x] **Compte** : inscrit + natif only ; droit lié au compte. Invité / web = pas d’achat. Ne pas re-payerwaller pseudo, 18 emojis gratuits, amis, jeux, lobby 8.
- [x] **Maître de soirée 12,99 €** : hors scope. Réserver : lobby > 8, outils de table. Mots perso qui suivent le **joueur** = Signature, pas Maître de soirée.
- [x] **Noms affichés** : Sans pub · Signature · Maître de soirée (onglet Menu reste « Profil »). SKUs inchangés.
- [x] **Ce que Signature débloque** (3 couches ; la fiche store ne promet que ce qui est dans le build) :
  1. **Identité visible** (1er ship métier) : couleur de pseudo (palette fermée), cadre / badge Profil en lobby, emojis extra, **photo de profil** (cercle, remplace l’emoji ; emoji si l’image ne charge pas). Recadrage dans Menu → Profil.
  2. **Carnet perso** (FEATURE-PROFILE-04) : stats agrégées (parties, winrate, MVP, jeu préféré), **20** dernières soirées (date, jeux, *ton* rang/score, prénoms des amis encore amis). Visuels : anneau winrate, courbe scores (Y : 0 ou pire−10 → max+10), barres 1er / 2e / 3e+. **Pas** un historique de salons : pas de code lobby, pas de rejoin, pas de fil. Carte share 9:16 (sans prénoms d’amis sur l’image).
  3. **Mots perso** (après) : paquet Draw It / thèmes Tier Night persisté sur le compte.

### 1. FEATURE-PROFILE-01 — Flag serveur

Même modèle que `profiles.ad_free` : le client **ne peut pas** s’auto-attribuer.

- [x] Colonne `profiles.profile_pack` boolean + trigger
- [x] `fetchProfile` lit le flag ; `upsertProfile` ne l’écrit pas
- [x] `entitlements.js` : `isProfilePack()` (invité = toujours false)
- [x] `isAdFree()` vrai si `ad_free` **ou** `profile_pack`
- [x] Tests type `featureAdFree01` + migration SQL + ligne [DEPLOYMENTS_SQL.md](./DEPLOYMENTS_SQL.md) — **SQL ✅** 4 sept 2026

### 2. FEATURE-PROFILE-02A — Stores + RevenueCat

Admin, pas de code app. En parallèle du 1.

| Où | Quoi |
|----|------|
| Play Console | Ponctuel `reveal_profile` **6,99 €** + `reveal_profile_upgrade` **4,00 €** |
| App Store Connect | Mêmes SKUs, **non-conso / lifetime** |
| RevenueCat | Entitlement `profile` (les **deux** SKUs) ; `ad_free` inchangé |
| Offering RC | Packages à côté de `reveal_adfree` |
| Catalogue | Identifiants alignés Play / iOS / RC |

- [x] Produit Play `reveal_profile` + `reveal_profile_upgrade` — 4 sept 2026
- [x] Produit App Store `reveal_profile` + `reveal_profile_upgrade` (minuscules, comme `reveal_adfree`) — **Prêt pour la vérification**
- [x] Captures review App Store Connect pour **Profil** et **Profil upgrade**
- [x] Entitlement RC `profile` : 4 produits (Play + iOS, plein tarif **et** upgrade). Pas d’entitlement `profile_upgrade`. `ad_free` inchangé.
- [x] Offering current : packages Custom `profile` / `profile_upgrade` (Play + App Store) + `$rc_lifetime` = `reveal_adfree`

Code client 02B prêt. **iOS : nouvelle version** (ne pas coller sur la maj hCaptcha en review). QA achat = licence testers Play + sandbox iOS, pas GitHub Pages.

### 3. FEATURE-PROFILE-02B — Achat client + webhook

Réutiliser `purchases.js` / `revenuecat-webhook`, pas un 2ᵉ pipeline.

- [x] SKUs dans `data/revenueCatConfig.js`
- [x] `purchaseProfile` : 6,99 si pas Sans pub ; 4,00 si Sans pub sans Profil. Restore. Compte inscrit only, pas web, pas invité
- [x] Menu → **Profil** : carte comme Sans pub ; si Profil actif, masquer l’achat 2,99 (inclus)
- [x] Webhook : entitlement `profile` → `profile_pack` + `ad_free`. Refund upgrade → perd Profil, **garde** Sans pub si `reveal_adfree` encore valide
- [x] Poll `refresh…FromServerUntil` après achat, **zéro écriture client**
- [x] Tests type `featureAdFree02a` / `02b`
- [x] **Webhook** déployé (Dashboard, 5 sept 2026) : `profile_pack` + JWT off — CLI `TransportError` ignoré

### 4. FEATURE-PROFILE-03 — Ce que ça débloque

Couche 1 (couleur, cadre, emojis extra) + carnet visuels sont dans le build. Mots perso ensuite. Ne pas promettre la couche 3 dans la fiche si absente du build.

- [x] Gate UI (Menu Profil + éventuellement hub)
- [x] Gate réelle (pas seulement un bouton grisé)
- [x] États : invité, inscrit sans palier, Sans pub seul, Profil, restore, refund

### 4b. FEATURE-PROFILE-04 — Carnet Signature

Stats + 20 soirées. Archive au leave/dissolve **avant** perte de membership. `lobby_id` jamais renvoyé au client. Visuels : client only, pas de SQL.

- [x] SQL `signature_evenings` + RPC `archive_signature_evening` / `list_signature_carnet` — **prod**
- [x] Menu → Profil → Mon carnet (teaser si pas Signature)
- [x] Amis encore amis uniquement (pseudos live)
- [x] Visuels : anneau winrate, courbe scores (0 ou pire−10 → max+10), barres 1er / 2e / 3e+, tuile favori 2×2
- [x] Carte share 9:16 (preview + share sheet), sans prénoms d’amis ; hero = accroche stats (photo rectangle plus tard)
- Hors scope ici : mots perso

### 4c. FEATURE-PROFILE-05 — Photo avatar (pastille unique)

Photo Signature = le même cercle que l’emoji, **partout** (lobby, scores, amis, aperçu Profil, carte share). Pas de picker sur la carte. Pas de photo dans le hero 9:16.

- [x] SQL `profiles.avatar_path` / `avatar_rev` + snapshot salon + Storage `avatars` — **prod** (5 sept 2026)
- [x] Recadrage cercle dans Menu → Profil (pinch / drag, pas de 90°)
- [x] Emoji conservé en secours (`onerror` / canvas CORS)
- Hors scope : photo hero carte, report UGC store (légal toujours après Maître de soirée)

### 5. Légal + stores

Reporté après **Maître de soirée 12,99 €** (un seul passage privacy / OVH / fiches).

- [ ] `data/legalContent.js` : achats Signature + Maître de soirée (prix TTC, lifetime, compte pas appareil)
- [ ] Pages OVH (`privacy.html`, mentions) — même mention
- [ ] Fiches Play / App Store si le texte IAP change

### 6. QA puis ship

- [ ] Licence testers Play (0 €) + sandbox iOS
- [ ] Achat → flag on → pubs coupées (si inclus) → features Profil visibles → restore 2ᵉ téléphone → refund → flag off
- [ ] Invité : achat refusé
- [ ] Web : message « dans l’app native »
- [ ] `cap:sync` → bump `versionCode` / `versionName` → AAB + Archive

---

## Si ça casse

| Symptôme | Piste |
|----------|--------|
| Modifs invisibles | Save → push → `?v=` dans `index.html` |
| `no captcha_token` | hCaptcha (web + natif) / `captcha.html` pas live |
| Captcha 600010 / widget | Site key, hostname, bloqueur. Natif : in-page hCaptcha, pas Safari |
| Invité impossible | Anonymous sign-ins Supabase |
| Sync cassée | Realtime + RLS — [SUPABASE.md](./SUPABASE.md) |
| Pas de mail reset | [SUPABASE.md](./SUPABASE.md) § Emails Resend |
| Achat iOS « indisponible » | Clé `appl_…`, Paid Apps **Actif**, produit dans l’offering RC |
| AdMob ne trouve pas Play | Coller l’URL complète + `&gl=FR` |

Webhook Sans pub déjà en place (secret `REVENUECAT_WEBHOOK_AUTH`, sans `Bearer`). Offering RC : `reveal_adfree` Play **et** iOS.

---

## App Review (référence)

Fil **2.1** du 1.0.0 (build 4) : **abandonné**. Compte démo : `review@revealthepartygame.fr` (enregistré, pas invité ; ne pas acheter Sans pub en review). Cette review = maj **hCaptcha**, pas une première soumission.

QA native : Xcode / TestFlight — pas GitHub Pages. 2ᵉ joueur : web + code lobby.

