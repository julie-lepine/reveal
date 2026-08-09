# FEATURE-TIERNIGHT-04C — customs Rank Live partagés (Supabase + sync)

**Statut** : `FEATURE-TIERNIGHT-04C implementation complete — SQL terrain validation pending — 04D NOT STARTED`  
**Date gate** : 2026-08-09  
**Correction pre-exec** : name/emoji reject (pas truncate) · `custom` strict · ID = prefix 04B réel  
**Git** : aucune opération Git  
**Contrats** : [04A](./FEATURE-TIERNIGHT-04A.md) · [04B](./FEATURE-TIERNIGHT-04B.md)

---

## Correction pre-exec SQL (avant staging)

### Contrats finaux (alignés `validateCustomLiveTierList`)

| Champ | Contrat |
|-------|---------|
| **name** | trim ; reject `<2` ou `>40` ; **jamais** truncate |
| **emoji** | absent/vide → `✨` ; non vide `>4` → **reject** ; jamais truncate |
| **custom** | clé **présente** + boolean JSON **`true`** uniquement |
| **id** | prefix `custom-live-` + suffixe non vide (= `isCustomLiveTierListId` JS) |

### Parité JS 04B

- **ID** : code réel = **prefix only** (pas de regex UUID). `createCustomLiveTierListId` préfère UUID ; fallback non-UUID reste valide. **Contradiction docs 04A « UUID » vs code** : on aligne SQL+harness sur le **code**, pas sur le prose UUID. Harness génère `custom-live-` + `gen_random_uuid()` (forme UUID, non exigée par le validateur).
- **custom** : JS acceptait l’absence → **resserré** pour exiger `custom === true` (parité SQL / ticket).
- **name/emoji** : validate JS rejetait déjà raw `>max` ; SQL tronquait → **corrigé** (reject).

### Correction terrain 03 — harness B1/B2 (plus de monolith)

Cause 42P01 toujours pas démontrée côté Editor ; fragilité structurelle éliminée :
- **16** `%rowtype` → `record`
- **B1** bootstrap commité séparément
- **B2** tests après assert B1
- **A inchangée — NE PAS réexécuter**

---

## Gate SQL (2026-08-09) — avant 04D

### A. Audit migration

| Check | Résultat |
|-------|----------|
| SQL raw valide (pas de fence MD / backslash parasite) | **oui** |
| `CREATE OR REPLACE` volontaire | **oui** (7 fonctions) |
| DROP table / destructive hors fixtures harness | **non** (migration) |
| `SECURITY DEFINER` + `search_path = pg_catalog, public` | **oui** (RPC mutantes) |
| `FOR UPDATE` sur `game_sessions` (lobby_id) | **oui** (upsert/delete/clear/preserve) |
| `assert_lobby_member` / host avant mutation | **oui** |
| `authorUid` client ignoré (`auth.uid()`) | **oui** |
| Replace complet collection client | **non** (jsonb_set entrée / rebuild list) |
| Surcharge `upsert_player_custom_entry` | **non** |

Fonctions créées/remplacées :

- `tiernight_parse_custom_live_writable`
- `tiernight_live_custom_pool_writable`
- `tiernight_live_build_custom_entry`
- `upsert_player_custom_live_tier_list`
- `delete_player_custom_live_tier_list`
- `clear_tiernight_custom_live_tier_lists`
- `upsert_game_session_preserving_roster_topics` (**remplacé**, extension additive)

Anomalies mineures notées (non bloquantes) :

1. Validation/build entry **avant** `FOR UPDATE` sur upsert (auth/membership déjà faits ; lock avant mutation/check writable).
2. Delete id absent = no-op write (pas d’erreur NOT_FOUND).
3. Divergence défensive writable non-bool : JS (`=== false` only) reste ouvert ; SQL type invalide → fermé.

Correctif gate appliqué : preserve live **refuse** hint client si serveur a `customLiveTierListsEpoch` + `[]` (anti-revive post-clear). Roster hint inchangé.

### B. Preserve partagé — blast radius

**Consommateur unique JS** : `upsertGameSessionPreservingRosterTopics` ← `startGameSession` / `pushGameSessionInner` / complete paths (`gameSync.js` → `supabaseGame.js`).

| Invariant | Preuve |
|-----------|--------|
| `customRosterTopics` preserve inchangé | branche roster TN02 non modifiée |
| `consumedCustomRosterTopicIds` | **non touché** par cette RPC |
| Session sans live | `v_live=[]` ; pas d’effet hors clé live |
| Clé live absente incoming ≠ clear | `jsonb_set` force valeur serveur/hint ; pas wipe implicite |
| Clé roster absente ≠ clear | idem |
| Anti-revive live post-clear | epoch serveur présent + `[]` → **pas** de hint |
| Jeux hors TierNight | même RPC hôte sur replace ; clés live/roster seulement réécrites ; autres clés = `p_state` |

Fragilité historique partagée (roster) : hint « base vide + incoming non vide » peut réparer une amputation **ou** (roster) ressusciter après clear si epoch non consulté. Live durci via epoch ; roster volontairement non refactoré dans ce gate.

