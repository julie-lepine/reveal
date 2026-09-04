# REVEAL — Lancement

Prod web : **https://julie-lepine.github.io/reveal/**  
Backend : [SUPABASE.md](./SUPABASE.md) · Native : [NATIVE.md](./NATIVE.md) · Site légal : [LEGAL_SITE_OVH.md](./LEGAL_SITE_OVH.md)

| | |
|--|--|
| Package | `com.reveal.partygames` |
| Play | **live** ([fiche](https://play.google.com/store/apps/details?id=com.reveal.partygames)) — 3 sept 2026 — compte `contact@revealthepartygame.fr` |
| App Store | **REVEAL - Party Games** — Apple ID [`6785256450`](https://apps.apple.com/app/id6785256450) — **live** (dernière maj acceptée) — **maj hCaptcha + URL marketing en review** (4 sept 2026) |
| Privacy | `https://revealthepartygame.fr/privacy.html` |
| Suppression | `https://revealthepartygame.fr/suppression-compte.html` |
| Contact | `contact@revealthepartygame.fr` |

Builds : `npm run cap:sync` (Node ≥ 22) → AAB / Archive.

---

## À faire

1. **Apple** — maj **hCaptcha** (+ URL marketing) **en review**. L’app est déjà live (maj précédente acceptée).
2. **Après acceptation de cette maj** — release, puis AdMob iOS → **Rechercher des mises à jour** (`app-ads.txt`). Store déjà associé ; l’URL marketing n’est que sur **cette** version.
3. **Plus tard** — palier Profil 6,99 / Hôte 12,99. Draw It (QA Android, hors gate).

- [ ] Release maj hCaptcha + AdMob iOS `app-ads.txt` (Site Web du développeur = `revealthepartygame.fr`)
- [ ] Palier Profil / Hôte

---

## Fait

**Play** live 3 sept 2026. AdMob Android lié 4 sept 2026 (recherche URL + `&gl=FR`). Test fermé, QA 11 jeux, Sans pub (0 € + 2ᵉ téléphone). Data safety + catégorie Jeu / Décontracté.

**iOS** — v1.1 refusée 2 sept 2026 (5.1.1 + 2.1) ; suppression **in-app** puis **maj acceptée** (app live). **Nouvelle version en review** : hCaptcha + URL marketing `https://revealthepartygame.fr` (4 sept 2026). AdMob iOS associé (validation `app-ads.txt` après cette maj live). IAP `reveal_adfree`, Paid Apps Actif, RevenueCat, ATT. QA iPhone XR 31 août 2026.

**Ads / légal** — `app-ads.txt` live (`pub-6332424645114129`). `ADMOB_USE_TEST_ADS = false`. Logo REVEAL déjà sur le message UMP. Privacy + suppression OVH. Amis / invitations / croisés 24 h (FEATURE-FRIENDS-04) sur web + fiches.

**Hors scope** — DUNS, diffusion INSEE, nom de société sur la fiche.

---

## Après acceptation de la maj hCaptcha

1. Release (manuel ou auto).
2. Fiche App Store : lien **Site Web du développeur** = `revealthepartygame.fr`.
3. AdMob → app iOS → **Rechercher des mises à jour**.
4. URLs store sur `revealthepartygame.fr` si pas déjà.

**Update store :** code → `cap:sync` → test → bump `versionCode` / `versionName` (Play : +1) → AAB ou Archive → upload.

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

