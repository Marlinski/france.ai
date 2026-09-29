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
                  src/agent.ts ──▶ API Claude (Opus 5.5), directe ou via OpenRouter
                      │
                      ├─▶ src/fiches.ts  index MiniSearch des fiches DILA
                      └─▶ src/mcp.ts     client MCP ─▶ mcp.data.gouv.fr
                                                     └▶ mcp-service-public
```

- L'historique de chaque conversation est conservé côté serveur, en mémoire, et n'est jamais réécrit (le cache de prompt et les blocs de réflexion restent valides d'un tour à l'autre). Les conversations expirent après une heure d'inactivité.
- Un plafond de questions par IP et par heure (`RATE_LIMIT`) protège le budget d'API.
- Aucun compte, aucun cookie, aucune donnée personnelle conservée au-delà de la conversation.

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
