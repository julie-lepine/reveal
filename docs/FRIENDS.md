# FEATURE-FRIENDS — Checklist d’implémentation

Cadrage produit validé. On avance **un palier à la fois**. On ne commence pas le palier N+1 tant que les cases du palier N ne sont pas cochées (sauf mention « peut chevaucher »).

Légal store : *No public social feed*. Découverte = roster du lobby vivant, plus (Phase 4) joueurs **déjà croisés** dans un lobby il y a moins de 24 h. Pas de recherche de joueurs.

---

## Règles figées (ne pas rediscuter en cours de route)

- Comptes **inscrits seulement** (`isLoggedIn()` = email / Facebook, pas invité anonyme).
- Canal = **notification privée**. Jamais le chat lobby (`lobby_messages`).
- Refus = **suppression** de la ligne `friend_requests`. Côté émetteur, le bouton redevient **+ Ami**, **sans explication**.
- Identité = `auth.users.id` (UUID). Pseudo / emoji **toujours relus** depuis `profiles`.
- Invitations de lobby = **FEATURE-FRIENDS-02** (Phase 2). Hors v1.
- Annuler une demande envoyée = **FEATURE-FRIENDS-03** (Phase 3).
- Croisés récents (24 h) = **FEATURE-FRIENDS-04** (Phase 4). Pas une recherche.

---

## Hors scope v1

- Invités dans le graphe d’amis
- DM / chat privé
- Blocage, recherche, suggestions, fil d’activité
- Push mobile
- Mention dans le chat public
- Deep link / QR d’invitation

---

## Palier 0 — Contrats avant code

Objectif : figer les fichiers et le contrat RPC pour ne pas empiler le graphe social dans `lobby_members`.

Source unique runtime : [`js/config/friends.js`](../js/config/friends.js). Tests : [`tests/featureFriends00.test.js`](../tests/featureFriends00.test.js).

- [x] Ticket / nom de vague : **FEATURE-FRIENDS-01** (v1 demandes + liste + unfriend)
- [x] Overlay roster : RPC `get_lobby_friend_overlay(p_lobby_id)` — **pas** de colonnes d’amitié sur `lobby_members`
  - Autre membre seulement (pas de statut `self`) : `guest` | `none` | `pending_out` | `pending_in` | `friends`
  - `guest` si `auth.users.is_anonymous`
- [x] Page Amis : écran dédié `friends` ([`js/screens/friends.js`](../js/screens/friends.js) au palier 6), pas un 4ᵉ onglet Settings
  - Entrées : Settings → Profil, et accueil si inscrit
- [x] Popup vs badge : popup seulement sur `lobby`, `game-select`, `results`, `leaderboard`, `friends`, `settings`, `home` ([`FRIEND_NOTICE_CALM_SCREENS`](../js/config/friends.js)) ; badge partout ailleurs
- [x] Cooldown **serveur** 60 s après refus A→B via table `friend_request_cooldowns` (écrite au decline, **aucune lecture client**, pas un statut `declined`). RPC `send_friend_request` lève `friends_cooldown` : le bouton reste **+ Ami**, **aucun toast**

**Fait quand** : contrats dans `js/config/friends.js` + tests Palier 0 verts. Pas de SQL tant que ce palier n’est pas coché. **Palier 0 terminé.**

---

## Palier 1 — SQL (tables, RLS, RPC)

Objectif : le graphe existe côté Postgres, le client anon/authenticated ne peut pas tricher.

Fichiers à créer :

- [`supabase/feature-friends-01.sql`](../supabase/feature-friends-01.sql) — migration idempotente
- [`supabase/tests/feature-friends-01-runbook.sql`](../supabase/tests/feature-friends-01-runbook.sql) — smoke SQL Editor

### 1.1 Tables

- [x] `public.friend_requests` — voir [`supabase/feature-friends-01.sql`](../supabase/feature-friends-01.sql)
- [x] `public.friendships`
- [x] `public.friend_request_cooldowns`

### 1.2 RLS

- [x] RLS on + SELECT self sur requests/friendships ; cooldowns sans policy ; INSERT client interdit
- [x] RPC SECURITY DEFINER, `grant execute` à `authenticated` seulement ; check `is_anonymous`

### 1.3 RPC

- [x] 7 RPC du contrat [`FRIEND_RPC`](../js/config/friends.js) : `send_friend_request`, `decline_friend_request`, `accept_friend_request`, `unfriend`, `get_lobby_friend_overlay`, `list_my_friends`, `list_incoming_friend_requests`

### 1.4 Realtime

- [x] Publication SQL `friend_requests` + `friendships` (FULL) ; **à vérifier au Dashboard** après apply staging

### 1.5 Ops — **à faire par toi (staging, pas prod)**

- [x] Appliquer [`supabase/feature-friends-01.sql`](../supabase/feature-friends-01.sql) dans le SQL Editor **staging**
- [x] Publications : `friend_requests` + `friendships` on ; `friend_request_cooldowns` off
- [x] Runbook : `FRIENDS01_RUNBOOK_OK` — 27 août 2026
- [x] Consigné dans [`docs/DEPLOYMENTS_SQL.md`](./DEPLOYMENTS_SQL.md) §13 (✅ staging)
- [x] Prod : **même projet** que l’app live — Palier 10 (27 août 2026)

**Palier 1 staging terminé.** Le palier 2 peut démarrer.

---

## Palier 2 — Couche client (sans UI)

Objectif : un module unique, pas de fetch friendship éparpillé.

- [x] Créer [`js/core/supabaseFriends.js`](../js/core/supabaseFriends.js)
  - wrappers RPC depuis [`FRIEND_RPC`](../js/config/friends.js)
  - mapping overlay → libellé : [`friendsLogic.js`](../js/core/friendsLogic.js) (`rosterActionForPeer` / `FRIEND_LABEL`)
