# Checklist de debug — Signature & Maître de soirée

Audit code du 6 sept 2026. Signature = entitlement `profiles.profile_pack` (IAP 6,99 € / upgrade 4,00 €). Maître de soirée = entitlement `profiles.host_pack` (IAP 9,99 € / 7,00 € / 3,00 €), **pas** le rôle hôte de salon (`lobbies.host_id`).

Objectif : rejouer les parcours, coller le symptôme à une cause connue, et confirmer ou infirmer les bugs ci-dessous.

**Légende** : `[ ]` à cocher · `P0` bloque le palier · `P1` casse un parcours payant · `P2` UX / edge · `P3` docs / légal.

---

## 0. Prérequis avant tout test

Sans ça, les symptômes « ça ne se débloque pas » sont des faux positifs.

- [x] **P0** SQL `feature-host-01-profile-flag.sql` **appliqué en prod** (`docs/DEPLOYMENTS_SQL.md` §22 encore ⏳). Sinon : achat RC OK, `fetchProfile` retombe sans `host_pack`, join toujours cap 8, UI Maître jamais « Actif » après refresh serveur.
- [x] SQL Signature déjà en prod : `feature-profile-01` … `05` (flag, identité, emojis, carnet, avatar).
- [x] Webhook RevenueCat déployé avec le patch Host (`profile_pack` + `ad_free` + `host_pack`).
- [x] Compte **inscrit** (pas invité) sur **app native** (pas GitHub Pages).
- [x] Distinguer les deux « hôtes » :
  - **Rôle salon** : couronne, lancer un jeu, kick, dissolve, scores de soirée.
  - **Pack Maître** : 14 sièges si **et seulement si** le `host_id` du lobby a `host_pack`. Un Maître invité dans le salon de quelqu’un d’autre n’élargit pas le lobby.

Contrôle SQL lecture seule :

```sql
select id, display_name, ad_free, profile_pack, host_pack, name_color, avatar_path
from public.profiles
where id = '<uuid>';
```

---

## 1. Bugs confirmés dans le code (à reproduire en priorité)

Ces écarts sont lus dans le code, pas des hypothèses. Cocher `repro OK` / `pas vu` / `déjà patché`.

