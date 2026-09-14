# Signature & Maître de soirée

Signature = `profiles.profile_pack` (6,99 € / upgrade 4,00 €). Maître = `profiles.host_pack` (9,99 / 7,00 / 3,00 €). **Pas** le rôle hôte de salon (`lobbies.host_id`).

Maître **inclut** Signature et Sans pub (UI + webhook posent les trois flags). Cap **14** seulement si le `host_id` du salon a `host_pack`. Un Maître invité n’élargit pas le lobby.

Hors scope : outils de table · mots perso Draw It / Tier Night.

**Recette Pages + SQL** (7–8 sept 2026, Anrobensy) : tickets code fermés (H-SQL, H-RACE, AV-REPLACE, LEGAL, identité, carnet, cap 8/14, kick 14, spoof, triggers). Il reste **l’app native** et les **stores**.

---

## SQL

```sql
select id, display_name, ad_free, profile_pack, host_pack, name_color, avatar_path
from public.profiles
where id = '<uuid>';
```

Anrobensy `0e36808e-52e3-461d-a424-906129b24aed` — remettre les packs après un test :

```sql
update public.profiles
set host_pack = true, profile_pack = true, ad_free = true
where id = '0e36808e-52e3-461d-a424-906129b24aed';
```

Le SQL Editor (`postgres`) **peut** changer les flags. Un `UPDATE` **client** (JWT) est ignoré par les triggers protect.

---

## Forfaits

| État | Signature | Maître |
| ---- | --------- | ------ |
| Rien | 6,99 € | 9,99 € |
| Sans pub seul | **4,00 €** | **7,00 €** |
| Signature | Actif | **3,00 €** |
| Maître | Inclus | Actif |

Invité : pas de bouton d’achat, hint **compte e-mail**. Web : « dans l’app native ».

---

## Encore à jouer (native / stores)

À faire **ce week-end** sur téléphone, **sans GitHub Pages**. Cocher au fur et à mesure. En cas de doute : SQL d’abord, UI ensuite.

### Avant de commencer

1. **App installée** (APK / Play interne / TestFlight), pas le site.
2. Compte **e-mail inscrit** (pas Invité). Noter l’UUID (`profiles.id`) — requête SQL plus haut.
3. Licence tester Play (ou sandbox Apple) sur le **même** Google / Apple que le téléphone.
4. Ouvrir le SQL Editor **avant** le 1er achat, onglet prêt avec `where id = '<uuid>'`.

**Règles d’or**

- Un achat Play/Apple est **à vie sur ce compte store**. Remettre `host_pack = false` en SQL **ne permet pas** de racheter le même SKU. Pour retester le même tarif : **rembourser** la commande sandbox, **puis** SQL, **puis** kill + relance. Sinon : autre compte e-mail + autre compte store.
- Après un achat, l’app attend le webhook **8 secondes**. Si le SQL n’a pas bougé : **ne rachète pas**. Force-stop l’app, relance, reconnecte, relance la requête SQL. L’UI peut déjà afficher le pack (overlay session) alors que SQL est encore `false` — c’est le cas « activation jusqu’à une minute ».
- Overlay = affichage temporaire côté téléphone. **Seul le webhook** écrit `ad_free` / `profile_pack` / `host_pack`. Un restore / overlay vert + SQL `host_pack = false` = webhook pas encore passé (ou jamais, voir test 10).

**Où cliquer** : Menu → Forfaits. Pubs = bannières / interstitiels en lobby ou entre jeux.

### Parcours (un par UUID, sauf upgrades)

Idéal : **3 comptes** (ou 1 compte + refunds entre chaque).

| Compte | Départ SQL (tout `false`) | Acheter | Prix attendu |
| ------ | ------------------------- | ------- | ------------ |
| A | rien | Signature, puis Maître | 6,99 puis **3,00** |
| B | rien | Maître direct | **9,99** |
| C | rien | Sans pub, puis Maître | 2,99 puis **7,00** |

Sans 3 comptes : faire A, rembourser Signature **et** Maître, SQL reset, puis B, etc.

---

- [x] **1. Prix au repos** — inscrit, **aucun** palier (`ad_free` `profile_pack` `host_pack` tous false). Menu → Forfaits : **2,99 / 6,99 / 9,99**. Invité : pas de bouton d’achat, hint compte e-mail. Sur le **web** : « dans l’app native ».

- [x] **2. Signature refuse si Maître déjà là** — SQL `host_pack = true` (vrai achat Maître, ou Anrobensy déjà Maître). Menu → Forfaits : Signature **Inclus** / déjà actif, **pas** de paiement 6,99. Un tap ne doit **pas** ouvrir la feuille Play/Apple.

- [x] **3. Achat Signature 6,99** (compte A, rien en SQL). Payer `reveal_profile`. **≤ 8 s** puis SQL : `profile_pack = true`, `ad_free = true`, `host_pack = false`. UI : Signature actif, pubs coupées, couleur / photo / carnet dispo. Maître affiche **3,00 € de plus**. Si SQL encore false après 8 s → message « jusqu’à une minute » / « rouvre le menu » : kill + relance, **pas** un 2ᵉ achat.

- [x] **4. Achat Maître** — trois flags **true**, pubs coupées. Vérifier les **trois** tarifs (comptes A/B/C ou refunds) :

  | Départ | Bouton | SKU | SQL après succès |
  | ------ | ------ | --- | ---------------- |
  | rien | 9,99 | `reveal_host` | `host_pack` `profile_pack` `ad_free` = true |
  | Sans pub seul | 7,00 | `reveal_host_upgrade_adfree` | idem |
  | Signature | 3,00 | `reveal_host_upgrade_profile` | idem |

  Cap lobby : **toi hôte** → 14. Un Maître **invité** dans un salon d’un non-Maître → toujours **8**.