- [x] Créer [`js/core/friendsState.js`](../js/core/friendsState.js) — cache session, **pas** `localStorage`
- [x] Invité : `isRegisteredUser` (même règle que `isLoggedIn()`), pas d’appel RPC
- [x] Tests Node : [`tests/featureFriends01.test.js`](../tests/featureFriends01.test.js)
- [x] Ajouté au script `test` de [`package.json`](../package.json)

**Palier 2 terminé.** Aucun écran modifié. Palier 3 = Realtime client.

---

## Palier 3 — Realtime client

Objectif : A et B voient le graphe bouger sans refresh.

- [x] Channel dédié `friends:${userId}` (pas `lobby:${id}`) — [`js/core/friendsRealtime.js`](../js/core/friendsRealtime.js)
  - `postgres_changes` INSERT/DELETE `friend_requests` (to + from)
  - INSERT/DELETE `friendships` (user_a + user_b)
- [x] Sur event : catch-up overlay si lobby + incoming / liste amis
- [x] Start au login inscrit ; stop logout / invité (`syncSessionToState` + boot)
- [ ] Recette 2 navigateurs : **après palier 4** (pas d’UI roster ici). Console : cache `getIncomingFriendRequests()`

**Palier 3 code terminé.** Pas de QA SQL. Recette visuelle au palier 4.

---

## Palier 4 — Roster salle d’attente

Objectif : envoyer / accepter depuis le lobby waiting room.

Fichiers : [`js/screens/lobby.js`](../js/screens/lobby.js) (`participantsHtml`), styles dans `style.css`, overlay fetch au mount lobby + sur `onLobbyBundleUpdated`. Tests : [`tests/featureFriends04.test.js`](../tests/featureFriends04.test.js).

- [x] Ne pas afficher d’action ami sur **soi**
- [x] Membre **invité** (vue d’un inscrit) : pas de bouton ; hint carte *« Pas de compte »*
- [x] Local **invité** : aucun bouton sur les cartes ; hint sous la grille *« Crée un compte pour ajouter des amis »*
- [x] Local **inscrit** + cible inscrite :
  - `none` → **+ Ami**
  - `pending_out` → **Envoyée** (disabled)
  - `pending_in` → **Accepter** (raccourci)
  - `friends` → pastille **Ami** (pas de re-demande)
- [x] Tap **+ Ami** → RPC ; optimistic `pending_out` + rollback si erreur
- [x] Tap Accepter → RPC accept
- [x] Kick / ready / emoji local **inchangés**
- [x] Aucun message posté dans le chat

**Palier 4 code terminé.** Pas de SQL. Recette : 2 inscrits + 1 invité dans un lobby **staging** ; les 4 états de bouton sont visibles et justes. Kick / prêt / emoji inchangés. Refus (via SQL ou palier 5) → **+ Ami**, sans toast.

---

## Palier 5 — Popup destinataire + badge

Objectif : B est prévenu sans polluer le chat, sans couper une partie.

S’inspirer de [`js/core/hostNotice.js`](../js/core/hostNotice.js) (toast) et [`js/core/dialog.js`](../js/core/dialog.js) (confirm). Tests : [`tests/featureFriends05.test.js`](../tests/featureFriends05.test.js).

- [x] Module [`js/core/friendRequestNotice.js`](../js/core/friendRequestNotice.js)
  - file des demandes incoming non vues (ids)
  - si écran calme (liste Palier 0) **et** pas de dialog déjà ouvert : popup *« {emoji} {name} veut t’ajouter »* → Accepter / Refuser
  - sinon : badge (point) sur Menu (bottom nav) + onglet **Profil** (Settings) — entrée *Mes amis* au palier 6
- [x] Pendant une partie : **aucune** `showAppConfirm` / modal
- [x] Refuser → RPC decline ; A revoit **+ Ami** ; **pas** de toast chez A
- [x] Accepter → friendship ; pastille Ami chez les deux si encore dans le même lobby
- [x] Dédup : une popup par request id ; ne pas re-pop la même si déjà refusée
- [x] Clic hors popup / Escape = **reporter** (pas `decline`) ; la demande reste dans **Mes amis**
- [x] Branchement init dans [`js/main.js`](../js/main.js) (comme host notice)

**Palier 5 validé** (27 août 2026). Recette waiting room : popup Accepter / Refuser. Recette « envoie pendant Trivia » **impossible** tant que **+ Ami** n’existe que dans la salle d’attente. Voir Palier 7bis.

---

## Palier 6 — Page Amis

Objectif : file durable + liste emoji/pseudo live.

- [x] [`js/screens/friends.js`](../js/screens/friends.js) + `registerScreen("friends", …)` dans [`js/main.js`](../js/main.js)
- [x] Invité / déconnecté : empty state inscription, pas de liste fantôme
- [x] Inscrit :
  - section **Demandes reçues** (Accepter / Refuser)
  - section **Amis** : emoji + pseudo `profiles` (pas de snapshot figé)
  - empty states distincts (0 demande / 0 ami)
- [x] Entrée Settings → Profil : bouton / ligne **Mes amis** ([`js/screens/settings.js`](../js/screens/settings.js))
- [x] Entrée accueil si `isLoggedIn()` ([`js/screens/home.js`](../js/screens/home.js)) — discret, pas un 6ᵉ onglet bottom-nav
- [x] Badge incoming sur ces entrées ( Palier 5 )
- [x] Retour navigation cohérent avec `bindNav` / stack router
- [x] Écran `friends` = chrome soirée (`MENU_SCREENS` + `goToFriends` / `suppressSessionRoute`), comme Menu : pas une manche, pas de suivi auto vers le lobby
- [x] Tests : [`tests/uxNavSettings.test.js`](../tests/uxNavSettings.test.js) mis à jour si le markup Profil change ; nouveau test écran friends (contrats HTML)

**Palier 6 validé** (27 août 2026). Badge Menu → Mes amis ; accepter depuis la page ; les deux listes **Tes amis** se mettent à jour. Clic hors popup = reporter, pas refuser. Unfriend = palier 7.