| Sev | ID | Symptôme attendu | Cause |
| --- | -- | ---------------- | ----- |
| P0 | **H-SQL** | Achat Maître : store OK, Forfaits reste « Débloquer », lobby reste `/ 8` | Colonne `host_pack` absente → `fetchProfile` fallback `host_pack: false` |
| P0 | **H-INVITE** | Hôte Maître, 8+ dans le salon : invitation ami → « Cette soirée est complète » | **Patch repo** : [`feature-host-02-invite-cap.sql`](../supabase/feature-host-02-invite-cap.sql) — **⏳ à coller en prod**. Tant que friends-02 n’est pas remplacé, `accept_lobby_invite` reste `>= 8`. |
| P1 | **H-UI-CAP** | Invité / membre voit `n / 8` alors que l’hôte Maître a 9–14 joueurs | Compteur lobby = `lobbyMaxPlayers(isLobbyHost() && isHostPack())` **local**, pas le pack de l’hôte |
| P1 | **H-UPSELL** | Membres d’un salon déjà à 14 voient encore « Tu veux un + grand lobby ? » | Upsell si `!isHostPack()` local ; ils ne peuvent pas élargir ce salon |
| P1 | **C-KICK** | Signature kické → soirée absente du carnet | `handleKickedFromLobby` n’appelle pas `archiveSignatureEveningBeforeLeave` |
| P1 | **C-DISSOLVE** | Hôte ferme le salon → seul **son** carnet archive ; les autres Signature perdent la soirée | `dissolveLobbyAsHost` archive uniquement l’appelant, tant qu’il est encore membre. Pas de trigger SQL sur DELETE lobby |
| P1 | **C-HOME** | Quitter depuis Accueil (membership serveur, cache non hydraté) → pas d’archive | `leaveLobbyMembershipFromServer` ne câble pas l’archive |
| P1 | **RC-RESTORE** | Compte déjà Signature, restore / already-owned Maître → Signature OK, Maître pas actif jusqu’au webhook | `refreshPremiumAfterStore` **break** dès que `profilePack` est true ; overlay store réappliqué seulement si les **3** flags sont false |
| P1 | **RC-SKU-ADF** | `profileSkuForUser` lit `user.adFree` (colonne), pas `isAdFree()` | Un compte Signature sans `ad_free` en base paierait 6,99 au lieu de 4,00 (cas SQL manuel / grant incomplet) |
| P2 | **ID-OLD** | Refund Signature puis rachat : couleur / photo / emoji extra **effacés** au grant | Triggers cosmetics / avatar lisent `old.profile_pack` sur UPDATE |
| P2 | **ID-OVERLAY** | Après achat, couleur « sauvée » puis disparue ; badge lobby en retard vs Menu → Profil | Overlay store débloque l’UI avant le webhook ; `upsertProfile` est strippé tant que `profile_pack` est false |
| P2 | **AV-STORAGE** | Utilisateur inscrit **sans** Signature peut uploader `{uid}/avatar.jpg` public | Policies Storage `avatars` : owner path only, **pas** de check `profile_pack` |
| P2 | **AV-REPLACE** | Remplacement photo : `remove` puis `upload` ; échec upload → plus de fichier, profil pointe encore le path | `uploadProfileAvatarBlob` |
| P2 | **H-RACE** | Deux joins simultanés passent le cap 8/14 | Gate capacité **client-only** (pas de contrainte SQL sur le count) |
| P2 | **H-TRANSFER** | Transfert d’hôte vers un non-Maître : sièges 9–14 restent, nouveaux joins refusés à 8 | Join relit le `host_pack` du **nouveau** `host_id` |
| P3 | **LEGAL** | Privacy in-app / site : Maître 9,99 absent ; `LEGAL_SITE_OVH.md` cite encore 12,99 € | `data/legalContent.js` + docs |

Hors scope produit (ne pas ouvrir de bug) : **outils de table** (réservés, pas dans le build) · **mots perso** Draw It / Tier Night (couche 3 Signature, pas shippée).

---

## 2. Achats, flags, restore

Tester **un compte par palier** (ne pas mélanger les SKU sur le même UUID sauf parcours upgrade).

### 2.1 Portes d’entrée

- [ ] Invité → Forfaits : pas de bouton d’achat, hint connexion.
- [ ] Web → achat Signature / Maître / Sans pub : message « dans l’app native ».
- [ ] Inscrit natif sans palier : cartes 2,99 / 6,99 / 9,99 visibles.
- [ ] `purchaseProfile` / `purchaseHost` refusent invité et web.

### 2.2 SKU affiché (Forfaits)

| État compte (après refresh serveur) | Signature | Maître |
| ----------------------------------- | --------- | ------ |
| Rien | 6,99 € | 9,99 € |
| Sans pub seul (`ad_free`, pas pack) | **4,00 €** | **7,00 €** |
| Signature (`profile_pack`) | Actif / Inclus | **3,00 €** |
| Maître (`host_pack`) | Inclus dans Maître | Actif |

- [ ] Prix et notes d’upgrade collent au tableau.
- [ ] Avec Maître : cartes Signature et Sans pub en badge « Inclus », pas de 2ᵉ achat.
- [ ] `purchaseProfile` court-circuite si `hostPack` déjà true.

### 2.3 Grant webhook

Après achat, attendre ≤ 8 s (poll 8×1 s) puis **forcer un kill + relance** si besoin.

- [ ] Signature : `profile_pack = true` **et** `ad_free = true`. `host_pack` inchangé (false).
- [ ] Maître (n’importe quel SKU Host) : les **trois** flags true.
- [ ] Pubs coupées (`isAdFree`) dès Signature ou Maître, même si on n’a jamais acheté 2,99.
- [ ] Si poll timeout : message « activation peut prendre une minute » — rouvrir Menu, pas un 2ᵉ achat.

