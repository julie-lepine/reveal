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
- [ ] **Guideline 2.1 — Information Needed** : répondre + vidéo iPhone — voir § [App Review 2.1](#app-review-21--information-needed-août-2026) ci-dessous
- [ ] Vérif **infos app + compte développeur** (modifs soumises) — en attente Apple — 25 août 2026
- [x] DSA : **commerçant** + coordonnées fiche UE — 25 août 2026
- [ ] Paid Apps : W-8BEN envoyé + RIB CA Atlantique Vendée — recocher **Actif** quand validé
- [x] Optionnel : catégorie **Casual**, retirer **Famille** (fiche 16+)
- [ ] 🧪 Parcours iPhone — [NATIVE.md](./NATIVE.md) § Test iPhone

Hors scope : DUNS, diffusion INSEE, nom de société sur la fiche. IAP iOS : après contrat **Actif** + prochaine version (pas la 1.0.0 en review).

### Site & AdMob (après pubs live)
- [x] `suppression-compte.html` en HTTPS — 25 août 2026
- [x] `https://revealthepartygame.fr/app-ads.txt` (`pub-6332424645114129`) — 25 août 2026
- [x] Boutons Play / App Store sur le site légal — 25 août 2026
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
- [x] Légal in-app : `data/legalContent.js` (IAP + RevenueCat + liste d’amis privée, 27 août 2026)

### En cours / à revoir
- [ ] RC : Pub/Sub (optionnel)
- [ ] Clé publique iOS `appl_…` (placeholder)
- [ ] QA testeur Play : achat → pubs off (AAB **18+**, pas le 17)
- [x] Légal OVH : `privacy.html` + `mentions-legales.html` (2,99 € TTC, Google = paiement) — 25 août 2026
- [x] Légal OVH : recopie **liste d’amis / demandes** sur `privacy.html` — 27 août 2026

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

---

## App Review 2.1 — Information Needed (août 2026)

**Ce n’est pas un rejet technique.** Apple demande des **informations complémentaires** (Guideline 2.1). Répondre dans **App Store Connect → Messages / Resolution Center** (réponse au fil du build 1.0.0).

Apple **a déjà le binaire** (build 4 uploadé le 24 août). Tu n’envoies **pas** l’app à nouveau : tu envoies une **vidéo** + un **texte** + un **compte démo**.

### Checklist réponse

- [ ] Créer compte démo review (e-mail + mot de passe stables)
- [ ] Renseigner **App Review Information → Sign-in required** + identifiants
- [ ] Installer l’**app native** sur iPhone (TestFlight ou Xcode — voir ci-dessous)
- [ ] Enregistrer la **vidéo** (iPhone physique, iOS récent, 3–5 min)
- [ ] Répondre dans App Store Connect (texte EN ci-dessous + pièce jointe / lien)
- [ ] Coller le même texte dans **Notes** (App Review Information) pour les prochaines soumissions

### Compte démo (à créer dans l’app)

| Champ | Valeur |
|-------|--------|
| E-mail | `review@revealthepartygame.fr` (ou Gmail dédié) |
| Mot de passe | `[CHOISIR — ex. RevealReview2026!]` |

Compte **enregistré** (pas invité) : permet hôte lobby, Paramètres, suppression compte. Préciser à Apple que le mode **Invité** fonctionne sans compte.

### Comment avoir l’app sur iPhone **sans** publication App Store

**GitHub Pages ne suffit pas** pour la vidéo demandée.

| Méthode | C’est quoi | OK pour la vidéo Apple ? |
|---------|------------|-------------------------|
| [julie-lepine.github.io/reveal](https://julie-lepine.github.io/reveal/) (Safari) | Version **web** | ❌ Pas l’app native : pas d’icône REVEAL, pas d’ATT, pas d’AdMob natif, pas de deep link |
| **TestFlight** | Build 4 déjà uploadé → install via app TestFlight | ✅ **Recommandé** si tu n’as pas de Mac |
| **Xcode + câble USB** | `npm run cap:sync` → Run sur iPhone | ✅ Idéal si tu as un Mac ([NATIVE.md](./NATIVE.md)) |

#### Option A — TestFlight (sans Mac, si le build est traité)

1. App Store Connect → **TestFlight** → onglet **iOS** → build **1.0.0 (4)**
2. Si le build est **Processing** : attendre 15–30 min (parfois quelques heures)
3. **Internal Testing** → créer un groupe → ajouter ton Apple ID → activer le build
4. Sur l’iPhone : installer **TestFlight** (App Store) → accepter l’invitation → installer **REVEAL**
5. Enregistrer l’écran (Réglages → Centre de contrôle → Enregistrement d’écran)

> Le build en review est en général **aussi** disponible en TestFlight interne pour ton compte développeur. Si le build n’apparaît pas : vérifier qu’il n’est pas en erreur de traitement (e-mail Apple / ASC).

#### Option B — Xcode (Mac + câble)

1. Cloner le repo sur le Mac, `npm install`, `npm run cap:sync`
2. `npm run cap:open:ios` → signing → Run sur iPhone branché
3. Réglages iPhone → Général → Gestion de l’appareil → faire confiance au dev
4. Lancer depuis l’**icône** REVEAL (pas seulement Xcode)

#### Multijoueur pour la démo (1 seul iPhone)

- Hôte sur iPhone (app native)
- 2ᵉ joueur : navigateur sur [julie-lepine.github.io/reveal](https://julie-lepine.github.io/reveal/) avec le **code lobby** (même Supabase prod)

### Script vidéo (3–5 min, cold start)

1. Lancement depuis l’icône REVEAL  
2. Connexion compte démo (e-mail / mot de passe)  
3. Créer un lobby → code visible  
4. (Optionnel) 2ᵉ client web rejoint avec le code  
5. Lancer une soirée → **1 jeu court** (ex. SpeedVote, Hot Take)  
6. Popup **UMP** (consentement pub RGPD) si affichée  
7. Popup **ATT** (« Autoriser le suivi ») — accepter **ou** refuser  
8. Paramètres → Politique de confidentialité  
9. Paramètres → **Supprimer mon compte** (montrer l’écran ; annuler si tu veux garder le compte démo)  
10. (Optionnel) Mode Invité : pseudo + code lobby  

**Important v1.0.0 iOS** : **pas d’achat in-app** (Sans pub = Android uniquement pour l’instant). Jeux + pub bannière AdMob seulement.

### Où répondre dans App Store Connect

1. **Messages** / **Resolution Center** lié au build → **Reply** + vidéo  
2. **App → App Review Information** → identifiants démo + Notes (texte ci-dessous)  

### Texte à coller (anglais — App Review)

```
Hello App Review Team,

Thank you for your message. Please find below the information requested for REVEAL - Party Games (com.reveal.partygames), version 1.0.0 (build 4).

1. SCREEN RECORDING
A screen recording captured on a physical iPhone running the latest iOS is attached / available at: [LINK OR ATTACHMENT].
It shows: app launch → email login with demo account → create lobby → start an evening → play one party game (multiplayer sync) → AdMob GDPR consent (UMP) → App Tracking Transparency prompt → Settings → Privacy Policy → account deletion entry point.
Note: Version 1.0.0 on iOS does NOT include in-app purchases. The “Remove ads” purchase is Android-only in this build; iOS shows free gameplay with banner ads only.

2. DEVICES TESTED
- iPhone [model], iOS [version] — primary App Store review device
- Samsung Galaxy Z Flip, Android 14 — Android closed testing (same Capacitor codebase)

3. APP PURPOSE & AUDIENCE
REVEAL is a multiplayer party games app for groups of friends (16+). Users create or join a private lobby via a short code, then play synchronized mini-games together in real time. Target audience: adults and older teens at casual social gatherings.

4. SETUP & ACCESS INSTRUCTIONS
- Open the app → Log in / Sign up.
- Demo account (registered user, can host a lobby):
  Email: [review@…]
  Password: […]
- Guest mode (no account): Guest → nickname → enter lobby code from host.
- Multiplayer demo: host on iPhone; second player can join via https://julie-lepine.github.io/reveal/ with the same lobby code.

5. EXTERNAL SERVICES
- Supabase (auth, database, Realtime sync)
- Google AdMob (banner ads; GDPR via Google UMP)
- Resend (password-reset email via Supabase SMTP)
- Google Fonts (Inter)
Cloudflare Turnstile is web-only; disabled in the native iOS app.
RevenueCat / IAP is NOT active on iOS in v1.0.0.

6. REGIONAL DIFFERENCES
No regional differences. French UI and content; consistent behavior worldwide.

7. REGULATED INDUSTRY / THIRD-PARTY MATERIAL
Not applicable. Casual party game; no licensed third-party media in v1.0.0.

USER-GENERATED CONTENT:
Nicknames, lobby chat, custom game text in private lobbies (code required). Private friend list with lobby-only discovery (registered accounts only; no player search). Mitigations: client-side word filter, host can remove players, contact@revealthepartygame.fr for abuse reports. No public social feed.

ACCOUNT DELETION:
In-app: Settings → Legal → “Supprimer mon compte”, or https://revealthepartygame.fr/suppression-compte.html

PRIVACY POLICY: https://revealthepartygame.fr/privacy.html

Best regards,
Julie [Last name]
contact@revealthepartygame.fr
```

### Points sensibles REVEAL

| Sujet | Réponse |
|-------|---------|
| IAP iOS | **Aucun** en 1.0.0 — le dire explicitement |
| UGC | Lobbies **privées** ; liste d’amis **privée** (découverte roster lobby, pas de recherche) ; filtre mots ; kick hôte ; **pas de fil public** ; pas de bouton « Signaler » in-app |
| ATT / UMP | **Obligatoire dans la vidéo** |
| GitHub | Version web seulement — **ne remplace pas** la démo native |