### C. Predicate writable — matrice JS

| Cas | Attendu | JS |
|-----|---------|-----|
| A aucun live | writable | ✅ |
| B prep | writable | ✅ |
| C Ready false | writable | ✅ |
| D Ready true | writable | ✅ |
| E writable=true | writable | ✅ |
| F writable=false | locked | ✅ |
| G series.kind=live | locked | ✅ |
| H lobbyStarted && !finished | locked | ✅ |
| I finished=true (mono) | writable | ✅ (réouverture mono ; **≠** série moderne) |
| J malformé | défensif open | ✅ |

Parité SQL : même matrice dans harness R1 / diagnostics runbook.  
Cas I documenté : mono terminé réouvre les contributions ; une série moderne `kind:"live"` reste locked même si `finished` ambigu.

### D. Gate 04E — atomicité launch (FIGÉ)

**Interdit** (états intermédiaires observables) :

1. `writable=false` puis commit série  
2. commit série puis `writable=false`

**04E DOIT**, sous **une** autorité transactionnelle (`FOR UPDATE` session) :

- verrouiller la session ;
- relire le pool sous lock ;
- valider prep / roundCount ;
- builder sous-ensemble + snapshots ;
- créer `tierNightLive.series` (`kind:"live"`) ;
- projeter la 1ʳᵉ liste ;
- setter `customLiveTierListsWritable=false` ;
- **commit unique**.

Raison : le launch est la frontière produit définitive — aucun état « pool locked sans série » ni « série sans lock ».

### E. Instructions Supabase (à exécuter par toi)

1. **(C optionnel)** diagnostics lecture seule — copier depuis  
   `supabase/feature-tiernight-04c-custom-live-tier-lists-runbook.sql`
2. **(A)** migration — exécuter **tout** le fichier  
   `supabase/feature-tiernight-04c-custom-live-tier-lists.sql`
3. **(B)** harness — exécuter **tout** le fichier  
   `supabase/feature-tiernight-04c-custom-live-tier-lists-smoke-harness.sql`  
   Prérequis : ≥ 2 `auth.users` **sans** membership vivant ; rôle postgres/supabase_admin.
4. Succès attendu : notices `C* OK` ; cleanup final `0` lobbies `TN04C%`.  
   Secours : `select public.tn04c_cleanup_fixtures();`
5. **Me renvoyer** : sortie notices / exceptions + résultat R0–R1 + cleanup.

### F. Résultats SQL

`SQL TERRAIN PENDING` — non exécutable depuis cet environnement Cursor.

### G. Tests JS (rejoués gate)

Voir section 14 ci-dessous (counts après re-run).

### H. Statut

`FEATURE-TIERNIGHT-04C implementation complete — SQL terrain validation pending — 04D NOT STARTED`

Après harness staging entièrement conforme → `FEATURE-TIERNIGHT-04C ready for 04D`.

---

## 1. Inventaire

| Zone | Constat |
|------|---------|
| `upsert_player_custom_entry` | HT / Dilemma / roster — **non surchargé** |
| Preserve | étendu additif live + anti-revive epoch |
| Pattern client | mirror roster session/sync/merge |
| Modération | `hotTakeModeration.js` pur |

## 2. Modération

`checkHotTakeModeration(text)` sync/pur ; Rank Live = 1+N (name puis items) avant RPC ; pas de modération SQL.

## 3–9. Canon / RPC / lock / atomicité / sync / preserve

Inchangés vs implémentation 04C ; détails gate ci-dessus.

## 10–11. Fichiers / SQL

| Artefact | Rôle |
|----------|------|
| `feature-tiernight-04c-custom-live-tier-lists.sql` | **A** migration |
| `feature-tiernight-04c-custom-live-tier-lists-smoke-harness.sql` | **B** harness C1–C25 |
| `feature-tiernight-04c-custom-live-tier-lists-runbook.sql` | ordre + **C** diagnostics |

## 12. Tests SQL

Harness prêt staging ; **terrain pending**.

Lost-update : preuve **structurelle** `FOR UPDATE` + A puis B séquentiels ; dual-tx concurrente réelle = QA intégration.

## 13–14. Tests JS / non-régression

Gate 2026-08-09 — **297 pass / 0 fail** sur :

- `featureTierNight04b` · `featureTierNight04c`
- `featureTierNight01CustomRoster` · `featureTierNight02CustomRosterSync`
- `featureTierNight03` · `featureTierNight03e1`
- `sessionMerge` · `featureDilemma01MultiCustom`
- `bugTierNightClearCustomRoster01`
- `hotTakePodiumMp` · `hotTakeSyncPending` · `dilemmaSyncPending`

## 15–17. Baseline / taille / dettes

Clear anti-revive SQL durci. Launch atomique = dette **04E**. UI = **04D** (non démarré).

## 18. Statut

`FEATURE-TIERNIGHT-04C implementation complete — SQL terrain validation pending — 04D NOT STARTED`