---

## Palier 7 — Unfriend

- [x] Sur chaque fiche ami : action **Retirer** + `showAppConfirm` (confirmation locale seulement)
- [x] RPC `unfriend` ; silencieux pour l’autre (la pastille Ami redevient **+ Ami** s’ils sont encore dans le même lobby via realtime DELETE `friendships`)
- [x] Pas de notif « X t’a retiré »
- [x] Tests : [`tests/featureFriends07.test.js`](../tests/featureFriends07.test.js)

**Palier 7 validé** (27 août 2026). Retirer + confirm ; l’autre n’a pas de toast ; même lobby → **+ Ami**.

---

## Palier 7bis — + Ami pendant la soirée

Objectif : demander en ami **après** « Commencer la soirée », pas seulement dans la salle d’attente. Découverte toujours = roster du lobby (pas de recherche).

Après les paliers 6–7. Pas de SQL.

- [x] Liste des joueurs du lobby ouverte à **tous** les inscrits (pas seulement l’hôte) : Menu → Soirée, même famille que [`showLobbyPlayersManageDialog`](../js/core/dialog.js)
- [x] Mêmes actions que le roster waiting room : **+ Ami** / **Envoyée** / **Accepter** / **Ami** / **Pas de compte**
- [x] **Retirer** (kick) reste **hôte seulement**
- [x] Pendant une manche : toujours **pas** de popup (Palier 5) ; le destinataire voit le badge Menu / Profil, popup au retour hub
- [x] Invité : pas de **+ Ami** (hint compte, comme palier 4)
- [x] Tests source + recette : A hôte ou membre envoie depuis Menu pendant Trivia → B : point seulement, puis popup au hub

**Palier 7bis validé** (27 août 2026). Menu → Soirée → Joueurs pour tout inscrit ; kick hôte ; pas de popup en manche.

---

## Palier 8 — Légal et store

Le graphe est une **nouvelle donnée personnelle**. Pas un fil public.

- [x] [`data/legalContent.js`](../data/legalContent.js)
  - Données collectées : + *liste d’amis et demandes d’amitié (comptes inscrits)*
  - Suppression de compte : + *demandes et amitiés effacées en cascade*
  - Date `updated` : 27 août 2026
