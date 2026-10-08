# Inventory API

REST API for products and stock levels. Built with Node 22, Express, TypeScript and Zod validation, secured with Helmet.

![CI](https://github.com/Sabin78910/inventory-api-node/actions/workflows/ci.yml/badge.svg)

## Run (Mac Terminal / VS Code)
```bash
npm install
npm run dev        # http://localhost:3000
npm test
docker build -t inventory-api . && docker run -p 3000:3000 inventory-api
```

## API / Output
GET /health · GET /products?lowStock=N · GET /products/:id · POST /products · PATCH /products/:id/stock {delta} · DELETE /products/:id

## Automation (runs on GitHub, no laptop needed)
| Workflow | Trigger | What it does |
|---|---|---|
| CI | push / PR | lint, typecheck, tests, build, npm audit |
| Docker image | push to main / tag | publishes `ghcr.io/sabin78910/inventory-api-node` |
| CodeQL | push / PR / weekly | security analysis |
| Dependabot | weekly | dependency update PRs |
