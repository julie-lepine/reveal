# Checklist de debug — Signature & Maître de soirée

Audit code du 6 sept 2026. Signature = entitlement `profiles.profile_pack` (IAP 6,99 € / upgrade 4,00 €). Maître de soirée = entitlement `profiles.host_pack` (IAP 9,99 € / 7,00 € / 3,00 €), **pas** le rôle hôte de salon (`lobbies.host_id`).

Objectif : rejouer les parcours, coller le symptôme à une cause connue, et confirmer ou infirmer les bugs ci-dessous.

**Légende** : `[ ]` à cocher · `P0` bloque le palier · `P1` casse un parcours payant · `P2` UX / edge · `P3` docs / légal.

---

## 0. Prérequis avant tout test

Sans ça, les symptômes « ça ne se débloque pas » sont des faux positifs.

- [x] **P0** SQL `feature-host-01-profile-flag.sql` **appliqué en prod** (`docs/DEPLOYMENTS_SQL.md` §22 : colonne `host_pack` utilisée en QA Anrobensy). Sinon : achat RC OK, `fetchProfile` retombe sans `host_pack`, join toujours cap 8, UI Maître jamais « Actif » après refresh serveur.
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

update public.profiles
set host_pack = true,
    profile_pack = true,
    ad_free = true
where id = '9c922f36-e153-4c3f-babc-cfda255ef946';

---

## 1. Bugs confirmés dans le code (à reproduire en priorité)

Tous les tickets code de ce tableau (H-SQL, H-RACE, AV-REPLACE, LEGAL, …) sont **fermés** au 7 sept 2026. Restent hors tableau : recette native IAP, H-KICK-14, Play/ASC.

Hors scope produit (ne pas ouvrir de bug) : **outils de table** (réservés, pas dans le build) · **mots perso** Draw It / Tier Night (couche 3 Signature, pas shippée).

---

## 2. Achats, flags, restore

Tester **un compte par palier** (ne pas mélanger les SKU sur le même UUID sauf parcours upgrade).

### 2.1 Portes d’entrée

- [x] Invité → Forfaits : pas de bouton d’achat, hint connexion.
- [x] Web → achat Signature / Maître / Sans pub : message « dans l’app native ».
- [x ] Inscrit natif sans palier : cartes 2,99 / 6,99 / 9,99 visibles.
- [x] `purchaseProfile` / `purchaseHost` refusent invité et web.

### 2.2 SKU affiché (Forfaits)

| État compte (après refresh serveur) | Signature | Maître |
| ----------------------------------- | --------- | ------ |
| Rien | 6,99 € | 9,99 € |
| Sans pub seul (`ad_free`, pas pack) | **4,00 €** | **7,00 €** |
| Signature (`profile_pack`) | Actif / Inclus | **3,00 €** |
| Maître (`host_pack`) | Inclus dans Maître | Actif |

- [x] Prix et notes d’upgrade collent au tableau. QA **✅** 7 sept 2026 Pages/SQL Anrobensy (SKU-B…F).
- [x] Avec Maître : cartes Signature et Sans pub en badge « Inclus », pas de 2ᵉ achat.
- [ ] `purchaseProfile` court-circuite si `hostPack` déjà true. (natif non joué)

### 2.3 Grant webhook

Après achat, attendre ≤ 8 s (poll 8×1 s) puis **forcer un kill + relance** si besoin.

- [ ] Signature : `profile_pack = true` **et** `ad_free = true`. `host_pack` inchangé (false).
- [ ] Maître (n’importe quel SKU Host) : les **trois** flags true.
- [ ] Pubs coupées (`isAdFree`) dès Signature ou Maître, même si on n’a jamais acheté 2,99.
- [ ] Si poll timeout : message « activation peut prendre une minute » — rouvrir Menu, pas un 2ᵉ achat.

SQL après achat (service_role / Editor) : les trois colonnes, pas seulement l’UI.

### 2.4 Restore / already-owned — **repro P1 RC-RESTORE**

Compte A = Signature déjà en base. Sur un 2ᵉ appareil / après réinstall :

- [ ] Restaurer les achats (Play natif) — non joué, comptes store bloqués.
- [x] **Attendu produit** (simulé SQL/overlay) : Forfaits = Maître Actif + cap 14 si hôte. QA **✅** 7 sept 2026 Anrobensy Pages.
- [x] Overlay + `fetchProfile` : Maître reste visible si `host_pack` false ; F5 enlève l’overlay ; SQL `host_pack` true le rétablit.
- [x] Contrôle : overlay n’écrit pas `host_pack` (SQL resté false pendant B/C).

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
- [x] **P2 ID-OLD** : refund simulé SQL `true → false → true` : couleur / photo / emoji extra **conservés**. QA **✅** 7 sept 2026 Anrobensy (lime · 🐉 · photo). Refund Play non joué.