- [x] **5. Timeout poll** — si l’activation SQL dépasse ~8 s : toast du type *« Achat enregistré. L’activation peut prendre une minute »* (Maître restore : *« …jusqu’à une minute »*). **Ne pas** racheter. Attendre / kill+relance. SQL doit finir par passer ; si au bout d’**une minute** les flags sont encore false → noter UUID + heure, regarder RevenueCat (customer = UUID ?) et logs webhook.

- [x] **6. Restore Play** — après un achat **réussi** (SQL déjà true). 2ᵉ téléphone **ou** désinstall / réinstall, **même** compte e-mail Reveal + même compte Google. Menu → restaurer (pas racheter). UI : packs visibles. SQL : flags **inchangés** (toujours true). L’overlay ne doit **jamais** passer `host_pack` à true **tout seul** : sur un UUID **sans** pack en base, un restore ne doit pas laisser `host_pack = true` en SQL si le webhook n’a rien écrit. Si l’UI montre Maître mais SQL `host_pack = false` : overlay OK, attendre le webhook ; si SQL reste false → bug / `app_user_id` (test 10).

- [x] **7. Refunds sandbox** — Play Console → commandes / Order management (licence tester) : rembourser **un** produit, attendre 1–2 min, kill+relance, SQL. Flags = **table Refunds** ci-dessous. Puis Menu (cartes), pubs (reviennent si `ad_free` false), couleur / photo **conservées** (ID-OLD), carnet (bloqué si plus Signature), cap lobby (14 → 8 si tu es l’hôte et `host_pack` tombe). Cosmétiques restent si tu **re-grantes** le pack après.

- [x] **8. Fiches store** — Play Console + App Store Connect : texte / captures. **Ne pas** promettre outils de table ni mots perso Draw It / Tier Night (hors scope). OK : 14 joueurs, Signature (profil, carnet), sans pub.

- [x] **9. RevenueCat (dashboard)** — entitlements exactement `ad_free`, `profile`, `host`. Produits attachés, **mêmes** SKUs Play **et** iOS : `reveal_adfree`, `reveal_profile`, `reveal_profile_upgrade`, `reveal_host`, `reveal_host_upgrade_adfree`, `reveal_host_upgrade_profile`. Offering actuel : le bon package selon le palier déjà possédé.

- [ ] **10. Webhook (si accès dashboards)** — customer RevenueCat = **UUID** du profil, pas `$RCAnonymousID…`. Cas connus (pas un crash) : `app_user_id` invalide ou `$RC…` → webhook **200**, SQL **inchangé**. Profil pas encore créé (UPDATE 0 rows) → **200** quand même, **grant perdu** jusqu’au **prochain** event (nouvel achat, restore, ou re-delivery RC). Après un achat OK : logs Edge Function `revenuecat-webhook` + SQL alignés.

**Anrobensy** (`0e36808e-…`) : après les tests, recoller le `UPDATE … host_pack = true, profile_pack = true, ad_free = true` du § SQL.

Optionnel métier (Pages déjà OK, native si le temps) : **C-KICK** — 2 joueurs Signature, une manche, kick **entre deux jeux** → le kické garde le carnet. Autres jeux identité : 1 partie + chat / scores.

### Refunds

| Produit remboursé | `host_pack` | `profile_pack` | `ad_free` |
| ----------------- | ----------- | -------------- | --------- |
| `reveal_profile` | — | false | false |
| `reveal_profile_upgrade` | — | false | **gardé** |
| `reveal_host` (9,99) | false | false | false |
| `reveal_host_upgrade_profile` (3 €) | false | **gardé** | **gardé** |
| `reveal_host_upgrade_adfree` (7 €) | false | **false** | **gardé** |

Cosmétiques (couleur / photo / emoji) **conservés** si le pack revient (ID-OLD).

---

## Rappels métier (déjà QA Pages)

- Kick : attente + **entre deux jeux**, pas mid-manche. OK à 14.
- Join : cap serveur `lobby_full` (H-RACE). 8 sans Maître, 14 si hôte Maître. Membres déjà là restent si le cap redescend.
- Invite : à 14/14 (ou 8/8) → « Soirée complète », pas d’envoi.
- Carnet : inscrit + pack + membre + une partie jouée. Prénoms = amis **encore** amis, jamais le code salon. RPC sans `lobby_id`.
- Stamp salon `lobby_members.signature` = colonne `profile_pack` (le webhook Maître pose aussi `profile_pack`).
- Overlay session (`__revealPremium`) : ne repeint pas l’écran courant ; F5 relit SQL.

---

## Fichiers

| Zone | Fichiers |
| ---- | -------- |
| Flags | `js/core/entitlements.js`, `js/core/supabaseProfile.js` |
| IAP | `js/core/purchases.js`, `data/revenueCatConfig.js`, `supabase/functions/revenuecat-webhook/index.ts` |
| Cap 8/14 | `js/config/lobbyLifecycle.js`, `js/core/supabaseLobby.js` |
| UI Forfaits | `js/core/hostPackUi.js`, `js/core/profilePackUi.js`, `js/core/adFreeUi.js` |
| Contrat | `docs/LAUNCH.md`, `docs/DEPLOYMENTS_SQL.md` §22 |