SQL après achat (service_role / Editor) : les trois colonnes, pas seulement l’UI.

### 2.4 Restore / already-owned — **repro P1 RC-RESTORE**

Compte A = Signature déjà en base. Sur un 2ᵉ appareil / après réinstall :

- [ ] Restaurer les achats alors que Maître est aussi sur le même compte Play/Apple.
- [ ] **Attendu produit** : Forfaits = Maître Actif + cap 14 si hôte.
- [ ] **Bug code** : Signature s’affiche, Maître reste off jusqu’à ce que le webhook `host_pack` arrive. Si le webhook est lent/absent, Maître ne revient pas.
- [ ] Contrôle : `profiles.host_pack` vs `state.user.hostPack` (localStorage `reveal-app-state`).

Même scénario via « déjà acheté » (error already-owned) pendant `purchaseHost`.

### 2.5 Refunds (sandbox / RC dashboard)

| Produit remboursé | `host_pack` | `profile_pack` | `ad_free` |
| ----------------- | ----------- | -------------- | --------- |
| `reveal_profile` | — | false | false |
| `reveal_profile_upgrade` | — | false | **gardé** |
| `reveal_host` (9,99) | false | false | false |
| `reveal_host_upgrade_profile` (3 €) | false | **gardé** | **gardé** |
| `reveal_host_upgrade_adfree` (7 €) | false | **false** | **gardé** |

- [ ] Rejouer chaque ligne : Menu, pubs, couleur, carnet, cap lobby.
- [ ] **P2 ID-OLD** : refund Signature → racheter tout de suite → couleur / photo encore là **ou** wipe au grant.

---

## 3. Identité Signature (couleur, emoji, badge, photo)

Précondition : `profile_pack` **ou** `host_pack` true en base (le serveur gate sur `profile_pack` ; le webhook Maître pose les deux).

### 3.1 Menu → Profil

- [ ] Aperçu : anneau or, badge ✦, couleur appliquée.
- [ ] 8 puces couleur ; sans pack → tap = Forfaits.
- [ ] 18 emojis gratuits utilisables sans pack ; extras verrouillés → Forfaits.
- [ ] Photo : crop cercle, pinch/drag, JPEG, fallback emoji si URL cassée.
- [ ] Retirer la photo : emoji revient partout.
- [ ] Invité : extras / photo / carnet masqués ou teasés, jamais d’upload.

### 3.2 Surfaces d’affichage (même joueur Signature)

Vérifier **nom coloré + ✦ + photo** (ou emoji) sur :

- [ ] Lobby (pastille + nom)
- [ ] Chat
- [ ] Scores / podium / scores de soirée
- [ ] Amis / croisés 24 h
- [ ] Prep + in-game : Hot Take, Speed Vote, Tier Night, Trivia, Consensus, Dilemma, TruthMeter, Spot the fake

Sans pack : pas de couleur, pas de ✦, pas de photo (même si un client envoie les champs — triggers stamp).

### 3.3 Overlay vs serveur — **repro P2 ID-OVERLAY**

1. Acheter Signature, **immédiatement** choisir une couleur avant la fin du poll.
2. [ ] UI Profil montre la couleur.
3. [ ] Relire `profiles.name_color` : souvent **null** tant que le webhook n’a pas posé `profile_pack`.
4. [ ] Lobby : `lobby_members.signature` encore false → pas de badge chez les autres.
5. [ ] Après webhook + Realtime : badge et couleur apparaissent. Si l’utilisateur a quitté l’écran, re-taper la couleur.

### 3.4 Écriture locale vs inclusion Maître

`setLocalNameColor` / `setLocalAvatar` / `uploadProfileAvatarBlob` testent `user.profilePack !== true`, **pas** `isProfilePack()`.