---

## 3. Identité Signature (couleur, emoji, badge, photo)

Précondition : `profile_pack` **ou** `host_pack` true en base (le serveur gate sur `profile_pack` ; le webhook Maître pose les deux).

### 3.1 Menu → Profil

- [x] Aperçu : anneau or, badge ✦, couleur appliquée.
- [x] 8 puces couleur ; sans pack → tap = Forfaits.
- [x] 18 emojis gratuits utilisables sans pack ; extras verrouillés → Forfaits.
- [x] Photo : crop cercle, pinch/drag, JPEG, fallback emoji si URL cassée. Crop + JPEG : QA **✅** AV-REPLACE 7 sept 2026. Fallback `onerror` non rejoué (contrat = ne pas casser l’URL).
- [x] Retirer la photo : emoji revient partout. QA **✅** 7 sept 2026 AV-REPLACE (SQL `path=null` `rev=0`, F5 OK).
- [ ] Invité : extras / photo / carnet masqués ou teasés, jamais d’upload.

### 3.2 Surfaces d’affichage (même joueur Signature)

Vérifier **nom coloré + ✦ + photo** (ou emoji) sur :

- [x] Lobby (pastille + nom) — photo B + cache-bust. QA **✅** 7 sept 2026 AV-REPLACE.
- [ ] Chat
- [ ] Scores / podium / scores de soirée
- [ ] Amis / croisés 24 h
- [ ] Prep + in-game : Hot Take, Speed Vote, Tier Night, Trivia, Consensus, Dilemma, TruthMeter, Spot the fake

Sans pack : pas de couleur, pas de ✦, pas de photo (même si un client envoie les champs — triggers stamp).

### 3.3 Overlay vs serveur — **repro P2 ID-OVERLAY**

QA **✅** 7 sept 2026 Pages/SQL Anrobensy (`__revealPremium`) : overlay Signature + `profile_pack=false` → lime visible → refresh ne wipe plus → grant SQL → replay `name_color=lime` → F5 OK. Achat Play natif **non exécuté**. Badge lobby partagé toujours le snapshot SQL (hors scope).

1. Acheter Signature, **immédiatement** choisir une couleur avant la fin du poll.
2. [x] UI Profil montre la couleur.
3. [x] Relire `profiles.name_color` : **null** tant que le webhook n’a pas posé `profile_pack`.
4. [ ] Lobby : `lobby_members.signature` encore false → pas de badge chez les autres. (hors scope)
5. [x] Après grant SQL + refresh : couleur persistée ; F5 OK.

### 3.4 Écriture locale vs inclusion Maître

`setLocalNameColor` / `setLocalAvatar` / `uploadProfileAvatarBlob` testent `user.profilePack !== true`, **pas** `isProfilePack()`.

- [x] Compte Maître **normal** (flags SQL `profile_pack` + `host_pack`) : couleur / photo OK. QA **✅** Anrobensy (lime · photo · ID-OVERLAY / AV-REPLACE). Webhook Play non joué.
- [ ] SQL manuel `host_pack = true` **sans** `profile_pack` : Forfaits / carnet UI débloqués, **couleur et photo refusées** localement, RPC carnet `signature_locked`.

### 3.5 Photo — **repro P2 AV-REPLACE / AV-STORAGE**

**AV-STORAGE** : patch SQL `feature-profile-av-storage.sql` (owner + `profile_pack OR host_pack`). QA **✅** 7 sept 2026 Pages/SQL Anrobensy (sans pack 403 · Signature OK · Maître seul OK · retrait packs 403).

**AV-REPLACE** : `uploadProfileAvatarBlob` n’appelle plus `remove` avant l’upload ; remplacement = `upload({ upsert: true })` sur `{uid}/avatar.jpg` puis `updateProfileAvatar`. QA **✅** 7 sept 2026 Pages/SQL Anrobensy (échec Offline : A + `rev` inchangés · B `rev=2` Profil+lobby · première photo · Retirer `path=null`).

- [x] Remplacer une photo existante (réseau coupé au moment de l’upload) : **A reste visible**, `avatar_rev` inchangé, pas de 404. (**AV-REPLACE**) QA **✅** 7 sept 2026 Anrobensy.
- [x] Compte inscrit **sans** pack : upload Storage `{uid}/avatar.jpg` depuis un client (hors UI) → **refusé** après AV-STORAGE. QA **✅** 7 sept 2026 Anrobensy.
- [ ] Suppression de compte : ligne `profiles` + `signature_evenings` cascade ; **objet Storage** peut rester (orphan, hors scope).

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
| Hôte dissolve | Tous les Signature du salon archivent | **OK** (04c) QA ✅ 7 sept 2026 |
| Kick | Le kické archive | **04b + client** : jeton SQL + archive même si RLS cache le salon |
| Accueil → quitter membership serveur | Archive si draft / live | **04d** QA **✅** 7 sept 2026 |
| Quitter **sans** avoir joué | Rien | OK (`hasEveningStatsActivity` false) |
| Rang introuvable (joueur local absent du standing) | Skip silencieux | Payload null |

