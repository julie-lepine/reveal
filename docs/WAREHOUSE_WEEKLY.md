# REVEAL — Stats d’usage, rituel hebdo

Déploiement : [DEPLOYMENTS_SQL.md §34](./DEPLOYMENTS_SQL.md).  
Où : [Dashboard Supabase](https://supabase.com/dashboard) → projet **production** (live) → **SQL Editor**.

Les vues ne sont pas dans Table Editor (`public`). L’app n’y a pas accès. Rôle **postgres**.

**Un seul `select` par Run** : l’éditeur n’affiche que le dernier résultat.

Historique **depuis le 15 septembre 2026** seulement. Recettes € : RevenueCat / Play / App Store, pas ici.

---

## Chaque lundi (~10 min)

### 0. Ouvrir le bon projet

Le projet où tu as collé `warehouse` (prod). Pas staging sauf si tu as recollé le SQL là aussi (⏳ au 15 sept 2026).

### 1. Semaine calendaire (jours Paris)

```sql
select *
from warehouse.v_daily
where day >= (timezone('Europe/Paris', now()))::date - 7
order by day;
```

| Colonne | Sens |
| ------- | ---- |
| `lobbies` | salons **créés** ce jour-là |
| `closed` | salons **fermés** (hôte ou purge) |
| `games` | jeux **lancés** (un salon peut en lancer plusieurs) |
| `signups` | nouveaux **comptes** (pas invités) |
| `guest_profiles` | nouveaux profils **invités** |
| `iap_grants` | passage d’un palier à `true` (Sans pub / Signature / Maître) |

`closed` peut décaler d’un jour par rapport à `lobbies` (salon créé samedi, fermé dimanche).

### 2. Jeux de la semaine

```sql
select game_id, sum(starts) as starts
from warehouse.v_games
where day >= (timezone('Europe/Paris', now()))::date - 7
group by game_id
order by starts desc;
```

### 3. Qualité des salons fermés

```sql
select close_reason, sum(n) as n,
  round(sum(avg_peak * n) / nullif(sum(n), 0), 2) as avg_peak,
  round(sum(avg_min * n) / nullif(sum(n), 0), 1) as avg_min
from warehouse.v_lobby_quality
where day >= (timezone('Europe/Paris', now()))::date - 7
group by close_reason;
```

| `close_reason` | Sens |
| -------------- | ---- |
| `host_closed` | l’hôte a fermé |
| `inactive_expired` | purge (inactivité) |

`avg_peak` = taille max moyenne. `avg_min` = durée moyenne en minutes.

Détail jour par jour si un chiffre choque :

```sql
select *
from warehouse.v_lobby_quality
where day >= (timezone('Europe/Paris', now()))::date - 7
order by day desc;
```

### 4. Là, tout de suite (optionnel)

```sql
select * from warehouse.v_live_now;
```

Puis, seulement s’il y a des salons vivants et que tu veux le détail :

```sql
select * from warehouse.lobby_live;
```

### 5. Ce que tu notes (3 lignes)

Exemple : *12 salons, 9 fermés hôte / 3 expirés, pic 3,2, 28 min, jeux : Hot Take 8 / Draw It 5, 2 inscrits, 0 IAP.*

Si `lobbies` = 0 toute la semaine : soit personne n’a joué, soit tu n’es pas sur le projet prod.

---

## Si un chiffre est bizarre

Journal brut (debug, pas le rituel) :

```sql
select event_type, game_id, props, occurred_at
from warehouse.events
order by id desc
limit 30;
```

| Piège | Rappel |
| ----- | ------ |
| Invités vs comptes | Usage réel = `lobbies` / `games`, pas seulement `signups` |
| `games` > `lobbies` | normal : plusieurs jeux par soirée |
| Salon de test | tes propres closes (ex. 15 sept, `host_closed` n = 2) polluent un peu la 1ʳᵉ semaine |
| Purge events | job `reveal-warehouse-purge` à 04:15 UTC ; détail brut 90 j ; IAP gardés |

Ne **pas** recoller `cron.schedule('reveal-warehouse-purge', …)` : ça duplique le job.

---

## Recettes (hors entrepôt)

Même lundi, 2 onglets à part : **RevenueCat** (achats) · **AdMob** (pubs). L’entrepôt dit *combien on joue*, pas *combien ça rapporte*.
