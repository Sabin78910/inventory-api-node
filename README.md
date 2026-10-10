# Inventory API

REST API for products and stock levels. Built with Node 22, Express, TypeScript and Zod validation, secured with Helmet.

![CI](https://github.com/Sabin78910/inventory-api-node/actions/workflows/ci.yml/badge.svg)

**Live:** https://inventory-api-tagg.onrender.com (try [`/health`](https://inventory-api-tagg.onrender.com/health)). Hosted on Render's free plan: it sleeps when idle, so the first request can take about 30–60 s. Data is in memory and resets on restart.

## Run (Mac Terminal / VS Code)
```bash
npm install
npm run dev        # http://localhost:3000
npm test
docker build -t inventory-api . && docker run -p 3000:3000 inventory-api
```

## API / Output
GET /health · GET /products?lowStock=N&category=X · GET /products/:id · POST /products · PATCH /products/:id/stock {delta} · DELETE /products/:id

Products have an optional `category` (1–50 chars) on create/PATCH and in CSV import/export; `GET /products?category=x` filters case-insensitively and combines with `q`, `sort`, `limit` and `offset`.

`POST /products` accepts an optional `Idempotency-Key` header: a retry with the same key and body replays the original response (`Idempotent-Replayed: true`); same key with a different body returns 422. Keys live in memory for 24 h.

API spec: [`/openapi.json`](https://inventory-api-tagg.onrender.com/openapi.json) · [view in Swagger UI](https://petstore.swagger.io/?url=https://inventory-api-tagg.onrender.com/openapi.json)

## Automation (runs on GitHub, no laptop needed)
| Workflow | Trigger | What it does |
|---|---|---|
| CI | push / PR | lint, typecheck, tests, build, npm audit |
| Docker image | push to main / tag | publishes `ghcr.io/sabin78910/inventory-api-node` |
| CodeQL | push / PR / weekly | security analysis |
| Dependabot | weekly | dependency update PRs |

## API key (write protection)
Set the `API_KEY` env var to require an `X-API-Key` header on POST/PATCH/DELETE
(missing or wrong key → 401). Reads stay public. If unset, writes are open.
`render.yaml` generates a value on Render; find it in the service's Environment tab.