Repro C-KICK (après SQL 04b) : 2 comptes Signature, une manche, kick du non-hôte → carnet du kické **contient** la soirée.

Repro C-DISSOLVE (après SQL 04c) : 2 comptes Signature + 1 sans pack, une manche, l’hôte ferme le salon → carnets Signature **contiennent** la soirée ; sans pack : rien.

### 4.3 Amis au **read** time

- [ ] Archiver avec un ami dans le salon → nom visible.
- [ ] Unfriend → relire le carnet : le prénom **disparaît** (voulu).
- [ ] Pas de `lobby_id` dans la réponse RPC (outils réseau).

---

## 5. Lobby 8 vs 14 (Maître de soirée)

Le cap 14 s’applique au **salon dont l’hôte a `host_pack`**, pas au joiner.

### 5.1 Compteur et copy

| Qui | Salon hôte Maître, 9 joueurs | Attendu |
| --- | ---------------------------- | ------- |
| Hôte Maître | `9 / 14` + hint 13 invités | |
| Membre inscrit sans Maître | `9 / 14`, pas d’upsell | |
| Invité | `9 / 14`, pas d’upsell | |
| Membre qui a Maître (pas hôte) | `9 / 14`, pas d’upsell | |

- [ ] Accueil, hôte Maître hors salon : hint sous « Créer un lobby ».
- [ ] Accueil, pas Maître : pas de hint 13 joueurs.
- [ ] Menu → Soirée → Joueurs : même cap que le lobby (`getCurrentLobbySeatCap()`).
- [x] **H-UI-CAP** : invité voit `14 / 14` (QA 7 sept 2026). Compteur `14 / 14` validé salon non démarré (même session).

### 5.2 Join par code

- [x] Hôte **sans** Maître : 9ᵉ joueur (code) → « Nombre de joueurs max atteint ». QA **✅** 7 sept 2026 H-RACE (`RMX7KX` 8/8).
- [x] Hôte **avec** Maître : 9ᵉ … 14ᵉ OK ; 15ᵉ refusé (QA 7 sept 2026, salon 14/14).
- [x] Le 9ᵉ n’a **pas** besoin d’être Maître.
- [x] **P0 H-SQL** : colonne `host_pack` en prod (HOST-01). Join : si `select host_pack` échoue, plus de faux cap 8 client — l’INSERT va au trigger H-RACE. QA colonne **✅** (Anrobensy).
- [x] **P2 H-RACE** : SQL + runbook **✅** · QA Pages **✅** 7 sept 2026 Anrobensy : 8/8 → 9ᵉ refusé · Maître cap 14 → 9ᵉ OK · cap redescendu 9/8 conservés → 10ᵉ refusé. Concurrent 2 appareils **non joué**.

### 5.3 Invitations amis — **H-INVITE** ✅ / **H-INVITE-FULL** ✅

**H-INVITE** (accept) OK : le 9ᵉ–14ᵉ entre ; un 15ᵉ qui **accepte** est refusé (« Cette soirée est complète. »).

**H-INVITE-FULL** (envoi) : à 14/14 (ou 8/8), bouton **Soirée complète**, l’invite ne part pas. Overbooking des places restantes inchangé (13/14 → N invites OK).

QA 7 sept 2026 : hôte Maître, 13 autres joueurs invités OK. Repro avant patch : Inviter encore actif à 14/14. Après HOST-03 : envoi refusé.

1. Hôte Maître, 8 membres déjà là (join par code).
2. Envoyer une invitation à un 9ᵉ ami → entre (siège 9/14).
3. [x] **H-INVITE-FULL** repro : à 14/14, l’hôte envoie encore une invite (avant HOST-03).
4. [x] Après HOST-03 : à 14/14, Inviter → « Soirée complète » / RPC `lobby_invite_full` (QA 7 sept 2026).

Variante encore utile : salon à 8, hôte **sans** Maître → refus d’acceptation **correct** ; même gate d’envoi après HOST-03.

### 5.4 Transfert / refund en cours de salon — **H-TRANSFER** ✅ / **H-INVITE-TRANSFER** ✅

