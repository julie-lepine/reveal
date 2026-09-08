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

Compte **inscrit**, app native (pas Pages). Un palier par UUID sauf parcours upgrade. Après achat : poll ≤ 8 s, sinon kill + relance. Vérifier SQL, pas seulement l’UI.

- [ ] Inscrit natif sans palier : cartes 2,99 / 6,99 / 9,99.
- [ ] `purchaseProfile` refuse si Maître déjà là.
- [ ] Achat Signature : `profile_pack` + `ad_free` ; `host_pack` false. Pubs coupées.
- [ ] Achat Maître (9,99 / 7,00 / 3,00) : **trois** flags true. Pubs coupées.
- [ ] Timeout poll : message « jusqu’à une minute », pas un 2ᵉ achat.
- [ ] Restore Play (2ᵉ appareil / réinstall). Overlay ne doit **pas** écrire `host_pack`.
- [ ] Refunds sandbox (table ci-dessous) : Menu, pubs, couleur, carnet, cap lobby.
- [ ] Fiches Play / ASC : ne pas promettre outils de table ni mots perso.
- [ ] RevenueCat : entitlements `ad_free`, `profile`, `host` ; SKUs Play + iOS alignés.
- [ ] Webhook : `app_user_id` non-UUID / `$RC…` → 200, flags inchangés. UPDATE 0 rows (profil pas encore créé) → grant perdu jusqu’à un nouvel event.

Optionnel : C-KICK (2 Signature, une manche, kick → carnet du kické) · autres jeux §identité (1 jeu + chat/scores déjà OK).

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
