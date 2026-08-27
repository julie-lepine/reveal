# Supabase — REVEAL (setup, egress, emails)

Lancement : [LAUNCH.md](./LAUNCH.md) · Native : [NATIVE.md](./NATIVE.md) · SQL prod : [DEPLOYMENTS_SQL.md](./DEPLOYMENTS_SQL.md)

---

## 1. Projet Supabase

1. Crée un projet sur [supabase.com](https://supabase.com).
2. **SQL Editor** → colle et exécute le fichier `supabase/schema.sql`.
3. **Database → Publications** → publication `supabase_realtime` : activer les tables :
   - `lobbies`
   - `lobby_members`
   - `lobby_messages`
   - `game_sessions`
   - `lobby_polls` *(Vague 1 sondages — après `lobby-polls.sql`)*
   - `lobby_poll_votes` *(idem)*
   - `friend_requests` *(FEATURE-FRIENDS-01 — après `feature-friends-01.sql`)*
   - `friendships` *(idem — pas `friend_request_cooldowns`)*
   - `lobby_invites` *(FEATURE-FRIENDS-02 — après `feature-friends-02.sql`)*
4. Exécute aussi **`supabase/game-sessions.sql`** (multijoueur des jeux). Si les invités ne peuvent pas synchroniser les mini-jeux (erreur `PGRST116` ou `406` sur `PATCH game_sessions`), réexécute au minimum la politique `game_sessions_update` (section `with check`) de ce fichier.
5. Exécute **`supabase/lobby-lifecycle.sql`** (expiration, heartbeat `last_seen_at`, purge auto — voir § 7bis)
6. Exécute **`supabase/transfer-lobby-host.sql`** (transfert volontaire du rôle d'hôte depuis le menu jeux)
7. Exécute **`supabase/kick-lobby-member.sql`** (l'hôte peut retirer un joueur au lobby / entre deux jeux)
8. Exécute **`supabase/lobby-polls.sql`** (sondages « prochain jeu » — tables + RPC ; dépend de `is_lobby_host` / `is_acting_host` I-08/ARCH-03)
9. Exécute **`supabase/traitre-private.sql`** si tu joues à Spot the fake (dépend de `is_lobby_host`, fourni par `game-sessions-i08-arch03.sql`)
10. Exécute **`supabase/feature-adfree-01-profile-flag.sql`** (colonne `profiles.ad_free` + trigger anti auto-attribution — palier Sans pub)
11. Exécute **`supabase/feature-friends-01.sql`** puis **`supabase/feature-friends-02.sql`** (amis + invitations de salon). Realtime : `friend_requests`, `friendships`, `lobby_invites` (pas `friend_request_cooldowns`)

> **Fil Rouge / Mot interdit** — suppression applicative terminée (et serveur via **CLEANUP-FILROUGE-02 ✅** 2026-08-07). Ne pas exécuter `supabase/fil-rouge-private.sql` sur une install neuve. Sur le projet cible : table `fil_rouge_private` absente ; RPC actives sans Fil Rouge / sans `playlistGuess` regressé. Helper client `stripLegacyFilRougeKeys` conservé (anciens localStorage).

## 2. Clés API

1. **Project Settings → API** : copie l’URL et la clé `anon` (publique).
2. Copie `js/config/supabase.example.js` vers `js/config/supabase.js`.
3. Remplace `SUPABASE_URL` et `SUPABASE_ANON_KEY`.

## 3. Auth (Authentication → Providers)

### Invités sans compte (important)

1. **Authentication** → **Providers** → **Anonymous**
2. Passe le toggle sur **Enabled** / **Activé**
3. **Save**

Sans cette étape, l’onglet « Invité » + code ne peut pas fonctionner (l’app utilise `signInAnonymously`).

## 3bis. Autres providers

| Méthode | Action |
|--------|--------|
| **Email** | Activé — inscription / connexion |
| **Anonymous** | **Obligatoire pour l’onglet Invité** — sans ça : *« Anonymous sign-ins are disabled »* |
| **Facebook** | Activé — Meta Developer App (App ID + secret dans Supabase) |

**Instagram** : Supabase n’a pas de provider Instagram dédié. Le bouton Instagram utilise le même OAuth **Facebook (Meta)**. Les utilisateurs se connectent avec leur compte Meta lié à Facebook/Instagram.

### URLs de redirection

Dans **Authentication → URL Configuration**, ajoute :

- `http://localhost:5500` (ou ton serveur local)
- `https://ton-domaine.com`
- Même URL + chemin exact que `index.html` (ex. `http://127.0.0.1:5500/index.html`)
- **App native (Capacitor)** : `com.reveal.partygames://auth/callback`

Dans l’app Meta (Facebook Login), ajoute les mêmes URLs dans **Valid OAuth Redirect URIs** (format Supabase : `https://TON_PROJECT.supabase.co/auth/v1/callback`).

## 4. Comportement dans l’app

| Profil | Créer lobby | Rejoindre |
|--------|-------------|-----------|
| Email / Facebook | Oui | Code salon **ou** invitation d’ami (FEATURE-FRIENDS-02) |
| Invité anonyme | Non | Saisie manuelle du code (pseudo requis) |

- **Partage** : le lobby affiche le code + bouton pour **copier le code**. Invitations d’amis (FEATURE-FRIENDS-02) : **Rejoindre** sans code, inscrits seulement. Pas de QR, pas de lien `#join=`.
- Les anciens liens `#join=CODE` ne sont plus supportés : l’app les ignore (hash retiré, aucun préremplissage / auto-join).

Sans `supabase.js` configuré (URL/clé absentes ou placeholders), l’application produit **ne démarre pas** en multijoueur : écran terminal **Configuration requise** (`BACKEND_MISSING`). Il n’y a plus de « démo locale » runtime (auth locale, faux lobby, PNJ). La configuration Supabase est **nécessaire** pour exécuter REVEAL.

## 5. Dépendances

```bash
npm install
```

Le client charge `@supabase/supabase-js` via `esm.sh` dans le navigateur ; `npm install` sert aux tests et à Capacitor (voir [NATIVE.md](./NATIVE.md)).

## 6. Vérification rapide

1. Lance l’app (Live Server ou `npx serve .`).
2. Inscription email → créer un lobby → code visible + bouton copier le code.
3. Autre navigateur / navigation privée → onglet Invité → saisir le code → participants en temps réel.
4. Facebook : redirection Meta puis retour sur l’app avec session active.

## 7. Emails (Resend + OVH)

Les mails d’auth (reset mot de passe, etc.) passent par **Resend** en SMTP custom Supabase.

**Statut** : domaine vérifié, SMTP actif, reset MDP testé — 25 août 2026.

### Pourquoi Resend ?

| Sans Resend | Avec Resend |
|-------------|-------------|
| Quota email Supabase limité | Volume adapté à une vraie app |
| Expéditeur `@supabase.io` | Expéditeur `@ton-domaine.com` (plus pro) |
| Risque de spam / rate limit en soirée | Meilleure délivrabilité (SPF/DKIM) |

### Setup Resend

1. [resend.com](https://resend.com) → **Domains** → ajouter le domaine (sous-domaine `mail.…` recommandé)
2. **DNS OVH** : TXT vérification, DKIM (`resend._domainkey`), SPF si proposé
3. Attendre **Verified** dans Resend (propagation 5 min – 48 h)
4. **API Keys** → clé `re_…` (Sending access)
5. Supabase → **Authentication → SMTP Settings** :

| Champ | Valeur |
|-------|--------|
| Host | `smtp.resend.com` |
| Port | `465` (SSL) ou `587` (TLS) |
| Username | `resend` |
| Password | clé API `re_…` |
| Sender email | `noreply@mail.ton-domaine.fr` |
| Sender name | `REVEAL` |

6. (Optionnel) **Email Templates** : personnaliser reset MDP — modèle dans `supabase/email-reset-password.html`

### Tests emails

- [x] App REVEAL → **Mot de passe oublié** → mail reçu — 25 août 2026
- [x] Lien reset → ouvre l’app web (deep link iOS : [NATIVE.md](./NATIVE.md) § Test iPhone § E)
- [x] Expéditeur affiché (`REVEAL <noreply@…>`)

### Dépannage emails

| Symptôme | Piste |
|----------|--------|
| Resend « Checking DNS » longtemps | Attendre propagation ; revérifier TXT/CNAME dans OVH |
| Supabase « SMTP error » | Clé API invalide ; port 465 vs 587 ; sender pas sur domaine vérifié |
| Mail en spam | DKIM OK ? ; ajouter DMARC |
| Reset reçu mais lien cassé | Redirect URLs Supabase (web + `com.reveal.partygames://auth/callback`) |

## 7bis. Cycle de vie des lobbies (`lobby-lifecycle.sql`)

Après migration SQL, l’app envoie un **heartbeat** (`last_seen_at`) toutes les ~60–120 s.

| Règle | Durée |
|--------|--------|
| Refus de join (code expiré) | inactif > **24 h** |
| Purge lobby `waiting` | inactif > **2 h** |
| Purge lobby `playing` | inactif > **12 h** |
| Purge `waiting` sans personne en ligne | **45 min** |
| Purge sans aucun membre | immédiat (cron) |

**Purge automatique** : active l’extension **pg_cron** (Database → Extensions), puis exécute [`ops-lobby-04-enable-purge-cron.sql`](../supabase/ops-lobby-04-enable-purge-cron.sql) (job `reveal-purge-stale-lobbies`, toutes les 15 min). Validation : [`ops-lobby-04-purge-cron-runbook.sql`](../supabase/tests/ops-lobby-04-purge-cron-runbook.sql). Voir aussi [`DEPLOYMENTS_SQL.md`](./DEPLOYMENTS_SQL.md) §7.

**Raison de fermeture (BUG-LOBBY-XX-E)** : après OPS-04, appliquer [`lobby-closures-xx-e.sql`](../supabase/lobby-closures-xx-e.sql) pour les tombstones `lobby_closures` (`host_closed` / `inactive_expired`). Runbook : [`lobby-closures-xx-e-runbook.sql`](../supabase/tests/lobby-closures-xx-e-runbook.sql). Rétention tombstones : **14 jours**. Voir [`DEPLOYMENTS_SQL.md`](./DEPLOYMENTS_SQL.md) §8. **Ne pas** réexécuter E5-01 dissolve ni le corps historique de `lobby-lifecycle.sql` après XX-E.

Purge manuelle (SQL Editor) :

```sql
select public.purge_stale_lobbies();
```

Monitoring :

```sql
select * from public.lobby_lifecycle_audit limit 30;
```

Constantes alignées app ↔ SQL : `js/config/lobbyLifecycle.js`.

## 8. Egress (trafic sortant)

**Statut** : optimisations app + migration / org prod bouclées — 25 août 2026.

L’**egress** compte les octets renvoyés par l’API Postgres (REST), pas la taille de la base. Une DB de ~30 Mo peut générer plusieurs Go d’egress si le même `game_sessions.state` est retéléchargé en boucle.

### Optimisations dans l’app

| Mécanisme | Fichier |
|-----------|---------|
| Polling `game_sessions` : méta sans `state`, fetch complet seulement si `updated_at` change | `js/core/gameSync.js` |
| Hôte : plus de refetch systématique du `state` avant chaque patch (méta + cache comme l’invité) | `loadSessionRowForPatch` |
| Decks déshydratés dans `state` | `js/core/deckCodec.js` |
| Lobby : pas de 100 messages par défaut | `js/core/supabaseLobby.js` |
| Heartbeat présence + expiration lobbies | `js/config/lobbyLifecycle.js`, `supabase/lobby-lifecycle.sql` |
| Localhost : polling espacé (×3) | `js/config/syncConfig.js` |

Réglages dev : `js/config/syncConfig.js` (`EGRESS_RELAX_POLL_ON_LOCALHOST`, `LOCALHOST_POLL_MULTIPLIER`).

**Recommandation** : projet Supabase **séparé** pour le développement.

### SQL utile (Dashboard → SQL Editor)

Sessions les plus lourdes :

```sql
select
  gs.id,
  gs.lobby_id,
  gs.game_id,
  gs.screen,
  gs.updated_at,
  pg_column_size(gs.state) as state_bytes,
  l.code as lobby_code
from public.game_sessions gs
left join public.lobbies l on l.id = gs.lobby_id
order by state_bytes desc nulls last
limit 20;
```

Lobbies / sessions de test orphelins (à adapter avant `DELETE`) :

```sql
-- Vue monitoring (lobby-lifecycle.sql)
select * from public.lobby_lifecycle_audit limit 30;

-- Purge automatique des lobbies expirés
select public.purge_stale_lobbies();

-- Lobbies sans membre (aperçu)
select l.id, l.code, l.last_activity_at
from public.lobbies l
where not exists (
  select 1 from public.lobby_members m where m.lobby_id = l.id
);

-- Supprimer les game_sessions d’un lobby précis (cascade si tu supprimes le lobby)
-- delete from public.game_sessions where lobby_id = 'UUID_ICI';
```

### Habitudes dev

- Un onglet client en test solo ; fermer le lobby (hôte) en fin de session.
- Les lobbies abandonnés sont purgés côté serveur (voir `lobby-lifecycle.sql`) — activer pg_cron en prod.
- Éviter les F5 en boucle pendant un lobby actif (chaque boot refetch lobby + session).
- Vérifier **Usage → Egress** (Database), pas seulement Realtime Messages.