- [x] Hôte Maître, 10 joueurs, transfert vers un membre **sans** pack : les 10 restent ; 11ᵉ join par code refusé (cap 8). QA 7 sept 2026.
- [x] Refund Maître pendant un salon (simulé SQL `host_pack=false`, 9 membres pas 12) : membres inchangés ; nouveau join cap 8. QA **✅** 7 sept 2026 H-RACE (`9/8`, 10ᵉ refusé). Refund Play non joué.
- [ ] Claim hôte stale / acting host : **aucun** lien avec le pack. Les contrôles de manche ne doivent pas exiger `host_pack`.
- [x] **H-INVITE-TRANSFER** : hôte Maître, salon à 10, invite pending vers un 11ᵉ → transfert vers non-Maître. L’ami tape Rejoindre → « Cette soirée est complète. » QA 7 sept 2026.

### 5.5 Jeux à 9–14 joueurs (régression layout) ✅

Pas de `maxPlayers` jeu à 8. QA **✅** 7 sept 2026, salon 14/14 lancé :

- [x] Grille lobby 14 pastilles (wrap, pas de crop).
- [x] Scores de soirée + podiums lisibles.
- [x] Spot the fake (min 3, pas de max) : deal / vote / liste vivants.
- [x] Tier Night « classe le groupe » : 14 noms.
- [x] Chat + random game.
- [x] Prep « tous prêts » avec 14.

### 5.6 Kick à 14 — **H-KICK-14**

QA : **en partie à 14**, l’hôte ne peut plus kick de joueurs.

Rappel produit : kick autorisé **lobby d’attente** et **entre deux jeux** (`canManageLobbyRoster` / RPC `kick_lobby_member`), **pas** mid-manche.

- [ ] **H-KICK-14** : salon Maître 14/14, soirée lancée. Entre deux jeux (pastilles lobby **et** Menu → Soirée → Joueurs) : boutons Retirer absents, ou tap → refus. Distinguer du refus mid-manche (voulu). Contrôle à 8 joueurs : le kick entre deux jeux doit encore marcher.

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

- [x] `legalContent.js` + page havefuncorp : Maître 9,99 / 7,00 / 3,00. QA **✅** 7 sept 2026 ([privacy](https://havefuncorp.fr/reveal/privacy) + in-app).
- [x] `docs/LEGAL_SITE_OVH.md` : 12,99 € retiré.
- [ ] Fiches Play / ASC : ne pas promettre outils de table ni mots perso.
- [ ] RevenueCat : entitlements `ad_free`, `profile`, `host` ; SKUs alignés Play + iOS.

---

## 10. Ordre de debug suggéré (une session)

1. Vérifier SQL `host_pack` en prod (**H-SQL**) — **fait** (colonne + Anrobensy).
2. Compte test Maître (SQL Editor si IAP pas collé) : créer salon, join code 9ᵉ, invitation ami 9ᵉ (**H-INVITE**).
3. 2e téléphone **invité** : lire `n / 8` vs `n / 14` (**H-UI-CAP**).
4. Deux comptes Signature, une manche, dissolve + kick (**C-DISSOLVE**, **C-KICK**).
5. IAP sandbox : Sans pub → Signature 4 € → Maître 3 €, pubs, Profil, cap.
6. Restore Maître sur un compte déjà Signature (**RC-RESTORE**).
7. Refund upgrade 3 € vs 9,99 (table §2.5).
8. Photo replace + surfaces d’affichage.
9. Transfert d’hôte 10 joueurs (**H-TRANSFER**, **H-INVITE-TRANSFER** si une invite est pending).
10. Salon 14/14 lancé : kick **entre deux jeux** (**H-KICK-14**). Mid-manche = refus voulu.

Pour chaque fail : noter **appareil**, **rôle salon**, **flags SQL**, **SKU**, **horaire webhook**, capture Forfaits + compteur lobby.

---

## 11. Fichiers utiles

| Zone | Fichiers |
| ---- | -------- |
| Flags client | `js/core/entitlements.js`, `js/core/supabaseProfile.js`, `js/core/state.js` |
| IAP | `js/core/purchases.js`, `data/revenueCatConfig.js`, `supabase/functions/revenuecat-webhook/index.ts` |
| Cap 8/14 | `js/config/lobbyLifecycle.js`, `js/screens/lobby.js`, `js/core/supabaseLobby.js` |
| Invites | `supabase/feature-host-03-send-invite-cap.sql` (send à salon plein) · `feature-host-02-invite-cap.sql` (`accept_lobby_invite`) · snapshot historique `feature-friends-02.sql` |
| Identité | `js/core/signatureUi.js`, `js/core/auth.js`, `supabase/feature-profile-03-identity.sql`, `feature-profile-05-avatar.sql` |
| Carnet | `js/core/signatureCarnet.js`, `js/core/lobby.js`, `supabase/feature-profile-04-carnet.sql` |
| UI Forfaits | `js/core/hostPackUi.js`, `js/core/profilePackUi.js`, `js/core/adFreeUi.js` |
| Contrat | `docs/LAUNCH.md` palier Profil / Maître, `docs/DEPLOYMENTS_SQL.md` §22 |