- [ ] Compte Maître **normal** (webhook a posé `profile_pack`) : couleur / photo OK.
- [ ] SQL manuel `host_pack = true` **sans** `profile_pack` : Forfaits / carnet UI débloqués, **couleur et photo refusées** localement, RPC carnet `signature_locked`.

### 3.5 Photo — **repro P2 AV-REPLACE / AV-STORAGE**

- [ ] Remplacer une photo existante (réseau coupé au moment de l’upload) : ancienne image disparue, pastille cassée.
- [ ] Compte inscrit **sans** pack : upload Storage `{uid}/avatar.jpg` depuis un client (hors UI) → fichier public, profil `avatar_path` null. Confirmer si la policy est encore ouverte.
- [ ] Suppression de compte : ligne `profiles` + `signature_evenings` cascade ; **objet Storage** peut rester (orphan).

---

## 4. Carnet Signature

Archive **uniquement** si : inscrit + pack + encore **membre** du lobby + `hasEveningStatsActivity()` + rang local 1–16.

### 4.1 Happy path

1. Compte Signature, créer un salon, jouer **au moins une partie** (score / stats soirée).
2. Membre : Quitter le lobby (confirm).
3. [ ] Menu → Profil → Mon carnet : soirée (date, jeux, rang, score).
4. [ ] Prénoms des **amis encore amis** seulement (pas le code lobby).
5. [ ] Stats : winrate, courbe, barres 1er/2e/3e+, jeu favori.
6. [ ] Carte share 9:16 : **sans** prénoms d’amis.
7. [ ] Teaser si pas Signature.
8. [ ] 21ᵉ soirée : les 20 plus récentes (FIFO côté liste).

### 4.2 Chemins qui **ne** doivent pas archiver (ou bug)

| Action | Attendu produit | Code actuel |
| ------ | --------------- | ----------- |
| Quitter volontaire (membre) | Archive | OK (`leaveLobby` → `archiveSignatureEveningBeforeLeave`) |
| Hôte dissolve | Tous les Signature du salon archivent | **Bug C-DISSOLVE** : hôte seul |
| Kick | Le kické archive | **Bug C-KICK** : non |
| Accueil → quitter membership serveur | Archive | **Bug C-HOME** : non |
| Quitter **sans** avoir joué | Rien | OK (`hasEveningStatsActivity` false) |
| Rang introuvable (joueur local absent du standing) | Skip silencieux | Payload null |

Repro C-DISSOLVE :

1. 2 comptes Signature + 1 sans pack. Jouer une manche.
2. Hôte ferme le salon.
3. [ ] Carnet hôte : soirée présente.
4. [ ] Carnet de l’autre Signature : **absente** (bug) vs devrait être là.

Repro C-KICK : même setup, kick du Signature → carnet vide.

### 4.3 Amis au **read** time

- [ ] Archiver avec un ami dans le salon → nom visible.
- [ ] Unfriend → relire le carnet : le prénom **disparaît** (voulu).
- [ ] Pas de `lobby_id` dans la réponse RPC (outils réseau).

---

## 5. Lobby 8 vs 14 (Maître de soirée)

Le cap 14 s’applique au **salon dont l’hôte a `host_pack`**, pas au joiner.

### 5.1 Compteur et copy

| Qui | Salon hôte Maître, 9 joueurs | Attendu | Code |
| --- | ---------------------------- | ------- | ---- |
| Hôte Maître | `9 / 14` + hint 13 invités | OK | `isHost && hostPack` |
| Membre inscrit sans Maître | devrait `9 / 14` | **voit `9 / 8` + upsell** | H-UI-CAP / H-UPSELL |
| Invité | devrait `9 / 14` | **voit `9 / 8` + upsell** | idem |
| Membre qui a Maître (pas hôte) | `9 / 14`, pas d’upsell | cap encore 8 (il n’est pas hôte) ; upsell **masqué** parce que `isHostPack()` local | copy trompeuse |

