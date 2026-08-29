# REVEAL — Lancement (web, stores, sans pub)

Prod web : **https://julie-lepine.github.io/reveal/**  
Backend : [SUPABASE.md](./SUPABASE.md) · Native : [NATIVE.md](./NATIVE.md) · Site légal : [LEGAL_SITE_OVH.md](./LEGAL_SITE_OVH.md)

| | |
|--|--|
| Package | `com.reveal.partygames` |
| Play | compte **individuel** `contact@revealthepartygame.fr` — test fermé OK, **prod demandée** (29 août 2026) — attente review Google |
| App Store | **REVEAL - Party Games** — Apple ID [`6785256450`](https://apps.apple.com/app/id6785256450) — compte **Particulier** (EI) |
| Privacy | `https://revealthepartygame.fr/privacy.html` |
| Suppression | `https://revealthepartygame.fr/suppression-compte.html` |
| Contact | `contact@revealthepartygame.fr` |

Builds natifs : `npm run cap:sync` (Node ≥ 22) → AAB / Archive. 

---

**Draw It** : seul QA jeu Android restant (25 août 2026).

---

## Reste (ordre — 29 août 2026)

1. **iOS (priorité)** — **abandonner** le 1.0.0 (build 4) / App Review 2.1 (binaire obsolète). Envoyer le **build final** (même codebase Play actuelle : amis + Sans pub + AdMob) et **demander la prod**.
   - Retirer le 1.0.0 de la review dans App Store Connect, puis **nouvelle version** + Archive Xcode (`cap:sync`, pas l’AAB).
   - **Avant** l’Archive : Paid Apps **Actif**, IAP `reveal_adfree`, RevenueCat iOS (`appl_…` + offering), App Privacy (amis), AdMob iOS lié.
   - AdMob iOS : IDs / UMP / ATT **déjà** dans le projet. À **tester** sur iPhone + lier l’app dans la console AdMob.
   - QA : **soirée test iPhone XR** (jeux + pubs + Sans pub sandbox). Si OK → soumettre + release prod.
2. **Play** — **prod demandée** (29 août 2026). Attente review / rollout Google. QA Sans pub déjà OK (achat 0 €, restore, pubs off, 2ᵉ téléphone).

---

## Stores — ouvert

### Play
- [x] **12 testeurs** installés via **code d’accès** — 25 août 2026
- [x] **14 jours** de test fermé — **accès production disponible** (lancement au choix)
- [x] **QA Sans pub** : achat 0 € → pubs off ; Restaurer ; 2ᵉ téléphone même compte — 29 août 2026
- [x] **Publication production demandée** (Play Console → accès production → rollout) — 29 août 2026 — **attente review Google** (pas encore live)
- [x] 🧪 QA app Android : **11 jeux** + parcours app validés — 25 août 2026 · **Draw It** reste (hors gate lancement)
- [x] Fiche Play : description courte / complète + nouveautés (amis, Sans pub 2,99 €) — 29 août 2026
- [x] Contenu de l’application : pubs, UGC, financier (IAP), Data safety (amis + IAP + AdMob) — 29 août 2026
- [x] Catégorie **Jeu → Décontracté** (Casual), pas Famille — 29 août 2026
  *(Paramètres de la fiche Play Store, pas la fiche textes)*

### App Store
**Priorité actuelle.** Le 1.0.0 (build 4) est **abandonné** (29 août 2026) — ne pas répondre au 2.1, ne pas le garder en file. Soumettre le **build final** + demander la prod.

#### Fiche (déjà fait)
- [x] Fiche **REVEAL - Party Games** + Apple ID `6785256450`
- [x] Vérif **infos app + compte développeur** (modifs soumises) — en attente Apple — 25 août 2026
- [x] DSA : **commerçant** + coordonnées fiche UE — 25 août 2026
- [x] Catégorie **Casual**, retirer **Famille** (fiche 16+)
- [x] Privacy URL = `https://revealthepartygame.fr/privacy.html`

#### Ancien binaire
- [x] Review **1.0.0** (build **4**, soumise 24 août 2026) — **refusée** 30 août 2026 (app obsolète ; 2.1 abandonné)
- [x] Pas de *Remove from Review* : version déjà **Refusée** — on resoumet un **nouveau build** sur 1.0.0 (ou version suivante)

#### Build prod (tout brancher **avant** Archive)
- [x] Paid Apps : W-8BEN + RIB CA Atlantique Vendée → **Actif** — 29 août 2026
- [x] Produit IAP App Store `reveal_adfree` (achat unique, 2,99 €) — créé 29 août 2026 — à soumettre **avec** le build prod (ne pas « Ajouter pour vérification » tout seul)
- [x] RevenueCat iOS : app Apple dans RC, credentials App Store Connect, produit dans l’offering Current (`reveal_adfree` Play **et** iOS) — 30 août 2026
- [x] Clé publique iOS `appl_…` collée dans `data/revenueCatConfig.js` — 30 août 2026 — `npm run cap:sync` **avant** l’Archive Mac
- [x] App Privacy Apple : User ID (amis, liste privée, pas de recherche) + Achats (Sans pub) + contenu de jeu — publié 30 août 2026
- [ ] AdMob : app iOS déjà créée (IDs dans `data/admobConfig.js`) — **lier l’App Store après la fiche live** (recherche AdMob vide tant que l’app n’est pas publique) ; `ADMOB_USE_TEST_ADS = false` (déjà)
- [x] Fiche textes : description alignée Play (amis, Sans pub 2,99 €) — 30 août 2026
- [ ] 🧪 Parcours iPhone — [NATIVE.md](./NATIVE.md) § Test iPhone + Sans pub sandbox (compte Sandbox Apple)
- [ ] Compte démo review + Notes App Review — § [Soumission prod iOS](#soumission-prod-ios--build-final) ci-dessous
- [ ] `cap:sync` → Archive Xcode → upload → soumettre review → **demander la prod** (release auto ou manuel dès acceptation)

Hors scope : DUNS, diffusion INSEE, nom de société sur la fiche. Palier Profil 6,99 / Hôte 12,99.

### Native (amis) — ce build

Le build prod iOS **embarque** amis / invitations / croisés 24 h (plus le 1.0.0 obsolète).

- [x] Play Data safety : relations sociales / user IDs — *No public social feed*, *private friend list*, *lobby-only discovery* (pas de recherche, pas de fil) — 29 août 2026
- [x] App Privacy Apple : **ce build prod** — User ID (amis privés, lobby only) + Achats + contenu de jeu — 30 août 2026

### Site & AdMob (après pubs live)
- [x] `suppression-compte.html` en HTTPS — 25 août 2026
- [x] `https://revealthepartygame.fr/app-ads.txt` (`pub-6332424645114129`) — 25 août 2026
- [x] Boutons Play / App Store sur le site légal — 25 août 2026
- [ ] Lier AdMob ↔ Play et ↔ App Store ; logo message UMP

---

## Sans pub (RevenueCat + stores)

### Fait (Android)
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
- [x] RC : Pub/Sub — **skip** (achat unique ; achats / remboursements Play OK sans ; webhook `REFUND` déjà câblé) — 29 août 2026
- [x] Légal in-app : `data/legalContent.js` (IAP + RevenueCat + liste d’amis privée + invitations de soirée éphémères, 27 août 2026)
- [x] Légal OVH : `privacy.html` + `mentions-legales.html` (2,99 € TTC, Google = paiement) — 25 août 2026
- [x] Légal OVH : recopie **liste d’amis / demandes** sur `privacy.html` — 27 août 2026
- [x] Légal OVH : recopie **invitations de soirée** sur `privacy.html` — 27 août 2026
- [x] Légal OVH : recopie **joueurs récemment croisés 24 h** sur `privacy.html` — FEATURE-FRIENDS-04 — 27 août 2026
- [x] QA testeur Play (après MAJ store) : achat **0 €** → pubs off ; **2ᵉ téléphone** même compte → Sans pub déjà là (AAB **24+**, pas le 17)

### En cours — iOS (ce build)
- [x] Prod Play — **demandée** 29 août 2026 (QA Sans pub OK ; critères test fermé déjà remplis) — **attente review Google**
- [x] Paid Apps **Actif** — 29 août 2026
- [x] Produit IAP Apple `reveal_adfree` **dans l’offering RC** (Play **et** iOS) — 30 août 2026
- [x] Clé publique iOS `appl_…` dans `data/revenueCatConfig.js` — 30 août 2026
- [ ] Légal OVH : préciser paiement Apple (App Store) en plus de Google, si pas déjà
- [ ] Archive + soumettre + demander prod App Store

### Plus tard
- [ ] Palier Profil 6,99 / Hôte 12,99

### Webhook (obligatoire pour que l’achat coupe les pubs)

1. Supabase → **Edge Functions** → secret `REVENUECAT_WEBHOOK_AUTH` = une longue chaîne aléatoire (pas `sk_` RevenueCat).
2. Déployer : `npx supabase functions deploy revenuecat-webhook --no-verify-jwt`
3. URL : `https://<projet>.supabase.co/functions/v1/revenuecat-webhook`
4. RevenueCat → **Integrations → Webhooks** → cette URL. Authorization header = **la même** chaîne que le secret, **sans** le mot `Bearer`.
5. Événements : purchases + refunds (lifetime = `NON_RENEWING_PURCHASE` / `INITIAL_PURCHASE`).
6. RC **Offering** : le package doit exposer `reveal_adfree` **Play et iOS** (Current offering).

Le webhook existant suffit pour iOS (même entitlement `ad_free`). Pas de nouvel AAB Android juste pour la clé iOS.

---

## Déjà en place

Auth e-mail + invité, Turnstile (web), Resend + SMTP, Realtime, schema lobby / game_sessions. Détail : [SUPABASE.md](./SUPABASE.md).

Comptes Play + Apple, fiches, UMP publié, AdMob IDs, assets (`resources/`, `store-assets/`), AAB test fermé. Âge Apple **16+** (IARC Play **3** : grilles différentes, normal). App Privacy Apple (e-mail, IDs, AdMob, UGC, gameplay) publiée le 24 août 2026 — **à compléter amis** sur le build prod.

Test fermé Play : codes générés, bêta device OK (Z Flip), critères prod remplis — 25 août 2026. Keystore `reveal-release.jks` hors repo.

**Reset MDP** (Resend) validé et testé — 25 août 2026.  
**Egress Supabase** : optimisations + migration faite — 25 août 2026.  
**App Store** : 1.0.0 (build 4) **abandonné** 29 août 2026. **Priorité : build final + prod** (IAP, RC, AdMob, App Privacy amis, parcours iPhone).  
**Play** : test fermé OK ; QA 11 jeux + app validés — 25 août 2026. Fiche + Data safety + catégorie Jeu/Décontracté — 29 août 2026. QA Sans pub (0 € + 2ᵉ téléphone) OK. **Prod demandée** 29 août 2026 — attente review Google.  
**Amis / invitations de soirée / Annuler / croisés 24 h** : code FEATURE-FRIENDS-04 prêt ; web [Pages](https://julie-lepine.github.io/reveal/) (`main`) après ton push. Play : fiche à jour (29 août 2026). App Store : **build prod iOS embarque** amis (plus le 1.0.0 obsolète).

---

## Après acceptation / prod

Play : **demandée** 29 août 2026 — à faire **quand la fiche est live**. App Store : idem après acceptation Apple.

1. Vérifier fiche live + pubs AdMob (`ADMOB_USE_TEST_ADS = false` — voir [NATIVE.md](./NATIVE.md)).
2. Lier les stores dans AdMob (Play **et** App Store).
3. Coller les URLs store sur `revealthepartygame.fr`.

**Update store :** code → `cap:sync` → test → bump `versionCode` / `versionName` (Play : +1 obligatoire) → AAB ou Archive → upload. Play Data safety **déjà à jour** (amis + IAP, 29 août 2026). App Privacy Apple : **avec ce build prod** (amis + IAP).

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
| Achat iOS « indisponible » | Clé `appl_…` pas collée, ou Paid Apps pas **Actif**, ou produit absent de l’offering RC |

---

## Soumission prod iOS — build final

Le fil **Guideline 2.1** du 1.0.0 (build 4) est **abandonné** (29 août 2026) : ce binaire ne correspond plus à l’app. **Ne pas** répondre dans Resolution Center. Retirer de la review, uploader le build actuel, soumettre une **nouvelle** version.

Apple peut redemander une vidéo (2.1) sur le nouveau binaire — compte démo + notes ci-dessous restent utiles.

### Compte démo (à créer dans l’app)

| Champ | Valeur |
|-------|--------|
| E-mail | `review@revealthepartygame.fr` (ou Gmail dédié) |
| Mot de passe | `[CHOISIR — ex. RevealReview2026!]` |

Compte **enregistré** (pas invité) : hôte lobby, Paramètres, suppression compte, liste d’amis. Préciser à Apple que le mode **Invité** fonctionne sans compte. **Ne pas** acheter Sans pub avec ce compte en review (sandbox Apple à part).

### Comment avoir l’app sur iPhone **sans** publication App Store

**GitHub Pages ne suffit pas** pour QA native / une éventuelle vidéo Apple.

| Méthode | C’est quoi | OK native ? |
|---------|------------|-------------|
| [julie-lepine.github.io/reveal](https://julie-lepine.github.io/reveal/) (Safari) | Version **web** | ❌ Pas ATT, pas AdMob natif, pas IAP |
| **Xcode + câble USB** | `npm run cap:sync` → Run sur iPhone | ✅ Idéal ([NATIVE.md](./NATIVE.md)) |
| **TestFlight** | Après upload du **nouveau** build | ✅ QA + review interne |

#### Xcode (Mac + câble)

1. Cloner le repo sur le Mac, `npm install`, coller `appl_…` si pas déjà, `npm run cap:sync`
2. `npm run cap:open:ios` → signing → Run sur iPhone branché
3. Réglages iPhone → Général → Gestion de l’appareil → faire confiance au dev
4. Lancer depuis l’**icône** REVEAL (pas seulement Xcode)

#### TestFlight (après upload du build prod)

1. App Store Connect → **TestFlight** → build **nouveau** (pas le 1.0.0 (4))
2. **Internal Testing** → ton Apple ID
3. iPhone : app **TestFlight** → installer **REVEAL**

#### Multijoueur (1 seul iPhone)

- Hôte sur iPhone (app native)
- 2ᵉ joueur : navigateur sur [julie-lepine.github.io/reveal](https://julie-lepine.github.io/reveal/) avec le **code lobby** (même Supabase prod)

### Script vidéo (si Apple redemande 2.1 — 3–5 min, cold start)

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
11. (Optionnel) Profil → Sans pub : montrer le bouton 2,99 € **sans** forcer l’achat review  

### Notes App Review (anglais — coller dans App Review Information)

```
Hello App Review Team,

Please find below the information for REVEAL - Party Games (com.reveal.partygames), the production build (friends + Remove ads IAP). This replaces the obsolete 1.0.0 (build 4).

1. DEVICES TESTED
- iPhone [model], iOS [version] — primary App Store review device
- Samsung Galaxy Z Flip, Android 14 — Android (same Capacitor codebase; Play production submitted)

2. APP PURPOSE & AUDIENCE
REVEAL is a multiplayer party games app for groups of friends (16+). Users create or join a private lobby via a short code, then play synchronized mini-games together in real time. Target audience: adults and older teens at casual social gatherings.

3. SETUP & ACCESS INSTRUCTIONS
- Open the app → Log in / Sign up.
- Demo account (registered user, can host a lobby):
  Email: [review@…]
  Password: […]
- Guest mode (no account): Guest → nickname → enter lobby code from host.
- Multiplayer demo: host on iPhone; second player can join via https://julie-lepine.github.io/reveal/ with the same lobby code.

4. IN-APP PURCHASE
One-time “Remove ads” purchase, 2.99 EUR, product ID reveal_adfree (non-consumable), via RevenueCat / App Store. Restores on the same Apple ID. Please use a Sandbox Apple ID if you test the purchase; the demo account above is for gameplay, not a paid entitlement.

5. EXTERNAL SERVICES
- Supabase (auth, database, Realtime sync)
- Google AdMob (banner ads; GDPR via Google UMP)
- RevenueCat (IAP entitlement sync)
- Resend (password-reset email via Supabase SMTP)
- Google Fonts (Inter)
Cloudflare Turnstile is web-only; disabled in the native iOS app.

6. REGIONAL DIFFERENCES
No regional differences. French UI and content; consistent behavior worldwide.

7. REGULATED INDUSTRY / THIRD-PARTY MATERIAL
Not applicable. Casual party game; no licensed third-party media.

USER-GENERATED CONTENT:
Nicknames, lobby chat, custom game text in private lobbies (code required). Private friend list with lobby-only discovery (registered accounts only; no player search). Private ephemeral party invites between registered friends (tied to a living lobby; no public invite link). Recently-crossed registered players from a shared lobby, shown for 24 hours after the lobby ends (not a search, not suggestions of strangers). Mitigations: client-side word filter, host can remove players, contact@revealthepartygame.fr for abuse reports. No public social feed.

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
| IAP iOS | **Oui** sur ce build — `reveal_adfree`, 2,99 €, unique, RevenueCat |
| UGC | Lobbies **privées** ; liste d’amis **privée** (découverte roster lobby, pas de recherche) ; invitations de soirée **privées** (éphémères, amis inscrits) ; croisés récents **24 h** (inscrits déjà vus en salon, pas une recherche) ; filtre mots ; kick hôte ; **pas de fil public** ; pas de bouton « Signaler » in-app |
| ATT / UMP | **Obligatoire** dans une éventuelle vidéo |
| GitHub | Version web seulement — **ne remplace pas** la démo native |
