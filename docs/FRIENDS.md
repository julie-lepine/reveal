# FEATURE-FRIENDS — Checklist d’implémentation

Cadrage produit validé. On avance **un palier à la fois**. On ne commence pas le palier N+1 tant que les cases du palier N ne sont pas cochées (sauf mention « peut chevaucher »).

Légal store : *No public social feed*. Découverte **uniquement** via le roster du lobby. Pas de recherche de joueurs.

---

## Règles figées (ne pas rediscuter en cours de route)

- Comptes **inscrits seulement** (`isLoggedIn()` = email / Facebook, pas invité anonyme).
- Canal = **notification privée**. Jamais le chat lobby (`lobby_messages`).
- Refus = **suppression** de la ligne `friend_requests`. Côté émetteur, le bouton redevient **+ Ami**, **sans explication**.
- Identité = `auth.users.id` (UUID). Pseudo / emoji **toujours relus** depuis `profiles`.
- Invitations de lobby = **phase 2** (section dédiée en bas). Hors v1.

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

**Palier 10 validé** (27 août 2026). FEATURE-FRIENDS-01 v1 close. Phase 2 = invitations de lobby, plus tard.

---

## Phase 2 — Invitations de lobby (plus tard)

Ne pas commencer avant v1 prod + usage réel de la liste d’amis.

Vague prévue : **FEATURE-FRIENDS-02**.

- [ ] Table `lobby_invites` (`lobby_id`, `from_user_id`, `to_user_id`, expire avec le lobby)
- [ ] Même canal de notif privé que les demandes d’ami
- [ ] Tap **Rejoindre** → join existant **sans taper le code**
- [ ] Si destinataire déjà dans un lobby : confirm *quitter la soirée en cours ?*
- [ ] Plein / fermé / 24 h inactif : échec clair
- [ ] Contrainte inchangée : **un lobby vivant par user**, max 8
- [ ] Pas de push, pas de présence hors lobby

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

Pour implémenter : ouvrir ce fichier et dire **« on fait le palier N »**.