- [ ] Accueil, hôte Maître hors salon : hint sous « Créer un lobby ».
- [ ] Accueil, pas Maître : pas de hint 13 joueurs.
- [ ] Menu → Soirée → Joueurs : même cap que le lobby (`lobbyMaxPlayers(isLobbyHost() && isHostPack())`) — **même biais local**.

### 5.2 Join par code

- [ ] Hôte **sans** Maître : 9ᵉ joueur (code) → « Nombre de joueurs max atteint ».
- [ ] Hôte **avec** Maître : 9ᵉ … 14ᵉ OK ; 15ᵉ refusé.
- [ ] Le 9ᵉ n’a **pas** besoin d’être Maître.
- [ ] **P0 H-SQL** : si `select host_pack` échoue, le join se comporte comme cap 8 (erreur avalée → `hostPack = false`).
- [ ] **P2 H-RACE** : deux appareils joignent le 8ᵉ/14ᵉ siège en même temps (optionnel, difficile).

### 5.3 Invitations amis — **H-INVITE** (patch repo, SQL ⏳)

Après apply `feature-host-02-invite-cap.sql` :

1. Hôte Maître, 8 membres déjà là (join par code).
2. Envoyer une invitation à un 9ᵉ ami (`send_lobby_invite` **ne** check **pas** le count → l’invite part).
3. L’ami accepte.
4. [ ] **Attendu** : il entre (siège 9/14). 15ᵉ → « Cette soirée est complète. »
5. [ ] **Sans** le SQL : encore `lobby_invite_full` à 8.

Variante : salon à 8, hôte **sans** Maître → refus d’acceptation **correct**.

Transfert d’hôte vers un non-Maître pendant qu’une invite est pending : l’acceptation doit alors caper à 8 (le helper relit `host_id` actuel).

### 5.4 Transfert / refund en cours de salon — **H-TRANSFER**

- [ ] Hôte Maître, 10 joueurs, transfert vers un membre **sans** pack : les 10 restent ; 11ᵉ join par code refusé (cap 8).
- [ ] Refund Maître pendant un salon à 12 : membres inchangés ; nouveau join cap 8.
- [ ] Claim hôte stale / acting host : **aucun** lien avec le pack. Les contrôles de manche ne doivent pas exiger `host_pack`.

### 5.5 Jeux à 9–14 joueurs (régression layout)

Pas de `maxPlayers` jeu à 8. Vérifier quand même overflow / perf :

- [ ] Grille lobby 14 pastilles (wrap, pas de crop).
- [ ] Scores de soirée + podiums lisibles.
- [ ] Spot the fake (min 3, pas de max) : deal / vote / liste vivants.
- [ ] Tier Night « classe le groupe » : 14 noms.
- [ ] Chat + random game.
- [ ] Prep « tous prêts » avec 14.

---

## 6. Matrice d’inclusion (ne pas re-payerwaller)

| Surface | Invité | Inscrit | Sans pub | Signature | Maître |
| ------- | ------ | ------- | -------- | --------- | ------ |
| Pseudo + 18 emojis | oui | oui | oui | oui | oui |
| Amis / invites / croisés | non | oui | oui | oui | oui |
| Lobby 8 | oui | oui | oui | oui | oui |
| Pubs native | oui | oui | non | non | non |
| Couleur / ✦ / extras / photo / carnet | non | non | non | oui | oui |
| Lobby 14 (si **hôte** du salon) | non | non | non | non | oui |
| Kick / lancer / dissolve | si hôte salon | si hôte salon | idem | idem | idem |

- [ ] Aucun paywall sur les lignes « oui » du palier inférieur.
- [ ] Guest picker Accueil : **pas** d’extras Signature (`includeSignatureExtras: false`).
- [ ] Picker lobby : extras visibles **verrouillés** pour inscrit sans pack (`needSignature` → Forfaits). Incohérence assumée vs Accueil.

---

## 7. Auth, session, spoof client

