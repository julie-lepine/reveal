# Fusion multijoueur (`game_sessions.state`)

## Piège classique

Les drapeaux « manche déjà traitée » (`roundScored`, `questionScored`, `takeScored`, parfois `podiumApplied`) passent à `true` après scoring, puis l’hôte lance la **manche suivante** avec `false`.

Si la fusion utilise seulement :

```js
mergeTruthy(local, remote) // = true || false → true
```

la manche suivante reste bloquée (votes enregistrés mais pas de reveal / question suivante). Bug observé sur **VibeCheck** (2e chanson), **Dilemma**, etc.

## Règle

Dans `js/core/gameSync.js` :

1. Détecter une **nouvelle manche** avec une fonction `isNew*Round(cur, inc)` (changement de `roundIdx` / `questionIdx` / `takeIdx` / `voteEndsAt` + votes/réponses vidés).
2. Fusionner les drapeaux avec **`mergeRoundFlag(local, remote, isNewRound)`** — pas `mergeTruthy` seul.
3. Appliquer la même logique dans **`merge*GameLocal`** (Realtime) et **`patchGameState`** (écriture hôte).

## Jeux et détecteurs

| Jeu | Drapeau(x) | Détection nouvelle manche |
|-----|------------|---------------------------|
| Hot Take | `takeScored` | `isNewHotTakeVoteRound` (`takeIdx`, `voteEndsAt`) |
| SpeedVote | `roundScored` | `isNewSpeedVoteVoteRound` (`roundIdx`, `voteEndsAt`) |
| Trivia | `questionScored`, `podiumApplied` | `isNewTriviaQuestionRound` (`questionIdx`, `questionEndsAt`) |
| Consensus | `roundScored`, `podiumApplied` | `isNewConsensusQuestionRound` (`questionIdx`, `questionEndsAt`) |
| Dilemma | `roundScored` | `isNewDilemmaVoteRound` (`roundIdx`, `voteEndsAt`) |
| TruthMeter | `roundScored` | `isNewTruthMeterVoteRound` (`roundIdx`, `voteEndsAt`) |
| VibeCheck | `roundScored` | `isNewPlaylistGuessVoteRound` (`roundIdx`, `voteEndsAt`) |
| Guess The Lie | `roundScored` | `isNewGuessLieVoteRound` (`roundIdx`) |

## Nouveau mini-jeu multijoueur

- Réinitialiser explicitement les drapeaux dans le payload de **début de manche**.
- Ajouter `isNew*Round` + `mergeRoundFlag` aux deux chemins de fusion.
- Tester au moins : manche 1 complète → manche 2 (tous votent / répondent → avance automatique).
