# Configuration Supabase — REVEAL

## 1. Projet Supabase

1. Crée un projet sur [supabase.com](https://supabase.com).
2. **SQL Editor** → colle et exécute le fichier `supabase/schema.sql`.
3. **Database → Replication** : active la réplication Realtime pour :
   - `lobbies`
   - `lobby_members`
   - `lobby_messages`
   - `game_sessions`
4. Exécute aussi **`supabase/game-sessions.sql`** (multijoueur des jeux). Si les invités ne peuvent pas synchroniser les mini-jeux (erreur `PGRST116` ou `406` sur `PATCH game_sessions`), réexécute au minimum la politique `game_sessions_update` (section `with check`) de ce fichier.
5. Exécute **`supabase/lobby-nudge.sql`** (wizz hôte → joueurs pas prêts : colonnes `nudge_at`, `nudge_for` sur `lobbies`)
6. Exécute **`supabase/lobby-lifecycle.sql`** (expiration, heartbeat `last_seen_at`, purge auto — voir ci-dessous)
7. Exécute **`supabase/transfer-lobby-host.sql`** (transfert volontaire du rôle d'hôte depuis le menu jeux)
8. ~~Exécute **`supabase/fil-rouge-private.sql`**~~ *(Mot interdit / Fil Rouge abandonné — optionnel, voir `data/filRouge.js` `FIL_ROUGE_ENABLED`)*

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
| Email / Facebook | Oui | Code ou lien `#join=CODE` |
| Invité anonyme | Non | Code ou lien d’invitation (pseudo requis) |

- **Lien d’invitation** : `https://ton-site/#join=ABC123` (hash lu au chargement → onglet Invité prérempli).
- **Lobby hôte** : code affiché + bouton « Copier le lien » (pas de scan QR dans l’app).

Sans `supabase.js` configuré, l’app reste en **mode démo locale** (localStorage + simulation de joueurs).

## 5. Dépendances

```bash
npm install
```

Le client charge `@supabase/supabase-js` via `esm.sh` dans le navigateur ; `npm install` sert aux tests et à Capacitor (voir [CAPACITOR.md](./CAPACITOR.md)).

**Lancement web** : [LAUNCH_CHECKLIST.md](./LAUNCH_CHECKLIST.md)

## 6. Vérification rapide

1. Lance l’app (Live Server ou `npx serve .`).
2. Inscription email → créer un lobby → code + lien d’invitation visibles.
3. Autre navigateur / navigation privée → onglet Invité → code ou lien → participants en temps réel.
4. Facebook : redirection Meta puis retour sur l’app avec session active.

## 7. Emails (Resend + OVH)

Les mails d’auth (reset mot de passe, etc.) passent par **Resend** en SMTP custom Supabase.

→ Guide complet : **[RESEND_SETUP.md](./RESEND_SETUP.md)**

Résumé :

1. Domaine vérifié dans Resend (DNS OVH : TXT, DKIM…)
2. Supabase → **Authentication → SMTP Settings** → `smtp.resend.com`
3. Tester « Mot de passe oublié » depuis l’app

## 7bis. Cycle de vie des lobbies (`lobby-lifecycle.sql`)

Après migration SQL, l’app envoie un **heartbeat** (`last_seen_at`) toutes les ~60–120 s.

| Règle | Durée |
|--------|--------|
| Refus de join (code expiré) | inactif > **24 h** |
| Purge lobby `waiting` | inactif > **2 h** |
| Purge lobby `playing` | inactif > **12 h** |
| Purge `waiting` sans personne en ligne | **45 min** |
| Purge sans aucun membre | immédiat (cron) |

**Purge automatique** : active l’extension **pg_cron** (Database → Extensions), puis décommente le bloc `cron.schedule` en bas de `supabase/lobby-lifecycle.sql` (toutes les 15 min).

Purge manuelle (SQL Editor) :

```sql
select public.purge_stale_lobbies();
```

Monitoring :

```sql
select * from public.lobby_lifecycle_audit limit 30;
```

Constantes alignées app ↔ SQL : `js/config/lobbyLifecycle.js`.

## 8. Egress (quota « sortant »)

Si le dashboard affiche **Egress > 100 %** avec une petite base : c’est surtout les **lectures répétées** de `game_sessions.state`, pas Realtime. Voir **[SUPABASE_EGRESS.md](./SUPABASE_EGRESS.md)** (réglages app, SQL de nettoyage, bonnes pratiques dev).