- [ ] Logout : `adFree` / `profilePack` / `hostPack` / couleur / avatar cleared.
- [ ] Relogin : flags relus depuis `profiles`, pas depuis l’ancien localStorage seul (le merge `loadState` peut réafficher un palier **le temps** du sync — vérifier qu’un refresh réseau écrase un spoof).
- [ ] Spoof `localStorage` `user.profilePack = true` : UI Profil / carnet teaser débloqués ; RPC `archive` / `list` → `signature_locked` ; couleur serveur null.
- [ ] Guest : même si state dit `hostPack: true`, `isHostPack()` false.

---

## 8. Contrôles serveur (si accès SQL / logs)

- [ ] Trigger `profiles_protect_profile_pack` / `profiles_protect_host_pack` : UPDATE client des flags **ignoré**.
- [ ] `lobby_members.signature` recopié depuis `profiles.profile_pack` (pas `host_pack` seul).
- [ ] Grant Maître sans `profile_pack` (SQL) : snapshot salon **sans** badge (stamp lit `profile_pack`).
- [ ] Webhook `app_user_id` non-UUID / `$RC…` → skip 200, flags inchangés.
- [ ] Webhook UPDATE 0 rows (profil pas encore créé) → 200, grant perdu jusqu’à un nouvel event.
- [ ] `list_signature_carnet` : pas de `lobby_id`.

---

## 9. Légal / stores / docs (P3)

- [ ] `legalContent.js` + page havefuncorp : Maître 9,99 / 7,00 / 3,00 encore **absents**.
- [ ] `docs/LEGAL_SITE_OVH.md` : encore **12,99 €** (prix mort).
- [ ] Fiches Play / ASC : ne pas promettre outils de table ni mots perso.
- [ ] RevenueCat : entitlements `ad_free`, `profile`, `host` ; SKUs alignés Play + iOS.

---

## 10. Ordre de debug suggéré (une session)

1. Vérifier SQL `host_pack` en prod (**H-SQL**) — 2 min.
2. Compte test Maître (SQL Editor si IAP pas collé) : créer salon, join code 9ᵉ, invitation ami 9ᵉ (**H-INVITE**).
3. 2e téléphone **invité** : lire `n / 8` vs `n / 14` (**H-UI-CAP**).
4. Deux comptes Signature, une manche, dissolve + kick (**C-DISSOLVE**, **C-KICK**).
5. IAP sandbox : Sans pub → Signature 4 € → Maître 3 €, pubs, Profil, cap.
6. Restore Maître sur un compte déjà Signature (**RC-RESTORE**).
7. Refund upgrade 3 € vs 9,99 (table §2.5).
8. Photo replace + surfaces d’affichage.
9. Transfert d’hôte 10 joueurs (**H-TRANSFER**).

Pour chaque fail : noter **appareil**, **rôle salon**, **flags SQL**, **SKU**, **horaire webhook**, capture Forfaits + compteur lobby.

---

## 11. Fichiers utiles

| Zone | Fichiers |
| ---- | -------- |
| Flags client | `js/core/entitlements.js`, `js/core/supabaseProfile.js`, `js/core/state.js` |
| IAP | `js/core/purchases.js`, `data/revenueCatConfig.js`, `supabase/functions/revenuecat-webhook/index.ts` |
| Cap 8/14 | `js/config/lobbyLifecycle.js`, `js/screens/lobby.js`, `js/core/supabaseLobby.js` |
| Invites | `supabase/feature-host-02-invite-cap.sql` (remplace `accept_lobby_invite`) · snapshot historique `feature-friends-02.sql` |
| Identité | `js/core/signatureUi.js`, `js/core/auth.js`, `supabase/feature-profile-03-identity.sql`, `feature-profile-05-avatar.sql` |
| Carnet | `js/core/signatureCarnet.js`, `js/core/lobby.js`, `supabase/feature-profile-04-carnet.sql` |
| UI Forfaits | `js/core/hostPackUi.js`, `js/core/profilePackUi.js`, `js/core/adFreeUi.js` |
| Contrat | `docs/LAUNCH.md` palier Profil / Maître, `docs/DEPLOYMENTS_SQL.md` §22 |
