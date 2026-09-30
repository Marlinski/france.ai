# france.re

**Vos démarches, simplement.** Une porte d'entrée conversationnelle vers les services publics français : on pose sa question en langage courant, un assistant IA cherche la réponse dans les **données publiques ouvertes** et renvoie vers la page officielle et le téléservice à utiliser.

Inspiré d'[america.gov](https://america.gov), mais bâti uniquement sur l'open data français — et **indépendant** : france.re n'est pas un site de l'État.

## Sources

| Source | Accès | Usage |
|---|---|---|
| [Fiches pratiques Service-Public.fr](https://www.data.gouv.fr/datasets/fiches-pratiques-et-ressources-de-service-public-gouv-fr-particuliers) — Particuliers et [Entreprendre](https://www.data.gouv.fr/datasets/fiches-pratiques-et-ressources-entreprendre-service-public-gouv-fr) (DILA, Licence Ouverte 2.0) | Flux XML téléchargé, indexé en plein texte en local, rafraîchi chaque jour | Droits, démarches, pièces à fournir, téléservices, formulaires |
| [data.gouv.fr](https://www.data.gouv.fr) | [Serveur MCP officiel](https://github.com/datagouv/datagouv-mcp) (`mcp.data.gouv.fr`) | Jeux de données, données tabulaires, API publiques |
| Annuaire de l'administration, API Recherche d'entreprises, REI DGFiP, Éducation nationale, Parcoursup, Géorisques, France Travail, Légifrance, BOAMP, BODACC… | Serveur MCP communautaire [mcp-service-public](https://github.com/OneNicolas/mcp-service-public) | Guichets et horaires, entreprises, fiscalité locale, simulateurs, écoles, emploi, droit |

france.re se connecte lui-même aux deux serveurs MCP (client MCP côté serveur) et propose leurs outils à Claude comme des outils ordinaires. Cela fonctionne avec l'API Anthropic comme avec une passerelle compatible (OpenRouter…).

## Fonctionnement

```
navigateur ──SSE──▶ src/server.ts (Hono)
                      │
                      ▼
                  src/agent.ts ──▶ API Messages : Claude en direct, ou OpenRouter (DeepSeek V4.1 Flash par défaut)
                      │
                      ├─▶ src/fiches.ts  index MiniSearch des fiches DILA
                      └─▶ src/mcp.ts     client MCP ─▶ mcp.data.gouv.fr
                                                     └▶ mcp-service-public
```

- L'historique de chaque conversation est conservé côté serveur, en mémoire, et n'est jamais réécrit (le cache de prompt et les blocs de réflexion restent valides d'un tour à l'autre). Les conversations expirent après une heure d'inactivité.
- Un plafond de questions par IP et par heure (`RATE_LIMIT`) protège le budget d'API.
- Aucun compte, aucun cookie.

## Journal et administration

Chaque question est enregistrée dans une base SQLite (`src/db.ts`, via `node:sqlite`, sans dépendance) : question, réponse finale, appels d'outils (nom, paramètres, durée — pas leurs résultats), modèle, durée, jetons, coût estimé, erreur éventuelle, et l'avis 👍/👎 du visiteur. **Aucune adresse IP n'est enregistrée** ; les lignes sont supprimées au bout de `FRANCE_RE_RETENTION_DAYS` jours (90 par défaut). Les visiteurs en sont informés dans « À propos ».

Si `ADMIN_PASSWORD` est défini, `/admin` (utilisateur `admin`, authentification HTTP Basic) permet de :
- rechercher dans les questions et réponses (plein texte FTS5, accents ignorés), filtrer par avis ou par erreur ;
- relire une conversation complète, tour par tour, avec ses appels d'outils ;
- suivre les statistiques par jour (questions, conversations, erreurs, avis, durée, coût) ;
- exporter tout le journal en JSON (`/admin/export.json`).

| Variable | Défaut | Rôle |
|---|---|---|
| `ADMIN_PASSWORD` | — | Active `/admin` |
| `FRANCE_RE_DB` | `data/france-re.sqlite` | Chemin de la base |
| `FRANCE_RE_RETENTION_DAYS` | `90` | Durée de conservation |

## Lancer en local

Node 24+ (exécute le TypeScript directement).

```sh
npm install
npm run index                 # télécharge et convertit les fiches → data/fiches.json (~10 s)
cp .env.example .env          # renseigner ANTHROPIC_API_KEY (et ANTHROPIC_BASE_URL pour OpenRouter)
node --env-file=.env src/server.ts
# → http://localhost:3000
```

Variables : voir [`.env.example`](.env.example).

## Image

```sh
docker build -t france.re .
docker run --rm -p 8080:8080 -e ANTHROPIC_API_KEY=… france.re
```

La CI publie `ghcr.io/marlinski/france.re:latest` à chaque push sur `main`.

## Avertissement

Les réponses sont générées par une IA et peuvent contenir des erreurs. Elles renvoient toujours vers la source officielle : vérifiez-la avant d'agir.

## Licence

Code sous licence [MIT](LICENSE). Les fiches Service-Public.fr sont © DILA, réutilisées sous [Licence Ouverte 2.0](https://www.etalab.gouv.fr/licence-ouverte-open-licence/).
