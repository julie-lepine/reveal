# FEATURE-TIERNIGHT-03 — Étape D1-bis — Rapport

**Statut** : Étape D consolidée côté code **et smokes PostgreSQL métier verts sur staging**.  
Machine d’état sans phase bloquante.  
Gate production toujours OFF.  
**Cleanup final fixtures `TNSD1B%` / helpers `tnsd1b_*` : en cours côté manuel** (prochain retour).  
Étapes E et F restantes.  
QA terrain **non réalisée**.  
**FEATURE-TIERNIGHT-03 n’est pas clôturée.**

**Date** : 2026-08-06  
**Git** : aucune opération Git

---

## 1. `round_result` — Option A (confirmée serveur)

| Point | Statut |
|-------|--------|
| Origine SERIES-00, jamais écrite par finalize/advance | confirmé |
| Shape D1-bis → `TNS_UNKNOWN_PHASE` + detail `round_result` | **vert staging** |
| Finalize / advance : aucun transition, aucune mutation | **vert staging (R2–R5 autonome)** |
| JS `PHASE_RETIRED` / écran `null` / pas d’impasse CTA | code + tests |

Machine canonique : `ranking` | `between_rounds` | `series_end`.

---

## 2. SQL final — ordre d’application staging

1. finalize 03 → **03A** (+ finished-flag si besoin)  
2. advance **05**  
3. A1-bis (historique éventuel)  
4. **`feature-tiernight-03-d1bis-series-shape-canonical.sql`** ★ **dernière définition du validateur**  
5. **`feature-tiernight-03-d1bis-finalize-v-rec-scope-fix.sql`** ★ **obligatoire** (fix 42P01)  

### Correctif `v_rec` (obligatoire)

| | |
|--|--|
| Symptôme | `ERROR 42P01: missing FROM-clause entry for table "v_rec"` |
| Cause | `v_rec jsonb` + accès `v_rec.elem` (syntaxe RECORD) |
| Fix | `for v_rec in select value …` ; `v_rec ->> 'uid'` / `consensusPoints` |
| Fichier | `supabase/feature-tiernight-03-d1bis-finalize-v-rec-scope-fix.sql` |
| Contrainte | **Ne pas** rejouer le fichier 03A complet (écraserait le shape D1-bis) |

### Validateur D1-bis (dernier)

- counts `3/5/7/8` ; customs stricts ; phases sans `round_result`  
- commentaire fonction contient `D1-bis`  
- ACL helper : non exécutable `authenticated`

---

## 3. Résultats smokes PostgreSQL (staging réel)

| Groupe | Résultat |
|--------|----------|
| P1–P8 préchecks / shape / ACL / DEFINER / search_path | **vert** |
| F1–F11 finalize | **vert** |
| A1–A10 advance | **vert** |
| L1–L6 last 3/5/8 + legacy 7 + `tierNightsPlayed` ×1 | **vert** |
| C1–C5 customs + count 8 | **vert** |
| R2–R5 `round_result` (smoke **autonome**) | **vert** |
| Cleanup final `TNSD1B%` + drop `tnsd1b_*` | **en cours** |

### Note exécution R

Un `TNS_STALE_RUN` observé en premier passage provenait d’une **exécution fragmentée** du bloc K (contexte `tnsd1b_smoke_ctx` d’un run précédent), **pas** d’un bug RPC.  
Preuve : identité `ctx.run_id` ≡ `tierNight.runId` ≡ préfixe `queue[0].roundId` après inject ; smoke autonome vert.  
**Ne jamais** accepter `TNS_STALE_RUN` dans R lorsque l’identité est prouvée.

Harness : `supabase/feature-tiernight-03-d1bis-smoke-harness.sql` (bloc K autonome).  
Index : `supabase/feature-tiernight-03-d1bis-smoke-runbook.sql`.

---

## 4. Alignement produit (inchangé)

| Couche | `round_result` |
|--------|----------------|
| SQL shape | rejeté |
| JS phases | absent / `PHASE_RETIRED` |
| Screen | `null` |
| CTA advance | only `between_rounds` |

---

## 5. Tests automatisés

```bash
node --experimental-test-module-mocks --test tests/featureTierNight03d1bis.test.js
```

Périmètre A–D1-bis / SERIES : à rejouer après toute modif harness (voir session).

---

## 6. Hors scope / suite

- Pas d’étape **E** tant que cleanup final non confirmé puis go produit  
- Gate production **OFF**  
- QA terrain **non réalisée**  
- Ticket **FEATURE-TIERNIGHT-03 non clôturé**
