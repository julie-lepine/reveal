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
- [ ] Prod : **ne pas appliquer** avant Palier 9

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

S’inspirer de [`js/core/hostNotice.js`](../js/core/hostNotice.js) (toast) et [`js/core/dialog.js`](../js/core/dialog.js) (confirm).

- [ ] Module [`js/core/friendRequestNotice.js`](../js/core/friendRequestNotice.js)
  - file des demandes incoming non vues (ids)
  - si écran calme (liste Palier 0) **et** pas de dialog déjà ouvert : popup *« {emoji} {name} veut t’ajouter »* → Accepter / Refuser
  - sinon : badge (point) sur l’entrée Amis (Settings Profil + nav vers `friends`)
- [ ] Pendant une partie : **aucune** `showAppConfirm` / modal
- [ ] Refuser → RPC decline ; A revoit **+ Ami** ; **pas** de toast chez A
- [ ] Accepter → friendship ; pastille Ami chez les deux si encore dans le même lobby
- [ ] Dédup : une popup par request id ; ne pas re-pop la même si déjà refusée
- [ ] Branchement init dans [`js/main.js`](../js/main.js) (comme host notice)

**Fait quand** : recette A. waiting room popup ; B. en manche Trivia → badge seulement, popup au retour hub.

---

## Palier 6 — Page Amis

Objectif : file durable + liste emoji/pseudo live.

- [ ] [`js/screens/friends.js`](../js/screens/friends.js) + `registerScreen("friends", …)` dans [`js/main.js`](../js/main.js)
- [ ] Invité / déconnecté : empty state inscription, pas de liste fantôme
- [ ] Inscrit :
  - section **Demandes reçues** (Accepter / Refuser)
  - section **Amis** : emoji + pseudo `profiles` (pas de snapshot figé)
  - empty states distincts (0 demande / 0 ami)
- [ ] Entrée Settings → Profil : bouton / ligne **Mes amis** ([`js/screens/settings.js`](../js/screens/settings.js))
- [ ] Entrée accueil si `isLoggedIn()` ([`js/screens/home.js`](../js/screens/home.js)) — discret, pas un 6ᵉ onglet bottom-nav
- [ ] Badge incoming sur ces entrées ( Palier 5 )
- [ ] Retour navigation cohérent avec `bindNav` / stack router
- [ ] Tests : [`tests/uxNavSettings.test.js`](../tests/uxNavSettings.test.js) mis à jour si le markup Profil change ; nouveau test écran friends (contrats HTML)

**Fait quand** : on peut accepter une demande **après** avoir quitté le lobby, depuis la page Amis.

---

## Palier 7 — Unfriend

- [ ] Sur chaque fiche ami : action **Retirer** + `showAppConfirm` (confirmation locale seulement)
- [ ] RPC `unfriend` ; silencieux pour l’autre (la pastille Ami redevient **+ Ami** s’ils sont encore dans le même lobby via realtime DELETE `friendships`)
- [ ] Pas de notif « X t’a retiré »

**Fait quand** : A unfriend B → liste A à jour ; B voit **+ Ami** (ou absence de pastille Ami) sans toast.

---

## Palier 8 — Légal et store

Le graphe est une **nouvelle donnée personnelle**. Pas un fil public.

- [ ] [`data/legalContent.js`](../data/legalContent.js)
  - Données collectées : + *liste d’amis et demandes d’amitié (comptes inscrits)*
  - Suppression de compte : + *demandes et amitiés effacées en cascade*
  - Date `updated`
- [ ] Recopie sur le site OVH `privacy.html` (repo séparé, [`docs/LEGAL_SITE_OVH.md`](./LEGAL_SITE_OVH.md))
- [ ] [`docs/LAUNCH.md`](./LAUNCH.md) UGC : rester sur *No public social feed* ; préciser *private friend list, lobby-only discovery* si on touche la section store
- [ ] App Privacy Apple / Play Data safety : **uniquement si** on republie un build après cette feature (relations sociales / user IDs) — ne pas modifier les fiches tant que ce n’est pas dans un store build

**Fait quand** : politique in-app et page web disent la même chose.

---

## Palier 9 — QA terrain (staging, 2 comptes inscrits + 1 invité)

Deux téléphones ou deux navigateurs. Lobby code réel.

- [ ] Invité ne peut pas envoyer / recevoir
- [ ] Inscrit → inscrit : send, popup, accept → page Amis
- [ ] Refus : A revoit **+ Ami**, aucun texte de refus
- [ ] A peut renvoyer après cooldown 60 s
- [ ] Demandes croisées → amis sans double popup bizarre
- [ ] Rename / change emoji : page Amis affiche la **nouvelle** identité
- [ ] Kick du lobby : l’amitié **reste**
- [ ] Fermeture de lobby : demandes pending **restent** (page Amis)
- [ ] Pendant Draw It / Trivia : pas de modal ami
- [ ] Logout : plus de channel friends ; autre session ne voit pas les demandes d’un autre user
- [ ] Suppression de compte (staging) : plus de lignes `friend_requests` / `friendships` pour cet id
- [ ] Chat lobby : **aucune** ligne générée par ces actions
- [ ] `npm test` vert

**Fait quand** : liste ci-dessus cochée. Alors seulement Palier 10 prod.

---

## Palier 10 — Production

- [ ] Appliquer `feature-friends-01.sql` sur le projet Supabase **prod**
- [ ] Activer Replication Realtime `friend_requests` + `friendships`
- [ ] Ligne ✅ dans [`docs/DEPLOYMENTS_SQL.md`](./DEPLOYMENTS_SQL.md)
- [ ] Mention Realtime dans [`docs/SUPABASE.md`](./SUPABASE.md) §1
- [ ] Déployer le client (web / store selon le train de release en cours — **ne pas** coller ça dans le build App Store 1.0.0 déjà en review)

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
| 5 | 5 | Popup + badge |
| 6 | 6–7 | Page Amis + unfriend |
| 7 | 8–9 | Légal + QA |
| 8 | 10 | Prod (quand on choisit le train de release) |

Pour implémenter : ouvrir ce fichier et dire **« on fait le palier N »**.
