# Configuration Supabase — REVEAL

## 1. Projet Supabase

1. Crée un projet sur [supabase.com](https://supabase.com).
2. **SQL Editor** → colle et exécute le fichier `supabase/schema.sql`.
3. **Database → Replication** : active la réplication Realtime pour :
   - `lobbies`
   - `lobby_members`
   - `lobby_messages`
   - `game_sessions`
4. Exécute aussi **`supabase/game-sessions.sql`** (multijoueur des jeux). Si les invités ne peuvent pas synchroniser Fil Rouge / mini-jeux (erreur `PGRST116` ou `406` sur `PATCH game_sessions`), réexécute au minimum la politique `game_sessions_update` (section `with check`) de ce fichier.
5. Exécute **`supabase/lobby-nudge.sql`** (wizz hôte → joueurs pas prêts : colonnes `nudge_at`, `nudge_for` sur `lobbies`)
6. Exécute **`supabase/fil-rouge-private.sql`** (Fil Rouge — missions privées par joueur)

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

Dans l’app Meta (Facebook Login), ajoute les mêmes URLs dans **Valid OAuth Redirect URIs** (format Supabase : `https://TON_PROJECT.supabase.co/auth/v1/callback`).

## 4. Comportement dans l’app

| Profil | Créer lobby | Rejoindre |
|--------|-------------|-----------|
| Email / Facebook | Oui | Code, lien `#join=CODE`, QR |
| Invité anonyme | Non | Code, lien, QR (pseudo requis) |

- **Lien d’invitation** : `https://ton-site/#join=ABC123` (hash lu au chargement → onglet Invité prérempli).
- **QR** : encode le même lien ; scan → rejoindre en invité.

Sans `supabase.js` configuré, l’app reste en **mode démo locale** (localStorage + simulation de joueurs).

## 5. Dépendances

```bash
npm install
```

Le client charge `@supabase/supabase-js` via `esm.sh` dans le navigateur ; `npm install` sert aux tests et à Capacitor (voir [CAPACITOR.md](./CAPACITOR.md)).

**Lancement web** : [LAUNCH_CHECKLIST.md](./LAUNCH_CHECKLIST.md)

## 6. Vérification rapide

1. Lance l’app (Live Server ou `npx serve .`).
2. Inscription email → créer un lobby → code + QR visibles.
3. Autre navigateur / navigation privée → onglet Invité → code ou lien → participants en temps réel.
4. Facebook : redirection Meta puis retour sur l’app avec session active.