- [x] Recopie sur le site OVH `privacy.html` (27 août 2026) — [privacy.html](https://revealthepartygame.fr/privacy.html)
- [x] [`docs/LAUNCH.md`](./LAUNCH.md) UGC : *No public social feed* + *private friend list, lobby-only discovery*
- [ ] App Privacy Apple / Play Data safety : **uniquement** au prochain store build qui embarque la feature (relations sociales / user IDs) — ne pas modifier les fiches maintenant

**Palier 8 validé** (in-app + [site](https://revealthepartygame.fr/privacy.html)). Stores : avec le prochain build.

---

## Palier 9 — QA terrain (staging, 2 comptes inscrits + 1 invité)

Deux téléphones ou deux navigateurs. Lobby code réel.

- [x] Invité ne peut pas envoyer / recevoir
- [x] Inscrit → inscrit : send, popup, accept → page Amis
- [x] Refus : A revoit **+ Ami**, aucun texte de refus
- [x] A peut renvoyer après cooldown 60 s
- [x] Demandes croisées → amis sans double popup bizarre
- [x] Rename / change emoji : page Amis affiche la **nouvelle** identité
- [x] Kick du lobby : l’amitié **reste**
- [x] Fermeture de lobby : demandes pending **restent** (page Amis)
- [x] Pendant Draw It / Trivia : pas de modal ami ; **+ Ami** possible via Menu (Palier 7bis)
- [x] Logout : plus de channel friends ; autre session ne voit pas les demandes d’un autre user
- [x] Suppression de compte (staging) : plus de lignes `friend_requests` / `friendships` pour cet id
- [x] Chat lobby : **aucune** ligne générée par ces actions
- [x] `npm test` vert

**Palier 9 validé** (27 août 2026). Alors seulement Palier 10 prod.

---

## Palier 10 — Production

Un seul projet Supabase (`ojzxbvpdfnwagrvbhfll`) : Live Server, GitHub Pages et apps natives. Les deux SQL du palier 1 **sont** déjà sur ce projet. Rien d’autre à coller.

- [x] [`feature-friends-01.sql`](../supabase/feature-friends-01.sql) — appliqué (27 août 2026). **Ne pas** relancer le runbook (blocs 1–3 mutent des comptes de test ; marqué *INTERDIT EN PRODUCTION*). Catalogue lecture seule (bloc 0) OK si besoin.
- [x] Realtime `friend_requests` + `friendships` (pas `friend_request_cooldowns`) — Palier 1.5
- [x] Ligne ✅ dans [`docs/DEPLOYMENTS_SQL.md`](./DEPLOYMENTS_SQL.md) §13
- [x] Mention Realtime dans [`docs/SUPABASE.md`](./SUPABASE.md) §1
- [x] Client **web** : [Pages](https://julie-lepine.github.io/reveal/) (`main`). Stores : **prochain** build — **pas** le 1.0.0 App Store déjà en review

**Palier 10 validé** (27 août 2026). FEATURE-FRIENDS-01 v1 close.

---

## Phase 2 — Invitations de lobby (FEATURE-FRIENDS-02)

On avance **un palier à la fois**, comme la v1. Source runtime : [`js/config/lobbyInvites.js`](../js/config/lobbyInvites.js).

**QA terrain = palier 8 seulement** (2 comptes, après l’UI). Pas de recette téléphone aux paliers 0–7.

### Avancement

- [x] **0** Contrats — 27 août 2026
- [x] **1** SQL + `FRIENDS02_RUNBOOK_OK` — 27 août 2026
- [x] **2** Client sans UI — 27 août 2026
- [x] **3** Realtime `friends:${userId}` — 27 août 2026
- [x] **4** Page Amis : **Inviter** / incoming — 27 août 2026
- [x] **5** Popup + badge — 27 août 2026
- [x] **6** Rejoindre sans code (+ modale déjà ailleurs) — 27 août 2026
- [x] **7** Légal in-app + OVH — 27 août 2026
- [x] **8** QA terrain — 27 août 2026
- [x] **9** Pages / docs prod — 27 août 2026

**FEATURE-FRIENDS-02 close** (sauf builds stores). Stores : prochain native — **pas** le 1.0.0 App Store en review.

### Règles figées (ne pas rediscuter)

- **Amis seulement.** Pas de recherche, pas d’invite d’un non-ami, pas d’invité (envoyer / recevoir).
- **Émetteur** = inscrit **déjà membre** d’un lobby vivant (n’importe quel membre, pas hôte-only). Pas dans un lobby → pas de bouton **Inviter**.
- **Destinataire** = ami inscrit, **pas** déjà dans ce lobby. Tu peux inviter **tous tes amis inscrits** hors salle (un, sept, N) — pas une seule invitation pour tout le lobby.
- Pas de **doublon** vers le même ami pour le même lobby (re-tap = **Envoyée**). 2ᵉ émetteur vers ce même ami / même salon → no-op `pending`.
- Le plafond **8** s’applique au **Rejoindre**, pas à l’envoi (tu peux inviter plus d’amis qu’il ne reste de places ; le 9ᵉ aura `lobby_invite_full`).
- Refus = **DELETE** la ligne. Silencieux pour l’émetteur. **Pas** de cooldown.
- **Rejoindre** = RPC `accept_lobby_invite` : insert `lobby_members` **sans** le code 6 lettres, **sans** `find_lobby_by_code`. La ligne invite ne contient **pas** le code.
- Déjà dans **ce** lobby → `lobby_invite_already_in` (no-op, pastille **Dans la soirée**).
- Déjà dans **un autre** lobby : modale d’explication, **deux choix** — **Rester et refuser** (decline, on ne bouge pas) ou **Quitter et rejoindre** (`leaveLobby` puis accept). Le serveur **ne quitte pas** tout seul. Clic hors / Escape = reporter (reste ici, l’invite **reste**).
- Plein / fermé / dissolu / inactif 24 h → erreur claire (`lobby_invite_full` / `lobby_invite_closed`). Invite **CASCADE** à la mort du lobby.
- Contraintes inchangées : **un lobby vivant par user**, max **8**. Join milieu de soirée = même règle que le join par code aujourd’hui.
- Canal = **`friends:${userId}`** (table `lobby_invites` en plus). Jamais `lobby_messages`. Pas de colonnes d’invite sur `lobby_members`.
- Popup seulement sur les écrans calmes v1 (`FRIEND_NOTICE_CALM_SCREENS`) ; en manche = badge. Clic hors / Escape sur la popup simple = **reporter**, pas refuser.
- Pas de push, pas de présence hors lobby, pas de deep link / QR.

### Hors scope

- Inviter un non-ami ou un invité
- Annuler une invitation côté émetteur (re-tap **Inviter** = déjà Envoyée)
- Deux pending distinctes vers le **même** ami pour le **même** lobby
- Présence online / hors lobby
- Push, DM, QR, lien `#join=`

### Palier 0 — Contrats avant code

- [x] Ticket : **FEATURE-FRIENDS-02**
- [x] [`js/config/lobbyInvites.js`](../js/config/lobbyInvites.js) + [`tests/featureFriends02-00.test.js`](../tests/featureFriends02-00.test.js)
- [x] RPC : `send_lobby_invite` / `decline_lobby_invite` / `accept_lobby_invite` / `list_incoming_lobby_invites`
- [x] Erreurs : `friends_guest` `friends_self` `friends_not_found` · `lobby_invite_not_friends` `lobby_invite_no_lobby` `lobby_invite_already_in` `lobby_invite_full` `lobby_invite_closed` `lobby_invite_busy` `lobby_invite_gone`
- [x] Copy : **Inviter** / **Envoyée** / **Rejoindre** / **Dans la soirée** · *« {name} t’invite à une soirée »* · déjà ailleurs : **Rester et refuser** / **Quitter et rejoindre**

**Palier 0 terminé.**

### Palier 1 — SQL (tables, RLS, RPC)

Objectif : invitations éphémères liées au lobby, le client ne peut pas tricher ni lire le code.

Fichiers :

- [`supabase/feature-friends-02.sql`](../supabase/feature-friends-02.sql) — migration idempotente
- [`supabase/tests/feature-friends-02-runbook.sql`](../supabase/tests/feature-friends-02-runbook.sql) — smoke SQL Editor

- [x] `public.lobby_invites` (`lobby_id` → `lobbies` ON DELETE CASCADE, `from_user_id` / `to_user_id` → `auth.users` CASCADE, unique `(lobby_id, to_user_id)` = anti-doublon **même ami / même salon** — l’émetteur envoie autant de lignes que d’amis, replica identity FULL)
- [x] RLS : SELECT self (`from` ou `to`) ; pas d’INSERT/UPDATE/DELETE client ; GRANT SELECT `authenticated` ; REVOKE anon
- [x] `send_lobby_invite(p_to)` : caller registered + living membership ; cible = ami registered ; pas self / pas déjà dans ce lobby ; **N appels** = N amis
- [x] `decline_lobby_invite(p_id)` : destinataire DELETE
- [x] `accept_lobby_invite(p_id)` : insert membre (profil live) **ou** `busy` si autre lobby (pas d’auto-leave) ; checks plein / fermé / 24 h ; DELETE l’invite si join OK ; retour `lobby_id` **sans** le code
- [x] `list_incoming_lobby_invites` : id, lobby_id, from_user_id, display_name, emoji, created_at — **pas** le code
- [x] Publication SQL `lobby_invites` (pas une 2ᵉ topic client)
- [x] Runbook source + tests [`tests/featureFriends02Sql.test.js`](../tests/featureFriends02Sql.test.js)

### 1.5 Ops — **à faire par toi**

- [x] Appliquer [`supabase/feature-friends-02.sql`](../supabase/feature-friends-02.sql) dans le SQL Editor
- [x] Publications : `lobby_invites` on
- [x] Runbook : `FRIENDS02_RUNBOOK_OK` — 27 août 2026
- [x] Consigner dans [`docs/DEPLOYMENTS_SQL.md`](./DEPLOYMENTS_SQL.md) §14

**Palier 1 terminé.** Palier 2 = client sans UI.

### Palier 2 — Couche client (sans UI)

- [x] Wrappers RPC [`js/core/supabaseLobbyInvites.js`](../js/core/supabaseLobbyInvites.js) + cache [`js/core/lobbyInvitesState.js`](../js/core/lobbyInvitesState.js) (incoming + pending out), **pas** `localStorage`
- [x] Invité : zéro RPC (`isRegisteredUser`)
- [x] Tests Node : [`tests/featureFriends02.test.js`](../tests/featureFriends02.test.js)

**Palier 2 terminé.** Pas d’écran modifié. Pas de QA.

### Palier 3 — Realtime

- [x] Étendre `friends:${userId}` : INSERT/DELETE `lobby_invites` (`to_user_id` + `from_user_id`)
- [x] Catch-up incoming + outgoing (+ overlay lobby si déjà en salle)
- [x] Stop logout / invité : vider aussi le cache invites
- [x] Pas de topic `lobby:` pour ça
- [x] Tests : [`tests/featureFriends02-03.test.js`](../tests/featureFriends02-03.test.js)

**Palier 3 terminé.** Pas de QA téléphone. Ensuite palier 4 (boutons).

### Palier 4 — Page Amis : envoyer / voir

- [x] Si local **pas** dans un lobby : hint *« Crée ou rejoins une soirée pour inviter tes amis. »* — pas de **Inviter**
- [x] Si local **dans** un lobby, **chaque** ami inscrit hors salle a **Inviter** (tu peux tous les inviter). Déjà dans **cette** salle → **Dans la soirée**. Pending → **Envoyée**
- [x] Section **Invitations de soirée** (Rejoindre / Refuser) au-dessus des demandes d’ami
- [x] Waiting room : entrée discrète vers Amis si on a au moins un ami (pas un 2ᵉ graphe)
- [x] Chat lobby : **aucune** ligne
- [x] Tests source (markup / actions)

**Palier 4 terminé.** Recette visuelle courte possible ; **QA complète = palier 8.**

### Palier 5 — Popup destinataire + badge

- [x] Hors lobby : *« {name} t’invite à une soirée »* → **Rejoindre** / **Refuser**
- [x] Déjà dans une **autre** soirée : modale *« Tu es déjà dans une soirée »* (explique l’une-à-la-fois) → **Rester et refuser** ou **Quitter et rejoindre** — pas un 3ᵉ bouton Annuler
- [x] En manche : badge seulement (Menu / Amis) ; la modale busy attend le hub comme la popup simple
- [x] Badge = demandes d’ami **ou** invitations
- [x] Clic hors / Escape = reporter (simple : invite reste ; busy : reste ici **et** invite reste)
- [x] Tests source (copy + décisions)

**Palier 5 terminé.** **QA téléphone = palier 8.**

### Palier 6 — Rejoindre sans code

- [x] Tap Rejoindre (pas déjà ailleurs) → `accept_lobby_invite` puis hydrate lobby existant (même pipeline que join code **après** membership)
- [x] **Rester et refuser** → `decline_lobby_invite` ; on ne quitte pas
- [x] **Quitter et rejoindre** → `leaveLobby` puis `accept_lobby_invite` (filet `lobby_invite_busy` si le client n’a pas vu le lobby local)
- [x] Plein / fermé / gone : alerte claire, pas de join partiel
- [x] Un seul lobby vivant, max 8 au join — pas de contournement
- [x] Tests source (busy / full / closed) [`tests/featureFriends02-06.test.js`](../tests/featureFriends02-06.test.js)

**Palier 6 terminé.** Légal in-app (7) fait ; site OVH puis QA (8).

### Palier 7 — Légal

- [x] [`data/legalContent.js`](../data/legalContent.js) : + invitations de soirée (éphémères, liées au lobby / cascade compte) — 27 août 2026
- [x] Recopie OVH `privacy.html` — 27 août 2026 — [privacy.html](https://revealthepartygame.fr/privacy.html)
- [x] Stores : avec le prochain build qui embarque la feature (comme palier 8 v1) — **ne pas** toucher App Privacy Apple / Play Data safety maintenant

**Palier 7 validé** (in-app + [site](https://revealthepartygame.fr/privacy.html)). **Puis QA (8).**

Tests : [`tests/featureFriends02-07.test.js`](../tests/featureFriends02-07.test.js)

### Palier 8 — QA terrain

À faire **toi** (2 téléphones ou 2 navigateurs, comptes inscrits). On ne commence pas avant que 4–7 soient cochés.

- [x] Invité : pas d’Inviter / pas de popup invite
- [x] A en lobby invite **plusieurs** amis inscrits (ex. 2 ou 7) : chacun a Envoyée ; ils peuvent tous rejoindre jusqu’au plafond 8
- [x] A en lobby, B ami hors lobby : Inviter → popup B → Rejoindre sans code → B dans la salle
- [x] Refus : A revoit **Inviter**, pas de texte
- [x] B déjà dans un **autre** lobby : modale *déjà dans une soirée* → **Quitter et rejoindre** OK ; **Rester et refuser** = B reste, A revoit **Inviter**
- [x] Clic hors de cette modale : B reste, l’invite **reste** (A voit encore Envoyée)
- [x] Lobby plein / fermé / hôte a dissous : échec clair
- [x] Fermeture de lobby : invitations **disparaissent** (CASCADE)
- [x] Pendant une manche : pas de modal invite ; badge puis popup au hub
- [x] Chat : aucune ligne
- [x] `npm test` vert

**Palier 8 validé** (27 août 2026). Recette : toast hôte au switch, kick plus réactif, statut *Dans la soirée* sous le pseudo.

### Palier 9 — Production (même projet)

SQL déjà sur le projet live au palier 1. Ici : client web + docs, **pas** le 1.0.0 App Store en review.

- [x] [`feature-friends-02.sql`](../supabase/feature-friends-02.sql) + Realtime `lobby_invites` — palier 1 (27 août 2026). **Ne pas** relancer le runbook (blocs mutatifs ; marqué *INTERDIT EN PRODUCTION*). Catalogue lecture seule OK si besoin.
- [x] Ligne ✅ dans [`docs/DEPLOYMENTS_SQL.md`](./DEPLOYMENTS_SQL.md) §14
- [x] Mention Realtime dans [`docs/SUPABASE.md`](./SUPABASE.md) §1
- [x] Client **web** : [Pages](https://julie-lepine.github.io/reveal/) (`main`). Stores : **prochain** build — **pas** le 1.0.0 App Store déjà en review

**Palier 9 validé** (27 août 2026). FEATURE-FRIENDS-02 Phase 2 close (sauf builds stores).

---

## Phase 3 — Annuler une demande envoyée (FEATURE-FRIENDS-03)

Aujourd’hui **Envoyée** est un cul-de-sac : pas de rétractation, et plus rien une fois hors du lobby. On ajoute **Annuler** (émetteur seulement).

On avance **un palier à la fois**. Pas de code avant le palier 0 coché. QA téléphone = dernier palier UI.

### Avancement

- [x] **0** Contrats — 27 août 2026
- [x] **1** SQL + `FRIENDS03_RUNBOOK_OK` — 27 août 2026
- [x] **2** Client sans UI — 27 août 2026
- [x] **3** UI (roster + page Amis) — 27 août 2026
- [x] **4** QA terrain — 27 août 2026 (Annuler validé)
- [x] **5** Docs / Pages — 27 août 2026 — **pas** le 1.0.0 App Store

**FEATURE-FRIENDS-03 close** (sauf builds stores). Identité Tes amis : SQL live-identity ✅. Stores : prochain native — **pas** le 1.0.0 App Store en review.

### Règles figées (ne pas rediscuter)

- **Émetteur seulement.** RPC `cancel_friend_request(p_to)` : DELETE sa propre ligne `friend_requests` (`from_user_id = caller`, `to_user_id = p_to`). Pas le destinataire (ça reste `decline_friend_request`).
- Inscrits seulement (mêmes garde-fous `friends_guest` / `friends_self` / `friends_not_found`).
- **Pas de cooldown.** Le cooldown 60 s reste **uniquement** après un **refus** du destinataire. Annuler ≠ refusé : l’émetteur peut renvoyer **+ Ami** tout de suite.
- **Silencieux pour le destinataire.** Pas de toast « a annulé ». Sa popup / badge disparaît via le DELETE Realtime déjà sur `friend_requests` (`friends:${userId}`).
- Copy : **Annuler** (pas **Retirer**, réservé au unfriend). Roster : **Envoyée** devient action **Annuler**. Page Amis : section **Demandes envoyées** (pour annuler **hors** lobby).
- Pas de nouvelle table. Pas de colonnes sur `lobby_members`. Jamais `lobby_messages`.
- **Pas** l’annulation d’une invitation de soirée (reste hors scope FEATURE-FRIENDS-02).

### Hors scope

- Annuler une invitation de lobby
- Toast / copy « a retiré sa demande » côté destinataire
- Cooldown après annulation
- Invités

### Palier 0 — Contrats avant code

- [x] Ticket : **FEATURE-FRIENDS-03**
- [x] [`js/config/friends.js`](../js/config/friends.js) : RPC `cancel` / `listOutgoing`, label **Annuler**, section **Demandes envoyées**
- [x] Erreurs : réutiliser `friends_guest` `friends_self` `friends_not_found` ; no-op si rien à annuler (pas d’erreur métier obligatoire)
- [x] Tests source palier 0 [`tests/featureFriends03-00.test.js`](../tests/featureFriends03-00.test.js)

**Palier 0 terminé.** Pas de SQL tant que ce palier n’était pas coché. **Ensuite palier 1.**

### Palier 1 — SQL

- [x] [`supabase/feature-friends-03.sql`](../supabase/feature-friends-03.sql) : `cancel_friend_request(p_to uuid)` SECURITY DEFINER
- [x] `list_outgoing_friend_requests()` : id, to_user_id, display_name, emoji, created_at (profils live)
- [x] Runbook source [`supabase/tests/feature-friends-03-runbook.sql`](../supabase/tests/feature-friends-03-runbook.sql) (`FRIENDS03_RUNBOOK_OK`) — **ne pas** lancer en prod sur des comptes réels
- [x] Tests [`tests/featureFriends03Sql.test.js`](../tests/featureFriends03Sql.test.js)

### 1.5 Ops — **à faire par toi**

Même projet live (`ojzxbvpdfnwagrvbhfll`). Pas de nouvelle publication Realtime.

- [x] Appliquer [`supabase/feature-friends-03.sql`](../supabase/feature-friends-03.sql) dans le SQL Editor
- [x] Runbook : `FRIENDS03_RUNBOOK_OK` — 27 août 2026
- [x] Consigner dans [`docs/DEPLOYMENTS_SQL.md`](./DEPLOYMENTS_SQL.md) §15

**Palier 1 terminé.** Palier 2 = client sans UI. **Ne pas** relancer le runbook.

### Palier 2 — Client sans UI

- [x] Wrappers RPC + cache outgoing (comme incoming)
- [x] Catch-up Realtime DELETE déjà là : rafraîchir overlay / outgoing
- [x] Invité : zéro RPC
- [x] Tests Node [`tests/featureFriends03-02.test.js`](../tests/featureFriends03-02.test.js)

**Palier 2 terminé.** Pas d’écran modifié. Pas de QA. Ensuite palier 3.

### Palier 3 — UI

- [x] Roster waiting room : **Annuler** à la place d’**Envoyée** figé
- [x] Page Amis : section **Demandes envoyées** au-dessus de **Tes amis** (sous les demandes reçues)
- [x] Après Annuler : **+ Ami** (roster) / ligne disparaît (page Amis)
- [x] Tests source (markup / actions) [`tests/featureFriends03-03.test.js`](../tests/featureFriends03-03.test.js)

**Palier 3 terminé.** **QA téléphone = palier 4.**

### Palier 4 — QA terrain

À faire **toi** (2 comptes inscrits).

- [x] A envoie, annule dans le lobby : B ne voit plus la popup ; A revoit **+ Ami**
- [x] A envoie, sort du lobby, annule depuis Amis : même effet
- [x] B refuse toujours silencieux pour A ; cooldown 60 s **inchangé** (seulement après refus)
- [x] Invité : pas d’Annuler
- [x] Chat : aucune ligne

**Validé 27 août 2026.** Un ami pouvait rester « Joueur » / 👤 sur Tes amis (table `profiles` encore au fallback, alors que le pseudo d’inscription / le lobby étaient bons).

### Palier 4 bis — Identité Tes amis

- [x] SQL Editor : [`feature-friends-03-live-identity.sql`](../supabase/feature-friends-03-live-identity.sql) — 27 août 2026
- [x] Recharger Tes amis : le pseudo / emoji du compte concerné (plus le placeholder)
- [x] Consigner dans [`DEPLOYMENTS_SQL.md`](./DEPLOYMENTS_SQL.md) §16 après apply

### Palier 5 — Docs / Pages

- [x] [`docs/DEPLOYMENTS_SQL.md`](./DEPLOYMENTS_SQL.md) §15–16 + Realtime inchangé (`friend_requests` déjà on)
- [x] Client **web** : [Pages](https://julie-lepine.github.io/reveal/) (`main`). Stores : **prochain** build — **pas** le 1.0.0 App Store déjà en review

**Palier 5 validé** (27 août 2026). FEATURE-FRIENDS-03 Phase 3 close (sauf builds stores).

---

## Phase 4 — Vous venez de jouer avec (FEATURE-FRIENDS-04)

Le roster **disparaît** à la dissolution (`lobby_members` CASCADE). Sans table dédiée, on ne peut plus ajouter après la soirée.

Liste courte sur la page Amis : joueurs **inscrits** avec qui on a **partagé un lobby**, fenêtre **24 h après la fin du chevauchement**. Ce n’est **pas** une recherche, **pas** des suggestions de inconnus.

On ne commence **pas** le palier 1 SQL tant que le palier 0 n’est pas coché. QA téléphone après l’UI. Légal in-app **avant** la recette (nouvelle donnée).

### Avancement

- [x] **0** Contrats — 27 août 2026
- [x] **1** SQL — 27 août 2026 (appliqué, même projet)
- [x] **2** Client sans UI — 27 août 2026
- [x] **3** UI page Amis — 27 août 2026
- [ ] **4** Légal in-app + OVH
- [ ] **5** QA terrain
- [ ] **6** Docs / Pages — **pas** le 1.0.0 App Store

**Palier 3 terminé.** Recette téléphone après palier 4 légal. Stores : **pas** le 1.0.0.

### Règles figées (ne pas rediscuter)

- **Déjà croisés seulement.** Une paire n’existe que si les deux ont été `lobby_members` du **même** lobby vivant, **tous les deux inscrits**. Jamais un invité. Jamais quelqu’un jamais vu en salon.
- **Pas de recherche**, pas de suggestions, pas d’amis d’amis, pas de fil.
- Fenêtre : **24 h après** qu’ils aient cessé d’être co-membres (leave / dissolve). Tant qu’ils sont **encore** dans le même lobby : **pas** dans cette liste (le **+ Ami** reste le roster).
- `lobby_members` CASCADE à la mort du lobby → table dédiée `lobby_encounters` (paire ordonnée `user_a < user_b`, `last_shared_at`). Écriture **serveur** (trigger membership), **pas** d’INSERT client. Purge opportuniste `last_shared_at < now() - 24h`. CASCADE compte.
- RPC `list_recent_lobby_peers()` : profils live (pseudo / emoji), **sans** code lobby, **sans** `lobby_id`. Client : SELECT via RPC seulement.
- Déjà **amis** → omis (ils sont dans **Tes amis**). Pending in/out → **Accepter** / **Envoyée** (ou **Annuler** si F03 live). Sinon **+ Ami** = `send_friend_request` existant (cooldown refus inchangé).
- Copy : section **Vous venez de jouer avec** · vide *« Personne récemment. »*
- Canal inchangé. Jamais `lobby_messages`. Pas de présence, push, QR, `#join=`.
- Stores : **ne pas** toucher App Privacy / Play Data safety tant que ce n’est pas le build qui embarque la feature (comme F01 palier 8 / F02 palier 7).

### Hors scope

- Recherche / suggestions / invités
- Historique > 24 h, nom du salon, code
- Présence online
- Bouton *« Ajouter tout le lobby »* (idée écartée pour l’instant)

### Palier 0 — Contrats avant code

- [x] Ticket : **FEATURE-FRIENDS-04**
- [x] Config dédiée [`js/config/recentPeers.js`](../js/config/recentPeers.js) (fenêtre 24 h, RPC, copy, qui apparaît)
- [x] Tests source palier 0 [`tests/featureFriends04-00.test.js`](../tests/featureFriends04-00.test.js)

**Palier 0 terminé.** Palier 1 SQL appliqué.

### Palier 1 — SQL

- [x] [`supabase/feature-friends-04.sql`](../supabase/feature-friends-04.sql) : table + trigger `lobby_members` INSERT/DELETE + RPC list + purge
- [x] Pas dans Realtime (liste au catch-up / ouverture page Amis ; optionnel plus tard)
- [x] Runbook staging (`FRIENDS04_RUNBOOK_OK`) — **ne pas** lancer en prod sur des comptes réels
- [x] Tests SQL source [`tests/featureFriends04Sql.test.js`](../tests/featureFriends04Sql.test.js)

### 1.5 Ops — **fait**

Même projet live (`ojzxbvpdfnwagrvbhfll`). **Ne pas** ajouter `lobby_encounters` à Realtime.

- [x] Appliquer [`supabase/feature-friends-04.sql`](../supabase/feature-friends-04.sql) dans le SQL Editor — 27 août 2026
- [ ] Runbook : `FRIENDS04_RUNBOOK_OK` — **staging / INTERDIT EN PRODUCTION** (lobby jetable) — **ne pas** lancer
- [x] Consigner dans [`docs/DEPLOYMENTS_SQL.md`](./DEPLOYMENTS_SQL.md) §17

**Ne pas** lancer le runbook en prod.

### Palier 2 — Client sans UI

- [x] Wrapper [`list_recent_lobby_peers`](../js/core/supabaseRecentPeers.js) + cache mémoire [`recentPeersState.js`](../js/core/recentPeersState.js) (pas `localStorage`)
- [x] Invité : zéro RPC
- [x] Catch-up HTTP sur le canal friends (pas de `postgres_changes` `lobby_encounters`)
- [x] Tests Node [`tests/featureFriends04-02.test.js`](../tests/featureFriends04-02.test.js)

**Palier 2 terminé.** Pas d’écran modifié. Pas de QA. Ensuite palier 3.

### Palier 3 — UI

- [x] Page Amis : section **Vous venez de jouer avec** (après demandes, avant **Tes amis**)
- [x] Actions **+ Ami** / **Annuler** (F03) / **Accepter** — pas **Inviter** ici (pas un graphe d’invites)
- [x] Tests source [`tests/featureFriends04-03.test.js`](../tests/featureFriends04-03.test.js)

**Palier 3 terminé.** Pas de QA tant que le palier 4 légal n’est pas collé. Ensuite palier 4.

### Palier 4 — Légal

Nouvelle donnée : identifiants de joueurs croisés, **éphémères 24 h**, cascade compte.

- [ ] [`data/legalContent.js`](../data/legalContent.js) + recopie OVH `privacy.html`
- [ ] Stores : prochain build qui embarque la feature — **ne pas** modifier les fiches maintenant
- [ ] Tests source légal

### Palier 5 — QA terrain

- [ ] Deux inscrits quittent / dissolvent : chacun voit l’autre 24 h, **+ Ami** marche
- [ ] Encore dans le même lobby : absent de la section (roster seulement)
- [ ] Invité jamais listé ; déjà ami jamais listé
- [ ] Après 24 h : disparu
- [ ] Chat : aucune ligne

### Palier 6 — Docs / Pages

- [ ] [`docs/DEPLOYMENTS_SQL.md`](./DEPLOYMENTS_SQL.md) · [`docs/SUPABASE.md`](./SUPABASE.md)
- [ ] Client web Pages ; **pas** le 1.0.0 App Store

---

## Ordre des sessions de code

| Session | Palier | Livrable visible |
| ------- | ------ | ---------------- |
| 1 | 0 | Contrats figés |
| 2 | 1 | SQL staging + runbook |
| 3 | 2–3 | Module + realtime (console) |
| 4 | 4 | Boutons roster |
| 5 | 5 | Popup + badge *(validé waiting room)* |
| 6 | 6 | Page Amis *(validé)* |
| 7 | 7 | Unfriend *(validé)* |
| 8 | 7bis | + Ami pendant la soirée *(validé)* |
| 9 | 8 | Légal in-app + OVH *(validé)* ; stores au build |
| 10 | 9 | QA terrain *(validé)* |
| 11 | 10 | Prod *(validé — même projet, SQL palier 1)* |
| 12 | F02-0 | Contrats invitations *(fait)* |
| 13 | F02-1 | SQL `lobby_invites` *(validé runbook)* |
| 14 | F02-2 | Module client *(fait)* |
| 15 | F02-3 | Realtime *(fait)* |
| 16 | F02-4 | UI Inviter page Amis *(fait)* |
| 17 | F02-5 | Popup + badge *(fait)* |
| 18 | F02-6 | Join sans code *(fait)* |
| 19 | F02-7 | Légal in-app + OVH *(validé)* |
| 20 | F02-8 | QA terrain *(validé)* |
| 21 | F02-9 | Docs / Pages *(validé — même projet, SQL palier 1)* |
| 22 | F03-0 | Contrats **Annuler** demande *(fait)* |
| 23 | F03-1 | SQL `cancel_friend_request` *(validé runbook)* |
| 24 | F03-2 | Module client *(fait)* |
| 25 | F03-3 | UI **Annuler** *(fait)* |
| 26 | F03-4 | QA **Annuler** *(validé 27 août 2026)* · identité Tes amis *(SQL ✅)* |
| 27 | F03-5 | Docs / Pages *(validé — Annuler + identité, pas le 1.0.0)* |
| 28 | F04-0 | Contrats croisés 24 h *(fait)* |
| 29 | F04-1 | SQL `lobby_encounters` *(validé — même projet, SQL palier 1)* |
| 30 | F04-2 | Module client sans UI *(fait)* |
| 31 | F04-3 | UI page Amis croisés *(fait)* |

**Prochain : palier 4 légal in-app + OVH. Stores : **pas** le 1.0.0 App Store.
