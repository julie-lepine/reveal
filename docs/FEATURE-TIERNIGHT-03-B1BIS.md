# FEATURE-TIERNIGHT-03 — Étape B1-bis — Rapport

**Statut** : Étape B entièrement consolidée et régressions vertes. Gate série toujours OFF. Étapes C à F restantes. QA terrain non réalisée.  
**Date** : 2026-08-05  
**Git** : aucune opération Git

---

## 1. mpLaunchLaunch

### Cause exacte

Le harness utilisait `mock.module(..., { exports: { ... } })`.

Avec le mock ESM expérimental de Node, **`exports` ne fournit pas les named exports ESM**.  
`mpLaunch.js` importe :

```js
import { DEFAULT_SYNC_PATCH_TIMEOUT_MS, ... } from "./gameSync.js";
```

→ `SyntaxError: does not provide an export named 'DEFAULT_SYNC_PATCH_TIMEOUT_MS'` **avant toute assertion**.

L’export existe bien dans le produit (`gameSync.js` ligne ~282). La failure était donc **100 % harness**, préexistante au sens « mock incorrect », indépendante des changements métier B1 (preuve : même clé `exports:` vs suites vertes qui utilisent `namedExports:` — ex. `triviaRevealCommit.test.js`).

### Correction

Harness uniquement (`tests/mpLaunchLaunch.test.js`) :

- `gameSync` / `dialog` / `supabaseAuth` : `exports:` → **`namedExports:`**
- Aucune assertion retirée
- Aucune modification produit artificielle

### Résultat suite seule

```text
node --experimental-test-module-mocks --test tests/mpLaunchLaunch.test.js
→ 20 pass / 0 fail
```

---

## 2. Customs → catalogue (pas readiness)

### Historique B1 / B1-bis (obsolète)

Une mutation de pool (add/remove custom) déclenchait `setupEpoch++` + `ready:{}` (hôte) ou clear ready local + `poolInvalidateRequest` (invité).

### Contrat actuel (BUG-TIERNIGHT-PREP-READY-CUSTOM-01)

| Acteur | Action |
|--------|--------|
| Tout joueur | Add/remove custom via RPC catalogue uniquement |
| Hôte hydrate | Met à jour l’empreinte customs ; **ack** `poolInvalidateRequest` si présent |
| Ready / `setupEpoch` | **Inchangés** sur simple évolution du catalogue |
| Catégories / roundCount | Seuls réglages structurants qui clear ready + bump epoch |

### Autorité

- Seul hôte / `canActAsHost()` publie un nouvel epoch **structurant**.
- Invité ne peut pas modifier `categoryIds` / `roundCount` (`HOST_ONLY`).
- Ready stale : patch avec `expectedSetupEpoch` inférieur → ignoré (`mergeTierNightPrepRemoteState`).
- Queue de série : construite au **clic launch** depuis `getCustomRosterTopics()` à jour.

### Stale / ack catalogue

- `shouldHonorPoolInvalidateRequest` : même `requestId` → skip.
- Empreinte customs : signature suivie pour anti-spam ; **pas** d’invalidation ready.
- Epoch ne régresse jamais.

---

## 3. Atomicité launch

### Séquence

1. Validate setup (sinon **aucune** mutation).
2. `prepareTierNightSeriesLaunchAttempt` (queue mémoire).
3. `mergedConsumed = merge(previous, series)`.
4. `markTierNightSeriesStarted({ attempt, consumedCustomRosterTopicIds, resetPrepSession })` :
   - **Apply local immédiat** : `tierNightGame` (series + `lobbyStarted: true`) + consumed + prep reset.
   - **Un seul** `launchGameWithSync` / **un seul** `getRemoteState` → **un push**.

### Payload conceptuel (même mutation)

```text
tierNight:
  series: { runId, queue, phase: ranking, roundIndex: 0, ... }
  lobbyStarted: true
  playerRoster: [ { userId, displayName }, ... ]
  ...
tierNightLive: <reset>
tierNightPrep:
  categoryIds: ["*"]
  roundCount: 5
  ready: {}
  setupEpoch: 0
consumedCustomRosterTopicIds:
  [ ...union précédente + customs de CETTE queue ]
```

### Réseau / rollback / timeout

| Cas | Comportement |
|-----|----------------|
| Appels réseau | **1** `pushGameSession` (mode push) via `commitMultiplayerLaunch` |
| Échec avant acceptation | Rollback local des **trois** blocs (`previousLocal`) |
| Timeout + fallback | `launchGameWithSync` applique local + retry background (ARCH-08) ; ledger déjà local ; hydrate réconcilie |
| Réponse perdue / succès serveur | Realtime/hydrate : series présente → `reconcileConsumedCustomRosterTopicIds` |
| Retry | Même `attempt` (pas de nouveau RNG) côté SERIES-04 ; pas de 2e queue si série déjà active |
| Remote stale `consumed: []` | Union monotone — pas de shrink |

Preuve source : une seule occurrence `launchGameWithSync(` dans `markTierNightSeriesStarted` ; remote construit avec les trois clés.

---

## 4. Tests

### Commandes obligatoires §4

```text
node --experimental-test-module-mocks --test ^
  tests/mpLaunchLaunch.test.js ^
  tests/mpLaunch.test.js ^
  tests/prepLaunch.test.js ^
  tests/prepReadyToggle.test.js ^
  tests/featureTierNight03b.test.js ^
  tests/featureTierNight03b1.test.js ^
  tests/featureTierNight03b1bis.test.js ^
  tests/featureTierNight02CustomRosterSync.test.js ^
  tests/sessionMerge.test.js ^
  tests/syncPrepOnMount.test.js ^
  tests/guestMustFollow.test.js ^
  tests/prepReadyRestart.test.js ^
  tests/featureDilemma01MultiCustom.test.js ^
  tests/featureDilemma01QaFixes.test.js
```

**Résultat : 261 pass / 0 fail**

### Passe B1 complète (+ mpLaunchLaunch)

Inclut A/A1/A1bis/B/B1/B1bis, SERIES-01→05, TN-01/02, BUG-03/04/05, prep*, mpLaunch*, nav, Hot Take, Dilemma, hydrate, restart, live…

**Résultat : 606 pass / 0 fail**  
Aucune failure baseline restante sur `mpLaunchLaunch` ni sur les helpers launch/prep du périmètre direct.

### Suite nouvelle

`tests/featureTierNight03b1bis.test.js` — harness mpLaunch, ready global, atomicité, wiring host honor.

---

## 5. Fichiers

| Fichier | Rôle |
|---------|------|
| `tests/mpLaunchLaunch.test.js` | Fix `namedExports` |
| `js/core/tierNightSeriesPrepSession.js` | Invalidation globale + honor request/customs + coalesce |
| `js/core/tierNightSeriesPrepContracts.js` | Signature customs, shouldHonor, merge request id |
| `js/core/gameSync.js` | Codec request id ; hooks honor à l’hydrate |
| `tests/featureTierNight03b1bis.test.js` | Suite B1-bis |
| `docs/FEATURE-TIERNIGHT-03-B1BIS.md` | Ce rapport |
| `package.json` | Inclut le test B1-bis |

---

## 6. Statut maximal

**Étape B entièrement consolidée et régressions vertes.  
Gate série toujours OFF.  
Étapes C à F restantes.  
QA terrain non réalisée.**
